import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { makeToolHandlers } from '../src/agent/tools.js';
import { ScraperResultStore, hydrateScraperRows, readScraperRows } from '../src/scraper-results.js';
import { runScraper } from '../src/scrapers.js';
import { Store } from '../src/store.js';

const newStore = () => new Store({ persist: false }).load();
const fakeOllama = (reply) => ({ calls: [], async chat(req) { this.calls.push(req); return { role: 'assistant', content: reply }; } });

function tmpDb(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'huis-scraper-results-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'scraper-results.db');
}

function pageServer(html) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(typeof html === 'function' ? html(req) : html);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('ScraperResultStore saves runs with row ids and serves row pages', (t) => {
  const results = new ScraperResultStore({ dbPath: tmpDb(t) });
  const saved = results.saveRun({
    scraperId: 'scraper-1',
    model: 'm',
    at: '2026-06-13T12:00:00.000Z',
    result: { columns: ['Item', 'Price'], rows: [['A', '$1'], ['B', '$2']], note: 'ok', cacheKey: 'abc' },
  });

  assert.equal(saved.rowCount, 2);
  const page = results.rows(saved.runId, { offset: 1, limit: 1 });
  assert.equal(page.rowCount, 2);
  assert.equal(page.returned, 1);
  assert.match(page.rows[0].id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(page.rows[0].cells, ['B', '$2']);
  assert.match(page.rows[0].hash, /^[a-f0-9]{64}$/);
});

test('runScraper stores completed rows in SQLite and keeps a lightweight dashboard result', async (t) => {
  const server = await pageServer('<body><p>Alpha | $1</p></body>');
  t.after(() => server.close());
  const scraperResults = new ScraperResultStore({ dbPath: tmpDb(t) });
  const store = newStore();
  const sc = store.addScraper({
    name: 'SQLite scrape',
    url: `http://127.0.0.1:${server.address().port}/`,
    model: 'm',
    sourceMode: 'single',
    sourceProcess: 'collect',
  });
  const firstOllama = fakeOllama('{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}');

  const first = await runScraper({ store, ollama: firstOllama, scraperId: sc.id, model: 'm', scraperResults });

  assert.equal(first.error, '');
  assert.equal(first.scraper.result.rowCount, 1);
  assert.deepEqual(first.scraper.result.rows, []);
  assert.match(first.scraper.result.runId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(readScraperRows(first.scraper, scraperResults, { limit: 10 }).rows, [['Alpha', '$1']]);

  const secondOllama = { calls: [], async chat() { this.calls.push(true); throw new Error('cache miss'); } };
  const second = await runScraper({ store, ollama: secondOllama, scraperId: sc.id, model: 'm', scraperResults });

  assert.equal(second.error, '');
  assert.equal(secondOllama.calls.length, 0);
  assert.equal(second.scraper.result.rowCount, 1);
  assert.deepEqual(readScraperRows(second.scraper, scraperResults, { limit: 10 }).rows, [['Alpha', '$1']]);
});

test('read_scraper tool pages SQLite-backed rows', (t) => {
  const scraperResults = new ScraperResultStore({ dbPath: tmpDb(t) });
  const store = newStore();
  const sc = store.addScraper({ name: 'Shop', url: 'http://x' });
  const rows = Array.from({ length: 12 }, (_, i) => [`Item${i}`, `$${i}`]);
  const saved = scraperResults.saveRun({
    scraperId: sc.id,
    model: 'm',
    result: { columns: ['Item', 'Price'], rows, note: 'ok', cacheKey: 'cache' },
  });
  store.updateScraper(sc.id, {
    result: { columns: ['Item', 'Price'], rows: [], rowCount: saved.rowCount, note: 'ok', runId: saved.runId },
  });

  const handlers = makeToolHandlers(store, { scraperResults });
  const page = handlers.read_scraper({ scraper_id: sc.id, offset: 10, limit: 5 });

  assert.equal(page.total, 12);
  assert.equal(page.returned, 2);
  assert.deepEqual(page.rows[1], ['Item11', '$11']);
});

test('hydrateScraperRows puts a bounded SQLite row preview in dashboard payloads', (t) => {
  const scraperResults = new ScraperResultStore({ dbPath: tmpDb(t) });
  const saved = scraperResults.saveRun({
    scraperId: 'scraper-1',
    model: 'm',
    result: { columns: ['Item'], rows: [['A'], ['B']], note: 'ok' },
  });
  const dashboard = {
    title: 'T',
    scrapers: [{
      id: 'scraper-1',
      name: 'S',
      result: { columns: ['Item'], rows: [], rowCount: 2, note: 'ok', runId: saved.runId },
    }],
  };

  const hydrated = hydrateScraperRows(dashboard, scraperResults, { limit: 1 });

  assert.deepEqual(dashboard.scrapers[0].result.rows, []);
  assert.deepEqual(hydrated.scrapers[0].result.rows, [['A']]);
  assert.equal(hydrated.scrapers[0].result.rowCount, 2);
});
