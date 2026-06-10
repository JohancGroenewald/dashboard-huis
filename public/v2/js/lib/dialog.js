// Small modal dialog used wherever the old UI used prompt(). Returns a
// Promise resolving to the field values, or null when dismissed.
import { h } from './dom.js';
import { pushEscLayer } from '../keys.js';

export function openDialog({ title, fields, submitLabel = 'Save' }) {
  return new Promise((resolve) => {
    const form = h('form');
    const inputs = {};
    for (const f of fields) {
      if (f.label) form.append(h('div', { class: 'field-label' }, f.label));
      const el = f.multiline
        ? h('textarea', { rows: 2, placeholder: f.placeholder || '' })
        : h('input', { type: 'text', placeholder: f.placeholder || '', autocomplete: 'off' });
      el.value = f.value || '';
      inputs[f.name] = el;
      form.append(el);
    }
    const cancelBtn = h('button', { class: 'ghost-btn', type: 'button' }, 'Cancel');
    form.append(h('div', { class: 'dialog-actions' }, cancelBtn, h('button', { class: 'primary-btn', type: 'submit' }, submitLabel)));

    const backdrop = h('div', { class: 'dialog-backdrop' }, h('div', { class: 'dialog' }, h('h2', {}, title), form));
    document.body.append(backdrop);
    const popEsc = pushEscLayer(() => close(null));
    inputs[fields[0].name].focus();

    function close(result) {
      popEsc();
      backdrop.remove();
      resolve(result);
    }
    cancelBtn.addEventListener('click', () => close(null));
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(null); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const values = {};
      for (const [name, el] of Object.entries(inputs)) values[name] = el.value.trim();
      close(values);
    });
  });
}
