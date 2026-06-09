import { fail } from './schema.js';

const CHAT_ROLES = new Set(['user', 'assistant']);

export function sanitizeChatMessages(messages, { maxMessages = 40, maxContent = 8000 } = {}) {
  if (!Array.isArray(messages)) fail('messages[] is required');
  const clean = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
    if (!CHAT_ROLES.has(msg.role) || typeof msg.content !== 'string') continue;
    const content = msg.content.trim();
    if (!content) continue;
    clean.push({ role: msg.role, content: content.slice(0, maxContent) });
  }
  return clean.slice(-maxMessages);
}

export function latestUserMessage(messages) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content || '';
}
