import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../src/store.js';

test('invalid section patch does not mutate live state', () => {
  const store = new Store({ persist: false }).load();
  const section = store.getState().sections[0];

  assert.throws(
    () => store.updateSection(section.id, { name: 'Changed despite validation', color: 42 }),
    /section\.color/
  );

  assert.equal(store.getState().sections[0].name, section.name);
});

test('valid section patch applies after validation', () => {
  const store = new Store({ persist: false }).load();
  const section = store.getState().sections[0];

  const updated = store.updateSection(section.id, { name: 'Infra', color: 'green' });

  assert.equal(updated.name, 'Infra');
  assert.equal(updated.color, 'green');
});
