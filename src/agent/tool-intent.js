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
  return `You are a strict binary classifier for a local dashboard copilot.

Question: did this assistant turn intend to use a dashboard tool?
Dashboard tools are: ${toolNames.join(', ')}.

Return only JSON:
{"intended":true|false,"confidence":0..1,"tool":"tool_name or null","reason":"short reason"}

Classify intended=true when:
- any tool call appears in the trace, including failed, blocked, or unknown-tool calls,
- the assistant says it did, will, is going to, needs to inspect/search/read, or is about to perform a dashboard action,
- the assistant asks the user to choose among options that should be clickable via offer_choices.

Classify intended=false when:
- it is ordinary information, refusal, or out-of-scope conversation,
- it asks a clarifying question before acting,
- it gives advice, recommendations, or hypothetical possibilities using words like could/should/might without claiming it will perform an action.

Examples:
- Trace includes "failed rename_section(...)" -> intended=true.
- Reply says "I need to inspect the dashboard first" -> intended=true, tool=get_dashboard or search_dashboard.
- Reply says "You could group those apps into a Media section" -> intended=false.

If tool calls are in the trace, intended must be true.`;
}

function classifierUser({ userText, reply, trace }) {
  return `User request:
${truncate(userText, AGENT_LIMITS.toolIntentInputChars)}

Tool-call trace:
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

function matchField(raw, name) {
  const m = String(raw || '').match(new RegExp(`["']?${name}["']?\\s*:\\s*("([^"]*)"|true|false|null|-?\\d+(?:\\.\\d+)?)`, 'i'));
  if (!m) return undefined;
  if (m[2] !== undefined) return m[2];
  if (/^true$/i.test(m[1])) return true;
  if (/^false$/i.test(m[1])) return false;
  if (/^null$/i.test(m[1])) return null;
  return m[1];
}

function extractFields(text) {
  const raw = String(text || '');
  const confidence = matchField(raw, 'confidence') ?? raw.match(/confidence[^0-9-]*(-?\d+(?:\.\d+)?)/i)?.[1];
  return {
    intended: matchField(raw, 'intended'),
    tool_intent: matchField(raw, 'tool_intent'),
    answer: matchField(raw, 'answer'),
    confidence,
    tool: matchField(raw, 'tool') ?? toolNames.find((name) => raw.includes(`"${name}"`)),
    reason: matchField(raw, 'reason'),
  };
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
  const data = { ...extractFields(text), ...(extractJson(text) || {}) };
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
