import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeNote, normalizeSection, normalizeTile } from '../src/schema.js';

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
