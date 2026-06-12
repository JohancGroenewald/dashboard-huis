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

test('update_section can enable rainbow heading effect', () => {
  const store = duplicateSectionStore();
  const handlers = makeToolHandlers(store);

  const result = handlers.update_section({ section: 's1', headingEffect: 'rainbow' });

  assert.equal(result.updated.headingEffect, 'rainbow');
  assert.equal(store.getState().sections.find((s) => s.id === 's1').headingEffect, 'rainbow');
});

test('set_workspace_background updates a workspace math-art spec', () => {
  const store = duplicateSectionStore();
  const handlers = makeToolHandlers(store);

  const result = handlers.set_workspace_background({
    workspace: 'B',
    effect: 'stars',
    palette: ['#123456', 'gold'],
    density: 2,
  });

  assert.equal(result.workspace.name, 'B');
  assert.equal(result.updated.effect, 'stars');
  assert.equal(store.getState().workspaces.find((w) => w.name === 'B').background.palette[1], 'gold');
});

test('report_problem files into the problems queue with the model as reporter', () => {
  const store = new Store({ persist: false }).load();
  const handlers = makeToolHandlers(store, { requestedBy: 'gemma4:e4b' });
  const out = handlers.report_problem({ title: 'add_tile keeps failing', detail: 'url rejected: …' });
  assert.equal(out.filed.status, 'open');
  assert.equal(out.filed.reportedBy, 'gemma4:e4b');
  const p = store.getState().problems[0];
  assert.equal(p.title, 'add_tile keeps failing');
  assert.throws(() => store.updateProblem(p.id, { status: 'fixed' }), /status/);
  assert.equal(store.updateProblem(p.id, { status: 'resolved' }).status, 'resolved');
  store.removeProblem(p.id);
  assert.equal(store.getState().problems.length, 0);
});

test('move_to_workspace resolves a trigger by its unique name', () => {
  const store = new Store({ persist: false }).load();
  const handlers = makeToolHandlers(store);
  const ws = store.addWorkspace({ name: 'Reminders' });
  const t = store.addTrigger({ name: 'Take Your Eyedrops' });
  const out = handlers.move_to_workspace({ item: 'take your eyedrops', workspace: 'Reminders' });
  assert.equal(out.moved.id, t.id);
  assert.equal(out.moved.workspaceId, ws.id);
});
