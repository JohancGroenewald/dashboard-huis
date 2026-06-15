// Scraper cards: a URL + an instruction. Press Scrape and the server fetches
// the page and a model extracts the requested data into a table shown on the
// card. The dock's active model runs it unless the card picks its own.
import { esc, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { loadDashboard, subscribe } from '../state/store.js';
import { activeModel, approvedModels } from '../dock/models.js';
import { openAiMenu } from './ai-menu.js';
import { inlineEdit, deleteWithUndo } from './editor.js';

const running = new Set(); // scraper ids with a run in flight
const RESULT_ROWS_LIMIT = 500;

const scraperModel = (sc) => sc.model || activeModel();

const fmtStamp = (iso) =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function modelOptions(sc) {
  const dock = activeModel();
  const opts = [`<option value="">✦ dock model${dock ? ` (${esc(dock)})` : ''}</option>`];
  for (const m of approvedModels()) {
    opts.push(`<option value="${esc(m)}"${sc.model === m ? ' selected' : ''}>${esc(m)}</option>`);
  }
  return opts.join('');
}

// Full modes walk all scraped text page by page; preview modes read one slice.
const PAGE_MODES = [
  { label: 'Full · 4K', mode: 'full', tokens: 4000 },
  { label: 'Full · 2K', mode: 'full', tokens: 2000 },
  { label: 'Full · 8K', mode: 'full', tokens: 8000 },
  { label: 'Preview · 4K', mode: 'preview', tokens: 4000 },
  { label: 'Preview · 2K', mode: 'preview', tokens: 2000 },
  { label: 'Preview · 8K', mode: 'preview', tokens: 8000 },
  { label: 'Preview · 16K', mode: 'preview', tokens: 0 },
];
const pageMode = (sc) => sc.pageMode || (sc.pageTokens === 0 ? 'preview' : 'full');
const pageValue = ({ mode, tokens }) => `${mode}:${tokens}`;
const selectedPageValue = (sc) => pageValue({ mode: pageMode(sc), tokens: sc.pageTokens });
const pageLabel = ({ mode, tokens }) => `${mode === 'full' ? 'Full' : 'Preview'} · ${tokens ? `${tokens / 1000}K` : '16K'}`;
function pageOptions(sc) {
  const selected = selectedPageValue(sc);
  const opts = PAGE_MODES.some((opt) => pageValue(opt) === selected)
    ? PAGE_MODES
    : [{ label: pageLabel({ mode: pageMode(sc), tokens: sc.pageTokens }), mode: pageMode(sc), tokens: sc.pageTokens }, ...PAGE_MODES];
  return opts.map((opt) =>
    `<option value="${esc(pageValue(opt))}"${selected === pageValue(opt) ? ' selected' : ''}>${esc(opt.label)}</option>`).join('');
}

const SOURCE_MODES = [
  { label: 'Follow pages', value: 'follow' },
  { label: 'This page only', value: 'single' },
];
const SOURCE_PROCESS = [
  { label: 'Process each page', value: 'per-page' },
  { label: 'Collect first', value: 'collect' },
];
const sourceModeOptions = (sc) => SOURCE_MODES.map(({ label, value }) =>
  `<option value="${value}"${(sc.sourceMode || 'follow') === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
const sourceProcessOptions = (sc) => SOURCE_PROCESS.map(({ label, value }) =>
  `<option value="${value}"${(sc.sourceProcess || 'per-page') === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
const setResultSlot = (card, result) => {
  const slot = card?.querySelector('.scraper-result-slot');
  if (slot) slot.innerHTML = resultTable(result);
};

function resultTable(r) {
  if (!r || !r.columns.length) return '';
  const rows = Array.isArray(r.rows) ? r.rows : [];
  const total = Number.isFinite(Number(r.rowCount)) ? Number(r.rowCount) : rows.length;
  const head = r.columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.length
    ? rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${r.columns.length}" class="scraper-empty">${total ? 'loading rows...' : 'no matching rows'}</td></tr>`;
  const count = rows.length === total ? `${total} row${total === 1 ? '' : 's'}` : `showing ${rows.length} of ${total} rows`;
  return `<div class="scraper-result">
    <table class="scraper-tbl"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    ${r.note ? `<div class="scraper-note">📝 ${esc(r.note)}</div>` : ''}
    <div class="scraper-ran">scraped ${esc(fmtStamp(r.at))} · ${esc(count)}</div>
  </div>`;
}

async function loadStoredRows(card, sc) {
  const r = sc.result;
  if (!r?.runId || !r.rowCount || r.rows?.length) return;
  try {
    const page = await api(`/api/scrapers/${sc.id}/rows?offset=0&limit=${RESULT_ROWS_LIMIT}`);
    if (card?.isConnected) setResultSlot(card, { ...r, rows: page.rows, rowCount: page.total, note: page.note, at: page.at, runId: page.runId });
  } catch { /* dashboard summary still tells us the total */ }
}

export function scraperInner(sc) {
  const busy = running.has(sc.id);
  return `<div class="card scraper-card${busy ? ' running' : ''}" data-id="${sc.id}">
    <div class="sec-head scraper-head">
      <span class="card-grip" title="Drag scraper">⠿</span>
      <span class="scraper-name" title="Click to rename">${esc(sc.name)}</span>
      <button class="ctl ai-btn scraper-ai" type="button" title="Dashy: act on this scraper">✦</button>
      <button class="ctl danger scraper-del" type="button" title="Delete scraper">✕</button>
    </div>
    <div class="scraper-url${sc.url ? '' : ' empty'}" title="Click to edit the URL">${esc(sc.url || '＋ add a page URL')}</div>
    <div class="scraper-inst${sc.instruction ? '' : ' empty'}" title="Click to edit the instruction">${esc(sc.instruction || '＋ what to look for and tabulate')}</div>
    <div class="scraper-controls">
      <select class="scraper-model" title="Which model extracts the data"${busy ? ' disabled' : ''}>${modelOptions(sc)}</select>
      <select class="scraper-pages" title="Full reviews all scraped text; preview reads only the first slice"${busy ? ' disabled' : ''}>${pageOptions(sc)}</select>
      <button type="button" class="scraper-run"${busy ? ' disabled' : ''}>${busy ? '⏳ scraping…' : '⛏ Scrape'}</button>
    </div>
    <div class="scraper-controls scraper-source-controls">
      <select class="scraper-source" title="Follow website pagination links like infinite-scroll result pages"${busy ? ' disabled' : ''}>${sourceModeOptions(sc)}</select>
      <select class="scraper-process" title="Process each source page before fetching the next one, or collect all source pages first"${busy ? ' disabled' : ''}>${sourceProcessOptions(sc)}</select>
    </div>
    ${sc.error ? `<div class="scraper-error">⚠️ ${esc(sc.error)}</div>` : ''}
    <div class="scraper-result-slot">${resultTable(sc.result)}</div>
  </div>`;
}

export function wireScraper(el, sc) {
  const cardEl = el.querySelector('.scraper-card');
  loadStoredRows(cardEl, sc);
  const nameEl = el.querySelector('.scraper-name');
  el.querySelector('.scraper-ai').addEventListener('click', (e) => {
    e.stopPropagation();
    openAiMenu({
      anchor: e.currentTarget,
      item: { type: 'scraper', id: sc.id, label: sc.name },
      prompts: [
        'Summarize these scraped rows',
        'Find patterns in these rows',
        'Show me the next rows',
      ],
    });
  });
  nameEl.addEventListener('click', () => inlineEdit(nameEl, {
    value: sc.name,
    onSubmit: (name) => api(`/api/scrapers/${sc.id}`, jsonBody({ name }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.scraper-url').addEventListener('click', (e) => inlineEdit(e.currentTarget, {
    value: sc.url || '',
    allowEmpty: true,
    onSubmit: (url) => api(`/api/scrapers/${sc.id}`, jsonBody({ url }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.scraper-inst').addEventListener('click', (e) => inlineEdit(e.currentTarget, {
    value: sc.instruction || '',
    allowEmpty: true,
    onSubmit: (instruction) => api(`/api/scrapers/${sc.id}`, jsonBody({ instruction }, 'PATCH')).then(loadDashboard),
  }));
  el.querySelector('.scraper-model').addEventListener('change', async (e) => {
    try { await api(`/api/scrapers/${sc.id}`, jsonBody({ model: e.target.value }, 'PATCH')); }
    catch (err) { toast(err.message, { error: true }); }
    await loadDashboard();
  });
  el.querySelector('.scraper-pages').addEventListener('change', async (e) => {
    const [mode, tokens] = e.target.value.split(':');
    try { await api(`/api/scrapers/${sc.id}`, jsonBody({ pageMode: mode, pageTokens: Number(tokens) }, 'PATCH')); }
    catch (err) { toast(err.message, { error: true }); }
    await loadDashboard();
  });
  el.querySelector('.scraper-source').addEventListener('change', async (e) => {
    try { await api(`/api/scrapers/${sc.id}`, jsonBody({ sourceMode: e.target.value }, 'PATCH')); }
    catch (err) { toast(err.message, { error: true }); }
    await loadDashboard();
  });
  el.querySelector('.scraper-process').addEventListener('change', async (e) => {
    try { await api(`/api/scrapers/${sc.id}`, jsonBody({ sourceProcess: e.target.value }, 'PATCH')); }
    catch (err) { toast(err.message, { error: true }); }
    await loadDashboard();
  });
  el.querySelector('.scraper-run').addEventListener('click', async () => {
    if (running.has(sc.id)) return;
    const model = scraperModel(sc);
    if (!model) { toast('Pick a model — it extracts the data.', { error: true }); return; }
    if (!sc.url) { toast('Add a URL to scrape first.', { error: true }); return; }
    running.add(sc.id);
    const card = el.querySelector('.scraper-card');
    card.classList.add('running');
    const btn = el.querySelector('.scraper-run');
    btn.disabled = true;
    btn.textContent = '⏳ scraping…';
    card.querySelector('.scraper-error')?.remove();
    setResultSlot(card, null);
    try {
      const { error } = await api(`/api/scrapers/${sc.id}/run`, jsonBody({ model }));
      if (error) toast(error, { error: true });
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      running.delete(sc.id);
      await loadDashboard();
    }
  });
  el.querySelector('.scraper-del').addEventListener('click', () => deleteWithUndo(`/api/scrapers/${sc.id}`, `Deleted scraper "${sc.name}"`));
}

// Live progress (server → events → here): paint the running button with the
// current phase so a long scrape shows what it's actually doing.
function progressLabel(s) {
  const rows = s.result?.rowCount ?? s.result?.rows?.length ?? 0;
  if (s.phase === 'clear') return '⏳ scraping…';
  if (s.phase === 'rows') return `⛏ ${rows} row${rows === 1 ? '' : 's'}…`;
  if (s.phase === 'source') return `📥 source page ${s.sourcePage || 1}…`;
  if (s.phase === 'fetch') return '📥 fetching page…';
  if (s.phase === 'preview') return '⛏ previewing…';
  if (s.phase === 'extract') return '⛏ extracting…';
  if (s.phase === 'slice') return `⛏ slice ${s.slice}/${s.slices}${s.rows ? ` · ${s.rows} rows` : ''}…`;
  return '⏳ scraping…';
}
subscribe('scraper', (s) => {
  const card = document.querySelector(`#board .scraper-card[data-id="${CSS.escape(s.id)}"]`);
  const btn = card?.querySelector('.scraper-run');
  if (btn) btn.textContent = progressLabel(s);
  if (s.phase === 'clear') {
    card?.querySelector('.scraper-error')?.remove();
    setResultSlot(card, null);
  } else if (s.phase === 'rows') {
    setResultSlot(card, s.result);
  }
});
