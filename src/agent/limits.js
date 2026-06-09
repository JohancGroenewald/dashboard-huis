import { AGENT_LIMITS } from '../constants.js';
import { clampInteger, config } from '../config.js';

export function resolveToolCallLimit(maxToolCalls, maxSteps) {
  return clampInteger(maxToolCalls ?? maxSteps ?? config.agentMaxToolCalls, config.agentMaxToolCalls, {
    min: AGENT_LIMITS.toolCallMin,
    max: AGENT_LIMITS.toolCallMax,
  });
}
