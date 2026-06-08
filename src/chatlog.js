// Full conversation logging to SQLite (built-in node:sqlite) for debugging model
// behaviour. Each agent turn — the messages sent, the reply, and every tool call
// with args + result — is stored as one row. Best-effort: never breaks a chat.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const DB_PATH = process.env.DASH_CHATLOG_DB || path.join(config.dataDir, 'chatlog.db');

let db;
function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL'); // allow the CLI to read while the server writes
  db.exec(`CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    session TEXT,
    model TEXT,
    user_msg TEXT,
    messages TEXT,
    reply TEXT,
    trace TEXT,
    steps INTEGER,
    ms INTEGER,
    error TEXT
  )`);
  return db;
}

// entry: { session, model, userMsg, messages, reply, trace, steps, ms, error }
export function logTurn(entry) {
  try {
    getDb()
      .prepare(
        `INSERT INTO chat_log (ts, session, model, user_msg, messages, reply, trace, steps, ms, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        entry.session || null,
        entry.model || null,
        entry.userMsg || null,
        JSON.stringify(entry.messages || []),
        entry.reply ?? null,
        JSON.stringify(entry.trace || []),
        entry.steps ?? null,
        entry.ms ?? null,
        entry.error || null
      );
  } catch (err) {
    console.error('[chatlog] failed to log turn:', err.message);
  }
}

export function query(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}
