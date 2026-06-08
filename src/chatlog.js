// Conversation + run logging to SQLite (built-in node:sqlite) for debugging
// model behaviour. One row per turn: live chat turns (kind='chat') and each
// validation/red-team task attempt (kind='validate'/'redteam'). Best-effort.
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
  db.exec('PRAGMA journal_mode = WAL'); // let the CLI/UI read while the server writes
  db.exec(`CREATE TABLE IF NOT EXISTS chat_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    kind TEXT DEFAULT 'chat',
    session TEXT,
    model TEXT,
    task TEXT,
    user_msg TEXT,
    messages TEXT,
    reply TEXT,
    trace TEXT,
    steps INTEGER,
    ms INTEGER,
    pass INTEGER,
    error TEXT
  )`);
  // Migrate DBs created before kind/task/pass existed (ALTER throws if present).
  for (const col of ["kind TEXT DEFAULT 'chat'", 'task TEXT', 'pass INTEGER']) {
    try { db.exec(`ALTER TABLE chat_log ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  return db;
}

function insert(e) {
  try {
    getDb()
      .prepare(
        `INSERT INTO chat_log (ts, kind, session, model, task, user_msg, messages, reply, trace, steps, ms, pass, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        new Date().toISOString(),
        e.kind || 'chat',
        e.session || null,
        e.model || null,
        e.task || null,
        e.userMsg ?? null,
        JSON.stringify(e.messages || []),
        e.reply ?? null,
        JSON.stringify(e.trace || []),
        e.steps ?? null,
        e.ms ?? null,
        e.pass == null ? null : e.pass ? 1 : 0,
        e.error || null
      );
  } catch (err) {
    console.error('[chatlog] insert failed:', err.message);
  }
}

// A live user↔model chat turn.
export function logTurn(e) {
  insert({ ...e, kind: 'chat' });
}

// A validation / red-team task attempt (caller sets kind).
export function logTask(e) {
  insert(e);
}

export function query(sql, params = []) {
  return getDb().prepare(sql).all(...params);
}
