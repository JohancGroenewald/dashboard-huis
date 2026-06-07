// Thin Ollama API client. Uses Node's global fetch.
import { config } from './config.js';

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

  // Preload a model into memory (cold loads of large models can take minutes).
  // Empty messages make Ollama load weights and return without generating.
  // Pass options (e.g. num_ctx) to size the context/KV-cache at load time.
  async load(model, { timeoutMs = 300_000, options } = {}) {
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
        body: JSON.stringify({ model, keep_alive: 0 }),
      });
    } catch { /* best effort */ }
  }

  // Non-streaming chat. Pass `tools` to enable tool-calling (model permitting).
  // Returns the assistant message: { role, content, tool_calls? }.
  async chat({ model, messages, tools, options, timeoutMs = 180_000 }) {
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
          stream: false,
          options: { temperature: 0, ...options },
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`ollama /api/chat → ${res.status} ${body.slice(0, 300)}`);
      }
      const data = await res.json();
      return data.message ?? { role: 'assistant', content: '' };
    } finally {
      clearTimeout(t);
    }
  }
}
