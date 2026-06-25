// Dashboard HTTP server: serves the UI, a REST API for dashboard state and
// health, and the agent endpoint (gated by the model allowlist).
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { config, paths } from './config.js';
import { ENV_BOUNDS, HTTP_STATUS, SCRAPER_LIMITS } from './constants.js';
import { EventHub } from './events.js';
import { Store } from './store.js';
import { HealthMonitor } from './health.js';
import { Ollama } from './ollama.js';
import { toolSpecs } from './agent/tools.js';
import { query } from './chatlog.js';
import { mountAgentRoutes } from './routes/agent.js';
import { listPrompts, setPromptOverride } from './prompts.js';
import { humanMove, aiMove, resetGame, reflectOnGame, isModelTurn } from './games.js';
import { pressTrigger } from './triggers.js';
import { runScraper } from './scrapers.js';
import { ScraperResultStore, hydrateScraperRows, readScraperRows } from './scraper-results.js';
import { forwardTranscription } from './speech-to-text.js';
import { listApproved, listResults, listSupervised, listDelegated, listParallel, listRetired, isApproved } from './validation/registry.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const store = new Store({
  filePath: paths.dashboard,
  backupsDir: paths.backups,
  maxBackups: config.maxBackups,
  maxHistory: config.maxHistory,
}).load();

const health = new HealthMonitor(store).start();
const ollama = new Ollama();
const events = new EventHub();
const scraperResults = new ScraperResultStore({ dbPath: paths.scraperResults });
const clientDashboard = (dashboard) =>
  hydrateScraperRows(dashboard, scraperResults, { limit: SCRAPER_LIMITS.displayRowsDefault });

// Broadcast every store change to connected browsers. The originating tab's
// X-Client-Id rides along so clients can tell their own echo from real news.
store.onChange = (dashboard, { rev, viewOnly }) =>
  events.broadcastDashboard({ rev, viewOnly: viewOnly || undefined, dashboard: clientDashboard(dashboard), sourceClient: events.lastClientId || undefined });

const app = express();
app.use(express.json({ limit: config.jsonBodyLimit }));

// Remember which tab is talking to us; store.onChange fires synchronously
// inside normal REST mutations, so this is accurate for echo suppression there.
// Agent tool mutations clear this marker so their live updates reach the tab
// that asked for the run too.
app.use('/api', (req, res, next) => {
  const sourceClient = req.get('x-client-id') || null;
  events.lastClientId = sourceClient;
  res.on('finish', () => {
    if (events.lastClientId === sourceClient) events.lastClientId = null;
  });
  next();
});

// Turn store validation errors into 400s instead of 500s.
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.code === 'EVALIDATION' ? HTTP_STATUS.badRequest : HTTP_STATUS.internalServerError;
    res.status(status).json({ error: err.message });
  }
};

// ---- dashboard state -----------------------------------------------------
app.get('/api/dashboard', (req, res) => {
  res.set('X-Dashboard-Rev', String(store.rev));
  res.json(clientDashboard(store.getState()));
});

// Long-lived SSE channel: dashboard changes + ambient agent activity.
app.get('/api/events', (req, res) => events.attach(req, res, { rev: store.rev }));

// ---- workspaces ----------------------------------------------------------
app.post('/api/workspaces', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addWorkspace(req.body))));
app.patch('/api/workspaces/:id', wrap((req, res) => res.json(store.renameWorkspace(req.params.id, req.body.name))));
app.patch('/api/workspaces/:id/background', wrap((req, res) => res.json(store.updateWorkspaceBackground(req.params.id, req.body))));
app.delete('/api/workspaces/:id', wrap((req, res) => res.json(store.removeWorkspace(req.params.id))));
// Switch the active workspace; returns the full state so the board can refresh.
app.post('/api/workspaces/:id/activate', wrap((req, res) => res.json(store.setActiveWorkspace(req.params.id))));
app.post('/api/sections/:id/workspace', wrap((req, res) => res.json(store.moveSectionToWorkspace(req.params.id, req.body.workspaceId))));
app.post('/api/notes/:id/workspace', wrap((req, res) => res.json(store.moveNoteToWorkspace(req.params.id, req.body.workspaceId))));

app.post('/api/sections', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addSection(req.body))));
app.patch('/api/sections/:id', wrap((req, res) => res.json(store.updateSection(req.params.id, req.body))));
app.delete('/api/sections/:id', wrap((req, res) => res.json(store.removeSection(req.params.id))));

app.post('/api/sections/:id/move', wrap((req, res) => res.json(store.moveSection(req.params.id, req.body.position))));

// Collapse/expand: one section, or all in the active workspace.
app.post('/api/sections/collapse', wrap((req, res) => res.json(store.setAllCollapsed(req.body.collapsed))));
app.post('/api/sections/:id/collapse', wrap((req, res) => res.json(store.setSectionCollapsed(req.params.id, req.body.collapsed))));

app.post('/api/sections/:id/tiles', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addTile(req.params.id, req.body))));
app.patch('/api/tiles/:id', wrap((req, res) => res.json(store.updateTile(req.params.id, req.body))));
app.delete('/api/tiles/:id', wrap((req, res) => res.json(store.removeTile(req.params.id))));
app.post('/api/tiles/:id/move', wrap((req, res) =>
  res.json(store.moveTile(req.params.id, req.body.section_id, req.body.position))
));

// Persist grid layout (drag/resize) for many cards at once.
app.post('/api/layout', wrap((req, res) => res.json(store.setLayouts(req.body.items || []))));

// Undo / redo the last dashboard change(s).
app.post('/api/undo', wrap((req, res) => {
  const dashboard = store.undo() || store.getState();
  res.json({ dashboard, canUndo: store.canUndo(), canRedo: store.canRedo() });
}));
app.post('/api/redo', wrap((req, res) => {
  const dashboard = store.redo() || store.getState();
  res.json({ dashboard, canUndo: store.canUndo(), canRedo: store.canRedo() });
}));

// Revert a batch of changes (e.g. everything one agent run did). Refuses when
// the board has moved on since the caller last saw it, so a stale "revert"
// can never eat someone else's edits.
app.post('/api/undo-batch', wrap((req, res) => {
  const { steps, expectedRev } = req.body || {};
  if (Number(expectedRev) !== store.rev) {
    return res.status(HTTP_STATUS.conflict).json({ error: `dashboard changed since rev ${expectedRev} (now ${store.rev})` });
  }
  const dashboard = store.undoTimes(steps);
  res.json({ dashboard, rev: store.rev, canUndo: store.canUndo(), canRedo: store.canRedo() });
}));

// ---- sticky notes --------------------------------------------------------
app.post('/api/notes', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addNote(req.body))));
app.patch('/api/notes/:id', wrap((req, res) => res.json(store.updateNote(req.params.id, req.body))));
app.delete('/api/notes/:id', wrap((req, res) => res.json(store.removeNote(req.params.id))));

// ---- feature requests ----------------------------------------------------
app.post('/api/feature-requests', wrap((req, res) =>
  res.status(HTTP_STATUS.created).json(store.addFeatureRequest({ ...req.body, requestedBy: req.body.requestedBy || 'you' }))
));
app.patch('/api/feature-requests/:id', wrap((req, res) => res.json(store.updateFeatureRequest(req.params.id, req.body))));
app.delete('/api/feature-requests/:id', wrap((req, res) => res.json(store.removeFeatureRequest(req.params.id))));

// ---- health --------------------------------------------------------------
app.get('/api/health', (req, res) => res.json(health.getStatuses()));

// Browser microphone uploads are proxied so the speech-to-text bearer token
// stays server-side. The proxy deliberately returns only JSON.
app.get('/api/speech-to-text/status', (req, res) => {
  res.json({ enabled: Boolean(config.speechToTextToken) });
});
app.post('/api/speech-to-text/transcriptions', wrap(async (req, res) => {
  const out = await forwardTranscription(req, {
    baseUrl: config.speechToTextUrl,
    token: config.speechToTextToken,
    timeoutMs: config.speechToTextTimeoutMs,
  });
  res.status(out.status).json(out.body);
}));

// ---- agent abilities (the tools the model can call) ----------------------
app.get('/api/abilities', (req, res) =>
  res.json(
    toolSpecs.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      params: Object.keys(t.function.parameters?.properties || {}),
      required: t.function.parameters?.required || [],
    }))
  )
);

// ---- conversation log ----------------------------------------------------
app.get('/api/logs', wrap((req, res) => {
  const requestedLimit = Number(req.query.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), ENV_BOUNDS.minPositiveInt), config.logMaxLimit)
    : config.logDefaultLimit;
  const where = [];
  const params = [];
  if (req.query.kind) { where.push('kind = ?'); params.push(req.query.kind); }
  if (req.query.model) { where.push('model = ?'); params.push(req.query.model); }
  if (req.query.excludeModel) { where.push('model != ?'); params.push(req.query.excludeModel); }
  // error is NULL on successful rows; a bare != would drop those too.
  if (req.query.excludeError) { where.push('(error IS NULL OR error != ?)'); params.push(req.query.excludeError); }
  let sql = 'SELECT id, ts, kind, model, task, user_msg, reply, trace, rounds, content, steps, ms, pass, error FROM chat_log';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  const rows = query(sql, params).map((r) => {
    let trace = [];
    let rounds = [];
    try { trace = JSON.parse(r.trace || '[]'); } catch { /* ignore */ }
    try { rounds = JSON.parse(r.rounds || '[]'); } catch { /* ignore */ }
    return { ...r, trace, rounds };
  });
  res.json(rows);
}));

// ---- games -----------------------------------------------------------------
const thinkingGames = new Set(); // one AI turn at a time per game
app.post('/api/games', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addGame(req.body || {}))));
// Only the co-player choice is patchable; board state moves through /move.
app.patch('/api/games/:id', wrap((req, res) => res.json(store.updateGame(req.params.id, { model: String(req.body?.model ?? '') }))));
app.delete('/api/games/:id', wrap((req, res) => res.json(store.removeGame(req.params.id))));
app.post('/api/games/:id/reset', wrap((req, res) => res.json(resetGame(store, req.params.id))));
app.post('/api/games/:id/move', wrap(async (req, res) => {
  const id = req.params.id;
  if (thinkingGames.has(id)) { res.status(HTTP_STATUS.conflict).json({ error: 'the model is still thinking' }); return; }
  const { model, image } = req.body || {};
  if (model && !isApproved(model)) { res.status(HTTP_STATUS.forbidden).json({ error: `"${model}" has not passed pre-validation` }); return; }
  let game = humanMove(store, id, Number(req.body?.cell));
  // A game-ending X move leaves no move to answer — don't ask for one.
  if (model && isModelTurn(game)) {
    thinkingGames.add(id);
    try {
      ({ game } = await aiMove({ store, ollama, gameId: id, model, image }));
    } finally {
      thinkingGames.delete(id);
    }
  }
  res.json(game);
}));
app.post('/api/games/:id/reflect', wrap(async (req, res) => {
  const id = req.params.id;
  const { model, image } = req.body || {};
  if (!model || !isApproved(model)) { res.status(HTTP_STATUS.forbidden).json({ error: `"${model || '(none)'}" has not passed pre-validation` }); return; }
  if (thinkingGames.has(id)) { res.status(HTTP_STATUS.conflict).json({ error: 'the model is still thinking' }); return; }
  thinkingGames.add(id);
  try {
    res.json(await reflectOnGame({ store, ollama, gameId: id, model, image }));
  } finally {
    thinkingGames.delete(id);
  }
}));

// ---- problems ----------------------------------------------------------------
app.post('/api/problems', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addProblem({ ...req.body, reportedBy: req.body?.reportedBy || 'you' }))));
app.patch('/api/problems/:id', wrap((req, res) => res.json(store.updateProblem(req.params.id, { status: req.body?.status }))));
app.delete('/api/problems/:id', wrap((req, res) => res.json(store.removeProblem(req.params.id))));

// ---- triggers ---------------------------------------------------------------
app.post('/api/triggers', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addTrigger(req.body || {}))));
app.patch('/api/triggers/:id', wrap((req, res) => {
  const { name, cooldownMs } = req.body || {};
  res.json(store.updateTrigger(req.params.id, { ...(name !== undefined ? { name } : {}), ...(cooldownMs !== undefined ? { cooldownMs } : {}) }));
}));
app.delete('/api/triggers/:id', wrap((req, res) => res.json(store.removeTrigger(req.params.id))));
app.post('/api/triggers/:id/press', wrap((req, res) => res.json(pressTrigger(store, req.params.id))));

// ---- scrapers ----------------------------------------------------------------
const runningScrapers = new Set(); // one run at a time per scraper
app.post('/api/scrapers', wrap((req, res) => res.status(HTTP_STATUS.created).json(store.addScraper(req.body || {}))));
app.patch('/api/scrapers/:id', wrap((req, res) => {
  const { name, url, instruction, model, pageMode, pageTokens, sourceMode, sourceProcess } = req.body || {};
  const patch = {};
  for (const [k, v] of Object.entries({ name, url, instruction, model, pageMode, pageTokens, sourceMode, sourceProcess })) if (v !== undefined) patch[k] = v;
  res.json(store.updateScraper(req.params.id, patch));
}));
app.delete('/api/scrapers/:id', wrap((req, res) => res.json(store.removeScraper(req.params.id))));
app.get('/api/scrapers/:id/rows', wrap((req, res) => {
  const sc = store.getScraper(req.params.id);
  const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
  const limit = Math.min(
    Math.max(1, Math.trunc(Number(req.query.limit) || SCRAPER_LIMITS.displayRowsDefault)),
    SCRAPER_LIMITS.displayRowsMax
  );
  res.json(readScraperRows(sc, scraperResults, { offset, limit }) || {
    name: sc.name, columns: [], rows: [], rowIds: [], total: 0, returned: 0, offset, note: 'no results yet',
  });
}));
app.post('/api/scrapers/:id/run', wrap(async (req, res) => {
  const id = req.params.id;
  const model = req.body?.model || store.getScraper(id).model;
  if (!model || !isApproved(model)) { res.status(HTTP_STATUS.forbidden).json({ error: `"${model || '(none)'}" has not passed pre-validation` }); return; }
  if (runningScrapers.has(id)) { res.status(HTTP_STATUS.conflict).json({ error: 'this scraper is already running' }); return; }
  runningScrapers.add(id);
  try {
    const onProgress = (info) => events.broadcast('scraper', info);
    res.json(await runScraper({ store, ollama, scraperId: id, model, onProgress, scraperResults }));
  } finally {
    runningScrapers.delete(id);
  }
}));

// ---- editable model prompts ------------------------------------------------
app.get('/api/prompts', wrap((req, res) => res.json(listPrompts())));
app.put('/api/prompts/:id', wrap((req, res) => res.json(setPromptOverride(req.params.id, req.body?.template))));

// ---- models & agent ------------------------------------------------------
// Capabilities are immutable per model tag; ask Ollama once and remember.
const visionCache = new Map();
async function visionFlags(models) {
  const out = {};
  await Promise.all(models.map(async (m) => {
    if (!visionCache.has(m)) {
      try { visionCache.set(m, ((await ollama.show(m)).capabilities || []).includes('vision')); }
      catch { return; } // ollama offline — report unknown as false, retry next time
    }
    out[m] = visionCache.get(m);
  }));
  return out;
}

app.get('/api/models', wrap(async (req, res) => {
  const approved = listApproved();
  let installed = [];
  try {
    installed = await ollama.listModels();
  } catch { /* ollama offline — still report the allowlist */ }
  res.json({
    approved: Object.keys(approved),
    installed,
    details: approved,
    vision: await visionFlags(Object.keys(approved)), // model → can it see images

    results: listResults(), // every tested model + outcome (pass or fail)
    supervised: listSupervised(), // failed-model + trusted-supervisor pairings
    delegated: listDelegated(), // trusted-orchestrator ▸ untrusted-sub-agent pairings
    parallel: listParallel(), // orchestrator ⇉ N concurrent sub-agents
    retired: listRetired(), // models we've retired as unreliable
  });
}));

// Agent chat (whole-reply + streaming) — see src/routes/agent.js.
mountAgentRoutes(app, { store, ollama, events, wrap, scraperResults });

// no-cache + ETag: the browser always revalidates, so updated JS/CSS/HTML load
// immediately (a 304 when unchanged) — no more stale modules / hard-refreshing.
app.use(express.static(config.publicDir, {
  etag: true,
  lastModified: true,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

// Always serve HTTP; also serve HTTPS when a cert+key from the internal CA exist.
http.createServer(app).listen(config.port, config.host, () =>
  console.log(`Huis dashboard → http://${config.host}:${config.port}`)
);

if (fs.existsSync(config.tlsCert) && fs.existsSync(config.tlsKey)) {
  const creds = { cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) };
  https.createServer(creds, app).listen(config.httpsPort, config.host, () =>
    console.log(`Huis dashboard → https://${config.host}:${config.httpsPort}`)
  );
} else {
  console.log(`HTTPS disabled (no cert at ${config.tlsCert})`);
}

console.log(`Ollama backend → ${config.ollamaHost}`);
const approved = Object.keys(listApproved());
console.log(approved.length
  ? `Approved agent models: ${approved.join(', ')}`
  : 'No approved agent models yet — run: npm run validate -- --all');
