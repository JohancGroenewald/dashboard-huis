// The allowlist of models that passed pre-validation and may drive the live
// dashboard. Backed by data/approved-models.json. The agent endpoint refuses
// any model not listed here.
import fs from 'node:fs';
import { config, paths } from '../config.js';

function emptyData() {
  return { models: {}, results: {}, safety: {}, supervised: {}, delegated: {}, parallel: {}, retired: [] };
}

function normalizeData(data = {}) {
  return {
    models: data.models || {},
    results: data.results || {},
    safety: data.safety || {},
    supervised: data.supervised || {},
    delegated: data.delegated || {},
    parallel: data.parallel || {},
    retired: data.retired || [],
  };
}

function read() {
  try {
    return normalizeData(JSON.parse(fs.readFileSync(paths.approvedModels, 'utf8')));
  } catch {
    return emptyData();
  }
}

function write(data) {
  const tmp = `${paths.approvedModels}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, paths.approvedModels);
}

export function listApproved() {
  return read().models;
}

export function isApproved(model) {
  return Boolean(read().models[model]);
}

export function approve(model, report) {
  const data = read();
  data.models[model] = {
    approvedAt: new Date().toISOString(),
    score: report.score,
    passed: report.passed,
    total: report.total,
    threshold: report.threshold ?? null,
    msPerAction: report.medianActionMs ?? null,
  };
  write(data);
}

export function revoke(model) {
  const data = read();
  delete data.models[model];
  write(data);
}

// Record a validation run and recompute the CUMULATIVE verdict.
//
// Safety is judged across ALL runs ever (since the last reset), not per-run:
// any single critical-safety failure in a model's history blocks approval, so a
// lucky 5/5 can't approve a model that has failed before. Trust is earned by
// accumulating clean runs (re-validate periodically). A run is approved only
// when its score clears the configured threshold and cumulative safety is clean.
export function mergeResult(data, model, report, { testedAt = new Date().toISOString() } = {}) {
  Object.assign(data, normalizeData(data));
  const hist = data.safety[model] || (data.safety[model] = {});

  // Accumulate per critical task: total runs and total failures. Infra runs
  // (backend errors, not model behavior) never enter the ledger — they block
  // the current validation but must not leave a false safety failure on the
  // model's permanent record.
  for (const r of report.results || []) {
    if (!r.critical) continue;
    const behavioralRuns = (r.runs || 0) - (r.infraRuns || 0);
    if (behavioralRuns <= 0) continue;
    const h = hist[r.id] || (hist[r.id] = { runs: 0, fails: 0 });
    h.runs += behavioralRuns;
    h.fails += behavioralRuns - r.passes;
  }

  // Cumulative safety: clean only if every critical task has zero failures.
  const safety = {};
  const blockedBy = [];
  for (const [tid, h] of Object.entries(hist)) {
    safety[tid] = `${h.runs - h.fails}/${h.runs}`;
    if (h.fails > 0) blockedBy.push(tid);
  }
  const safetyClean = Object.keys(hist).length > 0 && blockedBy.length === 0;
  const threshold = Number.isFinite(Number(report.threshold)) ? Number(report.threshold) : config.validationThreshold;
  const score = Number.isFinite(Number(report.score)) ? Number(report.score) : 0;
  const thresholdPass = score >= threshold;
  const approved = safetyClean && thresholdPass && !report.error;

  data.results[model] = {
    testedAt,
    approved,
    score,
    passed: report.passed,
    total: report.total,
    threshold,
    thresholdPass,
    msPerAction: report.medianActionMs ?? null,
    failures: (report.results || []).filter((r) => !r.pass).map((r) => r.id),
    safety, // cumulative passes/runs per critical task
    blockedBy, // critical tasks with a recorded failure in history
    error: report.error || null,
  };
  return data.results[model];
}

export function recordResult(model, report) {
  const data = read();
  const result = mergeResult(data, model, report);
  write(data);
  return result;
}

export function listResults() {
  return read().results;
}

// Record a supervised-pairing result (worker driven, trusted model vetting).
export function recordSupervised(report) {
  const data = read();
  data.supervised[`${report.worker} @ ${report.supervisor}`] = {
    worker: report.worker,
    supervisor: report.supervisor,
    testedAt: new Date().toISOString(),
    safetyPass: report.safetyPass,
    capabilityPass: report.capabilityPass,
    msPerAction: report.medianActionMs,
    supervisorAloneMs: report.supervisorAloneMs,
    speedup: report.speedup,
    useful: report.useful,
    totalBlocked: report.totalBlocked,
    error: report.error || null,
  };
  write(data);
}

export function listSupervised() {
  return read().supervised;
}

// Record a delegation pairing (trusted orchestrator ▸ untrusted sub-agent).
export function recordDelegated(report) {
  const data = read();
  data.delegated[`${report.orchestrator} ▸ ${report.subAgent}`] = {
    orchestrator: report.orchestrator,
    subAgent: report.subAgent,
    testedAt: new Date().toISOString(),
    safetyPass: report.safetyPass,
    capabilityPass: report.capabilityPass,
    msPerAction: report.medianActionMs,
    orchestratorAloneMs: report.orchestratorAloneMs,
    speedup: report.speedup,
    useful: report.useful,
    error: report.error || null,
  };
  write(data);
}

export function listDelegated() {
  return read().delegated;
}

// Record a parallel-delegation pairing (orchestrator ⇉ N concurrent sub-agents).
export function recordParallel(report) {
  const data = read();
  data.parallel[`${report.orchestrator} ⇉ ${report.subAgents.join(' + ')}`] = {
    orchestrator: report.orchestrator,
    subAgents: report.subAgents,
    temperatures: report.temperatures,
    numCtx: report.numCtx,
    testedAt: new Date().toISOString(),
    safetyPass: report.safetyPass,
    capabilityPass: report.capabilityPass,
    msPerAction: report.medianActionMs,
    orchestratorAloneMs: report.orchestratorAloneMs,
    speedup: report.speedup,
    useful: report.useful,
    error: report.error || null,
  };
  write(data);
}

export function listParallel() {
  return read().parallel;
}

// Wipe a model's accumulated safety history + result so it can re-baseline.
export function resetHistory(model) {
  const data = read();
  delete data.safety[model];
  delete data.results[model];
  delete data.models[model];
  write(data);
}

// Retire a model: drop it from the allowlist + report + history, and remember
// it so `validate --all` skips it. Reversible with unretire().
export function retire(model) {
  const data = read();
  if (!data.retired.includes(model)) data.retired.push(model);
  delete data.models[model];
  delete data.results[model];
  delete data.safety[model];
  write(data);
}

export function unretire(model) {
  const data = read();
  data.retired = data.retired.filter((m) => m !== model);
  write(data);
}

export function listRetired() {
  return read().retired;
}

export function isRetired(model) {
  return read().retired.includes(model);
}
