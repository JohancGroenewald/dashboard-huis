#!/usr/bin/env node
// Query the conversation log (data/chatlog.db).
//
//   npm run logs                     last 20 turns
//   npm run logs -- --recent 50      last N turns
//   npm run logs -- --model NAME     filter by model
//   npm run logs -- --session ID     one conversation
//   npm run logs -- --errors         only failed turns
//   npm run logs -- --full           include full reply + tool args/results
//   npm run logs -- --sql "SELECT ... FROM chat_log ..."   raw query (JSON out)
import { query } from './chatlog.js';

const C = { gray: '\x1b[90m', cyan: '\x1b[36m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', bold: '\x1b[1m', reset: '\x1b[0m' };
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : d);
const trunc = (s, n) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

if (flag('--sql')) {
  console.log(JSON.stringify(query(opt('--sql')), null, 2));
  process.exit(0);
}

const full = flag('--full');
const where = [];
const params = [];
if (opt('--model')) { where.push('model = ?'); params.push(opt('--model')); }
if (opt('--session')) { where.push('session = ?'); params.push(opt('--session')); }
if (flag('--errors')) where.push('error IS NOT NULL');

let sql = 'SELECT * FROM chat_log';
if (where.length) sql += ' WHERE ' + where.join(' AND ');
sql += ' ORDER BY id DESC LIMIT ?';
params.push(Number(opt('--recent', '20')));

const rows = query(sql, params).reverse(); // chronological
if (!rows.length) { console.log('No matching turns.'); process.exit(0); }

for (const r of rows) {
  const head = `${C.bold}#${r.id}${C.reset} ${C.gray}${r.ts}${C.reset} ${C.cyan}${r.model}${C.reset}` +
    ` ${C.gray}· ${(r.ms / 1000).toFixed(1)}s · ${r.steps ?? '?'} step(s)${r.session ? ` · ${r.session.slice(0, 8)}` : ''}${C.reset}`;
  console.log(head);
  if (r.error) console.log(`  ${C.red}✗ error: ${r.error}${C.reset}`);
  console.log(`  ${C.yellow}▸ user:${C.reset} ${full ? r.user_msg : trunc(r.user_msg, 160)}`);
  if (r.reply) console.log(`  ${C.green}◂ asst:${C.reset} ${full ? r.reply : trunc(r.reply, 200)}`);
  let trace = [];
  try { trace = JSON.parse(r.trace || '[]'); } catch { /* ignore */ }
  for (const t of trace) {
    const mark = t.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const detail = full
      ? `(${JSON.stringify(t.args)}) → ${JSON.stringify(t.ok ? t.result : t.error)}`
      : trunc(JSON.stringify(t.args), 80);
    console.log(`    ${mark} ${C.bold}${t.name}${C.reset} ${C.gray}${detail}${C.reset}`);
  }
  console.log();
}
console.log(`${C.gray}${rows.length} turn(s). Tip: --full, --model, --session, --errors, --sql.${C.reset}`);
