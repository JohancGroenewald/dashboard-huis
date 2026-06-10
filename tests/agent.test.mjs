import assert from 'node:assert/strict';
import test from 'node:test';
import { runAgent } from '../src/agent/agent.js';
import { Store } from '../src/store.js';

function toolCall(name, args = {}) {
  return { function: { name, arguments: args } };
}

test('agent stops after the configured number of tool calls', async () => {
  const store = new Store({ persist: false }).load();
  const ollama = {
    async chat() {
      return { role: 'assistant', content: '', tool_calls: [toolCall('get_dashboard')] };
    },
  };

  const result = await runAgent({
    model: 'test-model',
    store,
    messages: [{ role: 'user', content: 'keep using tools' }],
    ollama,
    maxToolCalls: 2,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.toolCalls, 2);
  assert.equal(result.trace.length, 2);
  assert.match(result.reply, /maximum number of tool calls/);
});

test('agent accepts legacy maxSteps as a tool-call limit', async () => {
  const store = new Store({ persist: false }).load();
  const ollama = {
    async chat() {
      return { role: 'assistant', content: '', tool_calls: [toolCall('get_dashboard')] };
    },
  };

  const result = await runAgent({
    model: 'test-model',
    store,
    messages: [{ role: 'user', content: 'keep using tools' }],
    ollama,
    maxSteps: 1,
  });

  assert.equal(result.toolCalls, 1);
  assert.equal(result.trace.length, 1);
});

test('onEvent streams deltas and tool lifecycle without changing the result', async () => {
  const store = new Store({ persist: false }).load();
  // Fake streaming backend: first round calls a tool, second round answers.
  let round = 0;
  const ollama = {
    async chatStream({ onToken }) {
      round += 1;
      if (round === 1) {
        return { role: 'assistant', content: '', tool_calls: [toolCall('add_section', { name: 'From stream' })] };
      }
      for (const t of ['All ', 'done.']) onToken(t);
      return { role: 'assistant', content: 'All done.' };
    },
    async chat() { throw new Error('non-streaming path must not be used when onEvent is set'); },
  };

  const events = [];
  const result = await runAgent({
    model: 'test-model',
    store,
    messages: [{ role: 'user', content: 'add a section' }],
    ollama,
    onEvent: (e) => events.push(e),
  });

  assert.equal(result.reply, 'All done.');
  assert.equal(result.trace.length, 1);
  assert.equal(result.trace[0].ok, true);
  assert.deepEqual(events.filter((e) => e.type === 'delta').map((e) => e.text), ['All ', 'done.']);
  const start = events.find((e) => e.type === 'tool-start');
  const done = events.find((e) => e.type === 'tool-result');
  assert.equal(start.name, 'add_section');
  assert.equal(done.ok, true);
  assert.equal(done.result.added.name, 'From stream');
  assert.equal(store.getState().sections.some((s) => s.name === 'From stream'), true);
});
