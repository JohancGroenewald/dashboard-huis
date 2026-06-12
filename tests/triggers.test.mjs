import assert from 'node:assert/strict';
import test from 'node:test';
import { Store } from '../src/store.js';
import { pressTrigger, fmtRemaining } from '../src/triggers.js';
import { normalizeTrigger } from '../src/schema.js';

const newStore = () => new Store({ persist: false }).load();

test('a press stamps the time and starts the cooldown', () => {
  const store = newStore();
  const t = store.addTrigger({ name: 'Fed the dog', cooldownMs: 60_000 });
  assert.equal(t.lastPressedAt, null);
  const t0 = Date.parse('2026-06-12T08:00:00Z');
  const pressed = pressTrigger(store, t.id, t0);
  assert.equal(Date.parse(pressed.lastPressedAt), t0);
  assert.equal(pressed.history.length, 1);
  // Within the cooldown: refused, with the remaining time in the message.
  assert.throws(() => pressTrigger(store, t.id, t0 + 30_000), /cooling down — ready in 30s/);
  // After it expires: allowed again, history grows newest-first.
  const again = pressTrigger(store, t.id, t0 + 61_000);
  assert.equal(again.history.length, 2);
  assert.equal(Date.parse(again.history[0]), t0 + 61_000);
});

test('history is capped and junk timestamps are dropped', () => {
  const store = newStore();
  const t = store.addTrigger({ name: 'Meds', cooldownMs: 0 }); // no cooldown
  let now = Date.parse('2026-06-12T08:00:00Z');
  for (let i = 0; i < 15; i++) pressTrigger(store, t.id, (now += 1000));
  assert.equal(store.getTrigger(t.id).history.length, 12); // capped
  assert.deepEqual(normalizeTrigger({ history: ['not a date', '2026-06-12T08:00:00Z', 42] }).history, ['2026-06-12T08:00:00Z']);
});

test('normalizeTrigger applies defaults and bounds', () => {
  const t = normalizeTrigger({});
  assert.equal(t.name, 'Trigger');
  assert.equal(t.cooldownMs, 6 * 60 * 60 * 1000); // 6h default
  assert.equal(normalizeTrigger({ cooldownMs: 1e12 }).cooldownMs, 7 * 24 * 60 * 60 * 1000); // clamped to a week
  assert.throws(() => normalizeTrigger({ cooldownMs: -5 }), /cooldownMs/);
  assert.throws(() => normalizeTrigger({ cooldownMs: 'soon' }), /cooldownMs/);
});

test('fmtRemaining reads naturally at every scale', () => {
  assert.equal(fmtRemaining(45_000), '45s');
  assert.equal(fmtRemaining(5 * 60_000), '5m');
  assert.equal(fmtRemaining(90 * 60_000), '1h 30m');
  assert.equal(fmtRemaining(26 * 60 * 60_000), '1d 2h');
});

test('triggers are searchable, movable across workspaces, and block workspace deletion', () => {
  const store = newStore();
  const ws = store.addWorkspace({ name: 'Reminders' });
  const t = store.addTrigger({ name: 'Take Your Eyedrops' });
  // search_dashboard resolves the name to an id…
  const hit = store.search('eyedrops').find((m) => m.type === 'trigger');
  assert.equal(hit?.id, t.id);
  // …and the generic move relocates it.
  assert.equal(store.moveCardToWorkspace(t.id, ws.id).workspaceId, ws.id);
  // A workspace holding a trigger refuses deletion instead of orphaning it.
  assert.throws(() => store.removeWorkspace(ws.id), /not empty/);
  assert.throws(() => store.moveCardToWorkspace('nope', ws.id), /nothing movable/);
});

test('plural search queries match singular items ("triggers" → trigger)', () => {
  const store = newStore();
  store.addTrigger({ name: 'Take Your Eyedrops' });
  store.addGame({});
  // The exact query from the model-filed problem: search_dashboard("triggers")
  assert.equal(store.search('triggers').filter((m) => m.type === 'trigger').length, 1);
  assert.equal(store.search('games').filter((m) => m.type === 'game').length, 1);
  assert.equal(store.search('the two triggers').some((m) => m.type === 'trigger'), true);
});

test('numeric noise tokens do not drown trigger matches ("2 triggers")', () => {
  const store = newStore();
  const sec = store.addSection({ name: 'Servers' });
  store.addTile(sec.id, { name: 'Proxmox 2', url: 'https://pve2.huis' });
  store.addTrigger({ name: 'Take Your Eyedrops' });
  store.addTrigger({ name: 'Take Your Medication' });
  const matches = store.search('2 triggers');
  assert.equal(matches.length, 2);
  assert.ok(matches.every((m) => m.type === 'trigger'));
});
