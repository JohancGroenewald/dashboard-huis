import test from 'node:test';
import assert from 'node:assert/strict';
import { introSuggestions } from '../public/js/dock/suggestions.js';

test('intro suggestions prefer scraper work when scraper rows exist', () => {
  const out = introSuggestions({
    workspaces: [{ id: 'w1', name: 'Models' }],
    activeWorkspaceId: 'w1',
    sections: [],
    notes: [],
    scrapers: [{ id: 'sc1', workspaceId: 'w1', name: 'Ollama models', result: { rowCount: 20 } }],
  });

  assert.deepEqual(out, [
    'Summarize the latest rows from Ollama models',
    'Run Ollama models and summarize what changed',
    'Find anything stale, duplicated, or misplaced in Models',
  ]);
});

test('intro suggestions include active queue and workspace cleanup prompts', () => {
  const out = introSuggestions({
    workspaces: [{ id: 'w1', name: 'Home Ops' }],
    activeWorkspaceId: 'w1',
    sections: [{ id: 's1', workspaceId: 'w1', name: 'Infra' }],
    notes: [{ id: 'n1', workspaceId: 'w1', text: 'Pay rates' }],
    scrapers: [],
    triggers: [],
    featureRequests: [{ id: 'fr1', status: 'planned', title: 'Voice' }],
    problems: [{ id: 'p1', status: 'open', title: 'Rows missing' }],
  });

  assert.deepEqual(out, [
    'Review my 1 open problem and suggest next fixes',
    'Review my 1 open feature request and suggest what to build next',
    'Turn my notes in Home Ops into a short action list',
  ]);
});

test('intro suggestions fall back to useful starters for an empty workspace', () => {
  const out = introSuggestions({
    workspaces: [{ id: 'w1', name: 'Empty' }],
    activeWorkspaceId: 'w1',
  });

  assert.deepEqual(out, [
    'Set up a useful starter layout for Empty',
    'Add a scraper for a page I care about and show the extracted rows',
    'Create a note with the next three things I should do',
  ]);
});
