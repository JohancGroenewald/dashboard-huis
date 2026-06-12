// Display helpers for the post-turn tool-intent review. `calls` is the run's
// tool-call count: when the reviewer says the turn meant to act (intended)
// but the trace is empty, the model talked the action without performing it —
// the classic "forgot to call the tool" failure, surfaced as its own state.
export function toolIntentState(intent, calls = null) {
  if (!intent) return null;
  if (intent.intended === true) return calls === 0 ? 'forgot' : 'yes';
  if (intent.intended === false) return 'no';
  return 'unknown';
}

export function toolIntentLabel(intent, calls = null) {
  const state = toolIntentState(intent, calls);
  if (state === 'forgot') return 'Tool: forgot?';
  if (state === 'yes') return 'Tool: yes';
  if (state === 'no') return 'Tool: no';
  return state ? 'Tool: ?' : '';
}

export function toolIntentTitle(intent, calls = null) {
  if (!intent) return '';
  const bits = [
    toolIntentState(intent, calls) === 'forgot'
      ? 'The reviewer judged this turn meant to use a tool, but no tool was ever called — the model likely claimed or promised an action without doing it.'
      : '',
    intent.reviewer ? `Reviewer: ${intent.reviewer}` : '',
    Number.isFinite(intent.confidence) ? `Confidence: ${Math.round(intent.confidence * 100)}%` : '',
    intent.tool ? `Tool: ${intent.tool}` : '',
    intent.error || intent.reason || '',
  ].filter(Boolean);
  return bits.join('\n');
}
