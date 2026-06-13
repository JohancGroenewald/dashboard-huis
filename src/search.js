// Free-text search across the dashboard tree: tiles, sections, notes, games,
// and triggers. Returns ranked matches (by number of query words found) with
// ids, so the agent can resolve fuzzy references like "the green note" or
// "the two triggers" before acting.
import { STORE_LIMITS } from './constants.js';
import { colorName } from './schema.js';

// Plural query tokens also match their singular hay ("triggers" → "trigger");
// the other direction already works via substring inclusion.
const hit = (hay, tk) => hay.includes(tk) || (tk.length > 3 && tk.endsWith('s') && hay.includes(tk.slice(0, -1)));

export function searchState(state, query) {
  const raw = String(query || '').toLowerCase().split(/\W+/).filter(Boolean);
  // 1-char tokens ("2", "a") substring-match half the board; ignore them
  // unless they are the entire query.
  const meaty = raw.filter((t) => t.length > 1);
  const tokens = meaty.length ? meaty : raw;
  if (!tokens.length) return [];
  const items = [];
  for (const sec of state.sections) {
    items.push({ type: 'section', id: sec.id, label: sec.name, layout: sec.layout, _hay: `section ${sec.name}` });
    for (const t of sec.tiles) {
      items.push({
        type: 'tile', id: t.id, label: t.name, url: t.url, section: sec.name,
        _hay: `tile ${t.name} ${t.description || ''} ${t.url} ${sec.name}`,
      });
    }
  }
  for (const n of state.notes) {
    const color = colorName(n.color);
    items.push({
      type: 'note', id: n.id, color, label: (n.text || '').slice(0, STORE_LIMITS.noteSearchLabelChars) || '(empty note)', layout: n.layout,
      _hay: `note ${color} ${n.text || ''}`,
    });
  }
  for (const g of state.games) {
    items.push({ type: 'game', id: g.id, label: 'Kringetjies & kruisies (tic-tac-toe)', layout: g.layout, _hay: `game ${g.kind} tictactoe kringetjies kruisies noughts crosses` });
  }
  for (const t of state.triggers) {
    items.push({ type: 'trigger', id: t.id, label: t.name, layout: t.layout, _hay: `trigger button ${t.name}` });
  }
  for (const sc of state.scrapers) {
    items.push({ type: 'scraper', id: sc.id, label: sc.name, layout: sc.layout, _hay: `scraper ${sc.name} ${sc.url} ${sc.instruction}` });
  }
  return items
    .map((it) => {
      const hay = it._hay.toLowerCase();
      let score = 0;
      for (const tk of tokens) if (hit(hay, tk)) score++;
      const { _hay, ...rest } = it;
      return { ...rest, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, STORE_LIMITS.searchResults);
}
