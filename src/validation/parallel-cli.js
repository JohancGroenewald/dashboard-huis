#!/usr/bin/env node
// Test a trusted orchestrator running MULTIPLE untrusted sub-agents in parallel.
//
//   npm run parallel -- <sub-agent> <sub-agent> [...] [--orchestrator <model>]
//
// Needs OLLAMA_NUM_PARALLEL > 1 for real concurrency. If --orchestrator is
// omitted, the fastest currently-approved model is used.
import { Ollama } from '../ollama.js';
import { parallelModel } from './parallel.js';
import { recordParallel, listApproved, listResults } from './registry.js';

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

  let orchestrator;
  const oi = args.indexOf('--orchestrator');
  if (oi !== -1) orchestrator = args[oi + 1];
  orchestrator = orchestrator || fastestApproved();

  const ti = args.indexOf('--temps');
  const temps = ti !== -1 ? args[ti + 1].split(',').map(Number) : undefined;
  const ci = args.indexOf('--num-ctx');
  const numCtx = ci !== -1 ? Number(args[ci + 1]) : undefined;

  const flagVals = new Set(['--orchestrator', '--temps', '--num-ctx']);
  const subs = args.filter((a, i) => !a.startsWith('--') && !flagVals.has(args[i - 1]));
  if (!orchestrator) {
    console.error('No orchestrator available — approve a trusted model first, or pass --orchestrator <model>.');
    process.exit(1);
  }
  if (subs.length < 2) {
    console.error('Usage: npm run parallel -- <sub-agent> <sub-agent> [...] [--orchestrator <model>]');
    process.exit(1);
  }

  console.log(`${C.bold}Parallel sub-agent testing · orchestrator = ${orchestrator}${C.reset}`);
  console.log(`${C.gray}Sub-agents (concurrent): ${subs.join(', ')}${C.reset}`);
  console.log(`${C.gray}Useful = safe + capable AND faster per action than the orchestrator alone.${C.reset}\n`);

  const report = await parallelModel(subs, orchestrator, {
    ollama, temps, numCtx,
    onProgress: (r) => {
      const tag = r.pass ? ok('PASS') : bad('FAIL');
      const crit = r.critical ? `${C.yellow}[safety]${C.reset} ` : '';
      const reps = r.runs > 1 ? ` ${C.gray}${r.passes}/${r.runs}${C.reset}` : '';
      console.log(`    ${tag} ${crit}${r.id}${reps} ${C.gray}(${r.ms}ms)${C.reset}`);
    },
  });
  if (report.error) { console.log(`${bad('✗ ' + report.error)}`); process.exit(1); }

  const spd = report.orchestratorAloneMs
    ? `${(report.medianActionMs / 1000).toFixed(1)}s/action vs ${(report.orchestratorAloneMs / 1000).toFixed(1)}s solo (${report.speedup}x)`
    : `${(report.medianActionMs / 1000).toFixed(1)}s/action`;
  const verdict = report.useful ? ok('USEFUL (parallel sub-agents)') : bad('NOT worthwhile');
  console.log(`\n  ${C.bold}${verdict}${C.reset}  safe=${report.safetyPass} capable=${report.capabilityPass} · ${spd}`);
  console.log(`  ${C.gray}temps=[${(report.temperatures || []).join(', ')}] · num_ctx=${report.numCtx}${C.reset}\n`);
  recordParallel(report);
}

main().catch((err) => {
  console.error(`Parallel run failed: ${err.message}`);
  process.exit(1);
});
