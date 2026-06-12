// Game cards: kringetjies & kruisies on the board grid. You play X by
// clicking a cell; the move goes to the server, which asks the dock's active
// model for O's reply. Vision models also get a rendered screenshot of the
// board; the model's table talk and private in-game memory show on the card.
import { esc, toast } from '../lib/dom.js';
import { api, jsonBody } from '../lib/api.js';
import { judge } from '../lib/tictactoe.js';
import { loadDashboard } from '../state/store.js';
import { activeModel, modelHasVision } from '../dock/models.js';
import { deleteWithUndo } from './editor.js';

const thinking = new Set(); // game ids with a move request in flight

function statusText(game, j) {
  if (thinking.has(game.id)) return `🤔 ${esc(activeModel() || 'model')} is thinking…`;
  if (j.status === 'won') return j.winner === 'X' ? '🎉 You win!' : '🤖 The model wins!';
  if (j.status === 'draw') return '🤝 A draw';
  return game.turn === 'X' ? 'Your turn — you are ✕' : 'Model to move…';
}

export function gameInner(game) {
  const j = judge(game.board);
  const winning = new Set(j.line || []);
  const over = j.status !== 'playing';
  const busy = thinking.has(game.id);
  const cells = game.board.map((c, i) => {
    const mark = c === 'X' ? '✕' : c === 'O' ? '◯' : '';
    const cls = `game-cell${c ? ` mark-${c.toLowerCase()}` : ''}${winning.has(i) ? ' win' : ''}`;
    const disabled = c || over || busy || game.turn !== 'X' ? ' disabled' : '';
    return `<button type="button" class="${cls}" data-cell="${i}"${disabled}>${mark}</button>`;
  }).join('');
  return `<div class="card game-card${busy ? ' busy' : ''}" data-id="${game.id}">
    <div class="sec-head game-head">
      <span class="card-grip" title="Drag game">⠿</span>
      <span class="game-title" title="tic-tac-toe — you are X, the dock's model plays O">⭕ Kringetjies &amp; kruisies</span>
      <button class="ctl game-reset" type="button" title="Rematch (the model keeps its memory)">↺</button>
      <button class="ctl danger game-del" type="button" title="Delete game">✕</button>
    </div>
    <div class="game-status">${statusText(game, j)}</div>
    <div class="game-grid">${cells}</div>
    ${game.say ? `<div class="game-say">✦ ${esc(game.say)}</div>` : ''}
    <details class="game-mem">
      <summary>🧠 model memory</summary>
      <pre>${esc(game.memory || '(nothing yet — the model writes notes here as it plays)')}</pre>
    </details>
  </div>`;
}

// Render the position as a PNG so vision models can literally look at it.
function snapshot(game) {
  const S = 312;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  g.strokeStyle = '#222222';
  g.lineWidth = 4;
  const t = S / 3;
  for (const k of [1, 2]) {
    g.beginPath(); g.moveTo(t * k, 8); g.lineTo(t * k, S - 8); g.stroke();
    g.beginPath(); g.moveTo(8, t * k); g.lineTo(S - 8, t * k); g.stroke();
  }
  g.lineWidth = 7;
  g.lineCap = 'round';
  game.board.forEach((mark, i) => {
    const x = (i % 3) * t + t / 2;
    const y = Math.floor(i / 3) * t + t / 2;
    const r = t * 0.28;
    if (mark === 'X') {
      g.strokeStyle = '#1f6fde';
      g.beginPath(); g.moveTo(x - r, y - r); g.lineTo(x + r, y + r); g.stroke();
      g.beginPath(); g.moveTo(x + r, y - r); g.lineTo(x - r, y + r); g.stroke();
    } else if (mark === 'O') {
      g.strokeStyle = '#c0392b';
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    }
  });
  return c.toDataURL('image/png').split(',')[1];
}

export function wireGame(el, game) {
  const grid = el.querySelector('.game-grid');
  grid.addEventListener('click', async (e) => {
    const btn = e.target.closest('.game-cell');
    if (!btn || btn.disabled || thinking.has(game.id)) return;
    const model = activeModel();
    if (!model) { toast('Pick a model in the dock first — it plays O.', { error: true }); return; }
    thinking.add(game.id);
    // Optimistic ✕ + thinking state; the authoritative board arrives via SSE.
    btn.textContent = '✕';
    btn.classList.add('mark-x');
    btn.disabled = true;
    el.querySelector('.game-card').classList.add('busy');
    const status = el.querySelector('.game-status');
    status.textContent = `🤔 ${model} is thinking…`;
    try {
      // The screenshot includes the move just played, matching the text board.
      const played = { ...game, board: game.board.map((c, i) => (i === Number(btn.dataset.cell) ? 'X' : c)) };
      await api(`/api/games/${game.id}/move`, jsonBody({
        cell: Number(btn.dataset.cell),
        model,
        ...(modelHasVision(model) ? { image: snapshot(played) } : {}),
      }));
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      thinking.delete(game.id);
      await loadDashboard(); // re-render from truth either way
    }
  });
  el.querySelector('.game-reset').addEventListener('click', async () => {
    await api(`/api/games/${game.id}/reset`, { method: 'POST' });
    await loadDashboard();
  });
  el.querySelector('.game-del').addEventListener('click', () => deleteWithUndo(`/api/games/${game.id}`, 'Game deleted'));
}
