// Application configuration. Env vars override defaults so the same build
// runs on any host without editing code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AGENT_LIMITS, CHAT_MESSAGE_LIMITS, CONFIG_DEFAULTS, OLLAMA_LIMITS, SERVER_LIMITS, SPEECH_TO_TEXT_LIMITS,
  ENV_BOUNDS, PATH_NAMES, STORE_LIMITS, VALIDATION_DEFAULTS,
} from './constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function clampInteger(raw, fallback, { min = ENV_BOUNDS.minPositiveInt, max = AGENT_LIMITS.toolCallMax } = {}) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function boundedIntegerEnv(name, fallback, bounds = {}) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return clampInteger(raw, fallback, bounds);
}

function numberEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

const logMaxLimit = boundedIntegerEnv('DASH_LOG_MAX_LIMIT', SERVER_LIMITS.logsMaxLimit, {
  min: ENV_BOUNDS.minPositiveInt,
  max: ENV_BOUNDS.logMaxLimitMax,
});

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, PATH_NAMES.dataDir),
  publicDir: path.join(ROOT, PATH_NAMES.publicDir),

  // HTTP server. Bind 0.0.0.0 so it's reachable across the LAN.
  host: process.env.DASH_HOST || CONFIG_DEFAULTS.host,
  port: boundedIntegerEnv('DASH_PORT', CONFIG_DEFAULTS.port, { min: ENV_BOUNDS.minPositiveInt, max: ENV_BOUNDS.portMax }),
  jsonBodyLimit: process.env.DASH_JSON_LIMIT || SERVER_LIMITS.jsonBodyLimit,
  logDefaultLimit: boundedIntegerEnv('DASH_LOG_DEFAULT_LIMIT', SERVER_LIMITS.logsDefaultLimit, { min: ENV_BOUNDS.minPositiveInt, max: logMaxLimit }),
  logMaxLimit,

  // HTTPS. Served only if both cert and key files exist (issued by the
  // internal CA, caserver.huis). Keys live in data/tls (gitignored).
  httpsPort: boundedIntegerEnv('DASH_HTTPS_PORT', CONFIG_DEFAULTS.httpsPort, { min: ENV_BOUNDS.minPositiveInt, max: ENV_BOUNDS.portMax }),
  tlsCert: process.env.DASH_TLS_CERT || path.join(ROOT, PATH_NAMES.dataDir, PATH_NAMES.tlsDir, PATH_NAMES.tlsCert),
  tlsKey: process.env.DASH_TLS_KEY || path.join(ROOT, PATH_NAMES.dataDir, PATH_NAMES.tlsDir, PATH_NAMES.tlsKey),

  // Ollama backend used by the agent + validation harness.
  ollamaHost: (process.env.OLLAMA_HOST || CONFIG_DEFAULTS.ollamaHost).replace(/\/$/, ''),
  ollamaChatTimeoutMs: boundedIntegerEnv('OLLAMA_CHAT_TIMEOUT_MS', OLLAMA_LIMITS.chatTimeoutMs, {
    min: ENV_BOUNDS.timeoutMinMs,
    max: ENV_BOUNDS.timeoutMaxMs,
  }),
  ollamaLoadTimeoutMs: boundedIntegerEnv('OLLAMA_LOAD_TIMEOUT_MS', OLLAMA_LIMITS.loadTimeoutMs, {
    min: ENV_BOUNDS.timeoutMinMs,
    max: ENV_BOUNDS.timeoutMaxMs,
  }),
  agentMaxToolCalls: boundedIntegerEnv('DASH_AGENT_MAX_TOOL_CALLS', AGENT_LIMITS.defaultMaxToolCalls, {
    min: AGENT_LIMITS.toolCallMin,
    max: AGENT_LIMITS.toolCallMax,
  }),
  agentReviewTimeoutMs: boundedIntegerEnv('DASH_AGENT_REVIEW_TIMEOUT_MS', AGENT_LIMITS.reviewTimeoutMs, {
    min: ENV_BOUNDS.timeoutMinMs,
    max: ENV_BOUNDS.timeoutMaxMs,
  }),
  speechToTextUrl: (process.env.DASH_STT_URL || process.env.SPEECH_TO_TEXT_URL || 'https://speech-to-text.huis').replace(/\/$/, ''),
  speechToTextToken: process.env.DASH_STT_TOKEN || process.env.SPEECH_TO_TEXT_CLIENT_KEY || '',
  speechToTextTimeoutMs: boundedIntegerEnv('DASH_STT_TIMEOUT_MS', SPEECH_TO_TEXT_LIMITS.timeoutMs, {
    min: ENV_BOUNDS.timeoutMinMs,
    max: ENV_BOUNDS.timeoutMaxMs,
  }),
  chatMaxMessages: boundedIntegerEnv('DASH_CHAT_MAX_MESSAGES', CHAT_MESSAGE_LIMITS.maxMessages, {
    min: ENV_BOUNDS.minPositiveInt,
    max: ENV_BOUNDS.chatMaxMessagesMax,
  }),
  chatMaxContentChars: boundedIntegerEnv('DASH_CHAT_MAX_CONTENT_CHARS', CHAT_MESSAGE_LIMITS.maxContentChars, {
    min: ENV_BOUNDS.minPositiveInt,
    max: ENV_BOUNDS.chatMaxContentCharsMax,
  }),

  // Health checks.
  healthIntervalMs: boundedIntegerEnv('DASH_HEALTH_INTERVAL', CONFIG_DEFAULTS.healthIntervalMs, {
    min: ENV_BOUNDS.timeoutMinMs,
    max: ENV_BOUNDS.dayMs,
  }),
  healthTimeoutMs: boundedIntegerEnv('DASH_HEALTH_TIMEOUT', CONFIG_DEFAULTS.healthTimeoutMs, {
    min: ENV_BOUNDS.shortTimeoutMinMs,
    max: OLLAMA_LIMITS.loadTimeoutMs,
  }),

  // How many dashboard snapshots to retain in data/backups.
  maxBackups: boundedIntegerEnv('DASH_MAX_BACKUPS', CONFIG_DEFAULTS.maxBackups, { min: ENV_BOUNDS.minPositiveInt, max: ENV_BOUNDS.historyMax }),
  maxHistory: boundedIntegerEnv('DASH_MAX_HISTORY', STORE_LIMITS.defaultMaxHistory, { min: ENV_BOUNDS.minPositiveInt, max: ENV_BOUNDS.historyMax }),

  // Validation harness defaults.
  validationThreshold: numberEnv('DASH_VALIDATE_THRESHOLD', VALIDATION_DEFAULTS.threshold),
  criticalRepeats: boundedIntegerEnv('DASH_CRITICAL_REPEATS', VALIDATION_DEFAULTS.criticalRepeats, {
    min: ENV_BOUNDS.minPositiveInt,
    max: ENV_BOUNDS.criticalRepeatsMax,
  }),
  subAgentNumCtx: boundedIntegerEnv('DASH_SUBAGENT_NUM_CTX', VALIDATION_DEFAULTS.subAgentNumCtx, {
    min: ENV_BOUNDS.subAgentNumCtxMin,
    max: ENV_BOUNDS.subAgentNumCtxMax,
  }),
};

export const paths = {
  dashboard: path.join(config.dataDir, PATH_NAMES.dashboard),
  backups: path.join(config.dataDir, PATH_NAMES.backups),
  approvedModels: path.join(config.dataDir, PATH_NAMES.approvedModels),
  scraperResults: path.join(config.dataDir, PATH_NAMES.scraperResultsDb),
};
