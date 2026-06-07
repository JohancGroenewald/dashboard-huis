// Dashboard HTTP server: serves the UI, a REST API for dashboard state and
// health, and the agent endpoint (gated by the model allowlist).
import express from 'express';
import fs from 'node:fs';
import { config, paths } from './config.js';
import { Store } from './store.js';
import { HealthMonitor } from './health.js';
import { Ollama } from './ollama.js';
import { runAgent } from './agent/agent.js';
import { listApproved, isApproved, listResults } from './validation/registry.js';

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
  });
}));

// Chat with the agent. Refuses any model not on the validated allowlist.
app.post('/api/agent/chat', wrap(async (req, res) => {
  const { model, messages } = req.body || {};
  if (!model) return res.status(400).json({ error: 'model is required' });
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: 'messages[] is required' });
  }
  if (!isApproved(model)) {
    return res.status(403).json({
      error: `"${model}" has not passed pre-validation. Run: npm run validate -- "${model}"`,
    });
  }
  const result = await runAgent({ model, store, messages, ollama });
  res.json({
    reply: result.reply,
    trace: result.trace,
    steps: result.steps,
    dashboard: store.getState(), // so the UI can refresh after agent edits
  });
}));

app.use(express.static(config.publicDir));

app.listen(config.port, config.host, () => {
  console.log(`Huis dashboard → http://${config.host}:${config.port}`);
  console.log(`Ollama backend → ${config.ollamaHost}`);
  const approved = Object.keys(listApproved());
  console.log(approved.length
    ? `Approved agent models: ${approved.join(', ')}`
    : 'No approved agent models yet — run: npm run validate -- --all');
});
