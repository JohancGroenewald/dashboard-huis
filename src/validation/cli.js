#!/usr/bin/env node
// CLI for the model pre-validation gate.
//
//   npm run validate -- <model> [<model>...]   validate specific models
//   npm run validate -- --all                  validate every installed model
//   npm run validate -- --list                 show currently approved models
//   npm run validate -- --reset <model>...     wipe a model's safety history
//   npm run validate -- --threshold 0.9 <model>
//
// Safety is judged CUMULATIVELY across runs: any recorded critical-safety
// failure blocks approval until the model's history is reset and re-earned.
import { Ollama } from '../ollama.js';
import { validateModel } from './harness.js';
import { approve, revoke, recordResult, resetHistory, retire, unretire, listRetired, isRetired, listApproved } from './registry.js';

const C = { gray: '\x1b[90m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;

async function main() {
  const args = process.argv.slice(2);
  const ollama = new Ollama();

  if (args.includes('--reset')) {
    const toReset = args.filter((a) => !a.startsWith('--'));
    for (const m of toReset) {
      resetHistory(m);
      console.log(`reset safety history for ${m}`);
    }
    return;
  }

  if (args.includes('--retire')) {
    for (const m of args.filter((a) => !a.startsWith('--'))) { retire(m); console.log(`retired ${m} (removed from allowlist/report; --all will skip it)`); }
    return;
  }
  if (args.includes('--unretire')) {
    for (const m of args.filter((a) => !a.startsWith('--'))) { unretire(m); console.log(`un-retired ${m}`); }
    return;
  }

  if (args.includes('--list')) {
    const approved = listApproved();
    const names = Object.keys(approved);
    if (names.length) {
      console.log(`${C.bold}Approved models:${C.reset}`);
      for (const n of names) {
        const m = approved[n];
        console.log(`  ${ok('✓')} ${n}  ${C.gray}score ${m.score} (${m.passed}/${m.total}) · ${m.approvedAt}${C.reset}`);
      }
    } else {
      console.log('No approved models yet.');
    }
    const retired = listRetired();
    if (retired.length) console.log(`${C.gray}Retired (skipped by --all): ${retired.join(', ')}${C.reset}`);
    return;
  }

  let threshold = 0.8;
  const ti = args.indexOf('--threshold');
  if (ti !== -1) threshold = Number(args[ti + 1]);

  // A category filter (e.g. --category robustness) makes the run DIAGNOSTIC:
  // results are printed but the allowlist + cumulative record are left untouched.
  const ci = args.indexOf('--category');
  const categories = ci !== -1 ? args[ci + 1].split(',') : null;

  const flagValueIdx = new Set();
  for (const f of ['--threshold', '--category']) {
    const i = args.indexOf(f);
    if (i !== -1) flagValueIdx.add(i + 1);
  }
  let models = args.filter((a, i) => !a.startsWith('--') && !flagValueIdx.has(i));
  if (args.includes('--all')) models = (await ollama.listModels()).filter((m) => !isRetired(m));
  if (!models.length) {
    console.error('Usage: npm run validate -- <model> | --all | --list | --reset <m> | [--category robustness]');
    process.exit(1);
  }

  console.log(`${C.bold}${categories ? `Diagnostic [${categories.join(',')}] run` : 'Pre-validating'} ${models.length} model(s)${categories ? '' : `, threshold ${threshold}`}${C.reset}\n`);
  const summary = [];

  for (const model of models) {
    console.log(`${C.bold}▶ ${model}${C.reset}`);
    const report = await validateModel(model, {
      ollama,
      threshold,
      categories,
      onProgress: (r) => {
        const tag = r.pass ? ok('PASS') : bad('FAIL');
        const crit = r.critical ? `${C.yellow}[safety]${C.reset} ` : '';
        const reps = r.runs > 1 ? ` ${C.gray}${r.passes}/${r.runs}${C.reset}` : '';
        const reason = r.pass ? '' : ` ${C.gray}— ${r.reason}${C.reset}`;
        console.log(`    ${tag} ${crit}${r.id}${reps} ${C.gray}(${r.ms}ms)${C.reset}${reason}`);
      },
    });
    if (report.error) console.log(`    ${bad('✗')} ${report.error}`);

    if (categories) {
      // Diagnostic only — never touch the allowlist on a partial run.
      console.log(`  ${C.bold}${report.passed}/${report.total} passed${C.reset} ${C.gray}(diagnostic — allowlist unchanged)${C.reset}\n`);
      summary.push({ model, approved: report.passed === report.total, score: report.score });
      continue;
    }

    // Accumulate evidence + compute the cumulative verdict (authoritative).
    const rec = recordResult(model, report);
    const verdict = rec.approved ? ok('APPROVED — added to allowlist') : bad('REJECTED');
    console.log(`  ${C.bold}${verdict}${C.reset}  score ${report.score} (${report.passed}/${report.total})`);
    if (rec.blockedBy.length) {
      const detail = rec.blockedBy.map((t) => `${t} ${rec.safety[t]}`).join(', ');
      console.log(`  ${bad('✗ safety failures on record (cumulative):')} ${C.gray}${detail}${C.reset}`);
    }
    console.log();

    if (rec.approved) approve(model, report);
    else revoke(model);
    summary.push({ model, approved: rec.approved, score: report.score });
  }

  if (summary.length > 1) {
    console.log(`${C.bold}Summary${C.reset}`);
    for (const s of summary) {
      console.log(`  ${s.approved ? ok('✓') : bad('✗')} ${s.model} ${C.gray}(${s.score})${C.reset}`);
    }
  }
}

main().catch((err) => {
  console.error(`Validation failed: ${err.message}`);
  process.exit(1);
});
