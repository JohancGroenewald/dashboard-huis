import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Store } from '../src/store.js';
import { htmlToText, nextSourceUrl, parseTable, paginate, runScraper } from '../src/scrapers.js';
import { normalizeScraper } from '../src/schema.js';
import { SCRAPER_LIMITS } from '../src/constants.js';

const newStore = () => new Store({ persist: false }).load();
const fakeOllama = (reply) => ({ calls: [], async chat(req) { this.calls.push(req); return { role: 'assistant', content: reply }; } });

function pageServer(html) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(typeof html === 'function' ? html(req) : html);
  });
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
  assert.equal(parseTable('{"columns":[],"rows":[]}'), null);
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

test('normalizeScraper defaults to full paged extraction but preserves legacy preview', () => {
  const def = normalizeScraper({ name: 'Default' });
  assert.equal(def.pageMode, 'full');
  assert.equal(def.pageTokens, SCRAPER_LIMITS.defaultPageTokens);
  assert.equal(def.sourceMode, 'follow');
  assert.equal(def.sourceProcess, 'per-page');

  const legacySingle = normalizeScraper({ name: 'Single', pageTokens: 0 });
  assert.equal(legacySingle.pageMode, 'preview');
  assert.equal(legacySingle.pageTokens, 0);

  const fullZero = normalizeScraper({ name: 'Full', pageMode: 'full', pageTokens: 0 });
  assert.equal(fullZero.pageMode, 'full');
  assert.equal(fullZero.pageTokens, SCRAPER_LIMITS.defaultPageTokens);

  assert.throws(() => normalizeScraper({ name: 'Bad', pageMode: 'everything' }), /pageMode/);
  assert.throws(() => normalizeScraper({ name: 'Bad', sourceMode: 'forever' }), /sourceMode/);
  assert.throws(() => normalizeScraper({ name: 'Bad', sourceProcess: 'later' }), /sourceProcess/);
});

test('nextSourceUrl detects htmx pagination and carries current query params', () => {
  const html = '<li hx-get="/search?page=2" hx-trigger="revealed" hx-include="[name=o]"></li>';
  assert.equal(
    nextSourceUrl(html, 'https://ollama.com/search?o=newest'),
    'https://ollama.com/search?page=2&o=newest'
  );
  assert.equal(nextSourceUrl('<div>No next page</div>', 'https://ollama.com/search?o=newest'), null);
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

test('runScraper uses paged extraction by default', async () => {
  const oldSinglePassPadding = 'x'.repeat(SCRAPER_LIMITS.maxTextChars + 1000);
  const server = await pageServer(`<body><pre>${oldSinglePassPadding}\nNeedle | $7</pre></body>`);
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Default pager', url: `http://127.0.0.1:${server.address().port}/`, model: 'm' });
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        const content = req.messages[0].content;
        if (content.includes('Needle')) return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Needle","$7"]]}' };
        return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[]}' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.equal(sc.pageMode, 'full');
    assert.equal(sc.pageTokens, SCRAPER_LIMITS.defaultPageTokens);
    assert.ok(ollama.calls.length > 1, 'default run split the page into slices');
    assert.deepEqual(scraper.result.rows, [['Needle', '$7']]);
    assert.match(scraper.result.note, /full paged/);
  } finally {
    server.close();
  }
});

test('runScraper full paged extraction keeps scanning past the old page-count ceiling', async () => {
  const latePadding = 'x'.repeat(105_000);
  const server = await pageServer(`<body><pre>${latePadding}\nLate needle | $99</pre></body>`);
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Deep page', url: `http://127.0.0.1:${server.address().port}/`, model: 'm', pageMode: 'full', pageTokens: 2000 });
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        const content = req.messages[0].content;
        if (content.includes('Late needle')) return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Late needle","$99"]]}' };
        return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[]}' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.ok(ollama.calls.length > 12, 'no hidden 12-page cutoff');
    assert.deepEqual(scraper.result.rows, [['Late needle', '$99']]);
  } finally {
    server.close();
  }
});

test('runScraper can collect htmx source pages before model extraction', async () => {
  const events = [];
  const server = await pageServer((req) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const page = u.searchParams.get('page') || '1';
    events.push(`fetch:${page}:${req.headers['hx-request'] || ''}:${u.searchParams.get('o') || ''}`);
    if (page === '2') return '<body><p>Beta | $2</p></body>';
    return '<body><p>Alpha | $1</p><li hx-get="/search?page=2" hx-trigger="revealed" hx-include="[name=o]"></li></body>';
  });
  try {
    const store = newStore();
    const sc = store.addScraper({
      name: 'Collect',
      url: `http://127.0.0.1:${server.address().port}/search?o=newest`,
      model: 'm',
      sourceMode: 'follow',
      sourceProcess: 'collect',
    });
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        const content = req.messages[0].content;
        events.push(`model:${content.includes('Alpha') && content.includes('Beta') ? 'both' : 'partial'}`);
        return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Alpha","$1"],["Beta","$2"]]}' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.deepEqual(scraper.result.rows, [['Alpha', '$1'], ['Beta', '$2']]);
    assert.deepEqual(events, ['fetch:1::newest', 'fetch:2:true:newest', 'model:both']);
    assert.match(scraper.result.note, /2 source page/);
  } finally {
    server.close();
  }
});

test('runScraper can process each htmx source page before fetching the next', async () => {
  const events = [];
  const server = await pageServer((req) => {
    const u = new URL(req.url, 'http://127.0.0.1');
    const page = u.searchParams.get('page') || '1';
    events.push(`fetch:${page}:${req.headers['hx-request'] || ''}`);
    if (page === '2') return '<body><p>Beta | $2</p></body>';
    return '<body><p>Alpha | $1</p><li hx-get="/search?page=2" hx-trigger="revealed"></li></body>';
  });
  try {
    const store = newStore();
    const sc = store.addScraper({
      name: 'Per page',
      url: `http://127.0.0.1:${server.address().port}/search`,
      model: 'm',
      sourceMode: 'follow',
      sourceProcess: 'per-page',
    });
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        const content = req.messages[0].content;
        if (content.includes('Alpha')) {
          events.push('model:alpha');
          return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}' };
        }
        events.push('model:beta');
        return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Beta","$2"]]}' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.deepEqual(scraper.result.rows, [['Alpha', '$1'], ['Beta', '$2']]);
    assert.deepEqual(events, ['fetch:1:', 'model:alpha', 'fetch:2:true', 'model:beta']);
    assert.match(scraper.result.note, /per-source/);
  } finally {
    server.close();
  }
});

test('runScraper can stay on the first source page only', async () => {
  let fetches = 0;
  const server = await pageServer(() => {
    fetches += 1;
    return '<body><p>Alpha | $1</p><li hx-get="/search?page=2" hx-trigger="revealed"></li></body>';
  });
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Single source', url: `http://127.0.0.1:${server.address().port}/search`, model: 'm', sourceMode: 'single' });
    const ollama = fakeOllama('{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}');
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.equal(fetches, 1);
    assert.deepEqual(scraper.result.rows, [['Alpha', '$1']]);
  } finally {
    server.close();
  }
});

test('runScraper reuses a cached extraction when source and prompt contract match', async () => {
  let fetches = 0;
  const server = await pageServer(() => {
    fetches += 1;
    return '<body><p>Alpha | $1</p></body>';
  });
  try {
    const store = newStore();
    const sc = store.addScraper({
      name: 'Cached',
      url: `http://127.0.0.1:${server.address().port}/search`,
      instruction: 'item and price',
      model: 'm',
      sourceMode: 'single',
      sourceProcess: 'collect',
    });
    const firstOllama = fakeOllama('{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}');
    const first = await runScraper({ store, ollama: firstOllama, scraperId: sc.id, model: 'm' });
    assert.equal(first.error, '');
    assert.equal(firstOllama.calls.length, 1);
    assert.match(first.scraper.result.cacheKey, /^[a-f0-9]{64}$/);

    const secondOllama = { calls: [], async chat() { this.calls.push(true); throw new Error('cache miss'); } };
    const second = await runScraper({ store, ollama: secondOllama, scraperId: sc.id, model: 'm' });
    assert.equal(second.error, '');
    assert.equal(secondOllama.calls.length, 0);
    assert.equal(fetches, 2, 'source is still rechecked before cache reuse');
    assert.deepEqual(second.scraper.result.rows, [['Alpha', '$1']]);
    assert.equal(second.scraper.result.cacheKey, first.scraper.result.cacheKey);
  } finally {
    server.close();
  }
});

test('runScraper cache misses when the scraper instruction changes', async () => {
  const server = await pageServer('<body><p>Alpha | $1</p></body>');
  try {
    const store = newStore();
    const sc = store.addScraper({
      name: 'Instruction cache',
      url: `http://127.0.0.1:${server.address().port}/search`,
      instruction: 'item and price',
      model: 'm',
      sourceMode: 'single',
      sourceProcess: 'collect',
    });
    await runScraper({ store, ollama: fakeOllama('{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}'), scraperId: sc.id, model: 'm' });
    store.updateScraper(sc.id, { instruction: 'only item names' });

    const ollama = fakeOllama('{"columns":["Item"],"rows":[["Alpha"]]}');
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.equal(ollama.calls.length, 1);
    assert.deepEqual(scraper.result.columns, ['Item']);
  } finally {
    server.close();
  }
});

test('runScraper cache misses when the fetched source changes', async () => {
  let body = '<body><p>Alpha | $1</p></body>';
  const server = await pageServer(() => body);
  try {
    const store = newStore();
    const sc = store.addScraper({
      name: 'Source cache',
      url: `http://127.0.0.1:${server.address().port}/search`,
      instruction: 'item and price',
      model: 'm',
      sourceMode: 'single',
      sourceProcess: 'collect',
    });
    await runScraper({ store, ollama: fakeOllama('{"columns":["Item","Price"],"rows":[["Alpha","$1"]]}'), scraperId: sc.id, model: 'm' });
    body = '<body><p>Beta | $2</p></body>';

    const ollama = fakeOllama('{"columns":["Item","Price"],"rows":[["Beta","$2"]]}');
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.equal(ollama.calls.length, 1);
    assert.deepEqual(scraper.result.rows, [['Beta', '$2']]);
  } finally {
    server.close();
  }
});

test('runScraper preview mode only sends the selected first slice', async () => {
  const server = await pageServer(`<body><pre>${'x'.repeat(9000)}\nNeedle | $7</pre></body>`);
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Preview', url: `http://127.0.0.1:${server.address().port}/`, model: 'm', pageMode: 'preview', pageTokens: 2000 });
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        const content = req.messages[0].content;
        if (content.includes('Needle')) return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[["Needle","$7"]]}' };
        return { role: 'assistant', content: '{"columns":["Item","Price"],"rows":[]}' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.equal(ollama.calls.length, 1);
    assert.deepEqual(scraper.result.rows, []);
    assert.match(scraper.result.note, /preview/);
  } finally {
    server.close();
  }
});

test('runScraper reports unreadable slices without discarding good rows', async () => {
  const server = await pageServer(`<body><pre>${'x'.repeat(5000)}</pre></body>`);
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Partial', url: `http://127.0.0.1:${server.address().port}/`, model: 'm', pageMode: 'full', pageTokens: 1000 });
    let call = 0;
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        call += 1;
        if (call === 1) return { role: 'assistant', content: '{"columns":["A"],"rows":[["ok"]]}' };
        return { role: 'assistant', content: 'not json' };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(error, '');
    assert.deepEqual(scraper.result.rows, [['ok']]);
    assert.match(scraper.result.note, /unreadable slice/);
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

test('runScraper never sets num_ctx — models run at their default context', async () => {
  const server = await pageServer('<body><p>data</p></body>');
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'X', url: `http://127.0.0.1:${server.address().port}/`, model: 'm' });
    const ollama = { calls: [], async chat(r) { this.calls.push(r); return { role: 'assistant', content: '{"columns":["A"],"rows":[["1"]]}' }; } };
    await runScraper({ store, ollama, scraperId: sc.id, model: 'm' });
    assert.equal(ollama.calls[0].options.num_ctx, undefined);
  } finally {
    server.close();
  }
});

test('paginate slices text on newline boundaries and caps page count', () => {
  const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n'); // ~70 chars
  const pages = paginate(text, 20);
  assert.ok(pages.length > 1);
  assert.equal(pages.join(''), text); // lossless
  assert.ok(pages.slice(0, -1).every((p) => p.endsWith('\n'))); // clean breaks
  assert.ok(paginate(text, 5, 2).length <= 2); // maxPages honoured
  assert.equal(paginate('abcd\nefgh', 4, { boundaryScanChars: 2 })[0], 'abcd\n'); // can look ahead
  assert.deepEqual(paginate('abcdefghi', 5, { overlapChars: 2 }), ['abcde', 'defgh', 'ghi']); // boundary context
});

test('the content pager runs each slice and merges rows under fixed columns', async () => {
  // >8K chars of text so a 2K-token (≈8K-char) slice splits into ≥2 passes.
  const lines = Array.from({ length: 220 }, (_, i) => `Item ${i} — a fairly long product description for padding | $${i}`).join('\n');
  const server = await pageServer(`<body><pre>${lines}</pre></body>`);
  try {
    const store = newStore();
    const sc = store.addScraper({ name: 'Big', url: `http://127.0.0.1:${server.address().port}/`, model: 'm', pageTokens: 2000 });
    let call = 0;
    const ollama = {
      calls: [],
      async chat(req) {
        this.calls.push(req);
        call += 1;
        return { role: 'assistant', content: `{"columns":["Item","Price"],"rows":[["Item${call}","$${call}"]]}` };
      },
    };
    const { scraper, error } = await runScraper({ store, ollama, scraperId: sc.id, model: 'm', });
    assert.equal(error, '');
    assert.ok(ollama.calls.length >= 2, 'paged into multiple model calls');
    assert.deepEqual(scraper.result.columns, ['Item', 'Price']);
    assert.equal(scraper.result.rows.length, ollama.calls.length); // one row merged per slice
    assert.match(scraper.result.note, /paged/);
    // Slices after the first are told to reuse the established columns.
    assert.match(ollama.calls[1].messages[1].content, /Use EXACTLY these columns/);
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
