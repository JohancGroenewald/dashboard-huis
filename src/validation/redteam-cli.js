#!/usr/bin/env node
// Red-team refusal report.
//   npm run redteam -- <model> [<model>...]
//   npm run redteam -- --all
import { Ollama } from '../ollama.js';
import { redteamModel, redteamCases } from './redteam.js';

const C = { gray: '\x1b[90m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
const mark = (v) =>
  v === 'declined' ? `${C.green}DECLINED${C.reset}` :
  v === 'complied' ? `${C.red}COMPLIED${C.reset}` :
  v === 'error' ? `${C.red}ERROR${C.reset}` :
  `${C.yellow}UNCLEAR${C.reset}`;

async function main() {
  const args = process.argv.slice(2);
  const ollama = new Ollama();
  let models = args.filter((a) => !a.startsWith('--'));
  if (args.includes('--all')) models = await ollama.listModels();
  if (!models.length) {
    console.error('Usage: npm run redteam -- <model> [<model>...] | --all');
    process.exit(1);
  }

  console.log(`${C.bold}Red-team refusal test · ${redteamCases.length} harmful prompts · ${models.length} model(s)${C.reset}`);
  console.log(`${C.gray}Good outcome = DECLINED (model refuses the harmful request)${C.reset}\n`);

  const summary = [];
  for (const model of models) {
    console.log(`${C.bold}▶ ${model}${C.reset}`);
    const report = await redteamModel(model, {
      ollama,
      onProgress: (r) => {
        console.log(`    ${mark(r.verdict)} ${r.id} ${C.gray}(${r.harm}, ${r.ms}ms)${C.reset}`);
        if (r.toolCalls.length) console.log(`        ${C.gray}tools: ${r.toolCalls.join(', ')}${C.reset}`);
        console.log(`        ${C.gray}↳ "${r.reply}"${C.reset}`);
      },
    });
    if (report.error) console.log(`    ${C.red}✗ ${report.error}${C.reset}`);
    const allGood = report.declined === report.total;
    const color = allGood ? C.green : C.red;
    console.log(`  ${C.bold}${color}Refused ${report.declined}/${report.total}${C.reset}\n`);
    summary.push({ model, declined: report.declined, total: report.total });
  }

  if (summary.length > 1) {
    console.log(`${C.bold}Summary (harmful requests refused)${C.reset}`);
    for (const s of summary) {
      const color = s.declined === s.total ? C.green : C.red;
      console.log(`  ${color}${s.declined}/${s.total}${C.reset}  ${s.model}`);
    }
  }
}

main().catch((err) => {
  console.error(`Red-team run failed: ${err.message}`);
  process.exit(1);
});
