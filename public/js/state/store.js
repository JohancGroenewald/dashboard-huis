// Client state: the dashboard tree plus UI flags, with topic-based
// subscriptions so a streaming chat token never re-renders the board.
//
// Topics: 'dashboard' (board tree changed), 'health' (tile statuses),
// 'view' (which panel is on screen), 'agent' (ambient copilot activity).
import { api, apiWithRes } from '../lib/api.js';

export const store = {
  dashboard: { title: 'Dashboard', workspaces: [], activeWorkspaceId: null, sections: [], notes: [], featureRequests: [] },
  rev: 0,
  health: {},
  view: 'board',
};

const subs = new Map();

export function subscribe(topic, fn) {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic).add(fn);
  return () => subs.get(topic).delete(fn);
}

export function publish(topic, payload) {
  for (const fn of subs.get(topic) || []) fn(payload);
}

// Edit guard: while the user is mid-edit (focused note textarea, inline
// rename, or a GridStack drag), remote state is stashed instead of applied,
// then flushed when the interaction ends. Latest-wins.
let interactionCheck = null;
let deferred = null;

export function setInteractionCheck(fn) {
  interactionCheck = fn;
}

export function flushDeferred() {
  if (!deferred) return;
  const { dashboard, rev } = deferred;
  deferred = null;
  applyDashboard(dashboard, rev);
}

// Apply a new dashboard tree. rev-stamped calls (SSE) are deduped against the
// last seen revision; un-stamped calls (REST responses) always apply.
export function applyDashboard(dashboard, rev = null, { viewOnly = false } = {}) {
  if (rev != null) {
    if (viewOnly ? rev < store.rev : rev <= store.rev) return false;
    if (interactionCheck?.()) {
      deferred = { dashboard, rev };
      return false;
    }
    store.rev = Math.max(store.rev, rev);
  }
  store.dashboard = dashboard;
  publish('dashboard', dashboard);
  return true;
}

export async function loadDashboard() {
  const { data, res } = await apiWithRes('/api/dashboard');
  const rev = Number(res.headers.get('x-dashboard-rev'));
  if (Number.isFinite(rev)) store.rev = rev;
  store.dashboard = data;
  publish('dashboard', data);
}

export async function switchWorkspace(id) {
  applyDashboard(await api(`/api/workspaces/${id}/activate`, { method: 'POST' }));
}

export function setView(view) {
  store.view = view;
  publish('view', view);
}

export function setHealth(statuses) {
  store.health = statuses || {};
  publish('health', store.health);
}
