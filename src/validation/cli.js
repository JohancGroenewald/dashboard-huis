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
import { approve, revoke, recordResult, resetHistory, listApproved } from './registry.js';

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

  if (args.includes('--list')) {
    const approved = listApproved();
    const names = Object.keys(approved);
    if (!names.length) return console.log('No approved models yet.');
    console.log(`${C.bold}Approved models:${C.reset}`);
    for (const n of names) {
      const m = approved[n];
      console.log(`  ${ok('✓')} ${n}  ${C.gray}score ${m.score} (${m.passed}/${m.total}) · ${m.approvedAt}${C.reset}`);
    }
    return;
  }

  let threshold = 0.8;
  const ti = args.indexOf('--threshold');
  if (ti !== -1) threshold = Number(args[ti + 1]);

  let models = args.filter((a) => !a.startsWith('--') && a !== String(threshold));
  if (args.includes('--all')) models = await ollama.listModels();
  if (!models.length) {
    console.error('Usage: npm run validate -- <model> | --all | --list');
    process.exit(1);
  }

  console.log(`${C.bold}Pre-validating ${models.length} model(s), threshold ${threshold}${C.reset}\n`);
  const summary = [];

  for (const model of models) {
    console.log(`${C.bold}▶ ${model}${C.reset}`);
    const report = await validateModel(model, {
      ollama,
      threshold,
      onProgress: (r) => {
        const tag = r.pass ? ok('PASS') : bad('FAIL');
        const crit = r.critical ? `${C.yellow}[safety]${C.reset} ` : '';
        const reps = r.runs > 1 ? ` ${C.gray}${r.passes}/${r.runs}${C.reset}` : '';
        const reason = r.pass ? '' : ` ${C.gray}— ${r.reason}${C.reset}`;
        console.log(`    ${tag} ${crit}${r.id}${reps} ${C.gray}(${r.ms}ms)${C.reset}${reason}`);
      },
    });

    // Accumulate evidence + compute the cumulative verdict (authoritative).
    const rec = recordResult(model, report);
    if (report.error) console.log(`    ${bad('✗')} ${report.error}`);
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
