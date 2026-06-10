// Board editing primitives: inline rename (replaces the old prompt() flow),
// the add-tile dialog, and delete-with-undo-toast (replaces confirm()).
import { h, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { openDialog } from '../lib/dialog.js';
import { loadDashboard } from '../state/store.js';

// Swap a label element's content for an input; Enter/blur commits, Esc
// cancels. The board re-render after onSubmit removes the input naturally.
export function inlineEdit(el, { value, onSubmit, allowEmpty = false }) {
  if (el.querySelector('.inline-edit')) return; // already editing
  const original = el.innerHTML;
  const input = h('input', { class: 'inline-edit', type: 'text' });
  input.value = value;
  el.innerHTML = '';
  el.append(input);
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (commit && (next || allowEmpty) && next !== value) {
      onSubmit(next).catch((err) => toast(err.message, { error: true }));
    } else {
      el.innerHTML = original;
    }
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (e) => e.stopPropagation());
}

export async function addTileTo(sectionId) {
  const values = await openDialog({
    title: 'New tile',
    submitLabel: 'Add tile',
    fields: [
      { name: 'name', placeholder: 'Name' },
      { name: 'url', placeholder: 'http://service.huis' },
      { name: 'description', placeholder: 'Description (optional)' },
    ],
  });
  if (!values?.name || !values?.url) return;
  let url = values.url;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) url = `http://${url}`;
  try {
    await api(`/api/sections/${sectionId}/tiles`, jsonBody({ name: values.name, url, description: values.description }));
    await loadDashboard();
  } catch (err) {
    toast(`Could not add tile: ${err.message}`, { error: true });
  }
}

// DELETE, refresh, and offer a one-click Undo instead of asking first.
export async function deleteWithUndo(path, label) {
  try {
    await api(path, { method: 'DELETE' });
    await loadDashboard();
    toast(label, {
      action: 'Undo',
      onAction: async () => {
        await api('/api/undo', { method: 'POST' });
        await loadDashboard();
      },
    });
  } catch (err) {
    toast(err.message, { error: true });
  }
}
