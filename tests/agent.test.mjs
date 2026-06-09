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
