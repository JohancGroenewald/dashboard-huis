const MAX_SUGGESTIONS = 3;

const clean = (value, fallback = 'this workspace') =>
  String(value || fallback).replace(/\s+/g, ' ').trim();

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function activeWorkspace(dashboard) {
  return (dashboard.workspaces || []).find((w) => w.id === dashboard.activeWorkspaceId)
    || (dashboard.workspaces || [])[0]
    || { id: dashboard.activeWorkspaceId, name: 'this workspace' };
}

function workspaceCards(dashboard, workspaceId, key) {
  return (dashboard[key] || []).filter((item) => item.workspaceId === workspaceId);
}

function hasRows(scraper) {
  return Number(scraper?.result?.rowCount || scraper?.result?.rows?.length || scraper?.rows || 0) > 0;
}

export function introSuggestions(dashboard = {}) {
  const ws = activeWorkspace(dashboard);
  const wsName = clean(ws.name);
  const wsId = ws.id;
  const sections = workspaceCards(dashboard, wsId, 'sections');
  const notes = workspaceCards(dashboard, wsId, 'notes').filter((n) => !n.hidden);
  const scrapers = workspaceCards(dashboard, wsId, 'scrapers');
  const triggers = workspaceCards(dashboard, wsId, 'triggers');
  const games = workspaceCards(dashboard, wsId, 'games');
  const openProblems = (dashboard.problems || []).filter((p) => p.status === 'open');
  const openRequests = (dashboard.featureRequests || []).filter((r) => r.status === 'open' || r.status === 'planned');
  const suggestions = [];
  const add = (text) => {
    if (suggestions.length >= MAX_SUGGESTIONS || suggestions.includes(text)) return;
    suggestions.push(text);
  };

  const scraperWithRows = scrapers.find(hasRows);
  if (scraperWithRows) add(`Summarize the latest rows from ${clean(scraperWithRows.name, 'this scraper')}`);
  if (scrapers.length > 1) add('Compare my scraper results and point out useful patterns');
  else if (scrapers.length) add(`Run ${clean(scrapers[0].name, 'this scraper')} and summarize what changed`);
  if (openProblems.length) add(`Review my ${plural(openProblems.length, 'open problem')} and suggest next fixes`);
  if (openRequests.length) add(`Review my ${plural(openRequests.length, 'open feature request')} and suggest what to build next`);
  if (notes.length) add(`Turn my notes in ${wsName} into a short action list`);
  if (sections.length) add(`Review ${wsName} and suggest a cleaner layout`);
  if (triggers.length) add('Summarize my trigger history and anything due soon');
  if (games.length) add('Summarize what you remember from my game cards');

  const cardCount = sections.length + notes.length + scrapers.length + triggers.length + games.length;
  if (cardCount) add(`Find anything stale, duplicated, or misplaced in ${wsName}`);

  add(`Set up a useful starter layout for ${wsName}`);
  add('Add a scraper for a page I care about and show the extracted rows');
  add('Create a note with the next three things I should do');
  return suggestions.slice(0, MAX_SUGGESTIONS);
}
