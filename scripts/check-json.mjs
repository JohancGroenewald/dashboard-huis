#!/usr/bin/env node
// Parse every tracked JSON-ish file to catch syntax errors before commit.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execSync('git ls-files "*.json" "*.code-workspace"', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('node_modules/'));

let bad = 0;
for (const f of files) {
  try {
    JSON.parse(readFileSync(f, 'utf8'));
  } catch (err) {
    bad++;
    console.error(`✗ ${f}: ${err.message}`);
  }
}

if (bad) process.exit(1);
console.log(`✓ ${files.length} JSON file(s) valid`);
