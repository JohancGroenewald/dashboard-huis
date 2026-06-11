import { config } from './config.js';
import { fail } from './schema.js';
import { CHAT_MESSAGE_LIMITS } from './constants.js';

const CHAT_ROLES = new Set(['user', 'assistant']);

// Base64 images may ride on user messages (vision models); bounded and
// stripped of any data-URL prefix the client forgot to remove.
function sanitizeImages(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((s) => typeof s === 'string' && s.length > 0 && s.length <= CHAT_MESSAGE_LIMITS.maxImageChars)
    .map((s) => s.replace(/^data:[^,]*,/, ''))
    .slice(0, CHAT_MESSAGE_LIMITS.maxImagesPerMessage);
}

export function sanitizeChatMessages(
  messages,
  { maxMessages = config.chatMaxMessages, maxContent = config.chatMaxContentChars } = {}
) {
  if (!Array.isArray(messages)) fail('messages[] is required');
  const clean = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
    if (!CHAT_ROLES.has(msg.role) || typeof msg.content !== 'string') continue;
    const content = msg.content.trim();
    const images = msg.role === 'user' ? sanitizeImages(msg.images) : [];
    if (!content && !images.length) continue;
    clean.push({ role: msg.role, content: content.slice(0, maxContent), ...(images.length ? { images } : {}) });
  }
  return clean.slice(-maxMessages);
}

export function latestUserMessage(messages) {
  return [...messages].reverse().find((m) => m.role === 'user')?.content || '';
}
