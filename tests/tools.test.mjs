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

test('stop_trigger tool clears an active trigger cooldown', () => {
  const store = new Store({ persist: false }).load();
  const handlers = makeToolHandlers(store);
  const t = store.addTrigger({
    name: 'Water plants',
    cooldownMs: 60_000,
    lastPressedAt: new Date(Date.now() - 1_000).toISOString(),
    history: [new Date(Date.now() - 1_000).toISOString()],
  });

  const out = handlers.stop_trigger({ trigger_id: t.id });

  assert.equal(out.stopped.id, t.id);
  assert.equal(out.stopped.stopped, true);
  assert.equal(store.getTrigger(t.id).lastPressedAt, null);
  assert.equal(store.getTrigger(t.id).history.length, 1);
});

test('get_dashboard exposes enough game and trigger state for item menus', () => {
  const store = new Store({ persist: false }).load();
  const handlers = makeToolHandlers(store);
  const game = store.addGame({ memory: 'Prefer centre', board: ['X', '', '', '', 'O', '', '', '', ''], moves: [{ p: 'X', cell: 0 }] });
  const trigger = store.addTrigger({ name: 'Water plants', history: ['2026-06-15T08:00:00.000Z'] });

  const dashboard = handlers.get_dashboard();

  const gameSummary = dashboard.games.find((g) => g.id === game.id);
  assert.deepEqual(gameSummary.board, game.board);
  assert.equal(gameSummary.memory, 'Prefer centre');
  assert.deepEqual(gameSummary.moves, game.moves);
  const triggerSummary = dashboard.triggers.find((t) => t.id === trigger.id);
  assert.deepEqual(triggerSummary.history, ['2026-06-15T08:00:00.000Z']);
});

test('read_scraper returns a paged slice of the extracted rows', () => {
  const store = new Store({ persist: false }).load();
  const handlers = makeToolHandlers(store);
  const sc = store.addScraper({ name: 'Shop', url: 'http://x', result: {
    columns: ['Item', 'Price'],
    rows: Array.from({ length: 12 }, (_, i) => [`Item${i}`, `$${i}`]),
    note: 'ok',
  } });

  const first = handlers.read_scraper({ scraper_id: sc.id, limit: 5 });
  assert.deepEqual(first.columns, ['Item', 'Price']);
  assert.equal(first.total, 12);
  assert.equal(first.returned, 5);
  assert.deepEqual(first.rows[0], ['Item0', '$0']);

  const next = handlers.read_scraper({ scraper_id: sc.id, offset: 10, limit: 5 });
  assert.equal(next.offset, 10);
  assert.equal(next.returned, 2); // only 2 rows left past offset 10
  assert.deepEqual(next.rows[1], ['Item11', '$11']);

  // limit is capped, and a scraper with no result reports it cleanly.
  assert.ok(handlers.read_scraper({ scraper_id: sc.id, limit: 9999 }).returned <= 50);
  const empty = handlers.read_scraper({ scraper_id: store.addScraper({ name: 'New' }).id });
  assert.equal(empty.total, 0);
  assert.match(empty.note, /run this scraper/);
});
