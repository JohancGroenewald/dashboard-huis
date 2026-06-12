import assert from 'node:assert/strict';
import test from 'node:test';
import { parseToolIntentResponse, reviewToolIntent } from '../src/agent/tool-intent.js';

test('tool-intent parser accepts strict JSON', () => {
  const out = parseToolIntentResponse('{"intended":true,"confidence":0.91,"tool":"add_tile","reason":"claimed it added a tile"}', {
    reviewer: 'small',
    ms: 12,
  });

  assert.equal(out.reviewed, true);
  assert.equal(out.reviewer, 'small');
  assert.equal(out.intended, true);
  assert.equal(out.confidence, 0.91);
  assert.equal(out.tool, 'add_tile');
  assert.equal(out.ms, 12);
});

test('tool-intent parser falls back to yes/no text', () => {
  assert.equal(parseToolIntentResponse('YES', {}).intended, true);
  assert.equal(parseToolIntentResponse('no', {}).intended, false);
  assert.equal(parseToolIntentResponse('maybe', {}).intended, null);
});

test('tool-intent reviewer asks the configured small model for JSON', async () => {
  let seen;
  const ollama = {
    async chat(req) {
      seen = req;
      return { role: 'assistant', content: '{"intended":false,"confidence":0.8,"tool":null,"reason":"plain answer"}' };
    },
  };

  const out = await reviewToolIntent({
    ollama,
    userText: 'what is grafana?',
    reply: 'Grafana is an observability dashboard.',
    trace: [],
    model: 'small-model',
    timeoutMs: 1234,
  });

  assert.equal(seen.model, 'small-model');
  assert.equal(seen.format, 'json');
  assert.equal(seen.timeoutMs, 1234);
  assert.equal(seen.tools, undefined);
  assert.equal(out.intended, false);
});

test('tool-intent reviewer can be disabled and fails open', async () => {
  const disabled = await reviewToolIntent({ ollama: {}, userText: '', reply: '', model: '' });
  assert.equal(disabled, null);

  const failed = await reviewToolIntent({
    ollama: { async chat() { throw new Error('missing model'); } },
    userText: '',
    reply: '',
    model: 'small-model',
  });
  assert.equal(failed.reviewed, false);
  assert.equal(failed.intended, null);
  assert.match(failed.error, /missing model/);
});
