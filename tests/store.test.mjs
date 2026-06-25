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

  const updated = store.updateSection(section.id, { name: 'Infra', color: 'green', headingEffect: 'rainbow' });

  assert.equal(updated.name, 'Infra');
  assert.equal(updated.color, 'green');
  assert.equal(updated.headingEffect, 'rainbow');
  assert.throws(() => store.updateSection(section.id, { headingEffect: 'sparkle' }), /section\.headingEffect/);
  assert.equal(store.getState().sections[0].headingEffect, 'rainbow');
});

test('rev bumps on commits and undo/redo, but not on view-only writes', () => {
  const store = new Store({ persist: false }).load();
  assert.equal(store.rev, 0);

  store.addSection({ name: 'A' });
  assert.equal(store.rev, 1);

  const wsId = store.getState().workspaces[0].id;
  store.setActiveWorkspace(wsId); // view-only
  assert.equal(store.rev, 1);

  store.undo();
  assert.equal(store.rev, 2);
  store.redo();
  assert.equal(store.rev, 3);
});

test('workspace background updates are validated and undoable', () => {
  const store = new Store({ persist: false }).load();
  const wsId = store.getState().workspaces[0].id;

  const bg = store.updateWorkspaceBackground(wsId, { effect: 'waves', palette: ['#abcdef'], speed: 2 });

  assert.equal(bg.effect, 'waves');
  assert.equal(store.rev, 1);
  assert.throws(() => store.updateWorkspaceBackground(wsId, { effect: 'eval' }), /workspace\.background\.effect/);
  assert.equal(store.getState().workspaces[0].background.effect, 'waves');
  store.undo();
  assert.equal(store.getState().workspaces[0].background.effect, 'none');
});

test('workspaces can be reordered and undone', () => {
  const store = new Store({ persist: false }).load();
  const first = store.getState().workspaces[0];
  const second = store.addWorkspace({ name: 'Second' });
  const third = store.addWorkspace({ name: 'Third' });

  const moved = store.moveWorkspace(third.id, 0);

  assert.deepEqual(moved.workspaces.map((w) => w.id), [third.id, first.id, second.id]);
  assert.equal(store.rev, 3);
  store.undo();
  assert.deepEqual(store.getState().workspaces.map((w) => w.id), [first.id, second.id, third.id]);
});

test('onChange fires for commits and flags view-only writes', () => {
  const store = new Store({ persist: false }).load();
  const seen = [];
  store.onChange = (state, meta) => seen.push({ sections: state.sections.length, ...meta });

  store.addSection({ name: 'A' });
  store.setSectionCollapsed(store.getState().sections.at(-1).id, true);

  assert.equal(seen.length, 2);
  assert.equal(seen[0].rev, 1);
  assert.equal(seen[0].viewOnly, false);
  assert.equal(seen[1].rev, 1);
  assert.equal(seen[1].viewOnly, true);
});

test('undoTimes reverts a batch of commits and is redoable', () => {
  const store = new Store({ persist: false }).load();
  const before = store.getState().sections.length;

  store.addSection({ name: 'One' });
  store.addSection({ name: 'Two' });
  store.addSection({ name: 'Three' });

  const reverted = store.undoTimes(3);
  assert.equal(reverted.sections.length, before);
  assert.equal(store.canRedo(), true);

  store.redo();
  assert.equal(store.getState().sections.length, before + 1);

  assert.throws(() => store.undoTimes(0), /steps/);
});
