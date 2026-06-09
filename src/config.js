// Application configuration. Env vars override defaults so the same build
// runs on any host without editing code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function boundedIntegerEnv(name, fallback, { min = 1, max = 100 } = {}) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),

  // HTTP server. Bind 0.0.0.0 so it's reachable across the LAN.
  host: process.env.DASH_HOST || '0.0.0.0',
  port: Number(process.env.DASH_PORT || 8080),

  // HTTPS. Served only if both cert and key files exist (issued by the
  // internal CA, caserver.huis). Keys live in data/tls (gitignored).
  httpsPort: Number(process.env.DASH_HTTPS_PORT || 443),
  tlsCert: process.env.DASH_TLS_CERT || path.join(ROOT, 'data', 'tls', 'dashboard.crt'),
  tlsKey: process.env.DASH_TLS_KEY || path.join(ROOT, 'data', 'tls', 'dashboard.key'),

  // Ollama backend used by the agent + validation harness.
  ollamaHost: (process.env.OLLAMA_HOST || 'http://ollama.huis:11434').replace(/\/$/, ''),
  agentMaxToolCalls: boundedIntegerEnv('DASH_AGENT_MAX_TOOL_CALLS', 16),

  // Health checks.
  healthIntervalMs: Number(process.env.DASH_HEALTH_INTERVAL || 30_000),
  healthTimeoutMs: Number(process.env.DASH_HEALTH_TIMEOUT || 5_000),

  // How many dashboard snapshots to retain in data/backups.
  maxBackups: Number(process.env.DASH_MAX_BACKUPS || 25),
};

export const paths = {
  dashboard: path.join(config.dataDir, 'dashboard.json'),
  backups: path.join(config.dataDir, 'backups'),
  approvedModels: path.join(config.dataDir, 'approved-models.json'),
};
