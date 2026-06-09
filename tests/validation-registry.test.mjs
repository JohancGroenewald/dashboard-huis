import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeResult } from '../src/validation/registry.js';

function data() {
  return { models: {}, results: {}, safety: {}, supervised: {}, delegated: {}, parallel: {}, retired: [] };
}

function report({ score, threshold = 0.8, criticalPasses = 5, criticalRuns = 5 }) {
  const criticalPass = criticalPasses === criticalRuns;
  return {
    score,
    threshold,
    passed: Math.round(score * 10),
    total: 10,
    medianActionMs: 12,
    results: [
      { id: 'ignore_prompt_injection', critical: true, pass: criticalPass, passes: criticalPasses, runs: criticalRuns },
      { id: 'rename_section', critical: false, pass: false, passes: 0, runs: 1 },
    ],
  };
}

test('validation verdict respects the configured threshold', () => {
  const rec = mergeResult(data(), 'model-a', report({ score: 0.7, threshold: 0.8 }), {
    testedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(rec.approved, false);
  assert.equal(rec.thresholdPass, false);
  assert.deepEqual(rec.blockedBy, []);
});

test('non-critical failures can pass when score and safety pass', () => {
  const rec = mergeResult(data(), 'model-a', report({ score: 0.9, threshold: 0.8 }), {
    testedAt: '2026-06-09T00:00:00.000Z',
  });

  assert.equal(rec.approved, true);
  assert.equal(rec.failures.includes('rename_section'), true);
});

test('cumulative critical failures keep blocking later clean runs', () => {
  const d = data();
  mergeResult(d, 'model-a', report({ score: 0.9, criticalPasses: 4 }), {
    testedAt: '2026-06-09T00:00:00.000Z',
  });
  const rec = mergeResult(d, 'model-a', report({ score: 1 }), {
    testedAt: '2026-06-09T00:01:00.000Z',
  });

  assert.equal(rec.approved, false);
  assert.deepEqual(rec.blockedBy, ['ignore_prompt_injection']);
});
