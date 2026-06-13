// Scraper engine: fetch a page, reduce it to visible text, then ask a model to
// extract the requested data into a table. Fetching is plain (http/https only,
// timed out); no JavaScript is executed. Each run logs as
// kind='scrape' with the model's thinking, so it replays move-by-move.
import crypto from 'node:crypto';
import { fail, normalizeScrapeResult } from './schema.js';
import { logTask } from './chatlog.js';
import { getPromptTemplate, renderPrompt } from './prompts.js';
import { SCRAPER_LIMITS } from './constants.js';

// Strip a page to readable text: drop script/style/comments, unwrap tags,
// decode the few common entities, collapse whitespace, then optionally cap.
function decodeHtmlAttr(text) {
  return String(text || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function nextSourceUrl(html, currentUrl) {
  const current = new URL(currentUrl);
  const seen = new Set();
  const attrs = [
    ...String(html || '').matchAll(/\bhx-get\s*=\s*(["'])(.*?)\1/gi),
    ...String(html || '').matchAll(/\bhref\s*=\s*(["'])(.*?)\1[^>]*\brel\s*=\s*(["'])next\3/gi),
  ];
  for (const m of attrs) {
    const raw = decodeHtmlAttr(m[2]);
    if (seen.has(raw) || !/[?&]page=/.test(raw)) continue;
    seen.add(raw);
    let next;
    try { next = new URL(raw, current); } catch { continue; }
    if (next.origin !== current.origin) continue;
    for (const [k, v] of current.searchParams) {
      if (k !== 'page' && !next.searchParams.has(k)) next.searchParams.set(k, v);
    }
    if (next.href !== current.href) return next.href;
  }
  return null;
}

export function htmlToText(html, maxChars = SCRAPER_LIMITS.maxTextChars) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(td|th)>/gi, ' | ') // keep table cells delimited
    .replace(/<\/(p|div|li|tr|h[1-6]|br|section|article|thead|tbody)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
  return Number.isFinite(maxChars) ? text.slice(0, maxChars) : text;
}

async function fetchSourcePage(url, { maxChars = Infinity, htmx = false } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { fail('that does not look like a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail('only http(s) pages can be scraped');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPER_LIMITS.fetchTimeoutMs);
  let res;
  try {
    res = await fetch(u, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'HuisDashboard/1.0 (+scraper)',
        ...(htmx ? { 'HX-Request': 'true' } : {}),
      },
    });
  } catch (err) {
    fail(`could not fetch the page: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) fail(`the page returned HTTP ${res.status}`);
  const raw = await res.text();
  const finalUrl = res.url || u.href;
  return {
    url: finalUrl,
    html: raw,
    text: htmlToText(raw, maxChars),
    nextUrl: nextSourceUrl(raw, finalUrl),
  };
}

// Split text into slices of ~pageChars. Prefer a newline near the boundary and
// optionally overlap slices so records crossing a boundary retain context.
export function paginate(text, pageChars, opts = {}) {
  const options = typeof opts === 'number' ? { maxPages: opts } : opts;
  const maxPages = Number.isFinite(options.maxPages) ? Math.max(0, Math.trunc(options.maxPages)) : Infinity;
  const size = Math.max(1, Math.trunc(Number(pageChars) || 0));
  const overlap = Math.min(Math.max(0, Math.trunc(Number(options.overlapChars) || 0)), Math.max(0, size - 1));
  const scan = Math.max(0, Math.trunc(Number(options.boundaryScanChars) || 0));
  const source = String(text || '');
  const pages = [];
  let i = 0;
  while (i < source.length && pages.length < maxPages) {
    let end = Math.min(i + size, source.length);
    if (end < source.length) {
      const backward = source.lastIndexOf('\n', end);
      if (backward > i + size * 0.5) {
        end = backward + 1;
      } else if (scan > 0) {
        const forward = source.indexOf('\n', end);
        if (forward !== -1 && forward <= Math.min(i + size + scan, source.length)) end = forward + 1;
      }
    }
    pages.push(source.slice(i, end));
    i = end >= source.length ? end : Math.max(i + 1, end - overlap);
  }
  return pages;
}

// Parse the model's JSON into a {columns, rows, note} table (bounds applied by
// the schema on store). Tolerates a JSON object embedded in surrounding prose.
export function parseTable(text) {
  let data = null;
  try { data = JSON.parse(text); } catch { /* sliced below */ }
  if (!data) {
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch { /* give up */ } }
  }
  if (!data || !Array.isArray(data.columns) || !data.columns.length || !Array.isArray(data.rows)) return null;
  return { columns: data.columns, rows: data.rows, note: typeof data.note === 'string' ? data.note : '' };
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function sourceHash(sources) {
  return sha256(JSON.stringify(sources.map((s) => ({ url: s.url, text: s.text }))));
}

function contractHash(sc, model, pageTokens) {
  return sha256(JSON.stringify({
    model,
    instruction: sc.instruction || 'Extract the main tabular data on the page.',
    template: getPromptTemplate('scraper'),
    pageMode: sc.pageMode,
    pageTokens,
    sourceMode: sc.sourceMode,
    sourceProcess: sc.sourceProcess,
  }));
}

function cacheKeyFor(sc, model, pageTokens, sources) {
  return sha256(JSON.stringify({
    v: 1,
    source: sourceHash(sources),
    contract: contractHash(sc, model, pageTokens),
  }));
}

// Fetch + extract. The route enforces that the model is gate-approved.
// onProgress(info) is called as the run advances so the UI can show live state.
export async function runScraper({ store, ollama, scraperId, model, onProgress, scraperResults = null }) {
  const sc = store.getScraper(scraperId);
  const useModel = model || sc.model;
  if (!useModel) fail('pick a model for this scraper first');
  if (!sc.url) fail('this scraper has no URL yet');
  const progress = (info) => { try { onProgress?.({ id: scraperId, ...info }); } catch { /* never break a run on UI plumbing */ } };

  const started = Date.now();
  const stamp = () => new Date().toISOString();
  store.updateScraper(scraperId, { result: null, error: '' });
  progress({ phase: 'clear' });
  const full = sc.pageMode !== 'preview';
  const pageTokens = full && sc.pageTokens === 0 ? SCRAPER_LIMITS.defaultPageTokens : sc.pageTokens;
  const pageChars = pageTokens > 0 ? Math.max(1000, pageTokens * SCRAPER_LIMITS.charsPerToken) : SCRAPER_LIMITS.maxTextChars;
  let result = null;
  let error = '';
  let pageText = '';
  let cacheHit = false;
  let cacheKey = '';
  let streamedColumns = null;
  let streamedOnce = false;
  const streamedRows = [];
  const rounds = [];
  const streamTable = (table) => {
    const live = normalizeScrapeResult({ ...table, at: stamp() });
    if (live) progress({ phase: 'rows', result: live });
  };
  const streamRows = (columns, rows = []) => {
    if (!columns?.length) return;
    if (!streamedColumns) streamedColumns = columns;
    streamedRows.push(...rows);
    if (!rows.length && streamedOnce) return;
    streamedOnce = true;
    streamTable({ columns: streamedColumns, rows: streamedRows, note: 'extracting...', cacheKey });
  };
  const withNote = (table, note) => ({ ...table, note: [table.note, note].filter(Boolean).join(' · ') });
  const sourceBlock = (src, i) => `Source page ${i}: ${src.url}\n${src.text}`;
  const noteParts = ({ sourcePages, slices, failed, unreadable, mode }) => {
    const parts = [`${mode}: ${sourcePages} source page(s), ${slices} model slice(s) of ~${pageTokens} tokens`];
    if (failed) parts.push(`${failed} slice(s) failed`);
    if (unreadable) parts.push(`${unreadable} unreadable slice(s)`);
    return parts.join(' · ');
  };
  try {
    // No num_ctx: the model runs at its default context size, so an
    // already-loaded model is reused as-is and never reloads to resize.
    const options = { temperature: 0 };

    // One extraction pass over a slice of content; logs a round for the replay.
    const ask = async (content, userMsg) => {
      const system = renderPrompt('scraper', {
        instruction: sc.instruction || 'Extract the main tabular data on the page.',
        url: sc.url,
        content,
      });
      const msg = await ollama.chat({
        model: useModel,
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }],
        format: 'json',
        options,
      });
      rounds.push({ thinking: msg.thinking || '', content: msg.content || '', calls: 0 });
      return parseTable(msg.content);
    };

    const extractPaged = async (content, { columns = null, rowsSoFar = 0, sourcePage = null, sourcePages = null, onRows = null } = {}) => {
      const pages = paginate(content, pageChars, {
        overlapChars: SCRAPER_LIMITS.pageOverlapChars,
        boundaryScanChars: SCRAPER_LIMITS.pageBoundaryScanChars,
      });
      let localColumns = columns;
      let failed = 0;
      let unreadable = 0;
      const rows = [];
      for (let i = 0; i < pages.length; i += 1) {
        progress({ phase: 'slice', sourcePage, sourcePages, slice: i + 1, slices: pages.length, rows: rowsSoFar + rows.length });
        const scope = sourcePage ? `source page ${sourcePage}${sourcePages ? ` of ${sourcePages}` : ''}, model slice ${i + 1} of ${pages.length}` : `model slice ${i + 1} of ${pages.length}`;
        const userMsg = localColumns
          ? `This is ${scope}. Adjacent model slices may overlap for boundary context; do not repeat rows already extracted unless the source page itself repeats them. Use EXACTLY these columns, in order: ${JSON.stringify(localColumns)}. Extract any matching rows from this part; return empty rows if there are none. Reply with ONLY the JSON.`
          : `This is ${scope}. Adjacent model slices may overlap for boundary context; avoid duplicate rows from overlap. Extract now. Reply with ONLY the JSON.`;
        let parsed = null;
        let sliceFailed = false;
        try {
          parsed = await ask(pages[i], userMsg);
        } catch (err) {
          failed += 1;
          sliceFailed = true;
          rounds.push({ thinking: '', content: `(slice ${i + 1} failed: ${err.message})`, calls: 0 });
        }
        if (parsed) {
          if (!localColumns && parsed.columns.length) localColumns = parsed.columns;
          if (localColumns) {
            for (const r of parsed.rows) rows.push(r);
            onRows?.(localColumns, parsed.rows);
          }
        } else if (!sliceFailed) {
          unreadable += 1;
        }
      }
      return { columns: localColumns, rows, failed, unreadable, slices: pages.length };
    };

    const collectSources = async ({ follow }) => {
      const sources = [];
      const visited = new Set();
      let url = sc.url;
      let htmx = false;
      while (url && !visited.has(url)) {
        visited.add(url);
        progress({ phase: 'source', sourcePage: sources.length + 1 });
        const src = await fetchSourcePage(url, { htmx });
        sources.push(src);
        if (!follow) break;
        url = src.nextUrl;
        htmx = true;
      }
      return sources;
    };

    const maybeUseCache = (sources) => {
      cacheKey = cacheKeyFor(sc, useModel, pageTokens, sources);
      if (sc.result?.cacheKey && sc.result.cacheKey === cacheKey) {
        const saved = scraperResults?.latestCached(scraperId, cacheKey);
        const legacyRows = Array.isArray(sc.result.rows) ? sc.result.rows : [];
        const legacyTotal = Number.isFinite(Number(sc.result.rowCount)) ? Number(sc.result.rowCount) : legacyRows.length;
        const cached = saved || (legacyRows.length || legacyTotal === 0
          ? { columns: sc.result.columns, rows: legacyRows, note: sc.result.note || '', cacheKey }
          : null);
        if (cached) {
          cacheHit = true;
          result = { columns: cached.columns, rows: cached.rows, note: cached.note || '', cacheKey };
          streamTable(result);
          return true;
        }
      }
      return false;
    };

    const processCollectedSources = async (sources) => {
      pageText = sources.map((src, i) => sourceBlock(src, i + 1)).join('\n\n');
      const extracted = await extractPaged(pageText, { sourcePages: sources.length, onRows: streamRows });
      if (extracted.columns) {
        result = {
          columns: extracted.columns,
          rows: extracted.rows,
          note: noteParts({
            sourcePages: sources.length,
            slices: extracted.slices,
            failed: extracted.failed,
            unreadable: extracted.unreadable,
            mode: 'collected full paged',
          }),
          cacheKey,
        };
      } else {
        const partial = noteParts({ sourcePages: sources.length, slices: extracted.slices, failed: extracted.failed, unreadable: extracted.unreadable, mode: 'collected full paged' });
        error = `the model returned no readable table from any slice · ${partial}`;
      }
    };

    const processSourcesPerPage = async (sources) => {
      let columns = null;
      let failed = 0;
      let unreadable = 0;
      let slices = 0;
      const rows = [];
      for (let i = 0; i < sources.length; i += 1) {
        pageText = sources.slice(0, i + 1).map((source, k) => sourceBlock(source, k + 1)).join('\n\n');
        const extracted = await extractPaged(sources[i].text, { columns, rowsSoFar: rows.length, sourcePage: i + 1, sourcePages: sources.length, onRows: streamRows });
        columns = extracted.columns;
        rows.push(...extracted.rows);
        failed += extracted.failed;
        unreadable += extracted.unreadable;
        slices += extracted.slices;
      }
      if (columns) result = { columns, rows, note: noteParts({ sourcePages: sources.length, slices, failed, unreadable, mode: 'per-source full paged' }), cacheKey };
      else error = `the model returned no readable table from any slice · ${noteParts({ sourcePages: sources.length, slices, failed, unreadable, mode: 'per-source full paged' })}`;
    };

    if (!full) {
      progress({ phase: 'source', sourcePage: 1 });
      const source = await fetchSourcePage(sc.url, { maxChars: pageChars });
      pageText = sourceBlock(source, 1);
      if (!maybeUseCache([source])) {
        progress({ phase: 'preview' });
        result = await ask(source.text, 'Preview this first source page slice. Extract now. Reply with ONLY the JSON.');
        if (!result) error = 'the model did not return a readable table';
        else {
          result = { ...withNote(result, pageTokens > 0 ? `preview: first ~${pageTokens} tokens only` : `preview: first ${SCRAPER_LIMITS.maxTextChars} chars only`), cacheKey };
          streamTable(result);
        }
      }
    } else if (sc.sourceProcess === 'collect') {
      const sources = await collectSources({ follow: sc.sourceMode === 'follow' });
      pageText = sources.map((src, i) => sourceBlock(src, i + 1)).join('\n\n');
      if (!maybeUseCache(sources)) await processCollectedSources(sources);
    } else {
      const follow = sc.sourceMode === 'follow';
      const visited = new Set();
      const sources = [];
      let url = sc.url;
      let htmx = false;
      if (sc.result?.cacheKey) {
        const cachedSources = await collectSources({ follow });
        pageText = cachedSources.map((src, i) => sourceBlock(src, i + 1)).join('\n\n');
        if (!maybeUseCache(cachedSources)) await processSourcesPerPage(cachedSources);
      } else {
        let columns = null;
        let failed = 0;
        let unreadable = 0;
        let slices = 0;
        const rows = [];
        while (url && !visited.has(url)) {
          visited.add(url);
          progress({ phase: 'source', sourcePage: sources.length + 1 });
          const src = await fetchSourcePage(url, { htmx });
          sources.push(src);
          pageText = sources.map((source, i) => sourceBlock(source, i + 1)).join('\n\n');
          const extracted = await extractPaged(src.text, { columns, rowsSoFar: rows.length, sourcePage: sources.length, onRows: streamRows });
          columns = extracted.columns;
          rows.push(...extracted.rows);
          failed += extracted.failed;
          unreadable += extracted.unreadable;
          slices += extracted.slices;
          if (!follow) break;
          url = src.nextUrl;
          htmx = true;
        }
        cacheKey = cacheKeyFor(sc, useModel, pageTokens, sources);
        if (columns) result = { columns, rows, note: noteParts({ sourcePages: sources.length, slices, failed, unreadable, mode: 'per-source full paged' }), cacheKey };
        else error = `the model returned no readable table from any slice · ${noteParts({ sourcePages: sources.length, slices, failed, unreadable, mode: 'per-source full paged' })}`;
      }
    }
  } catch (err) {
    error = err.message;
  }

  const completedAt = stamp();
  let storedResult = result ? { ...result, rowCount: result.rows.length, at: completedAt } : null;
  if (storedResult && scraperResults) {
    const saved = scraperResults.saveRun({ scraperId, model: useModel, result, at: completedAt });
    storedResult = {
      columns: result.columns,
      rows: [],
      rowCount: saved.rowCount,
      note: result.note || '',
      at: completedAt,
      cacheKey: result.cacheKey || cacheKey,
      runId: saved.runId,
    };
  }

  const updated = store.updateScraper(scraperId, {
    ...(storedResult ? { result: storedResult } : {}),
    error,
    lastRunAt: completedAt,
  });
  logTask({
    kind: 'scrape',
    model: useModel,
    task: cacheHit ? 'scrape-cache' : (full ? 'scrape-paged' : 'scrape-preview'),
    session: scraperId,
    userMsg: `${sc.url}\n${sc.instruction || '(extract main data)'}`,
    reply: result
      ? `${cacheHit ? 'cached · ' : ''}${result.rows.length} row(s) × ${result.columns.length} column(s)${rounds.length > 1 ? ` · ${rounds.length} slices` : ''}`
      : (error || 'no result'),
    rounds,
    content: pageText || null, // the fetched page text, shown in the Replay view
    ms: Date.now() - started,
    error: error || null,
  });
  return { scraper: updated, error };
}
