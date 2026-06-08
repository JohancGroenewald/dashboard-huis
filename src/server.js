// Dashboard HTTP server: serves the UI, a REST API for dashboard state and
// health, and the agent endpoint (gated by the model allowlist).
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { config, paths } from './config.js';
import { Store } from './store.js';
import { HealthMonitor } from './health.js';
import { Ollama } from './ollama.js';
import { runAgent } from './agent/agent.js';
import { toolSpecs } from './agent/tools.js';
import { logTurn, query } from './chatlog.js';
import { listApproved, isApproved, listResults, listSupervised, listDelegated, listParallel } from './validation/registry.js';

fs.mkdirSync(config.dataDir, { recursive: true });

const store = new Store({
  filePath: paths.dashboard,
  backupsDir: paths.backups,
  maxBackups: config.maxBackups,
}).load();

const health = new HealthMonitor(store).start();
const ollama = new Ollama();

const app = express();
app.use(express.json({ limit: '1mb' }));

// Turn store validation errors into 400s instead of 500s.
const wrap = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    const status = err.code === 'EVALIDATION' ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
};

// ---- dashboard state -----------------------------------------------------
app.get('/api/dashboard', (req, res) => res.json(store.getState()));

app.post('/api/sections', wrap((req, res) => res.status(201).json(store.addSection(req.body))));
app.patch('/api/sections/:id', wrap((req, res) => res.json(store.updateSection(req.params.id, req.body))));
app.delete('/api/sections/:id', wrap((req, res) => res.json(store.removeSection(req.params.id))));

app.post('/api/sections/:id/move', wrap((req, res) => res.json(store.moveSection(req.params.id, req.body.position))));

app.post('/api/sections/:id/tiles', wrap((req, res) => res.status(201).json(store.addTile(req.params.id, req.body))));
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

// ---- sticky notes --------------------------------------------------------
app.post('/api/notes', wrap((req, res) => res.status(201).json(store.addNote(req.body))));
app.patch('/api/notes/:id', wrap((req, res) => res.json(store.updateNote(req.params.id, req.body))));
app.delete('/api/notes/:id', wrap((req, res) => res.json(store.removeNote(req.params.id))));

// ---- feature requests ----------------------------------------------------
app.post('/api/feature-requests', wrap((req, res) =>
  res.status(201).json(store.addFeatureRequest({ ...req.body, requestedBy: req.body.requestedBy || 'you' }))
));
app.patch('/api/feature-requests/:id', wrap((req, res) => res.json(store.updateFeatureRequest(req.params.id, req.body))));
app.delete('/api/feature-requests/:id', wrap((req, res) => res.json(store.removeFeatureRequest(req.params.id))));

// ---- health --------------------------------------------------------------
app.get('/api/health', (req, res) => res.json(health.getStatuses()));

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
  const limit = Math.min(Number(req.query.limit) || 40, 200);
  const where = [];
  const params = [];
  if (req.query.kind) { where.push('kind = ?'); params.push(req.query.kind); }
  if (req.query.model) { where.push('model = ?'); params.push(req.query.model); }
  let sql = 'SELECT id, ts, kind, model, task, user_msg, reply, trace, steps, ms, pass, error FROM chat_log';
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(limit);
  const rows = query(sql, params).map((r) => {
    let trace = [];
    try { trace = JSON.parse(r.trace || '[]'); } catch { /* ignore */ }
    return { ...r, trace };
  });
  res.json(rows);
}));

// ---- models & agent ------------------------------------------------------
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
    results: listResults(), // every tested model + outcome (pass or fail)
    supervised: listSupervised(), // failed-model + trusted-supervisor pairings
    delegated: listDelegated(), // trusted-orchestrator ▸ untrusted-sub-agent pairings
    parallel: listParallel(), // orchestrator ⇉ N concurrent sub-agents
  });
}));

// Derive contextual follow-up chips from what the agent just did. Prefers the
// model's own suggest_followups; otherwise maps the last action to next steps.
const MUTATING = new Set([
  'add_tile', 'add_section', 'add_note', 'update_tile', 'update_note', 'rename_section',
  'remove_tile', 'remove_section', 'remove_note', 'move_tile', 'move_section', 'resize_card',
]);
function followupsFromTrace(trace = []) {
  const sf = [...trace].reverse().find((t) => t.ok && t.name === 'suggest_followups');
  if (sf) return (sf.result?.suggestions || sf.args?.suggestions || []).slice(0, 4);
  const last = [...trace].reverse().find((t) => t.ok && MUTATING.has(t.name));
  switch (last?.name) {
    case 'add_tile': return ['Add another tile', 'Resize the section', 'Add a note'];
    case 'add_section': return ['Add a tile to it', 'Rename the section', 'Add another section'];
    case 'add_note': return ['Change its colour', 'Make it bigger', 'Add another note'];
    case 'resize_card': return ['Make it bigger', 'Make it smaller', 'Move it'];
    case 'remove_tile':
    case 'remove_section':
    case 'remove_note': return ['Undo that', 'Add something new'];
    case 'update_tile':
    case 'update_note':
    case 'rename_section': return ['Undo that', 'Edit another'];
    case 'move_tile':
    case 'move_section': return ['Move another', 'Undo that'];
    default: return ['Add a tile', 'Add a note'];
  }
}

// Chat with the agent. Refuses any model not on the validated allowlist.
// Every turn is logged in full to data/chatlog.db (see `npm run logs`).
app.post('/api/agent/chat', wrap(async (req, res) => {
  const { model, messages, session } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model is required' });
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] is required' });
  }
  if (!isApproved(model)) {
    return res.status(403).json({
      error: `"${model}" has not passed pre-validation. Run: npm run validate -- "${model}"`,
    });
  }
  const started = Date.now();
  const userMsg = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  try {
    const result = await runAgent({ model, store, messages, ollama });
    logTurn({ session, model, userMsg, messages, reply: result.reply, trace: result.trace, steps: result.steps, ms: Date.now() - started });
    res.json({
      reply: result.reply,
      trace: result.trace,
      steps: result.steps,
      followups: followupsFromTrace(result.trace),
      dashboard: store.getState(), // so the UI can refresh after agent edits
    });
  } catch (err) {
    logTurn({ session, model, userMsg, messages, ms: Date.now() - started, error: err.message });
    throw err;
  }
}));

app.use(express.static(config.publicDir));

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
