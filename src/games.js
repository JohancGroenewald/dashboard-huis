// Game engine: applies human moves and asks a validated model for its move.
// The human is X, the model is O. Non-vision models play from the text board;
// vision models additionally get the client's screenshot of the card. The
// model keeps private per-game notes ("memory") that survive rematches, and
// every AI turn is logged (kind='game') with its thinking, so the Replay view
// can play the model's reasoning back move by move.
import { fail } from './schema.js';
import { logTask } from './chatlog.js';
import { renderPrompt } from './prompts.js';
import { CHAT_MESSAGE_LIMITS, SCHEMA_LIMITS } from './constants.js';
import { judge, legalMoves, boardText } from '../public/js/lib/tictactoe.js';

const historyText = (moves) =>
  moves.length ? moves.map((m) => `${m.p}:${m.cell + 1}`).join(', ') : '(none yet)';

export function humanMove(store, gameId, cell) {
  const game = store.getGame(gameId);
  if (judge(game.board).status !== 'playing') fail('the game is over — reset to play again');
  if (game.turn !== 'X') fail('not your turn');
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) fail('cell must be 0-8');
  if (game.board[cell]) fail('that cell is taken');
  const board = [...game.board];
  board[cell] = 'X';
  return store.updateGame(gameId, { board, turn: 'O', moves: [...game.moves, { p: 'X', cell }] });
}

export function resetGame(store, gameId) {
  // Memory survives on purpose: the model gets to learn across rematches.
  return store.updateGame(gameId, { board: Array(9).fill(''), turn: 'X', moves: [], say: '' });
}

function extractMove(text, legal) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* sliced below */ }
  if (!data) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch { /* regex below */ } }
  }
  const num = Number(data?.move ?? String(text || '').match(/"?move"?\s*[:=]\s*(\d)/)?.[1]);
  const cell = Number.isInteger(num) ? num - 1 : null; // models speak 1-9
  return {
    cell: legal.includes(cell) ? cell : null,
    say: typeof data?.say === 'string' ? data.say.slice(0, SCHEMA_LIMITS.gameSayChars) : '',
    memory: typeof data?.memory === 'string' ? data.memory.slice(0, SCHEMA_LIMITS.gameMemoryChars) : null,
  };
}

// Ask the model for O's move; one retry on an illegal/unparseable answer,
// then a random legal move so the game never wedges. The route enforces that
// only validated models get this far.
export async function aiMove({ store, ollama, gameId, model, image }) {
  const game = store.getGame(gameId);
  if (judge(game.board).status !== 'playing') fail('the game is over');
  if (game.turn !== 'O') fail('it is not the model\'s turn');

  const legal = legalMoves(game.board);
  const system = renderPrompt('game-tictactoe', {
    board: boardText(game.board),
    legal: legal.map((i) => i + 1).join(' '),
    history: historyText(game.moves),
    memory: game.memory || '(empty — keep notes here for future turns and rematches)',
  });
  const b64 = typeof image === 'string' && image.length <= CHAT_MESSAGE_LIMITS.maxImageChars
    ? image.replace(/^data:[^,]*,/, '')
    : null;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: 'Your move. Reply with ONLY the JSON.', ...(b64 ? { images: [b64] } : {}) },
  ];

  const started = Date.now();
  let parsed = null;
  let fallback = false;
  let rounds = [];
  try {
    let msg = await ollama.chat({ model, messages, format: 'json', options: { temperature: 0 } });
    rounds.push({ thinking: msg.thinking || '', content: msg.content || '', calls: 0 });
    parsed = extractMove(msg.content, legal);
    if (parsed.cell === null) {
      msg = await ollama.chat({
        model,
        messages: [...messages, { role: 'assistant', content: msg.content || '' },
          { role: 'user', content: `That move is not legal. Legal cells: ${legal.map((i) => i + 1).join(' ')}. Reply with ONLY the JSON.` }],
        format: 'json',
        options: { temperature: 0 },
      });
      rounds.push({ thinking: msg.thinking || '', content: msg.content || '', calls: 0 });
      parsed = extractMove(msg.content, legal);
    }
  } catch (err) {
    rounds.push({ thinking: '', content: `(model error: ${err.message})`, calls: 0 });
  }
  if (!parsed || parsed.cell === null) {
    parsed = { ...(parsed || { say: '', memory: null }), cell: legal[Math.floor(Math.random() * legal.length)] };
    fallback = true;
  }

  const board = [...game.board];
  board[parsed.cell] = 'O';
  const updated = store.updateGame(gameId, {
    board,
    turn: 'X',
    moves: [...game.moves, { p: 'O', cell: parsed.cell }],
    say: fallback ? `${parsed.say || ''} (fallback move)`.trim() : parsed.say,
    ...(parsed.memory !== null ? { memory: parsed.memory } : {}),
  });

  logTask({
    kind: 'game',
    model,
    task: game.kind,
    session: gameId,
    userMsg: `${boardText(game.board)}\n\nlegal: ${legal.map((i) => i + 1).join(' ')}${b64 ? '\n[board screenshot attached]' : ''}`,
    reply: `O → cell ${parsed.cell + 1}${parsed.say ? ` · "${parsed.say}"` : ''}${fallback ? ' (fallback)' : ''}`,
    rounds,
    ms: Date.now() - started,
  });
  return { game: updated, fallback };
}
