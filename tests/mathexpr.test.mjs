import assert from 'node:assert/strict';
import test from 'node:test';
import { compileMathExpr, MATH_EXPR_LIMITS } from '../public/js/lib/mathexpr.js';

test('compiles and evaluates plain math over x y r a t', () => {
  const fn = compileMathExpr('sin(8*r - 2*t) * exp(-r) + 0.3*sin(x*5+t)');
  assert.ok(Number.isFinite(fn(0.5, -0.2, 0.54, -0.38, 3)));
  assert.equal(compileMathExpr('x + y')(2, 3, 0, 0, 0), 5);
  assert.equal(compileMathExpr('2 ^ 3')(0, 0, 0, 0, 0), 8);
  assert.equal(compileMathExpr('2 ** 3')(0, 0, 0, 0, 0), 8);
  assert.equal(compileMathExpr('-x ^ 2')(3, 0, 0, 0, 0), -9);
  assert.equal(compileMathExpr('min(x, y, t)')(4, 2, 0, 0, 9), 2);
  assert.equal(compileMathExpr('fract(2.75)')(0, 0, 0, 0, 0), 0.75);
  assert.ok(Math.abs(compileMathExpr('tau')(0, 0, 0, 0, 0) - Math.PI * 2) < 1e-12);
});

test('rejects everything outside the whitelist', () => {
  const evil = [
    'window', // unknown name
    'alert(1)', // unknown function
    'x.constructor', // property access is not in the grammar
    'constructor', // unknown name
    '"hi"', // strings cannot tokenize
    'x => x', // no arrows
    'x; y', // no statements
    'x = 1', // no assignment
    '[1,2]', // no arrays
    'this', // unknown name
    'eval(x)', // unknown function
    '', // empty
    'sin(x', // unbalanced
    'x +', // dangling operator
  ];
  for (const src of evil) assert.throws(() => compileMathExpr(src), Error, `should reject: ${src}`);
});

test('bounds formula size and complexity', () => {
  assert.throws(() => compileMathExpr('x'.repeat(MATH_EXPR_LIMITS.maxChars + 1)), /longer/);
  // 299 chars (inside the length cap) but 299 parse nodes (over the node cap).
  assert.throws(() => compileMathExpr(`x${'+x'.repeat(149)}`), /complex/);
});
