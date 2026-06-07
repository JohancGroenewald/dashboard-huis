#!/usr/bin/env node
// Test whether a FAILED model is still useful when a trusted model supervises it.
//
//   npm run supervise -- <worker> [<worker>...] [--supervisor <model>]
//
// If --supervisor is omitted, the fastest currently-approved model is used.
import { Ollama } from '../ollama.js';
import { superviseModel } from './supervised.js';
import { recordSupervised, listApproved, listResults } from './registry.js';

const C = { gray: '\x1b[90m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
const ok = (s) => `${C.green}${s}${C.reset}`;
const bad = (s) => `${C.red}${s}${C.reset}`;

function fastestApproved() {
  const approved = Object.keys(listApproved());
  const results = listResults();
  return approved
    .map((m) => ({ m, ms: results[m]?.msPerAction ?? Infinity }))
    .sort((a, b) => a.ms - b.ms)[0]?.m;
}

async function main() {
  const args = process.argv.slice(2);
  const ollama = new Ollama();

  let supervisor;
  const si = args.indexOf('--supervisor');
  if (si !== -1) supervisor = args[si + 1];
  supervisor = supervisor || fastestApproved();

  const workers = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--supervisor');
  if (!supervisor) {
    console.error('No supervisor available — approve a trusted model first, or pass --supervisor <model>.');
    process.exit(1);
  }
  if (!workers.length) {
    console.error('Usage: npm run supervise -- <worker> [<worker>...] [--supervisor <model>]');
    process.exit(1);
  }

  console.log(`${C.bold}Supervised testing · supervisor = ${supervisor}${C.reset}`);
  console.log(`${C.gray}Useful = supervision makes the worker safe, keeps capability, and beats the supervisor alone on speed.${C.reset}\n`);

  for (const worker of workers) {
    if (worker === supervisor) { console.log(`(skipping ${worker} — that's the supervisor)\n`); continue; }
    console.log(`${C.bold}▶ ${worker}  ${C.gray}supervised by ${supervisor}${C.reset}`);
    const report = await superviseModel(worker, supervisor, {
      ollama,
      onProgress: (r) => {
        const tag = r.pass ? ok('PASS') : bad('FAIL');
        const crit = r.critical ? `${C.yellow}[safety]${C.reset} ` : '';
        const reps = r.runs > 1 ? ` ${C.gray}${r.passes}/${r.runs}${C.reset}` : '';
        const blk = r.blocked ? ` ${C.gray}(${r.blocked} blocked)${C.reset}` : '';
        console.log(`    ${tag} ${crit}${r.id}${reps}${blk} ${C.gray}(${r.ms}ms)${C.reset}`);
      },
    });
    if (report.error) { console.log(`    ${bad('✗ ' + report.error)}\n`); continue; }

    const spd = report.supervisorAloneMs
      ? `${(report.medianActionMs / 1000).toFixed(1)}s/action vs ${(report.supervisorAloneMs / 1000).toFixed(1)}s solo (${report.speedup}x)`
      : `${(report.medianActionMs / 1000).toFixed(1)}s/action`;
    const verdict = report.useful ? ok('USEFUL under supervision') : bad('NOT worthwhile');
    console.log(`  ${C.bold}${verdict}${C.reset}  safe=${report.safetyPass} capable=${report.capabilityPass} · ${spd} · ${report.totalBlocked} actions blocked\n`);
    recordSupervised(report);
  }
}

main().catch((err) => {
  console.error(`Supervised run failed: ${err.message}`);
  process.exit(1);
});
