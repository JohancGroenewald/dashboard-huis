// Tool/function definitions advertised to the model (the JSON-schema specs).
// Kept separate from the handler logic in tools.js so each file stays small.
// These declarations are the agent's entire capability surface.

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
      name: 'set_workspace_background',
      description:
        'Set or clear a full-workspace animated math-art canvas background. Choose a preset effect, or write your own maths with effect="formula": one expression over x, y (screen coords, −1..1), r (radius), a (angle), t (seconds), using sin cos tan sqrt abs exp log pow min max floor sign hypot tanh fract atan2, constants pi/tau/e and + - * / % ^. Its value maps −1..1 onto the palette. Example: sin(8*r - 2*t) * exp(-r) + 0.3*sin(x*5+t). Use effect="none" to clear the background.',
      parameters: {
        type: 'object',
        properties: {
          workspace: { type: 'string', description: 'Workspace id or name.' },
          effect: { type: 'string', enum: ['none', 'waves', 'orbits', 'plasma', 'stars', 'formula'], description: 'Preset effect, or "formula" to supply your own expression.' },
          formula: { type: 'string', description: 'Required when effect="formula": the math expression to render.' },
          palette: { type: 'array', items: { type: 'string' }, description: 'Up to 6 colour names or hex colours.' },
          speed: { type: 'number', description: 'Animation speed from 0 to 5. Use 1 for normal.' },
          density: { type: 'number', description: 'How busy the pattern is, from 0 to 5. Use 1 for normal.' },
          intensity: { type: 'number', description: 'Opacity/brightness strength, from 0 to 5. Use 1 for normal.' },
        },
        required: ['workspace', 'effect'],
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
      name: 'add_game',
      description: 'Add a playable game card to the active workspace (kringetjies en kruisies / tic-tac-toe). The user plays it on the board and a model co-plays the moves.',
      parameters: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['tictactoe'], description: 'Game kind. Default tictactoe.' } },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_game',
      description: 'Delete a game card by id.',
      parameters: {
        type: 'object',
        properties: { game_id: { type: 'string', description: 'Game id.' } },
        required: ['game_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_trigger',
      description: 'Add a trigger card: a named button that records a timestamp when pressed, then refuses repeat presses until its cooldown expires (e.g. "Fed the dog", 6 hours).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the trigger tracks.' },
          cooldown_minutes: { type: 'number', description: 'Minutes before it can be pressed again. Default 360 (6 hours).' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'press_trigger',
      description: 'Press a trigger card for the user, recording the timestamp now. Fails with the remaining time if it is still cooling down.',
      parameters: {
        type: 'object',
        properties: { trigger_id: { type: 'string', description: 'Trigger id.' } },
        required: ['trigger_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_trigger',
      description: 'Delete a trigger card by id.',
      parameters: {
        type: 'object',
        properties: { trigger_id: { type: 'string', description: 'Trigger id.' } },
        required: ['trigger_id'],
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
      description: 'Move a section (with its tiles), sticky note, game, or trigger into a different workspace.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'A section id or name, or the id of a note, game, or trigger (use search_dashboard to resolve a name to an id).' },
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
        properties: {
          name: { type: 'string', description: 'Section title, e.g. "Monitoring".' },
          description: { type: 'string', description: 'Optional one-line description shown under the title.' },
        },
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
      name: 'update_section',
      description: "Set a section's description, card colours, heading style, and/or heading effect. Only provided fields change. Colours accept a CSS colour name (e.g. \"blue\") or hex (e.g. \"#1a2233\"); pass an empty string to clear one back to the default. Use headingEffect=\"rainbow\" for cycling rainbow heading colours, or \"none\" to disable it.",
      parameters: {
        type: 'object',
        properties: {
          section: { type: 'string', description: 'Section id or name.' },
          description: { type: 'string', description: 'Description shown under the title.' },
          color: { type: 'string', description: 'Card background (fill) colour.' },
          borderColor: { type: 'string', description: 'Card outline (border) colour.' },
          headingColor: { type: 'string', description: 'Heading (title) text colour.' },
          headingEffect: { type: 'string', enum: ['none', 'rainbow'], description: 'Animated heading effect. Use "rainbow" to cycle heading colours, or "none" for a normal static heading.' },
          bold: { type: 'boolean', description: 'Whether the heading is bold.' },
        },
        required: ['section'],
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
      description: 'Change fields on an existing tile. Only provided fields are modified. To set a tile\'s description, pass "description" (NOT "name" — name is the tile\'s title/label).',
      parameters: {
        type: 'object',
        properties: {
          tile_id: { type: 'string', description: 'Id of the tile to update.' },
          name: { type: 'string', description: 'The tile\'s title/label (e.g. "Grafana"). Only change this to rename the tile.' },
          url: { type: 'string', description: 'The link target.' },
          description: { type: 'string', description: 'The sub-text shown under the tile name.' },
          icon: { type: 'string', description: 'Emoji or short label, e.g. "📊".' },
          bold: { type: 'boolean', description: 'Whether the tile label is bold.' },
          enable_health: { type: 'boolean', description: 'Whether to health-check this tile.' },
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
          color: { type: 'string', description: 'Optional background colour: color name, hex, or "transparent".' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_note',
      description: 'Edit a sticky note: text, background colour, text colour, bold state, or hide/show it.',
      parameters: {
        type: 'object',
        properties: {
          note_id: { type: 'string' },
          text: { type: 'string' },
          color: { type: 'string', description: 'Background colour (name, hex, "transparent", or empty string for the default).' },
          textColor: { type: 'string', description: 'Text colour (name or hex).' },
          bold: { type: 'boolean', description: 'Whether the note text is bold.' },
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
      name: 'undo',
      description: 'Undo the last dashboard change (revert the most recent mutation). Call it again to step further back. Use this when the user asks to undo, revert, or take back the last change.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'redo',
      description: 'Re-apply the change that was just undone.',
      parameters: { type: 'object', properties: {}, required: [] },
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
      name: 'report_problem',
      description:
        'Report a problem to the dashboard maintainers: a tool call that keeps failing, something that looks broken, or a task you could not complete for a technical reason. Include what you tried and the error. Not for missing capabilities — that is request_feature.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short summary of the problem.' },
          detail: { type: 'string', description: 'What you tried, what happened, any error text.' },
        },
        required: ['title'],
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
