// Periodic health checks for tiles that opt in (health.enabled).
// HTTP checks treat any response (even 4xx) as "up" — the host answered.
// TCP checks just confirm the port accepts a connection.
import net from 'node:net';
import { config } from './config.js';

export class HealthMonitor {
  constructor(store, { intervalMs = config.healthIntervalMs, timeoutMs = config.healthTimeoutMs } = {}) {
    this.store = store;
    this.intervalMs = intervalMs;
    this.timeoutMs = timeoutMs;
    this.statuses = new Map(); // tileId -> { status, code, latencyMs, checkedAt, error }
    this.timer = null;
  }

  start() {
    this.runOnce();
    this.timer = setInterval(() => this.runOnce(), this.intervalMs);
    this.timer.unref?.();
    return this;
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatuses() {
    return Object.fromEntries(this.statuses);
  }

  async runOnce() {
    const { sections } = this.store.getState();
    const checks = [];
    const live = new Set();
    for (const section of sections) {
      for (const tile of section.tiles) {
        if (!tile.health?.enabled || tile.health.type === 'none') continue;
        live.add(tile.id);
        checks.push(this.checkTile(tile));
      }
    }
    // Drop status for tiles that no longer exist or stopped opting in.
    for (const id of this.statuses.keys()) if (!live.has(id)) this.statuses.delete(id);
    await Promise.all(checks);
  }

  async checkTile(tile) {
    const target = tile.health.target || tile.url;
    const started = Date.now();
    try {
      const result =
        tile.health.type === 'tcp'
          ? await this.tcpCheck(target)
          : await this.httpCheck(target);
      this.statuses.set(tile.id, {
        status: 'up',
        code: result.code ?? null,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      this.statuses.set(tile.id, {
        status: 'down',
        code: null,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
        error: err.message,
      });
    }
  }

  async httpCheck(target) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(target, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
      return { code: res.status };
    } finally {
      clearTimeout(t);
    }
  }

  tcpCheck(target) {
    return new Promise((resolve, reject) => {
      let host;
      let port;
      try {
        const u = new URL(target);
        host = u.hostname;
        port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
      } catch {
        reject(new Error(`invalid tcp target: ${target}`));
        return;
      }
      const socket = net.createConnection({ host, port });
      const done = (err) => {
        socket.destroy();
        err ? reject(err) : resolve({ code: null });
      };
      socket.setTimeout(this.timeoutMs);
      socket.once('connect', () => done());
      socket.once('timeout', () => done(new Error('timeout')));
      socket.once('error', (err) => done(err));
    });
  }
}
