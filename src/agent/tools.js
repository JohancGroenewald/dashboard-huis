// The agent's capability surface. These tools are the ONLY way a model can
// affect the dashboard — there is no shell, file, or network access here.
// Handlers are bound to a Store, so the identical tool set runs against the
// live store (the agent) and a throwaway store (the validation sandbox).
// The JSON-schema specs live in tool-specs.js (re-exported here).
import { AGENT_LIMITS } from '../constants.js';
import { pressTrigger } from '../triggers.js';
import { readScraperRows } from '../scraper-results.js';
import { toolSpecs } from './tool-specs.js';

export { toolSpecs };
export const toolNames = toolSpecs.map((t) => t.function.name);

// Build name -> handler(args) bound to a given store. Handlers return plain,
// JSON-serializable summaries that get fed back to the model as tool results.
// `requestedBy` labels feature requests the model files (defaults to the model).
export function makeToolHandlers(store, { requestedBy = 'agent', scraperResults = null } = {}) {
  // Resolve a section by id first, then by case-insensitive name.
  const resolveSectionMaybe = (ref) => {
    const { sections } = store.getState();
    const byId = sections.find((s) => s.id === ref);
    if (byId) return byId;
    const matches = sections.filter((s) => s.name.toLowerCase() === String(ref).toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Don't guess — tell the model exactly how to disambiguate.
      throw new Error(`"${ref}" is ambiguous: ${matches.length} sections share that name. Use the section id — one of: ${matches.map((s) => s.id).join(', ')}`);
    }
    return null;
  };

  const resolveSection = (ref) => {
    const section = resolveSectionMaybe(ref);
    if (section) return section;
    throw new Error(`no section matching "${ref}"`);
  };

  // Resolve a workspace by id first, then by case-insensitive name.
  const resolveWorkspace = (ref) => {
    const { workspaces } = store.getState();
    const byId = workspaces.find((w) => w.id === ref);
    if (byId) return byId;
    const matches = workspaces.filter((w) => w.name.toLowerCase() === String(ref).toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(`"${ref}" is ambiguous: ${matches.length} workspaces share that name. Use the workspace id — one of: ${matches.map((w) => w.id).join(', ')}`);
    }
    throw new Error(`no workspace matching "${ref}"`);
  };

  return {
    get_dashboard: () => {
      const s = store.getState();
      // layout = { x, y, w, h } grid cells (w×h is the card's size). Empty = auto.
      return {
        title: s.title,
        activeWorkspaceId: s.activeWorkspaceId,
        workspaces: s.workspaces.map((w) => ({ id: w.id, name: w.name, active: w.id === s.activeWorkspaceId, background: w.background })),
        sections: s.sections.map((sec) => ({
          id: sec.id,
          name: sec.name,
          description: sec.description || '', // always shown so the field is discoverable
          color: sec.color || '',
          borderColor: sec.borderColor || '',
          headingColor: sec.headingColor || '',
          headingEffect: sec.headingEffect || 'none',
          bold: sec.bold,
          collapsed: sec.collapsed,
          workspaceId: sec.workspaceId,
          layout: sec.layout,
          tiles: sec.tiles.map((t) => ({
            id: t.id,
            name: t.name,
            url: t.url,
            description: t.description || '', // editable via add_tile/update_tile
            icon: t.icon || '',
            bold: t.bold,
          })),
        })),
        notes: s.notes.map((n) => ({
          id: n.id,
          text: n.text,
          color: n.color,
          textColor: n.textColor || '',
          bold: n.bold,
          hidden: n.hidden,
          workspaceId: n.workspaceId,
          layout: n.layout,
        })),
        games: s.games.map((g) => ({ id: g.id, kind: g.kind, workspaceId: g.workspaceId, layout: g.layout })),
        triggers: s.triggers.map((t) => ({
          id: t.id, name: t.name, cooldownMs: t.cooldownMs, lastPressedAt: t.lastPressedAt, workspaceId: t.workspaceId, layout: t.layout,
        })),
        scrapers: s.scrapers.map((sc) => ({
          id: sc.id, name: sc.name, url: sc.url, instruction: sc.instruction, pageMode: sc.pageMode, pageTokens: sc.pageTokens,
          sourceMode: sc.sourceMode, sourceProcess: sc.sourceProcess,
          rows: sc.result?.rowCount ?? sc.result?.rows.length ?? 0, workspaceId: sc.workspaceId, layout: sc.layout,
        })),
        featureRequests: s.featureRequests.map((f) => ({ id: f.id, title: f.title, status: f.status })),
        problems: s.problems.map((p) => ({ id: p.id, title: p.title, status: p.status })),
      };
    },

    add_workspace: ({ name }) => ({ added: store.addWorkspace({ name }) }),

    rename_workspace: ({ workspace, name }) => ({
      updated: store.renameWorkspace(resolveWorkspace(workspace).id, name),
    }),

    set_workspace_background: ({ workspace, effect, formula, palette, speed, density, intensity }) => {
      const w = resolveWorkspace(workspace);
      return {
        updated: store.updateWorkspaceBackground(w.id, { effect, formula, palette, speed, density, intensity }),
        workspace: { id: w.id, name: w.name },
      };
    },

    remove_workspace: ({ workspace }) => ({ removed: store.removeWorkspace(resolveWorkspace(workspace).id) }),

    add_game: ({ kind }) => ({ added: store.addGame({ kind: kind || 'tictactoe' }) }),
    remove_game: ({ game_id }) => ({ removed: store.removeGame(game_id) }),

    add_trigger: ({ name, cooldown_minutes }) => ({
      added: store.addTrigger({ name, ...(cooldown_minutes !== undefined ? { cooldownMs: Number(cooldown_minutes) * 60_000 } : {}) }),
    }),
    press_trigger: ({ trigger_id }) => ({ pressed: pressTrigger(store, trigger_id) }),
    remove_trigger: ({ trigger_id }) => ({ removed: store.removeTrigger(trigger_id) }),

    add_scraper: ({ name, url, instruction }) => ({ added: store.addScraper({ name, url, instruction, model: requestedBy }) }),
    remove_scraper: ({ scraper_id }) => ({ removed: store.removeScraper(scraper_id) }),

    // Read a window of a scraper's extracted rows so the model can work with
    // the data; page through large tables with offset/limit.
    read_scraper: ({ scraper_id, offset, limit }) => {
      const sc = store.getScraper(scraper_id);
      const r = sc.result;
      if (!r) return { name: sc.name, columns: [], rows: [], total: 0, returned: 0, offset: 0, note: 'no results yet — the user must run this scraper first' };
      const start = Math.max(0, Math.trunc(Number(offset) || 0));
      const n = Math.min(Math.max(1, Math.trunc(Number(limit) || AGENT_LIMITS.scraperReadDefault)), AGENT_LIMITS.scraperReadMax);
      return readScraperRows(sc, scraperResults, { offset: start, limit: n });
    },

    switch_workspace: ({ workspace }) => {
      const w = resolveWorkspace(workspace);
      store.setActiveWorkspace(w.id);
      return { activeWorkspace: { id: w.id, name: w.name } };
    },

    move_to_workspace: ({ item, workspace }) => {
      const ws = resolveWorkspace(workspace);
      // Sections and triggers resolve by unique name too; notes and games
      // move by id (use search_dashboard to turn a reference into an id).
      const section = resolveSectionMaybe(item);
      const byName = store.getState().triggers.filter((t) => t.name.toLowerCase() === String(item).toLowerCase());
      const id = section?.id || (byName.length === 1 ? byName[0].id : item);
      return { moved: store.moveCardToWorkspace(id, ws.id) };
    },

    add_section: ({ name, description }) => ({ added: store.addSection({ name, description }) }),

    rename_section: ({ section, name }) => ({
      updated: store.updateSection(resolveSection(section).id, { name }),
    }),

    update_section: ({ section, description, color, borderColor, headingColor, headingEffect, bold }) => {
      const patch = {};
      for (const [k, v] of Object.entries({ description, color, borderColor, headingColor, headingEffect, bold })) {
        if (v !== undefined) patch[k] = v;
      }
      return { updated: store.updateSection(resolveSection(section).id, patch) };
    },

    remove_section: ({ section }) => ({ removed: store.removeSection(resolveSection(section).id) }),

    add_tile: ({ section, name, url, description, icon, enable_health }) => ({
      added: store.addTile(resolveSection(section).id, {
        name,
        url,
        description,
        icon,
        health: { enabled: Boolean(enable_health), type: 'http' },
      }),
    }),

    update_tile: ({ tile_id, enable_health, ...rest }) => {
      const patch = { ...rest };
      if (enable_health !== undefined) patch.health = { enabled: Boolean(enable_health), type: 'http' };
      return { updated: store.updateTile(tile_id, patch) };
    },

    remove_tile: ({ tile_id }) => ({ removed: store.removeTile(tile_id) }),

    move_tile: ({ tile_id, section, position }) => ({
      moved: store.moveTile(tile_id, resolveSection(section).id, position),
    }),

    move_section: ({ section, position }) => ({
      moved: store.moveSection(resolveSection(section).id, position),
    }),

    add_note: ({ text, color }) => ({ added: store.addNote({ text, color }) }),

    update_note: ({ note_id, ...patch }) => ({ updated: store.updateNote(note_id, patch) }),

    remove_note: ({ note_id }) => ({ removed: store.removeNote(note_id) }),

    search_dashboard: ({ query }) => ({ matches: store.search(query) }),

    undo: () => {
      const s = store.undo();
      return s ? { undone: true, canUndo: store.canUndo(), canRedo: store.canRedo() } : { undone: false, reason: 'nothing to undo' };
    },

    redo: () => {
      const s = store.redo();
      return s ? { redone: true, canUndo: store.canUndo(), canRedo: store.canRedo() } : { redone: false, reason: 'nothing to redo' };
    },

    resize_card: ({ card, w, h }) => {
      const section = resolveSectionMaybe(card);
      if (section) return { resized: store.resizeCard(section.id, { w, h }) };
      const note = store.getState().notes.find((n) => n.id === card);
      if (!note) throw new Error(`no section or note matching "${card}"`);
      return { resized: store.resizeCard(note.id, { w, h }) };
    },

    // UI-only: surface clickable buttons/chips in the chat (no state change).
    offer_choices: ({ choices }) => ({
      offered: Array.isArray(choices) ? choices.slice(0, AGENT_LIMITS.offeredChoicesMax).map((c) => String(c)) : [],
    }),

    suggest_followups: ({ suggestions }) => ({
      suggestions: Array.isArray(suggestions) ? suggestions.slice(0, AGENT_LIMITS.followupsMax).map((s) => String(s)) : [],
    }),

    report_problem: ({ title, detail }) => ({
      filed: store.addProblem({ title, detail, reportedBy: requestedBy, status: 'open' }),
    }),

    request_feature: ({ title, detail }) => ({
      filed: store.addFeatureRequest({ title, detail, requestedBy, status: 'open' }),
    }),
  };
}
