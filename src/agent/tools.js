// The agent's capability surface. These tools are the ONLY way a model can
// affect the dashboard — there is no shell, file, or network access here.
// Handlers are bound to a Store, so the identical tool set runs against the
// live store (the agent) and a throwaway store (the validation sandbox).

export const toolSpecs = [
  {
    type: 'function',
    function: {
      name: 'get_dashboard',
      description:
        'Read the current dashboard: its workspaces (with the active one), and every section, tile, and note with their ids and which workspace they belong to. Call this first to learn the ids you need for other tools.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_workspace',
      description: 'Create a new workspace — a separate tabbed board with its own sections and notes. Does not switch to it; use switch_workspace for that.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Workspace name, e.g. "Media Room".' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_workspace',
      description: 'Rename an existing workspace.',
      parameters: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Workspace id or current name.' },
          name: { type: 'string', description: 'New workspace name.' },
        },
        required: ['workspace', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_workspace',
      description: 'Delete a workspace. Only works if it has no sections or notes (move or delete those first) and it is not the last workspace.',
      parameters: {
        type: 'object',
        properties: { workspace: { type: 'string', description: 'Workspace id or name.' } },
        required: ['workspace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'switch_workspace',
      description: 'Make a workspace the active one — the board shows it and new sections/notes land in it.',
      parameters: {
        type: 'object',
        properties: { workspace: { type: 'string', description: 'Workspace id or name to switch to.' } },
        required: ['workspace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_to_workspace',
      description: 'Move a section (with its tiles) or a sticky note into a different workspace.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'A section id or name, or a note id, to move.' },
          workspace: { type: 'string', description: 'Destination workspace id or name.' },
        },
        required: ['item', 'workspace'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_section',
      description: 'Create a new, empty section (a group of tiles) on the dashboard.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Section title, e.g. "Monitoring".' } },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_section',
      description: 'Rename an existing section.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Section id or current name.' },
          name: { type: 'string', description: 'New section title.' },
        },
        required: ['section', 'name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_section',
      description: 'Delete a section AND all tiles inside it. Use with care.',
      parameters: {
        type: 'object',
        properties: { section: { type: 'string', description: 'Section id or name.' } },
        required: ['section'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_tile',
      description: 'Add a service tile (a labelled link) to a section.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Target section id or name.' },
          name: { type: 'string', description: 'Tile label, e.g. "Grafana".' },
          url: { type: 'string', description: 'Link target, e.g. "http://grafana.huis:3000".' },
          description: { type: 'string', description: 'Optional one-line description.' },
          icon: { type: 'string', description: 'Optional emoji or short label, e.g. "📊".' },
          enable_health: { type: 'boolean', description: 'Whether to health-check this tile (default false).' },
        },
        required: ['section', 'name', 'url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_tile',
      description: 'Change fields on an existing tile. Only provided fields are modified.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string', description: 'Id of the tile to update.' },
          name: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          icon: { type: 'string' },
          enable_health: { type: 'boolean' },
        },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_tile',
      description: 'Delete a single tile by its id.',
      parameters: {
        type: 'object',
        properties: { tile_id: { type: 'string', description: 'Id of the tile to remove.' } },
        required: ['tile_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_tile',
      description: 'Move a tile to a different section and/or position.',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string' },
          section: { type: 'string', description: 'Destination section id or name.' },
          position: { type: 'integer', description: 'Zero-based index within the section (optional).' },
        },
        required: ['tile_id', 'section'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_section',
      description: 'Reorder a section to a new position on the dashboard.',
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Section id or name to move.' },
          position: { type: 'integer', description: 'Zero-based target index among sections.' },
        },
        required: ['section', 'position'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_note',
      description: 'Add a sticky note to the dashboard.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Note contents.' },
          color: { type: 'string', description: 'Optional color name or hex, e.g. "yellow".' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_note',
      description: 'Edit a sticky note: text, background colour, text colour, or hide/show it.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          text: { type: 'string' },
          color: { type: 'string', description: 'Background colour (name or hex).' },
          textColor: { type: 'string', description: 'Text colour (name or hex).' },
          hidden: { type: 'boolean', description: 'Hide the note from the board without deleting it.' },
        },
        required: ['note_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_note',
      description: 'Delete a sticky note by id.',
      parameters: {
        type: 'object',
        properties: { note_id: { type: 'string' } },
        required: ['note_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_dashboard',
      description:
        'Find dashboard items by a free-text query like "the green note", "grafana", or "monitoring". Matches names, note text, note colour, URLs, descriptions, and section. Returns ranked matches with their ids and type — use it to resolve a vague reference before updating, moving, resizing, or removing something, instead of guessing an id.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What to look for, e.g. "green note".' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resize_card',
      description:
        'Resize a card on the dashboard grid — a section or a sticky note — by setting its width and height in grid cells. The grid is 12 columns wide.',
      parameters: {
        type: 'object',
        properties: {
          card: { type: 'string', description: 'Section id or name, or a note id.' },
          w: { type: 'integer', description: 'Width in grid columns (1–12).' },
          h: { type: 'integer', description: 'Height in grid rows (1 or more).' },
        },
        required: ['card', 'w', 'h'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'suggest_followups',
      description:
        'Optionally offer 2–4 short follow-up actions the user might want next (e.g. "Add another tile", "Make it wider"). Shown as dismissable chips under your reply; clicking one pre-fills their input to edit and send. Use sparingly, only when there are obvious next steps.',
      parameters: {
        type: 'object',
        properties: {
          suggestions: { type: 'array', items: { type: 'string' }, description: '2–4 short next-step suggestions.' },
        },
        required: ['suggestions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'offer_choices',
      description:
        'Offer the user a few clickable choices (e.g. ["Yes","No"]) when you need a decision or confirmation. Put the question in your reply text and pass the options here; the user clicks one and it becomes their next message. Prefer this over asking them to type for yes/no or either/or questions.',
      parameters: {
        type: 'object',
        properties: {
          choices: { type: 'array', items: { type: 'string' }, description: '2–6 short options, e.g. ["Yes","No"].' },
        },
        required: ['choices'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_feature',
      description:
        'File a feature request for the dashboard maintainers. Use this when the user asks for something you cannot do with your current tools, instead of refusing or pretending.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short summary of the requested feature.' },
          detail: { type: 'string', description: 'Optional details / rationale.' },
        },
        required: ['title'],
      },
    },
  },
];

export const toolNames = toolSpecs.map((t) => t.function.name);

// Build name -> handler(args) bound to a given store. Handlers return plain,
// JSON-serializable summaries that get fed back to the model as tool results.
// `requestedBy` labels feature requests the model files (defaults to the model).
export function makeToolHandlers(store, { requestedBy = 'agent' } = {}) {
  // Resolve a section by id first, then by case-insensitive name.
  const resolveSection = (ref) => {
    const { sections } = store.getState();
    const byId = sections.find((s) => s.id === ref);
    if (byId) return byId;
    const matches = sections.filter((s) => s.name.toLowerCase() === String(ref).toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Don't guess — tell the model exactly how to disambiguate.
      throw new Error(`"${ref}" is ambiguous: ${matches.length} sections share that name. Use the section id — one of: ${matches.map((s) => s.id).join(', ')}`);
    }
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
        workspaces: s.workspaces.map((w) => ({ id: w.id, name: w.name, active: w.id === s.activeWorkspaceId })),
        sections: s.sections.map((sec) => ({
          id: sec.id,
          name: sec.name,
          workspaceId: sec.workspaceId,
          layout: sec.layout,
          tiles: sec.tiles.map((t) => ({
            id: t.id,
            name: t.name,
            url: t.url,
            ...(t.description ? { description: t.description } : {}),
          })),
        })),
        notes: s.notes.map((n) => ({ id: n.id, text: n.text, color: n.color, workspaceId: n.workspaceId, layout: n.layout })),
        featureRequests: s.featureRequests.map((f) => ({ id: f.id, title: f.title, status: f.status })),
      };
    },

    add_workspace: ({ name }) => ({ added: store.addWorkspace({ name }) }),

    rename_workspace: ({ workspace, name }) => ({
      updated: store.renameWorkspace(resolveWorkspace(workspace).id, name),
    }),

    remove_workspace: ({ workspace }) => ({ removed: store.removeWorkspace(resolveWorkspace(workspace).id) }),

    switch_workspace: ({ workspace }) => {
      const w = resolveWorkspace(workspace);
      store.setActiveWorkspace(w.id);
      return { activeWorkspace: { id: w.id, name: w.name } };
    },

    move_to_workspace: ({ item, workspace }) => {
      const ws = resolveWorkspace(workspace);
      const s = store.getState();
      const section = s.sections.find((x) => x.id === item) ||
        s.sections.find((x) => x.name.toLowerCase() === String(item).toLowerCase());
      if (section) return { moved: store.moveSectionToWorkspace(section.id, ws.id) };
      const note = s.notes.find((n) => n.id === item);
      if (note) return { moved: store.moveNoteToWorkspace(note.id, ws.id) };
      throw new Error(`no section or note matching "${item}"`);
    },

    add_section: ({ name }) => ({ added: store.addSection({ name }) }),

    rename_section: ({ section, name }) => ({
      updated: store.updateSection(resolveSection(section).id, { name }),
    }),

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

    resize_card: ({ card, w, h }) => {
      const s = store.getState();
      const sec =
        s.sections.find((x) => x.id === card) ||
        s.sections.find((x) => x.name.toLowerCase() === String(card).toLowerCase());
      const id = sec ? sec.id : s.notes.find((n) => n.id === card)?.id;
      if (!id) throw new Error(`no section or note matching "${card}"`);
      return { resized: store.resizeCard(id, { w, h }) };
    },

    // UI-only: surface clickable buttons/chips in the chat (no state change).
    offer_choices: ({ choices }) => ({
      offered: Array.isArray(choices) ? choices.slice(0, 6).map((c) => String(c)) : [],
    }),

    suggest_followups: ({ suggestions }) => ({
      suggestions: Array.isArray(suggestions) ? suggestions.slice(0, 4).map((s) => String(s)) : [],
    }),

    request_feature: ({ title, detail }) => ({
      filed: store.addFeatureRequest({ title, detail, requestedBy, status: 'open' }),
    }),
  };
}
