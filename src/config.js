// Application configuration. Env vars override defaults so the same build
// runs on any host without editing code.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const config = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  publicDir: path.join(ROOT, 'public'),

  // HTTP server. Bind 0.0.0.0 so it's reachable across the LAN.
  host: process.env.DASH_HOST || '0.0.0.0',
  port: Number(process.env.DASH_PORT || 8080),

  // Ollama backend used by the agent + validation harness.
  ollamaHost: (process.env.OLLAMA_HOST || 'http://ollama.huis:11434').replace(/\/$/, ''),

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
