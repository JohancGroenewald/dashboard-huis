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
        'Read the current dashboard: its title and every section and tile with their ids. Call this first to learn the ids you need for other tools.',
      parameters: { type: 'object', properties: {}, required: [] },
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
      description: 'Edit an existing sticky note.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          text: { type: 'string' },
          color: { type: 'string' },
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

  return {
    get_dashboard: () => {
      const s = store.getState();
      return {
        title: s.title,
        sections: s.sections.map((sec) => ({
          id: sec.id,
          name: sec.name,
          tiles: sec.tiles.map((t) => ({
            id: t.id,
            name: t.name,
            url: t.url,
            ...(t.description ? { description: t.description } : {}),
          })),
        })),
        notes: s.notes.map((n) => ({ id: n.id, text: n.text })),
        featureRequests: s.featureRequests.map((f) => ({ id: f.id, title: f.title, status: f.status })),
      };
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

    request_feature: ({ title, detail }) => ({
      filed: store.addFeatureRequest({ title, detail, requestedBy, status: 'open' }),
    }),
  };
}
