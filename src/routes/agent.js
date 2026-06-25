// Agent endpoints. /api/agent/chat answers whole (kept for scripts and as a
// fallback); /api/agent/stream answers as SSE frames in the response body —
// meta → delta*/step/result* → done|error — while ambient activity goes out
// on the shared /api/events channel so every open browser can pulse the
// affected cards.
import { AGENT_LIMITS, HTTP_STATUS } from '../constants.js';
import { runAgent } from '../agent/agent.js';
import { sseFrame } from '../events.js';
import { logTurn } from '../chatlog.js';
import { latestUserMessage, sanitizeChatMessages } from '../messages.js';
import { isApproved } from '../validation/registry.js';

const MUTATING = new Set([
  'add_tile', 'add_section', 'add_note', 'update_tile', 'update_note', 'rename_section', 'update_section',
  'remove_tile', 'remove_section', 'remove_note', 'move_tile', 'move_section', 'resize_card',
  'add_trigger', 'press_trigger', 'stop_trigger', 'remove_trigger',
  'add_workspace', 'rename_workspace', 'set_workspace_background', 'remove_workspace', 'switch_workspace', 'move_to_workspace',
  'undo', 'redo',
]);

// Derive contextual follow-up chips from what the agent just did. Prefers the
// model's own suggest_followups; otherwise maps the last action to next steps.
export function followupsFromTrace(trace = []) {
  const sf = [...trace].reverse().find((t) => t.ok && t.name === 'suggest_followups');
  if (sf) return (sf.result?.suggestions || sf.args?.suggestions || []).slice(0, AGENT_LIMITS.followupsMax);
  const last = [...trace].reverse().find((t) => t.ok && MUTATING.has(t.name));
  switch (last?.name) {
    case 'add_tile': return ['Add another tile', 'Resize the section', 'Add a note'];
    case 'add_section': return ['Add a tile to it', 'Rename the section', 'Add another section'];
    case 'add_note': return ['Change its colour', 'Make it bigger', 'Add another note'];
    case 'resize_card': return ['Make it bigger', 'Make it smaller', 'Move it'];
    case 'undo': return ['Redo that', 'Make another change'];
    case 'redo': return ['Undo that', 'Make another change'];
    case 'add_workspace': return ['Switch to it', 'Add a section to it', 'Rename it'];
    case 'switch_workspace': return ['Add a section', 'Add a tile', 'Add a note'];
    case 'move_to_workspace': return ['Switch to that workspace', 'Move another', 'Undo that'];
    case 'press_trigger':
    case 'stop_trigger': return ['Undo that', 'Show triggers'];
    case 'rename_workspace': return ['Switch to it', 'Undo that'];
    case 'set_workspace_background': return ['Try a calmer background', 'Clear the background', 'Undo that'];
    case 'remove_workspace':
    case 'remove_trigger':
    case 'remove_tile':
    case 'remove_section':
    case 'remove_note': return ['Undo that', 'Add something new'];
    case 'update_section': return ['Change its colours', 'Edit the description', 'Undo that'];
    case 'update_tile':
    case 'update_note':
    case 'rename_section': return ['Undo that', 'Edit another'];
    case 'move_tile':
    case 'move_section': return ['Move another', 'Undo that'];
    default: return ['Add a tile', 'Add a note'];
  }
}

// Ids a tool call touches, for board pulses. Args may hold names instead of
// ids (the client just won't match those); results carry canonical objects.
const ID_ARG_KEYS = ['tile_id', 'note_id', 'trigger_id', 'card', 'section', 'item', 'workspace'];
function idsFromCall(args = {}, result) {
  const ids = new Set();
  for (const k of ID_ARG_KEYS) if (typeof args[k] === 'string') ids.add(args[k]);
  if (result && typeof result === 'object') {
    for (const v of Object.values(result)) {
      if (v && typeof v === 'object' && typeof v.id === 'string') ids.add(v.id);
    }
  }
  return [...ids];
}

// One-line step description for the dock's timeline.
function stepSummary(entry) {
  if (!entry.ok) return entry.error || 'failed';
  const r = entry.result || {};
  const obj = r.added || r.updated || r.removed || r.moved || r.filed || r.activeWorkspace;
  const label = obj?.name || obj?.title || (obj?.text ? String(obj.text).slice(0, AGENT_LIMITS.reviewPreviewChars) : '');
  return label ? `"${label}"` : '';
}

// Shared request validation; replies with the error itself when invalid.
function chatRequest(req, res) {
  const { model, messages, session } = req.body || {};
  if (!model) { res.status(HTTP_STATUS.badRequest).json({ error: 'model is required' }); return null; }
  if (!Array.isArray(messages) || !messages.length) {
    res.status(HTTP_STATUS.badRequest).json({ error: 'messages[] is required' });
    return null;
  }
  const safeMessages = sanitizeChatMessages(messages);
  const userMsg = latestUserMessage(safeMessages);
  if (!userMsg) {
    res.status(HTTP_STATUS.badRequest).json({ error: 'messages[] must include at least one user message' });
    return null;
  }
  if (!isApproved(model)) {
    res.status(HTTP_STATUS.forbidden).json({
      error: `"${model}" has not passed pre-validation. Run: npm run validate -- "${model}"`,
    });
    return null;
  }
  // For the chatlog: megabytes of base64 become an image count.
  const logMessages = safeMessages.map((m) => (m.images ? { ...m, images: m.images.length } : m));
  return { model, safeMessages, logMessages, session, userMsg };
}

export function mountAgentRoutes(app, { store, ollama, events, wrap, scraperResults = null }) {
  // Agent tool calls should update every open tab, including the tab that asked
  // for the run. The chat UI does not locally apply tool results, so tagging
  // these broadcasts as a same-tab echo would make the requester wait until the
  // final catch-up fetch.
  const broadcastAgentMutation = (fn) => {
    events.lastClientId = null;
    return fn();
  };

  // Whole-reply chat (legacy UI, curl, and the stream fallback path).
  app.post('/api/agent/chat', wrap(async (req, res) => {
    const r = chatRequest(req, res);
    if (!r) return;
    const started = Date.now();
    try {
      const result = await runAgent({ model: r.model, store, messages: r.safeMessages, ollama, runTool: broadcastAgentMutation, scraperResults });
      logTurn({ session: r.session, model: r.model, userMsg: r.userMsg, messages: r.logMessages, reply: result.reply, trace: result.trace, rounds: result.rounds, steps: result.steps, ms: Date.now() - started });
      res.json({
        reply: result.reply,
        trace: result.trace,
        steps: result.steps,
        toolCalls: result.toolCalls ?? result.trace.length,
        followups: followupsFromTrace(result.trace),
        dashboard: store.getState(), // so the UI can refresh after agent edits
      });
    } catch (err) {
      logTurn({ session: r.session, model: r.model, userMsg: r.userMsg, messages: r.logMessages, ms: Date.now() - started, error: err.message });
      throw err;
    }
  }));

  // Streaming chat: SSE frames in the response body. If the client drops the
  // connection mid-run the run still finishes (writes just go nowhere) and is
  // logged — the board channel keeps every UI truthful.
  app.post('/api/agent/stream', wrap(async (req, res) => {
    const r = chatRequest(req, res);
    if (!r) return;
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (event, data) => res.write(sseFrame(event, data));
    const activity = (payload) => events.broadcastAgentActivity({ session: r.session, model: r.model, ...payload });

    const started = Date.now();
    const revBefore = store.rev;
    send('meta', { session: r.session, model: r.model, revBefore });
    activity({ phase: 'start' });
    try {
      const result = await runAgent({
        model: r.model,
        store,
        messages: r.safeMessages,
        ollama,
        runTool: broadcastAgentMutation,
        scraperResults,
        onEvent: (ev) => {
          if (ev.type === 'delta') send('delta', { text: ev.text });
          else if (ev.type === 'tool-start') {
            const ids = idsFromCall(ev.args);
            send('step', { i: ev.i, name: ev.name, ids });
            activity({ phase: 'tool-start', name: ev.name, ids });
          } else if (ev.type === 'tool-result') {
            const ids = idsFromCall(ev.args, ev.result);
            send('result', { i: ev.i, ok: ev.ok, summary: stepSummary(ev), error: ev.error, ids });
            activity({ phase: 'tool-result', name: ev.name, ok: ev.ok, ids });
          }
        },
      });
      logTurn({ session: r.session, model: r.model, userMsg: r.userMsg, messages: r.logMessages, reply: result.reply, trace: result.trace, rounds: result.rounds, steps: result.steps, ms: Date.now() - started });
      const mutated = result.trace.some((t) => t.ok && MUTATING.has(t.name));
      const usedHistory = result.trace.some((t) => t.ok && (t.name === 'undo' || t.name === 'redo'));
      send('done', {
        reply: result.reply,
        trace: result.trace,
        steps: result.steps,
        toolCalls: result.toolCalls ?? result.trace.length,
        followups: followupsFromTrace(result.trace),
        revBefore,
        revAfter: store.rev,
        // Revert-run is only offered when counting back is sound: something
        // mutated and the run didn't itself undo/redo (which skews the count).
        canRevert: mutated && !usedHistory && store.rev > revBefore,
      });
    } catch (err) {
      logTurn({ session: r.session, model: r.model, userMsg: r.userMsg, messages: r.logMessages, ms: Date.now() - started, error: err.message });
      send('error', { message: err.message });
    } finally {
      activity({ phase: 'done' });
      res.end();
    }
  }));
}
