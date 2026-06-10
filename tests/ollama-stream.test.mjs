import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { Ollama } from '../src/ollama.js';

// Serve canned NDJSON chunks the way Ollama streams them, then check that
// chatStream reassembles the message and forwards tokens.
function ndjsonServer(chunks) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    let i = 0;
    const t = setInterval(() => {
      if (i < chunks.length) res.write(`${JSON.stringify(chunks[i++])}\n`);
      else { clearInterval(t); res.end(); }
    }, 2);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('chatStream assembles streamed content and split tool_calls', async () => {
  const server = await ndjsonServer([
    { message: { role: 'assistant', content: 'Hel' } },
    { message: { content: 'lo' } },
    { message: { content: '', tool_calls: [{ function: { name: 'a', arguments: {} } }] } },
    { message: { content: '', tool_calls: [{ function: { name: 'b', arguments: '{"x":1}' } }] }, done: true },
  ]);
  try {
    const ollama = new Ollama(`http://127.0.0.1:${server.address().port}`);
    const tokens = [];
    const msg = await ollama.chatStream({ model: 'm', messages: [], onToken: (t) => tokens.push(t) });
    assert.equal(msg.content, 'Hello');
    assert.deepEqual(tokens, ['Hel', 'lo']);
    assert.equal(msg.tool_calls.length, 2);
    assert.equal(msg.tool_calls[1].function.name, 'b');
  } finally {
    server.close();
  }
});

test('chatStream surfaces HTTP errors with the body preview', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end('model exploded');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const ollama = new Ollama(`http://127.0.0.1:${server.address().port}`);
    await assert.rejects(() => ollama.chatStream({ model: 'm', messages: [] }), /500 model exploded/);
  } finally {
    server.close();
  }
});
