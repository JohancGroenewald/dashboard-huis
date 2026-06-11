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
        return { role: 'assistant', thinking: 'needs a section', content: 'Adding it now.', tool_calls: [toolCall('add_section', { name: 'From stream' })] };
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
  // Each round's reasoning is preserved for the replay view.
  assert.deepEqual(result.rounds, [
    { thinking: 'needs a section', content: 'Adding it now.', calls: 1 },
    { thinking: '', content: 'All done.', calls: 0 },
  ]);
  assert.deepEqual(events.filter((e) => e.type === 'delta').map((e) => e.text), ['All ', 'done.']);
  const start = events.find((e) => e.type === 'tool-start');
  const done = events.find((e) => e.type === 'tool-result');
  assert.equal(start.name, 'add_section');
  assert.equal(done.ok, true);
  assert.equal(done.result.added.name, 'From stream');
  assert.equal(store.getState().sections.some((s) => s.name === 'From stream'), true);
});

test('runTool wraps tool handler execution', async () => {
  const store = new Store({ persist: false }).load();
  let round = 0;
  const ollama = {
    async chatStream() {
      round += 1;
      if (round === 1) return { role: 'assistant', content: '', tool_calls: [toolCall('add_section', { name: 'Wrapped' })] };
      return { role: 'assistant', content: 'Done.' };
    },
  };
  const seen = [];

  const result = await runAgent({
    model: 'test-model',
    store,
    messages: [{ role: 'user', content: 'add a section' }],
    ollama,
    onEvent: () => {},
    runTool: async (fn, call) => {
      seen.push(`before:${call.name}`);
      const value = await fn();
      seen.push(`after:${call.name}`);
      return value;
    },
  });

  assert.equal(result.trace[0].result.added.name, 'Wrapped');
  assert.deepEqual(seen, ['before:add_section', 'after:add_section']);
});
