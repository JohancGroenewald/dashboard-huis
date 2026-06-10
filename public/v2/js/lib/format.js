// Shared formatting helpers.
import { SPEED_LIMITS } from '../constants.js';

export function fmtMs(ms) {
  if (!ms) return '';
  const s = ms / SPEED_LIMITS.msPerSecond;
  return s < SPEED_LIMITS.secondsCutoff ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
}

export function speedTier(ms) {
  if (!ms) return '';
  if (ms < SPEED_LIMITS.fastMs) return '⚡';
  if (ms < SPEED_LIMITS.okMs) return '🟢';
  if (ms < SPEED_LIMITS.slowMs) return '🟡';
  return '🐢';
}
