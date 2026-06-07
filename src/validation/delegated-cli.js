#!/usr/bin/env node
// Test a trusted orchestrator delegating to an (untrusted) sub-agent.
//
//   npm run delegate -- <sub-agent> [<sub-agent>...] [--orchestrator <model>]
//
// If --orchestrator is omitted, the fastest currently-approved model is used.
import { Ollama } from '../ollama.js';
import { delegateModel } from './delegated.js';
import { recordDelegated, listApproved, listResults } from './registry.js';

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

  const subs = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--orchestrator');
  if (!orchestrator) {
    console.error('No orchestrator available — approve a trusted model first, or pass --orchestrator <model>.');
    process.exit(1);
  }
  if (!subs.length) {
    console.error('Usage: npm run delegate -- <sub-agent> [...] [--orchestrator <model>]');
    process.exit(1);
  }

  console.log(`${C.bold}Delegation testing · orchestrator = ${orchestrator}${C.reset}`);
  console.log(`${C.gray}Useful = orchestrator review keeps it safe + capable AND the pair beats the orchestrator alone on speed.${C.reset}\n`);

  for (const sub of subs) {
    const self = sub === orchestrator ? `${C.gray} (self-delegation)${C.reset}` : '';
    console.log(`${C.bold}▶ ${orchestrator} ▸ ${sub}${C.reset}${self}`);
    const report = await delegateModel(sub, orchestrator, {
      ollama,
      onProgress: (r) => {
        const tag = r.pass ? ok('PASS') : bad('FAIL');
        const crit = r.critical ? `${C.yellow}[safety]${C.reset} ` : '';
        const reps = r.runs > 1 ? ` ${C.gray}${r.passes}/${r.runs}${C.reset}` : '';
        const app = ` ${C.gray}(${r.applied}/${r.runs} applied)${C.reset}`;
        console.log(`    ${tag} ${crit}${r.id}${reps}${app} ${C.gray}(${r.ms}ms)${C.reset}`);
      },
    });
    if (report.error) { console.log(`    ${bad('✗ ' + report.error)}\n`); continue; }

    const spd = report.orchestratorAloneMs
      ? `${(report.medianActionMs / 1000).toFixed(1)}s/action vs ${(report.orchestratorAloneMs / 1000).toFixed(1)}s solo (${report.speedup}x)`
      : `${(report.medianActionMs / 1000).toFixed(1)}s/action`;
    const verdict = report.useful ? ok('USEFUL as sub-agent') : bad('NOT worthwhile');
    console.log(`  ${C.bold}${verdict}${C.reset}  safe=${report.safetyPass} capable=${report.capabilityPass} · ${spd}\n`);
    recordDelegated(report);
  }
}

main().catch((err) => {
  console.error(`Delegation run failed: ${err.message}`);
  process.exit(1);
});
