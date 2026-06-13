// Scraper engine: fetch a page, reduce it to visible text, then ask a model to
// extract the requested data into a table. Fetching is plain (http/https only,
// timed out); no JavaScript is executed. Each run logs as
// kind='scrape' with the model's thinking, so it replays move-by-move.
import { fail } from './schema.js';
import { logTask } from './chatlog.js';
import { renderPrompt } from './prompts.js';
import { SCRAPER_LIMITS } from './constants.js';

// Strip a page to readable text: drop script/style/comments, unwrap tags,
// decode the few common entities, collapse whitespace, then optionally cap.
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

async function fetchPageText(url, maxChars = Infinity) {
  let u;
  try { u = new URL(String(url)); } catch { fail('that does not look like a valid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') fail('only http(s) pages can be scraped');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCRAPER_LIMITS.fetchTimeoutMs);
  let res;
  try {
    res = await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': 'HuisDashboard/1.0 (+scraper)' } });
  } catch (err) {
    fail(`could not fetch the page: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) fail(`the page returned HTTP ${res.status}`);
  const raw = await res.text();
  return htmlToText(raw, maxChars);
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

// Fetch + extract. The route enforces that the model is gate-approved.
// onProgress(info) is called as the run advances so the UI can show live state.
export async function runScraper({ store, ollama, scraperId, model, onProgress }) {
  const sc = store.getScraper(scraperId);
  const useModel = model || sc.model;
  if (!useModel) fail('pick a model for this scraper first');
  if (!sc.url) fail('this scraper has no URL yet');
  const progress = (info) => { try { onProgress?.({ id: scraperId, ...info }); } catch { /* never break a run on UI plumbing */ } };

  const started = Date.now();
  const stamp = () => new Date().toISOString();
  const full = sc.pageMode !== 'preview';
  const pageTokens = full && sc.pageTokens === 0 ? SCRAPER_LIMITS.defaultPageTokens : sc.pageTokens;
  const pageChars = pageTokens > 0 ? Math.max(1000, pageTokens * SCRAPER_LIMITS.charsPerToken) : SCRAPER_LIMITS.maxTextChars;
  let result = null;
  let error = '';
  let pageText = '';
  const rounds = [];
  const withNote = (table, note) => ({ ...table, note: [table.note, note].filter(Boolean).join(' · ') });
  try {
    progress({ phase: 'fetch' });
    pageText = await fetchPageText(sc.url, full ? Infinity : pageChars);

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

    if (!full) {
      progress({ phase: 'preview' });
      result = await ask(pageText, 'Preview this first slice of the page. Extract now. Reply with ONLY the JSON.');
      if (!result) error = 'the model did not return a readable table';
      else result = withNote(result, pageTokens > 0 ? `preview: first ~${pageTokens} tokens only` : `preview: first ${SCRAPER_LIMITS.maxTextChars} chars only`);
    } else {
      // Content pager: extract from each slice, fixing the columns after the
      // first hit so later slices' rows stay alignable, then merge the rows.
      const pages = paginate(pageText, pageChars, {
        overlapChars: SCRAPER_LIMITS.pageOverlapChars,
        boundaryScanChars: SCRAPER_LIMITS.pageBoundaryScanChars,
      });
      let columns = null;
      let failed = 0;
      let unreadable = 0;
      const rows = [];
      for (let i = 0; i < pages.length; i += 1) {
        progress({ phase: 'slice', slice: i + 1, slices: pages.length, rows: rows.length });
        const userMsg = columns
          ? `This is part ${i + 1} of ${pages.length} of the same page. Adjacent parts may overlap for boundary context; do not repeat rows already extracted unless the page itself repeats them. Use EXACTLY these columns, in order: ${JSON.stringify(columns)}. Extract any matching rows from this part; return empty rows if there are none. Reply with ONLY the JSON.`
          : `This is part ${i + 1} of ${pages.length} of a page. Adjacent parts may overlap for boundary context; avoid duplicate rows from overlap. Extract now. Reply with ONLY the JSON.`;
        // A slow or failed slice shouldn't discard rows already gathered.
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
          if (!columns && parsed.columns.length) columns = parsed.columns;
          if (columns) for (const r of parsed.rows) rows.push(r);
        } else if (!sliceFailed) {
          unreadable += 1;
        }
      }
      const partials = [];
      if (failed) partials.push(`${failed} slice(s) failed`);
      if (unreadable) partials.push(`${unreadable} unreadable slice(s)`);
      const partial = partials.length ? ` · ${partials.join(' · ')}` : '';
      if (columns) result = { columns, rows, note: `full paged: ${pages.length} slice(s) of ~${pageTokens} tokens${partial}` };
      else error = `the model returned no readable table from any slice${partial}`;
    }
  } catch (err) {
    error = err.message;
  }

  const updated = store.updateScraper(scraperId, {
    ...(result ? { result: { ...result, at: stamp() } } : {}),
    error,
    lastRunAt: stamp(),
  });
  logTask({
    kind: 'scrape',
    model: useModel,
    task: full ? 'scrape-paged' : 'scrape-preview',
    session: scraperId,
    userMsg: `${sc.url}\n${sc.instruction || '(extract main data)'}`,
    reply: result
      ? `${result.rows.length} row(s) × ${result.columns.length} column(s)${rounds.length > 1 ? ` · ${rounds.length} slices` : ''}`
      : (error || 'no result'),
    rounds,
    content: pageText || null, // the fetched page text, shown in the Replay view
    ms: Date.now() - started,
    error: error || null,
  });
  return { scraper: updated, error };
}
