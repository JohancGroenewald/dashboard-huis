import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Point the overrides file at scratch before the module loads (the data dir
// itself has no override; this mirrors the DASH_CHATLOG_DB pattern).
process.env.DASH_PROMPTS_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prompts-test-')), 'prompts.json');
const { listPrompts, setPromptOverride, renderPrompt, getPromptTemplate } = await import('../src/prompts.js');

test('prompts list defaults with placeholders intact', () => {
  const all = listPrompts();
  const agent = all.find((p) => p.id === 'agent');
  assert.ok(agent.isDefault);
  assert.ok(agent.template.includes('{{SNAPSHOT}}'));
  assert.ok(all.find((p) => p.id === 'tool-intent').template.includes('{{TOOLS}}'));
});

test('renderPrompt fills known placeholders and leaves unknown ones', () => {
  setPromptOverride('agent', 'Board "{{TITLE}}" has {{SNAPSHOT}} and {{MYSTERY}}');
  const out = renderPrompt('agent', { title: 'Huis', snapshot: 'two sections' });
  assert.equal(out, 'Board "Huis" has two sections and {{MYSTERY}}');
});

test('override persists, and saving default text resets it', () => {
  const r = setPromptOverride('tool-intent', 'Classify: {{TOOLS}}');
  assert.equal(r.isDefault, false);
  assert.equal(getPromptTemplate('tool-intent'), 'Classify: {{TOOLS}}');
  const back = setPromptOverride('tool-intent', '');
  assert.equal(back.isDefault, true);
  assert.ok(back.template.includes('strict binary classifier'));
});

test('unknown prompt ids and oversized templates are rejected', () => {
  assert.throws(() => setPromptOverride('nope', 'x'), /unknown prompt/);
  assert.throws(() => setPromptOverride('agent', 'x'.repeat(20_001)), /longer/);
});
