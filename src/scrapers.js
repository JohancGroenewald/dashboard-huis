// Scraper engine: fetch a page, reduce it to visible text, then ask a model to
// extract the requested data into a table. Fetching is plain (http/https only,
// timed out, size-capped); no JavaScript is executed. Each run logs as
// kind='scrape' with the model's thinking, so it replays move-by-move.
import { fail } from './schema.js';
import { logTask } from './chatlog.js';
import { renderPrompt } from './prompts.js';
import { SCRAPER_LIMITS } from './constants.js';

// Strip a page to readable text: drop script/style/comments, unwrap tags,
// decode the few common entities, collapse whitespace, then cap the length.
export function htmlToText(html) {
  return String(html || '')
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
    .replace(/^\s+|\s+$/g, '')
    .slice(0, SCRAPER_LIMITS.maxTextChars);
}

async function fetchPageText(url) {
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
  const raw = (await res.text()).slice(0, SCRAPER_LIMITS.maxHtmlChars);
  return htmlToText(raw);
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
  if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) return null;
  return { columns: data.columns, rows: data.rows, note: typeof data.note === 'string' ? data.note : '' };
}

// Fetch + extract. The route enforces that the model is gate-approved.
export async function runScraper({ store, ollama, scraperId, model }) {
  const sc = store.getScraper(scraperId);
  const useModel = model || sc.model;
  if (!useModel) fail('pick a model for this scraper first');
  if (!sc.url) fail('this scraper has no URL yet');

  const started = Date.now();
  const stamp = () => new Date().toISOString();
  let result = null;
  let error = '';
  const rounds = [];
  try {
    const content = await fetchPageText(sc.url);
    const system = renderPrompt('scraper', {
      instruction: sc.instruction || 'Extract the main tabular data on the page.',
      url: sc.url,
      content,
    });
    const msg = await ollama.chat({
      model: useModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: 'Extract now. Reply with ONLY the JSON.' },
      ],
      format: 'json',
      options: { temperature: 0, num_ctx: 16384 },
    });
    rounds.push({ thinking: msg.thinking || '', content: msg.content || '', calls: 0 });
    result = parseTable(msg.content);
    if (!result) error = 'the model did not return a readable table';
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
    task: 'scrape',
    session: scraperId,
    userMsg: `${sc.url}\n${sc.instruction || '(extract main data)'}`,
    reply: result ? `${result.rows.length} row(s) × ${result.columns.length} column(s)` : (error || 'no result'),
    rounds,
    ms: Date.now() - started,
    error: error || null,
  });
  return { scraper: updated, error };
}
