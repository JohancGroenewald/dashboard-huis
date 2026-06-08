#!/usr/bin/env node
// Fail if any source file exceeds the line limit. Keeps modules small enough to
// reason about; over-limit files should be refactored.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LIMIT = 500;
const files = execSync('git ls-files "*.js" "*.mjs" "*.css" "*.html"', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !f.startsWith('public/vendor/'));

const over = [];
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n').length;
  if (lines > LIMIT) over.push(`${f} (${lines} lines)`);
}

if (over.length) {
  console.error(`✗ ${over.length} file(s) over ${LIMIT} lines — refactor them:`);
  for (const o of over) console.error(`  ${o}`);
  process.exit(1);
}
console.log(`✓ all source files ≤ ${LIMIT} lines (${files.length} checked)`);
