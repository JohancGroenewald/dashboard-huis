// Durable scraper result storage. Dashboard JSON keeps the scraper card
// metadata and latest result summary; the potentially large row set lives here
// in local SQLite so callers can page through it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { PATH_NAMES } from './constants.js';
import { normalizeScrapeResult } from './schema.js';

const DEFAULT_DB_PATH = path.join(config.dataDir, PATH_NAMES.scraperResultsDb);

function parseJson(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function hashRow(columns, row) {
  return crypto.createHash('sha256').update(JSON.stringify({ columns, row })).digest('hex');
}

function clampWindow(offset, limit, fallbackLimit = 50) {
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const n = Math.max(1, Math.trunc(Number(limit) || fallbackLimit));
  return { offset: start, limit: n };
}

export class ScraperResultStore {
  constructor({ dbPath = DEFAULT_DB_PATH } = {}) {
    this.dbPath = dbPath;
    this.db = null;
  }

  getDb() {
    if (this.db) return this.db;
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA busy_timeout = 5000');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(`CREATE TABLE IF NOT EXISTS scraper_runs (
      id TEXT PRIMARY KEY,
      scraper_id TEXT NOT NULL,
      at TEXT NOT NULL,
      model TEXT,
      columns_json TEXT NOT NULL,
      note TEXT DEFAULT '',
      cache_key TEXT DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0
    )`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS scraper_rows (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES scraper_runs(id) ON DELETE CASCADE,
      scraper_id TEXT NOT NULL,
      row_index INTEGER NOT NULL,
      row_hash TEXT NOT NULL,
      data_json TEXT NOT NULL,
      UNIQUE(run_id, row_index)
    )`);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_scraper_runs_scraper_cache ON scraper_runs(scraper_id, cache_key, at DESC)');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_scraper_rows_run_index ON scraper_rows(run_id, row_index)');
    return this.db;
  }

  saveRun({ scraperId, model = '', result, at = new Date().toISOString() }) {
    const clean = normalizeScrapeResult(result);
    if (!clean) throw new Error('cannot store an unreadable scraper result');
    const columns = clean.columns;
    const rows = clean.rows;
    const runId = crypto.randomUUID();
    const db = this.getDb();
    try {
      db.exec('BEGIN IMMEDIATE');
      db.prepare(`INSERT INTO scraper_runs (id, scraper_id, at, model, columns_json, note, cache_key, row_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(runId, scraperId, at, model || null, JSON.stringify(columns), clean.note || '', clean.cacheKey || '', rows.length);
      const insertRow = db.prepare(`INSERT INTO scraper_rows (id, run_id, scraper_id, row_index, row_hash, data_json)
        VALUES (?, ?, ?, ?, ?, ?)`);
      rows.forEach((row, i) => {
        insertRow.run(crypto.randomUUID(), runId, scraperId, i, hashRow(columns, row), JSON.stringify(row));
      });
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* no active tx */ }
      throw err;
    }
    return { runId, rowCount: rows.length };
  }

  runMeta(runId) {
    if (!runId) return null;
    const row = this.getDb()
      .prepare('SELECT id, scraper_id, at, model, columns_json, note, cache_key, row_count FROM scraper_runs WHERE id = ?')
      .get(runId);
    if (!row) return null;
    return {
      runId: row.id,
      scraperId: row.scraper_id,
      at: row.at,
      model: row.model || '',
      columns: parseJson(row.columns_json, []),
      note: row.note || '',
      cacheKey: row.cache_key || '',
      rowCount: row.row_count || 0,
    };
  }

  latestCached(scraperId, cacheKey) {
    if (!scraperId || !cacheKey) return null;
    const row = this.getDb()
      .prepare('SELECT id FROM scraper_runs WHERE scraper_id = ? AND cache_key = ? ORDER BY at DESC LIMIT 1')
      .get(scraperId, cacheKey);
    return row ? this.result(row.id) : null;
  }

  rows(runId, { offset = 0, limit = 50 } = {}) {
    const meta = this.runMeta(runId);
    if (!meta) return null;
    const win = clampWindow(offset, limit);
    const rows = this.getDb()
      .prepare('SELECT id, row_index, row_hash, data_json FROM scraper_rows WHERE run_id = ? ORDER BY row_index LIMIT ? OFFSET ?')
      .all(runId, win.limit, win.offset)
      .map((r) => ({
        id: r.id,
        index: r.row_index,
        hash: r.row_hash,
        cells: parseJson(r.data_json, []),
      }));
    return { ...meta, rows, offset: win.offset, returned: rows.length };
  }

  result(runId) {
    const meta = this.runMeta(runId);
    if (!meta) return null;
    const page = this.rows(runId, { offset: 0, limit: Math.max(1, meta.rowCount) });
    return { ...meta, rows: page?.rows.map((r) => r.cells) || [] };
  }
}

export function readScraperRows(sc, scraperResults, { offset = 0, limit = 50 } = {}) {
  const r = sc?.result;
  if (!r) return null;
  const win = clampWindow(offset, limit);
  if (scraperResults && r.runId) {
    const page = scraperResults.rows(r.runId, win);
    if (page) {
      return {
        name: sc.name,
        columns: page.columns,
        rows: page.rows.map((row) => row.cells),
        rowIds: page.rows.map((row) => row.id),
        total: page.rowCount,
        offset: page.offset,
        returned: page.returned,
        note: page.note,
        at: page.at,
        runId: page.runId,
      };
    }
  }
  const rows = Array.isArray(r.rows) ? r.rows : [];
  const total = Number.isFinite(Number(r.rowCount)) ? Number(r.rowCount) : rows.length;
  const pageRows = rows.slice(win.offset, win.offset + win.limit);
  return {
    name: sc.name,
    columns: r.columns || [],
    rows: pageRows,
    rowIds: [],
    total,
    offset: win.offset,
    returned: pageRows.length,
    note: r.note || '',
    at: r.at || '',
    runId: r.runId || '',
  };
}
