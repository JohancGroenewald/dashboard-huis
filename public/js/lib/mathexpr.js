// Safe compiler for model-authored background formulas. The model writes one
// math expression over x, y, r, a, t; we tokenize and parse it against a
// strict whitelist and re-emit JavaScript ONLY from our own token mappings —
// no model text ever reaches the generated function, so this is eval-safe by
// construction (no identifiers, property access, strings, or calls beyond the
// table below can survive the parse). Pure module: the server imports it too,
// so a bad formula is rejected at the tool boundary with a useful message.
export const MATH_EXPR_LIMITS = { maxChars: 300, maxNodes: 240 };

// callable name → emitted Math member
const FUNCS = {
  sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos',
  atan: 'Math.atan', atan2: 'Math.atan2', sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh',
  sqrt: 'Math.sqrt', cbrt: 'Math.cbrt', abs: 'Math.abs', exp: 'Math.exp', log: 'Math.log',
  pow: 'Math.pow', min: 'Math.min', max: 'Math.max', floor: 'Math.floor', ceil: 'Math.ceil',
  round: 'Math.round', sign: 'Math.sign', hypot: 'Math.hypot', fract: '((v)=>v-Math.floor(v))',
};
const VARS = new Set(['x', 'y', 'r', 'a', 't']);
const CONSTS = { pi: 'Math.PI', tau: '(Math.PI*2)', e: 'Math.E' };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
      if (!m) throw new Error(`bad number at position ${i}`);
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[a-z_]/i.test(c)) {
      const m = src.slice(i).match(/^[a-z_]\w*/i);
      tokens.push({ kind: 'id', value: m[0].toLowerCase() });
      i += m[0].length;
      continue;
    }
    if (src.startsWith('**', i)) { tokens.push({ kind: 'op', value: '^' }); i += 2; continue; }
    if ('+-*/%^(),'.includes(c)) { tokens.push({ kind: 'op', value: c }); i += 1; continue; }
    throw new Error(`unexpected character "${c}" — only numbers, x y r a t, math functions and + - * / % ^ ( ) are allowed`);
  }
  return tokens;
}

// Recursive descent over: expr → term → unary → power → atom. Emits code as
// it parses; every emitted fragment comes from FUNCS/CONSTS/VARS or Number().
export function compileMathExpr(src) {
  const text = String(src ?? '').trim();
  if (!text) throw new Error('formula is empty');
  if (text.length > MATH_EXPR_LIMITS.maxChars) throw new Error(`formula is longer than ${MATH_EXPR_LIMITS.maxChars} characters`);
  const tokens = tokenize(text);
  let pos = 0;
  let nodes = 0;
  const node = () => {
    if ((nodes += 1) > MATH_EXPR_LIMITS.maxNodes) throw new Error('formula is too complex');
  };
  const peek = () => tokens[pos];
  const takeOp = (...ops) => (peek()?.kind === 'op' && ops.includes(peek().value) ? tokens[pos++].value : null);

  function expr() {
    let code = term();
    let op;
    while ((op = takeOp('+', '-'))) { node(); code = `(${code}${op}${term()})`; }
    return code;
  }
  function term() {
    let code = unary();
    let op;
    while ((op = takeOp('*', '/', '%'))) { node(); code = `(${code}${op}${unary()})`; }
    return code;
  }
  function unary() {
    if (takeOp('-')) { node(); return `(-${unary()})`; }
    return power();
  }
  function power() {
    const base = atom();
    if (takeOp('^')) { node(); return `Math.pow(${base},${unary()})`; }
    return base;
  }
  function atom() {
    node();
    const tk = tokens[pos++];
    if (!tk) throw new Error('formula ends unexpectedly');
    if (tk.kind === 'num') return `(${Number(tk.value)})`;
    if (tk.kind === 'id') {
      if (peek()?.kind === 'op' && peek().value === '(') {
        const fn = FUNCS[tk.value];
        if (!fn) throw new Error(`unknown function "${tk.value}" — allowed: ${Object.keys(FUNCS).join(', ')}`);
        pos += 1; // consume '('
        const args = [expr()];
        while (takeOp(',')) args.push(expr());
        if (!takeOp(')')) throw new Error(`missing ) after ${tk.value}(…`);
        return `${fn}(${args.join(',')})`;
      }
      if (VARS.has(tk.value)) return tk.value;
      if (CONSTS[tk.value]) return CONSTS[tk.value];
      throw new Error(`unknown name "${tk.value}" — variables are x, y, r, a, t (plus pi, tau, e)`);
    }
    if (tk.kind === 'op' && tk.value === '(') {
      const code = expr();
      if (!takeOp(')')) throw new Error('missing )');
      return `(${code})`;
    }
    throw new Error(`unexpected "${tk.value}"`);
  }

  const code = expr();
  if (pos < tokens.length) throw new Error(`unexpected "${tokens[pos].value}" after the expression`);
  // new Function is safe here: code is emitted only from the whitelist above.
  return new Function('x', 'y', 'r', 'a', 't', `"use strict"; return (${code});`);
}
