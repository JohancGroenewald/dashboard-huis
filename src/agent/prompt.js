// System prompt for the dashboard agent. The template lives in src/prompts.js
// (editable from the Prompts view); this fills its per-request placeholders.
import { renderPrompt } from '../prompts.js';

export function systemPrompt(store) {
  const state = store.getState();
  const activeId = state.activeWorkspaceId;
  const wsLine = state.workspaces
    .map((w) => `"${w.name}" (id: ${w.id})${w.id === activeId ? ' [active]' : ''}`)
    .join(', ');
  const snapshot = state.sections
    .filter((s) => s.workspaceId === activeId)
    .map((s) => {
      const tiles = s.tiles.map((t) => `    - "${t.name}" (id: ${t.id}) → ${t.url}`).join('\n');
      return `  Section "${s.name}" (id: ${s.id})\n${tiles || '    (empty)'}`;
    })
    .join('\n');

  return renderPrompt('agent', {
    title: state.title,
    workspaces: wsLine,
    snapshot: snapshot || '  (no sections in the active workspace yet)',
  });
}
