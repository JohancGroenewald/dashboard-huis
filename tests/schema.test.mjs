import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNote, normalizeSection, normalizeTile, normalizeWorkspaceBackground } from '../src/schema.js';

test('color fields allow hex and color names', () => {
  assert.equal(normalizeSection({ name: 'Ops', color: '#ABC', tiles: [] }).color, '#abc');
  assert.equal(normalizeNote({ text: 'Check backups', color: 'Blue' }).color, 'blue');
  assert.equal(normalizeNote({ text: 'Check backups', color: 'transparent' }).color, 'transparent');
});

test('color fields reject CSS declarations and functions', () => {
  assert.throws(
    () => normalizeSection({ name: 'Ops', color: 'red;display:none', tiles: [] }),
    /hex colour or CSS colour name/
  );
  assert.throws(
    () => normalizeNote({ text: 'Check backups', textColor: 'url(https://example.test/x)' }),
    /hex colour or CSS colour name/
  );
});

test('tile URLs reject protocol-relative external hosts', () => {
  assert.throws(
    () => normalizeTile({ name: 'Bad', url: '//example.test/dashboard' }),
    /must be http\(s\) or a \/path/
  );
});

test('section heading effect accepts only known effects', () => {
  assert.equal(normalizeSection({ name: 'Ops', headingEffect: 'rainbow', tiles: [] }).headingEffect, 'rainbow');
  assert.equal(normalizeSection({ name: 'Ops', tiles: [] }).headingEffect, 'none');
  assert.throws(
    () => normalizeSection({ name: 'Ops', headingEffect: 'blink', tiles: [] }),
    /section\.headingEffect/
  );
});

test('workspace background accepts constrained math-art specs', () => {
  const bg = normalizeWorkspaceBackground({
    effect: 'plasma',
    palette: ['#ABCDEF', 'Blue'],
    speed: 9,
    density: 2,
    intensity: 0.5,
  });
  assert.equal(bg.effect, 'plasma');
  assert.deepEqual(bg.palette.slice(0, 2), ['#abcdef', 'blue']);
  assert.equal(bg.speed, 5);
  assert.equal(bg.density, 2);
  assert.equal(bg.intensity, 0.5);
});

test('workspace background rejects unknown effects and unsafe colours', () => {
  assert.throws(() => normalizeWorkspaceBackground({ effect: 'script' }), /workspace\.background\.effect/);
  assert.throws(() => normalizeWorkspaceBackground({ effect: 'waves', palette: ['url(https://example.test/x)'] }), /hex colour or CSS colour name/);
});

test('workspace background formula compiles under the whitelist grammar', () => {
  const bg = normalizeWorkspaceBackground({ effect: 'formula', formula: 'sin(8*r - 2*t) * exp(-r)' });
  assert.equal(bg.effect, 'formula');
  assert.equal(bg.formula, 'sin(8*r - 2*t) * exp(-r)');
  // Non-formula effects never carry a formula along.
  assert.equal('formula' in normalizeWorkspaceBackground({ effect: 'waves', formula: 'sin(x)' }), false);
});

test('workspace background formula rejects non-math input', () => {
  assert.throws(() => normalizeWorkspaceBackground({ effect: 'formula' }), /formula" is required/);
  assert.throws(() => normalizeWorkspaceBackground({ effect: 'formula', formula: 'alert(1)' }), /unknown function/);
  assert.throws(() => normalizeWorkspaceBackground({ effect: 'formula', formula: 'x.constructor' }), /workspace\.background\.formula/);
});
