// Models workspace: the validation outcomes shown as section-cards + tiles
// (Approved / Rejected / Retired, plus any multi-agent pairings). Clicking an
// approved tile selects that model as the assistant's driver. Re-fetches each
// time the workspace is opened, so it reflects the latest gate runs.
import { $, api, esc, fmtMs, speedTier } from './util.js';

function failReason(r) {
  if (!r) return '';
  if (r.blockedBy?.length) return `safety: ${r.blockedBy.map((t) => `${t.replace('safety-', '')} ${r.safety?.[t] || ''}`).join(', ')}`;
  if (r.failures?.length) return r.failures.join(', ');
  return r.error || '';
}

function modelTile(name, r, { selectable = false, muted = false } = {}) {
  const speed = r?.msPerAction ? `${speedTier(r.msPerAction)} ~${fmtMs(r.msPerAction)}/action` : '';
  const score = r?.total ? `${r.passed}/${r.total}` : '';
  const sub = [score, speed].filter(Boolean).join(' · ');
  const reason = muted ? '' : failReason(r);
  const cls = muted ? 'muted' : r?.approved ? 'ok' : 'bad';
  const attrs = selectable ? ` data-model="${esc(name)}" data-ms="${r?.msPerAction || ''}" title="Use this model in the assistant"` : '';
  return `<div class="mw-tile ${cls}${selectable ? ' selectable' : ''}"${attrs}>
    <div class="mw-tile-name">${esc(name)}</div>
    ${sub ? `<div class="mw-tile-sub">${esc(sub)}</div>` : ''}
    ${reason ? `<div class="mw-tile-fail">${esc(reason)}</div>` : ''}
  </div>`;
}

function section(title, tiles, hint = '') {
  if (!tiles.length && !hint) return '';
  return `<div class="mw-section">
    <div class="mw-sec-head"><span class="mw-sec-name">${title}</span><span class="mw-count">${tiles.length}</span></div>
    <div class="mw-tiles">${tiles.join('') || `<div class="mw-empty">${esc(hint)}</div>`}</div>
  </div>`;
}

function pairTile(useful, title, sub) {
  return `<div class="mw-tile ${useful ? 'ok' : 'bad'}"><div class="mw-tile-name">${title}</div><div class="mw-tile-sub">${sub}</div></div>`;
}
function pairSection(title, map, render) {
  const pairs = Object.values(map || {});
  if (!pairs.length) return '';
  pairs.sort((a, b) => Number(b.useful) - Number(a.useful));
  return section(title, pairs.map(render));
}
function spd(p, aloneMs) {
  return aloneMs ? `~${fmtMs(p.msPerAction)} vs ${fmtMs(aloneMs)} solo (${p.speedup}×)` : `~${fmtMs(p.msPerAction)}`;
}

export async function loadModelsReport() {
  const panel = $('#ws-models');
  if (!panel) return;
  try {
    const { approved, details, results, supervised, delegated, parallel, retired } = await api('/api/models');
    const retiredSet = new Set(retired || []);
    const res = results || {};

    const approvedTiles = (approved || []).map((n) => modelTile(n, res[n] || details?.[n], { selectable: true }));
    const rejectedTiles = Object.entries(res)
      .filter(([n, r]) => !r.approved && !retiredSet.has(n))
      .sort((a, b) => b[1].score - a[1].score)
      .map(([n, r]) => modelTile(n, r));
    const retiredTiles = (retired || []).map((n) => modelTile(n, res[n], { muted: true }));

    const tested = Object.keys(res).length;
    const head = `<div class="mw-summary">${(approved || []).length} approved · ${tested} tested · ${(retired || []).length} retired</div>`;

    const sections = [
      section('✓ Approved drivers', approvedTiles, 'No models have passed the gate yet.'),
      section('✗ Rejected', rejectedTiles),
      section('💤 Retired', retiredTiles),
      pairSection('Supervised pairings (worker ▸ supervisor)', supervised, (s) =>
        pairTile(s.useful, `${esc(s.worker)} <span class="mw-pair">▸ ${esc(s.supervisor)}</span>`,
          `safe ${s.safetyPass ? '✓' : '✗'} · capable ${s.capabilityPass ? '✓' : '✗'} · ${spd(s, s.supervisorAloneMs)} · ${s.totalBlocked} blocked`)),
      pairSection('Sub-agent delegation (orchestrator ▸ sub-agent)', delegated, (d) =>
        pairTile(d.useful, `${esc(d.orchestrator)} <span class="mw-pair">▸ ${esc(d.subAgent)}</span>`,
          `safe ${d.safetyPass ? '✓' : '✗'} · capable ${d.capabilityPass ? '✓' : '✗'} · ${spd(d, d.orchestratorAloneMs)}`)),
      pairSection('Parallel sub-agents (orchestrator ⇉ concurrent)', parallel, (p) =>
        pairTile(p.useful, `${esc(p.orchestrator)} <span class="mw-pair">⇉ ${esc((p.subAgents || []).join(' + '))}</span>`,
          `safe ${p.safetyPass ? '✓' : '✗'} · capable ${p.capabilityPass ? '✓' : '✗'} · ${spd(p, p.orchestratorAloneMs)}`)),
    ].join('');

    panel.innerHTML = head + `<div class="mw-board">${sections}</div>`;
    panel.querySelectorAll('.mw-tile.selectable').forEach((t) =>
      t.addEventListener('click', () =>
        document.dispatchEvent(new CustomEvent('select-model', { detail: { model: t.dataset.model, ms: Number(t.dataset.ms) || null } }))
      )
    );
  } catch {
    panel.innerHTML = '<div class="mw-summary">Models report is offline.</div>';
  }
}
