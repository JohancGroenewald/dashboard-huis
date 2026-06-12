import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../src/store.js';
import { humanMove, aiMove, resetGame, reflectOnGame, isModelTurn } from '../src/games.js';
import { judge, legalMoves, boardText } from '../public/js/lib/tictactoe.js';
import { normalizeGame } from '../src/schema.js';

const newStore = () => new Store({ persist: false }).load();
const fakeOllama = (replies) => {
  let i = 0;
  return { calls: [], async chat(req) { this.calls.push(req); return { role: 'assistant', content: replies[Math.min(i++, replies.length - 1)] }; } };
};

test('tictactoe rules judge wins, draws, and legal moves', () => {
  assert.equal(judge(['X', 'X', 'X', '', '', '', '', '', '']).winner, 'X');
  assert.equal(judge(['O', '', '', '', 'O', '', '', '', 'O']).winner, 'O');
  assert.equal(judge(['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X']).status, 'draw');
  assert.deepEqual(legalMoves(['X', '', 'O', '', '', '', '', '', 'X']), [1, 3, 4, 5, 6, 7]);
  assert.match(boardText(['X', '', '', '', 'O', '', '', '', '']), /X \| \. \| \./);
});

test('human moves are validated and flip the turn', () => {
  const store = newStore();
  const g = store.addGame({});
  const after = humanMove(store, g.id, 4);
  assert.equal(after.board[4], 'X');
  assert.equal(after.turn, 'O');
  assert.deepEqual(after.moves, [{ p: 'X', cell: 4 }]);
  assert.throws(() => humanMove(store, g.id, 4), /not your turn/);
});

test('aiMove plays the model answer and stores say + memory', async () => {
  const store = newStore();
  const g = store.addGame({});
  humanMove(store, g.id, 4);
  const ollama = fakeOllama(['{"move": 1, "say": "corners are mine", "memory": "user opened centre"}']);
  const { game, fallback } = await aiMove({ store, ollama, gameId: g.id, model: 'm', image: null });
  assert.equal(fallback, false);
  assert.equal(game.board[0], 'O');
  assert.equal(game.turn, 'X');
  assert.equal(game.say, 'corners are mine');
  assert.equal(game.memory, 'user opened centre');
  // The prompt carried the board, legal moves, and (empty) memory.
  const sys = ollama.calls[0].messages[0].content;
  assert.match(sys, /Legal moves: 1 2 3 4 6 7 8 9/);
  assert.match(sys, /empty — keep notes here/);
});

test('aiMove retries an illegal answer, then falls back to a legal move', async () => {
  const store = newStore();
  const g = store.addGame({});
  humanMove(store, g.id, 0);
  const ollama = fakeOllama(['{"move": 1}', 'gibberish']); // cell 1 is taken, then unparseable
  const { game, fallback } = await aiMove({ store, ollama, gameId: g.id, model: 'm' });
  assert.equal(fallback, true);
  assert.equal(ollama.calls.length, 2);
  assert.equal(game.board.filter((c) => c === 'O').length, 1);
  assert.notEqual(game.board[0], 'O');
  assert.match(game.say, /fallback move/);
});

test('vision images ride along and reset keeps the memory', async () => {
  const store = newStore();
  const g = store.addGame({});
  humanMove(store, g.id, 4);
  const ollama = fakeOllama(['{"move": 1, "memory": "remember: blocks fast"}']);
  await aiMove({ store, ollama, gameId: g.id, model: 'm', image: 'data:image/png;base64,AAAA' });
  assert.deepEqual(ollama.calls[0].messages[1].images, ['AAAA']);
  const after = resetGame(store, g.id);
  assert.deepEqual(after.board, Array(9).fill(''));
  assert.equal(after.turn, 'X');
  assert.equal(after.memory, 'remember: blocks fast'); // memory survives rematches
  assert.equal(after.say, '');
});

test('a game-ending human move leaves no model turn to answer', () => {
  const store = newStore();
  const g = store.addGame({});
  // X completes the top row via direct state (two O fillers elsewhere).
  store.updateGame(g.id, { board: ['X', 'X', '', 'O', 'O', '', '', '', ''], turn: 'X' });
  const after = humanMove(store, g.id, 2);
  assert.equal(after.turn, 'O'); // turn flips mechanically…
  assert.equal(isModelTurn(after), false); // …but the game is over: no AI move
});

test('post-game reflection rewrites memory for the future self, once', async () => {
  const store = newStore();
  const g = store.addGame({});
  store.updateGame(g.id, { board: ['X', 'X', 'X', 'O', 'O', '', '', '', ''], turn: 'O', memory: 'old notes' });
  const ollama = fakeOllama(['{"say": "well played!", "memory": "lesson: block the top row sooner"}']);
  const { game, skipped } = await reflectOnGame({ store, ollama, gameId: g.id, model: 'm', image: 'data:image/png;base64,BBBB' });
  assert.equal(skipped, false);
  assert.equal(game.reflected, true);
  assert.equal(game.say, 'well played!');
  assert.equal(game.memory, 'lesson: block the top row sooner');
  assert.deepEqual(ollama.calls[0].messages[1].images, ['BBBB']);
  assert.match(ollama.calls[0].messages[0].content, /LOSS for you/);
  assert.match(ollama.calls[0].messages[0].content, /old notes/);
  // Second reflection is a no-op; reset clears the flag for the next match.
  assert.equal((await reflectOnGame({ store, ollama, gameId: g.id, model: 'm' })).skipped, true);
  assert.equal(resetGame(store, g.id).reflected, false);
});

test('reflection refuses while the game is still in play', async () => {
  const store = newStore();
  const g = store.addGame({});
  await assert.rejects(() => reflectOnGame({ store, ollama: fakeOllama(['{}']), gameId: g.id, model: 'm' }), /not over yet/);
});

test('normalizeGame rejects junk and bounds the fields', () => {
  assert.throws(() => normalizeGame({ kind: 'chess' }), /game.kind/);
  const g = normalizeGame({ board: ['X', 'Z', 1, 'O', '', '', '', '', ''], moves: [{ p: 'X', cell: 0 }, { p: 'Q', cell: 3 }, { p: 'O', cell: 99 }] });
  assert.deepEqual(g.board.slice(0, 4), ['X', '', '', 'O']); // junk marks dropped
  assert.deepEqual(g.moves, [{ p: 'X', cell: 0 }]); // junk moves dropped
  assert.equal(normalizeGame({}).board.length, 9);
});
