// Model picker: validated models only, with speed badges. The Models view's
// 'select-model' event also lands here.
import { $, esc } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { fmtMs, speedTier } from '../lib/format.js';
import { STORAGE_KEYS } from '../constants.js';

let active = '';
let vision = {}; // model → can it see images (from /api/models)

export const activeModel = () => active;
export const modelHasVision = (m) => Boolean(vision[m]);

function setModel(m, ms) {
  active = m;
  if (m) localStorage.setItem(STORAGE_KEYS.model, m);
  const eye = vision[m] ? ' <span title="Understands images">👁</span>' : '';
  $('#model-btn-label').innerHTML = m ? `${esc(m)}${eye}${ms ? ` <span class="pill-badge">${speedTier(ms)} ~${fmtMs(ms)}</span>` : ''}` : 'no models';
}

export async function loadModels() {
  try {
    const { approved, details, vision: v } = await api('/api/models');
    vision = v || {};
    const menu = $('#model-menu');
    if (!approved.length) {
      menu.innerHTML = '<div class="mm-empty">No validated models yet. Run <code>npm run validate -- --all</code> on the server — only models that pass the safety gate may drive the board.</div>';
      setModel('', null);
      return;
    }
    menu.innerHTML = approved
      .map((m) => {
        const ms = details?.[m]?.msPerAction;
        const eye = `<span class="mm-eye"${vision[m] ? ' title="Understands images"' : ''}>${vision[m] ? '👁' : ''}</span>`;
        const badge = `<span class="mm-badge">${ms ? `${speedTier(ms)} <span class="mm-ms">~${fmtMs(ms)}</span>` : ''}</span>`;
        return `<button type="button" class="mm-item" data-model="${esc(m)}"><span class="mm-name">${esc(m)}</span>${eye}${badge}</button>`;
      })
      .join('');
    for (const it of menu.querySelectorAll('.mm-item')) {
      it.addEventListener('click', () => {
        setModel(it.dataset.model, details?.[it.dataset.model]?.msPerAction);
        menu.classList.add('hidden');
      });
    }
    const saved = localStorage.getItem(STORAGE_KEYS.model);
    const pick = active && approved.includes(active) ? active
      : saved && approved.includes(saved) ? saved
      : approved[0];
    setModel(pick, details?.[pick]?.msPerAction);
  } catch {
    setModel('', null);
    $('#model-btn-label').textContent = 'offline';
  }
}

export function initModels() {
  const menu = $('#model-menu');
  $('#model-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = menu.classList.contains('hidden');
    menu.classList.toggle('hidden');
    if (opening) loadModels(); // reflect the latest approvals/retirements
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.model-picker')) menu.classList.add('hidden');
  });
  // The Models view picks a driver by dispatching select-model.
  document.addEventListener('select-model', (e) => setModel(e.detail.model, e.detail.ms));
  loadModels();
}
