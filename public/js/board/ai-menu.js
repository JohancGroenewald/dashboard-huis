// The per-card ✦ menu: act on exactly this item with the copilot. "Ask
// about this…" attaches the item and focuses the composer; canned prompts
// pre-fill it (the user still presses Enter — nothing fires unseen).
import { h } from '../lib/dom.js';
import { pushEscLayer } from '../keys.js';
import { subscribe } from '../state/store.js';
import { askAbout } from '../dock/chat.js';

const MARGIN = 12;
let menu = null;
let cleanup = null;

export function closeAiMenu() {
  cleanup?.();
}

function position(anchor) {
  if (!menu || !document.contains(anchor)) return closeAiMenu();
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const hgt = menu.offsetHeight;
  const left = Math.max(MARGIN, Math.min(r.right - w + 16, window.innerWidth - w - MARGIN));
  let top = r.bottom + 6;
  if (top + hgt > window.innerHeight - MARGIN) top = Math.max(MARGIN, r.top - hgt - 6);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function openAiMenu({ anchor, item, prompts = [] }) {
  closeAiMenu();

  const pick = (prompt) => () => { closeAiMenu(); askAbout(item, prompt); };
  menu = h('div', { class: 'ai-menu' },
    h('div', { class: 'ai-menu-head' }, `✦ ${item.type}: ${item.label}`),
    h('button', { class: 'menu-item', type: 'button', onclick: pick('') }, 'Ask about this…'),
    ...prompts.map((p) => h('button', { class: 'menu-item', type: 'button', onclick: pick(p) }, p)));
  document.body.append(menu);

  const reposition = () => position(anchor);
  const onOutside = (e) => { if (!menu.contains(e.target) && e.target !== anchor) closeAiMenu(); };
  const popEsc = pushEscLayer(closeAiMenu);
  const unsubRender = subscribe('board-rendered', closeAiMenu);
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  setTimeout(() => document.addEventListener('pointerdown', onOutside));

  cleanup = () => {
    popEsc();
    unsubRender();
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
    document.removeEventListener('pointerdown', onOutside);
    menu?.remove();
    menu = null;
    cleanup = null;
  };

  position(anchor);
}
