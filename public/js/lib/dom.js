// DOM helpers shared by every v2 module.
import { TOAST_UI } from '../constants.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// Tiny element builder for the few places template strings get awkward.
// h('button', { class: 'x', onclick: fn }, 'label')
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// Bottom-center toast. Pass an action to get a button (e.g. deletes offer
// Undo); returns a dispose function. Errors stick around a little longer.
export function toast(message, { action, onAction, error = false, duration } = {}) {
  const box = $('#toasts');
  const el = h('div', { class: `toast${error ? ' error' : ''}` }, message);
  if (action && onAction) {
    el.append(h('button', {
      class: 'toast-action',
      type: 'button',
      onclick: () => { dispose(); onAction(); },
    }, action));
  }
  box.append(el);
  const ms = duration ?? (error ? TOAST_UI.errorDurationMs : action ? TOAST_UI.undoDurationMs : TOAST_UI.durationMs);
  const timer = setTimeout(() => el.remove(), ms);
  function dispose() { clearTimeout(timer); el.remove(); }
  return dispose;
}

// Scroll a board card (or tile chip) into view and flash it briefly.
export function flashElement(el, cls = 'flash', ms = 1_600) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}
