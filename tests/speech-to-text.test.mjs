import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { forwardTranscription } from '../src/speech-to-text.js';

function req(headers = {}) {
  const stream = Readable.from(['audio']);
  stream.headers = headers;
  return stream;
}

test('speech proxy refuses to run without a server-side token', async () => {
  const out = await forwardTranscription(req({ 'content-type': 'multipart/form-data; boundary=x' }), {
    baseUrl: 'https://speech-to-text.huis',
    token: '',
  });
  assert.equal(out.status, 503);
  assert.match(out.body.error, /not configured/);
});

test('speech proxy forwards multipart uploads with bearer auth', async () => {
  let seen;
  const out = await forwardTranscription(req({ 'content-type': 'multipart/form-data; boundary=x', 'content-length': '123' }), {
    baseUrl: 'https://speech-to-text.huis/',
    token: 'secret-token',
    fetchImpl: async (url, opts) => {
      seen = { url, opts };
      return new Response(JSON.stringify({
        text: 'hello dashboard',
        model: 'gpt-4o-transcribe',
        provider: 'openai',
        duration_ms: 10,
        request_id: 'req_test',
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  assert.equal(out.status, 200);
  assert.equal(out.body.text, 'hello dashboard');
  assert.equal(seen.url, 'https://speech-to-text.huis/v1/transcriptions');
  assert.equal(seen.opts.headers.authorization, 'Bearer secret-token');
  assert.equal(seen.opts.headers['content-type'], 'multipart/form-data; boundary=x');
  assert.equal(seen.opts.duplex, 'half');
});

test('speech proxy normalizes upstream errors for the chat UI', async () => {
  const out = await forwardTranscription(req({ 'content-type': 'multipart/form-data; boundary=x' }), {
    baseUrl: 'https://speech-to-text.huis',
    token: 'secret-token',
    fetchImpl: async () => new Response(JSON.stringify({
      error: { code: 'unsupported_media', message: 'Unsupported audio type.', request_id: 'req_bad' },
    }), { status: 415, headers: { 'content-type': 'application/json' } }),
  });

  assert.equal(out.status, 415);
  assert.equal(out.body.code, 'unsupported_media');
  assert.equal(out.body.request_id, 'req_bad');
  assert.match(out.body.error, /Unsupported audio type/);
  assert.match(out.body.error, /req_bad/);
});
