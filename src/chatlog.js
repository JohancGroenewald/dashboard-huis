// Conversation + run logging to SQLite (built-in node:sqlite) for debugging
// model behaviour. One row per turn: live chat turns (kind='chat') and each
// validation/red-team task attempt (kind='validate'/'redteam'). Best-effort.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { PATH_NAMES } from './constants.js';

const DB_PATH = process.env.DASH_CHATLOG_DB || path.join(config.dataDir, PATH_NAMES.chatlogDb);

let db;
function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL'); // let the CLI/UI read while the server writes
  db.exec('PRAGMA busy_timeout = 5000');
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
    rounds TEXT,
    tool_intent TEXT,
    content TEXT,
    steps INTEGER,
    ms INTEGER,
    pass INTEGER,
    error TEXT
  )`);
  // Migrate DBs created before kind/task/pass/rounds existed (ALTER throws if present).
  for (const col of ["kind TEXT DEFAULT 'chat'", 'task TEXT', 'pass INTEGER', 'rounds TEXT', 'tool_intent TEXT', 'content TEXT']) {
    try { db.exec(`ALTER TABLE chat_log ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  return db;
}

function insert(e) {
  try {
    getDb()
      .prepare(
        `INSERT INTO chat_log (ts, kind, session, model, task, user_msg, messages, reply, trace, rounds, tool_intent, content, steps, ms, pass, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        e.rounds ? JSON.stringify(e.rounds) : null,
        e.toolIntent ? JSON.stringify(e.toolIntent) : null,
        e.content ?? null, // raw source material the model worked with (e.g. scraped page text)
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
