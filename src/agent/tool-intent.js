// A tiny post-turn reviewer: ask a small local model whether the assistant turn
// was trying to use the dashboard tool surface.
import { config } from '../config.js';
import { AGENT_LIMITS } from '../constants.js';
import { toolNames } from './tools.js';

const truncate = (s, n) => {
  const text = String(s ?? '').replace(/\s+/g, ' ').trim();
  return text.length > n ? `${text.slice(0, n)}...` : text;
};

function traceSummary(trace = []) {
  if (!trace.length) return 'none';
  const lines = trace.map((e) => {
    const args = truncate(JSON.stringify(e.args || {}), AGENT_LIMITS.reviewPreviewChars);
    return `${e.ok ? 'ok' : 'failed'} ${e.name}(${args})`;
  });
  return truncate(lines.join('\n'), AGENT_LIMITS.toolIntentTraceChars);
}

function classifierSystem() {
  return `You are a strict classifier for a local dashboard copilot.

Decide whether the assistant turn intended to use a dashboard tool.
Dashboard tools are: ${toolNames.join(', ')}.

Return only JSON:
{"intended":true|false,"confidence":0..1,"tool":"tool_name or null","reason":"short reason"}

Use intended=true if completed tool calls are present, or if the assistant reply says it will do, did, needs to inspect, or prints a dashboard action that should be one of those tool calls.
Use intended=false for ordinary conversation, refusals, out-of-scope answers, or clarifying questions that do not claim/action a dashboard change.`;
}

function classifierUser({ userText, reply, trace }) {
  return `User request:
${truncate(userText, AGENT_LIMITS.toolIntentInputChars)}

Completed tool calls:
${traceSummary(trace)}

Assistant reply:
${truncate(reply, AGENT_LIMITS.toolIntentInputChars)}

Did this assistant turn intend to use a dashboard tool?`;
}

function extractJson(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch { /* try object slice below */ }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function coerceBool(v, raw) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (/^(true|yes|y)$/i.test(v.trim())) return true;
    if (/^(false|no|n)$/i.test(v.trim())) return false;
  }
  const head = String(raw || '').trim().split(/\s+/)[0] || '';
  if (/^(true|yes)$/i.test(head)) return true;
  if (/^(false|no)$/i.test(head)) return false;
  return null;
}

function coerceConfidence(v, intended) {
  const n = Number(v);
  if (Number.isFinite(n)) return Math.min(Math.max(n, 0), 1);
  return intended == null ? 0 : 0.5;
}

function coerceTool(v) {
  const name = typeof v === 'string' ? v.trim() : '';
  return toolNames.includes(name) ? name : null;
}

export function parseToolIntentResponse(text, { reviewer, ms } = {}) {
  const data = extractJson(text) || {};
  const intended = coerceBool(data.intended ?? data.tool_intent ?? data.answer, text);
  const reason = truncate(data.reason || (intended == null ? 'Could not parse reviewer response' : ''), AGENT_LIMITS.reviewPreviewChars);
  return {
    reviewed: true,
    reviewer,
    intended,
    confidence: coerceConfidence(data.confidence, intended),
    tool: coerceTool(data.tool),
    reason,
    raw: truncate(text, AGENT_LIMITS.reviewPreviewChars),
    ms,
  };
}

export async function reviewToolIntent({
  ollama,
  userText,
  reply,
  trace = [],
  model = config.toolIntentModel,
  timeoutMs = config.toolIntentTimeoutMs,
}) {
  if (!model) return null;
  const started = Date.now();
  try {
    const msg = await ollama.chat({
      model,
      messages: [
        { role: 'system', content: classifierSystem() },
        { role: 'user', content: classifierUser({ userText, reply, trace }) },
      ],
      format: 'json',
      options: { temperature: 0 },
      timeoutMs,
    });
    return parseToolIntentResponse(msg.content || '', { reviewer: model, ms: Date.now() - started });
  } catch (err) {
    return {
      reviewed: false,
      reviewer: model,
      intended: null,
      confidence: 0,
      tool: null,
      reason: 'review failed',
      error: err.message,
      ms: Date.now() - started,
    };
  }
}
