import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import { EventHub, sseFrame } from '../src/events.js';

function fakeClient() {
  const req = new EventEmitter();
  const res = {
    chunks: [],
    set() {},
    flushHeaders() {},
    write(chunk) { this.chunks.push(chunk); },
  };
  return { req, res };
}

test('attach greets the client and broadcast reaches it', () => {
  const hub = new EventHub({ heartbeatMs: 60_000 });
  const { req, res } = fakeClient();

  hub.attach(req, res, { rev: 7 });
  assert.equal(res.chunks[0], sseFrame('hello', { rev: 7, clientCount: 1 }));

  hub.broadcast('agent', { phase: 'start' });
  assert.equal(res.chunks[1], sseFrame('agent', { phase: 'start' }));

  req.emit('close');
  hub.broadcast('agent', { phase: 'done' });
  assert.equal(res.chunks.length, 2); // detached clients hear nothing
});

test('dashboard broadcasts coalesce to the latest payload', async () => {
  const hub = new EventHub({ heartbeatMs: 60_000, coalesceMs: 5 });
  const { req, res } = fakeClient();
  hub.attach(req, res, { rev: 0 });

  hub.broadcastDashboard({ rev: 1, dashboard: { v: 1 } });
  hub.broadcastDashboard({ rev: 2, dashboard: { v: 2 } });
  hub.broadcastDashboard({ rev: 3, dashboard: { v: 3 } });
  await sleep(20);

  const dashboards = res.chunks.filter((c) => c.startsWith('event: dashboard'));
  assert.equal(dashboards.length, 1);
  assert.match(dashboards[0], /"rev":3/);
  req.emit('close');
});

test('sseFrame formats a spec-compliant frame', () => {
  assert.equal(sseFrame('x', { a: 1 }), 'event: x\ndata: {"a":1}\n\n');
});
