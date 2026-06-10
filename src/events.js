// SSE event hub: one broadcast channel (GET /api/events) that every open
// browser listens to for dashboard state changes and ambient agent activity.
// Private per-request streams (e.g. a chat run) do not go through here — they
// stream over their own response body.
import { SSE_LIMITS } from './constants.js';

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function sseFrame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class EventHub {
  constructor({ heartbeatMs = SSE_LIMITS.heartbeatMs, coalesceMs = SSE_LIMITS.coalesceMs } = {}) {
    this.clients = new Set();
    this.heartbeatMs = heartbeatMs;
    this.coalesceMs = coalesceMs;
    this.heartbeatTimer = null;
    this.pendingDashboard = null;
    this.flushTimer = null;
    // The X-Client-Id of the request currently mutating the store, so the
    // dashboard broadcast can tell the originating tab from the others.
    this.lastClientId = null;
  }

  // Register a long-lived SSE client and greet it with a hello event.
  attach(req, res, hello = {}) {
    res.set(SSE_HEADERS);
    res.flushHeaders();
    this.clients.add(res);
    res.write(sseFrame('hello', { ...hello, clientCount: this.clients.size }));
    if (!this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => this.#heartbeat(), this.heartbeatMs);
      this.heartbeatTimer.unref?.();
    }
    req.on('close', () => {
      this.clients.delete(res);
      if (!this.clients.size && this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
    });
  }

  broadcast(event, data) {
    const frame = sseFrame(event, data);
    for (const res of this.clients) res.write(frame);
  }

  // Dashboard updates coalesce over a short window so bursts (e.g. layout
  // persists during a drag) become one event carrying the latest state.
  broadcastDashboard(payload) {
    this.pendingDashboard = payload;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const p = this.pendingDashboard;
      this.pendingDashboard = null;
      this.broadcast('dashboard', p);
    }, this.coalesceMs);
    this.flushTimer.unref?.();
  }

  broadcastAgentActivity(payload) {
    this.broadcast('agent', payload);
  }

  #heartbeat() {
    for (const res of this.clients) res.write(': heartbeat\n\n');
  }
}
