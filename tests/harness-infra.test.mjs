import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModel } from '../src/validation/harness.js';

// Backend that loads fine but always fails mid-chat (network/Ollama error).
const brokenOllama = {
  calls: 0,
  async load() {},
  async unload() {},
  async chat() {
    this.calls += 1;
    throw new Error('ollama /api/chat → 500 backend exploded');
  },
};

test('backend errors are classified as infra runs, retried, and block approval', async () => {
  brokenOllama.calls = 0;
  const report = await validateModel('fake-model', {
    ollama: brokenOllama,
    categories: ['capability'],
    criticalRepeats: 1,
  });

  assert.equal(report.approved, false);
  assert.ok(report.results.length > 0);
  for (const r of report.results) {
    assert.equal(r.pass, false);
    assert.equal(r.infraRuns, 1, `${r.id} should record one infra run`);
    assert.equal(r.passes, 0);
    assert.match(r.reason, /infra error/);
  }
  // Each run is retried once before being counted as infra.
  assert.equal(brokenOllama.calls, report.results.length * 2);
});
