// Thin Ollama API client. Uses Node's global fetch.
import { config } from './config.js';
import { OLLAMA_LIMITS } from './constants.js';

export class Ollama {
  constructor(host = config.ollamaHost) {
    this.host = host.replace(/\/$/, '');
  }

  async version() {
    const res = await fetch(`${this.host}/api/version`);
    if (!res.ok) throw new Error(`ollama /api/version → ${res.status}`);
    return res.json();
  }

  async listModels() {
    const res = await fetch(`${this.host}/api/tags`);
    if (!res.ok) throw new Error(`ollama /api/tags → ${res.status}`);
    const data = await res.json();
    return (data.models || []).map((m) => m.name).sort();
  }

  // Model metadata; capabilities lists e.g. 'completion', 'vision', 'tools'.
  async show(model) {
    const res = await fetch(`${this.host}/api/show`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    if (!res.ok) throw new Error(`ollama /api/show ${model} → ${res.status}`);
    return res.json();
  }

  // Preload a model into memory (cold loads of large models can take minutes).
  // Empty messages make Ollama load weights and return without generating.
  // Pass options (e.g. num_ctx) to size the context/KV-cache at load time.
  async load(model, { timeoutMs = config.ollamaLoadTimeoutMs, options } = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({ model, messages: [], stream: false, options }),
      });
      if (!res.ok) throw new Error(`ollama load ${model} → ${res.status}`);
      return res.json();
    } finally {
      clearTimeout(t);
    }
  }

  // Evict a model from memory (keep_alive: 0) to free VRAM for the next one.
  async unload(model) {
    try {
      await fetch(`${this.host}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: OLLAMA_LIMITS.unloadKeepAlive }),
      });
    } catch { /* best effort */ }
  }

  // Streaming chat: same request as chat() but with stream:true, reading the
  // NDJSON chunks as they arrive. onToken receives each content fragment; the
  // assembled message (same shape as chat()) is returned at the end. Models
  // differ in whether tool_calls arrive whole or split across chunks, so they
  // are collected from every chunk. The timeout is per-chunk (idle), not for
  // the whole call — long answers are fine as long as tokens keep flowing.
  async chatStream({ model, messages, tools, options, onToken, idleTimeoutMs = config.ollamaChatTimeoutMs }) {
    const ctrl = new AbortController();
    let timer = setTimeout(() => ctrl.abort(), idleTimeoutMs);
    const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), idleTimeoutMs); };
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages,
          tools,
          stream: true,
          options: { temperature: OLLAMA_LIMITS.defaultTemperature, ...options },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ollama /api/chat → ${res.status} ${body.slice(0, OLLAMA_LIMITS.errorBodyPreviewChars)}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let content = '';
      let thinking = '';
      let role = 'assistant';
      const toolCalls = [];
      const handleLine = (line) => {
        if (!line) return;
        let chunk;
        try { chunk = JSON.parse(line); } catch { return; }
        const m = chunk.message;
        if (m?.role) role = m.role;
        if (m?.content) { content += m.content; onToken?.(m.content); }
        if (m?.thinking) thinking += m.thinking;
        if (Array.isArray(m?.tool_calls)) toolCalls.push(...m.tool_calls);
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        resetIdle();
        buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          handleLine(buf.slice(0, nl).trim());
          buf = buf.slice(nl + 1);
        }
      }
      handleLine(buf.trim());
      return { role, content, ...(thinking ? { thinking } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
    } finally {
      clearTimeout(timer);
    }
  }

  // Non-streaming chat. Pass `tools` to enable tool-calling (model permitting).
  // Returns the assistant message: { role, content, tool_calls? }.
  async chat({ model, messages, tools, options, format, timeoutMs = config.ollamaChatTimeoutMs }) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${this.host}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages,
          tools,
          format,
          stream: false,
          options: { temperature: OLLAMA_LIMITS.defaultTemperature, ...options },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ollama /api/chat → ${res.status} ${body.slice(0, OLLAMA_LIMITS.errorBodyPreviewChars)}`);
      }
      const data = await res.json();
      return data.message ?? { role: 'assistant', content: '' };
    } finally {
      clearTimeout(t);
    }
  }
}
