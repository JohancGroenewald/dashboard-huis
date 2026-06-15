// Trigger presses: stamp the time, then refuse repeats until the cooldown
// expires. Server-side so two tabs can't double-press; the remaining time
// rides in the error message for the UI (and the agent) to relay.
import { fail } from './schema.js';

export function fmtRemaining(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.ceil(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const dm = m % 60;
  if (h < 24) return dm ? `${h}h ${dm}m` : `${h}h`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function pressTrigger(store, id, now = Date.now()) {
  const t = store.getTrigger(id);
  const last = t.lastPressedAt ? Date.parse(t.lastPressedAt) : 0;
  const readyAt = last + t.cooldownMs;
  if (last && now < readyAt) fail(`"${t.name}" is cooling down — ready in ${fmtRemaining(readyAt - now)}`);
  const stamp = new Date(now).toISOString();
  return store.updateTrigger(id, { lastPressedAt: stamp, history: [stamp, ...t.history] });
}

export function stopTrigger(store, id, now = Date.now()) {
  const t = store.getTrigger(id);
  const last = t.lastPressedAt ? Date.parse(t.lastPressedAt) : 0;
  const readyAt = last + t.cooldownMs;
  if (!last || now >= readyAt) return { ...t, stopped: false };
  return { ...store.updateTrigger(id, { lastPressedAt: null }), stopped: true };
}
