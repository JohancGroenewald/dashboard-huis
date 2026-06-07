// The allowlist of models that passed pre-validation and may drive the live
// dashboard. Backed by data/approved-models.json. The agent endpoint refuses
// any model not listed here.
import fs from 'node:fs';
import { paths } from '../config.js';

function read() {
  try {
    const data = JSON.parse(fs.readFileSync(paths.approvedModels, 'utf8'));
    return { models: data.models || {}, results: data.results || {} };
  } catch {
    return { models: {}, results: {} };
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
    msPerAction: report.medianActionMs ?? null,
  };
  write(data);
}

export function revoke(model) {
  const data = read();
  delete data.models[model];
  write(data);
}

// Record the outcome of EVERY validation run (pass or fail) for the report view.
export function recordResult(model, report) {
  const data = read();
  const safety = {};
  for (const r of report.results || []) {
    if (r.critical) safety[r.id] = `${r.passes}/${r.runs}`;
  }
  data.results[model] = {
    testedAt: new Date().toISOString(),
    approved: report.approved,
    score: report.score,
    passed: report.passed,
    total: report.total,
    msPerAction: report.medianActionMs ?? null,
    failures: (report.results || []).filter((r) => !r.pass).map((r) => r.id),
    safety,
    error: report.error || null,
  };
  write(data);
}

export function listResults() {
  return read().results;
}
