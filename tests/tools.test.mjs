import assert from 'node:assert/strict';
import test from 'node:test';
import { makeToolHandlers } from '../src/agent/tools.js';
import { Store } from '../src/store.js';

function duplicateSectionStore() {
  return new Store({ persist: false }).seed({
    title: 'T',
    workspaces: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    activeWorkspaceId: 'a',
    sections: [
      { id: 's1', name: 'Dup', workspaceId: 'a', tiles: [] },
      { id: 's2', name: 'Dup', workspaceId: 'b', tiles: [] },
    ],
    notes: [{ id: 'n1', text: 'Note', workspaceId: 'a' }],
  });
}

test('resize_card rejects ambiguous section names', () => {
  const store = duplicateSectionStore();
  const handlers = makeToolHandlers(store);

  assert.throws(() => handlers.resize_card({ card: 'Dup', w: 4, h: 2 }), /ambiguous/);
  assert.deepEqual(store.getState().sections.map((s) => s.layout), [{}, {}]);
});

test('move_to_workspace rejects ambiguous section names', () => {
  const store = duplicateSectionStore();
  const handlers = makeToolHandlers(store);

  assert.throws(() => handlers.move_to_workspace({ item: 'Dup', workspace: 'B' }), /ambiguous/);
  assert.deepEqual(store.getState().sections.map((s) => s.workspaceId), ['a', 'b']);
});

test('move_to_workspace still accepts note ids', () => {
  const store = duplicateSectionStore();
  const handlers = makeToolHandlers(store);

  const result = handlers.move_to_workspace({ item: 'n1', workspace: 'B' });

  assert.equal(result.moved.workspaceId, 'b');
});
