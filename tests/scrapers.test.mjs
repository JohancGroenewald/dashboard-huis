import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Store } from '../src/store.js';
import { htmlToText, parseTable, runScraper } from '../src/scrapers.js';
import { normalizeScraper } from '../src/schema.js';

const newStore = () => new Store({ persist: false }).load();
const fakeOllama = (reply) => ({ calls: [], async chat(req) { this.calls.push(req); return { role: 'assistant', content: reply }; } });

function pageServer(html) {
  const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('htmlToText strips scripts, styles, and tags to readable text', () => {
  const text = htmlToText('<html><head><style>.x{color:red}</style><script>evil()</script></head><body><h1>Widgets</h1><p>Hello &amp; welcome</p></body></html>');
  assert.doesNotMatch(text, /evil|color:red|</);
  assert.match(text, /Widgets/);
  assert.match(text, /Hello & welcome/);
  // Table cells stay delimited so values don't run together.
  assert.match(htmlToText('<table><tr><td>Hammer</td><td>R120</td></tr></table>'), /Hammer \| R120/);
});

test('parseTable reads strict JSON and JSON embedded in prose', () => {
  assert.deepEqual(parseTable('{"columns":["A"],"rows":[["1"]],"note":""}'), { columns: ['A'], rows: [['1']], note: '' });
  const loose = parseTable('Here you go: {"columns":["A","B"],"rows":[["1","2"]]} done');
  assert.deepEqual(loose.columns, ['A', 'B']);
  assert.equal(parseTable('not json at all'), null);
});

test('normalizeScraper bounds the result table', () => {
  const sc = normalizeScraper({
    name: 'Prices',
    result: { columns: ['Name', 'Price'], rows: [['Widget', '$10', 'extra'], ['Gadget'], 'junk'], note: 'x'.repeat(9999) },
  });
  assert.deepEqual(sc.result.columns, ['Name', 'Price']);
  assert.deepEqual(sc.result.rows[0], ['Widget', '$10']); // over-wide row trimmed to column count
  assert.deepEqual(sc.result.rows[1], ['Gadget', '']); // short row padded
  assert.equal(sc.result.rows.length, 2); // non-array "junk" dropped
  assert.ok(sc.result.note.length <= 500);
});

test('runScraper fetches the page, extracts a table, and stores it', async () => {
  const server = await pageServer('<body><h1>Shop</h1><ul><li>Widget — $10</li><li>Gadget — $20</li></ul></body>');
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Shop', url: `http://127.0.0.1:${server.address().port}/`, instruction: 'product and price', model: 'm' });
    const ollama = fakeOllama('{"columns":["Product","Price"],"rows":[["Widget","$10"],["Gadget","$20"]],"note":""}');
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.deepEqual(scraper.result.columns, ['Product', 'Price']);
    assert.equal(scraper.result.rows.length, 2);
    assert.ok(scraper.lastRunAt);
    // The fetched page text reached the model's system prompt.
    assert.match(ollama.calls[0].messages[0].content, /Widget/);
  } finally {
    server.close();
  }
});

test('runScraper records an error when the model returns no table', async () => {
  const server = await pageServer('<body>nothing useful</body>');
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'X', url: `http://127.0.0.1:${server.address().port}/`, model: 'm' });
    const { scraper, error } = await runScraper({ store, ollama: fakeOllama('sorry I cannot'), scraperId: sc.id, model: 'm' });
    assert.match(error, /readable table/);
    assert.equal(scraper.result, null);
    assert.match(scraper.error, /readable table/);
  } finally {
    server.close();
  }
});

test('runScraper widens context only when the model is not already loaded', async () => {
  const server = await pageServer('<body><p>data</p></body>');
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'X', url: `http://127.0.0.1:${server.address().port}/`, model: 'm' });
    const reply = '{"columns":["A"],"rows":[["1"]]}';

    // Already resident → reuse as-is, no num_ctx (which would force a reload).
    const warm = { calls: [], loadedModels: async () => ['m', 'other'], async chat(r) { this.calls.push(r); return { role: 'assistant', content: reply }; } };
    await runScraper({ store, ollama: warm, scraperId: sc.id, model: 'm' });
    assert.equal(warm.calls[0].options.num_ctx, undefined);

    // Not loaded → request the wider context while it loads anyway.
    const cold = { calls: [], loadedModels: async () => ['other'], async chat(r) { this.calls.push(r); return { role: 'assistant', content: reply }; } };
    await runScraper({ store, ollama: cold, scraperId: sc.id, model: 'm' });
    assert.equal(cold.calls[0].options.num_ctx, 16384);
  } finally {
    server.close();
  }
});

test('runScraper refuses a non-http URL before fetching', async () => {
  const store = newStore();
  const sc = store.addScraper({ name: 'bad', url: 'file:///etc/passwd', model: 'm' });
  const ollama = fakeOllama('{}');
  const { error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
  assert.match(error, /only http/);
  assert.equal(ollama.calls.length, 0); // never reached the model
});
