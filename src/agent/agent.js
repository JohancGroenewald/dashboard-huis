// The agent loop: drive a model through tool calls until it produces a final
// answer. Returns the final text plus a full trace (every tool call + result),
// which the UI shows and the validation harness scores.
import { Ollama } from '../ollama.js';
import { resolveToolCallLimit } from './limits.js';
import { systemPrompt } from './prompt.js';
import { toolSpecs, makeToolHandlers } from './tools.js';

// Ollama returns tool_calls[].function.arguments as an object, but some models
// emit a JSON string — accept both.
function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: String(raw) };
  }
}

export async function runAgent({ model, store, messages, ollama = new Ollama(), maxToolCalls, maxSteps, options }) {
  const handlers = makeToolHandlers(store, { requestedBy: model });
  const convo = [{ role: 'system', content: systemPrompt(store) }, ...messages];
  const trace = []; // { name, args, ok, result|error }
  const limit = resolveToolCallLimit(maxToolCalls, maxSteps);
  let steps = 0;
  let toolCalls = 0;

  while (toolCalls < limit) {
    const msg = await ollama.chat({ model, messages: convo, tools: toolSpecs, options });
    convo.push(msg);
    steps += 1;

    const calls = msg.tool_calls || [];
    if (calls.length === 0) {
      return { reply: msg.content || '', trace, steps, toolCalls, convo };
    }

    for (const call of calls) {
      if (toolCalls >= limit) {
        return {
          reply: '(stopped: reached the maximum number of tool calls)',
          trace,
          steps,
          toolCalls,
          convo,
          truncated: true,
        };
      }
      const name = call.function?.name;
      const args = parseArgs(call.function?.arguments);
      const handler = handlers[name];
      let entry;
      if (!handler) {
        entry = { name, args, ok: false, error: `unknown tool: ${name}` };
      } else {
        try {
          entry = { name, args, ok: true, result: await handler(args) };
        } catch (err) {
          entry = { name, args, ok: false, error: err.message };
        }
      }
      trace.push(entry);
      toolCalls += 1;
      convo.push({
        role: 'tool',
        // Ollama matches tool replies by name; include it explicitly.
        tool_name: name,
        content: JSON.stringify(entry.ok ? entry.result : { error: entry.error }),
      });
    }
  }

  return {
    reply: '(stopped: reached the maximum number of tool calls)',
    trace,
    steps,
    toolCalls,
    convo,
    truncated: true,
  };
}
