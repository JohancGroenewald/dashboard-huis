// Kringetjies & kruisies rules, shared by the browser card and the server
// engine (another deliberate import across the src/public seam, like
// mathexpr.js) so both judge a position identically.
export const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6], // diagonals
];

export function judge(board) {
  for (const line of WIN_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { status: 'won', winner: board[a], line };
    }
  }
  if (board.every(Boolean)) return { status: 'draw', winner: null, line: null };
  return { status: 'playing', winner: null, line: null };
}

// Empty cells as 0-based indexes.
export const legalMoves = (board) => board.map((c, i) => (c ? null : i)).filter((i) => i !== null);

// The text rendering non-vision models play from ('.' = empty).
export function boardText(board) {
  const cell = (i) => board[i] || '.';
  return [0, 3, 6].map((r) => ` ${cell(r)} | ${cell(r + 1)} | ${cell(r + 2)} `).join('\n---+---+---\n');
}
