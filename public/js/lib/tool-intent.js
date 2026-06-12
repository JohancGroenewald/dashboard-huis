export function toolIntentState(intent) {
  if (!intent) return null;
  if (intent.intended === true) return 'yes';
  if (intent.intended === false) return 'no';
  return 'unknown';
}

export function toolIntentLabel(intent) {
  const state = toolIntentState(intent);
  if (state === 'yes') return 'Tool: yes';
  if (state === 'no') return 'Tool: no';
  return state ? 'Tool: ?' : '';
}

export function toolIntentTitle(intent) {
  if (!intent) return '';
  const bits = [
    intent.reviewer ? `Reviewer: ${intent.reviewer}` : '',
    Number.isFinite(intent.confidence) ? `Confidence: ${Math.round(intent.confidence * 100)}%` : '',
    intent.tool ? `Tool: ${intent.tool}` : '',
    intent.error || intent.reason || '',
  ].filter(Boolean);
  return bits.join('\n');
}
