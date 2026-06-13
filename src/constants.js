export const HTTP_DEFAULT_PORTS = {
  http: 80,
  https: 443,
};

export const HTTP_STATUS = {
  created: 201,
  badRequest: 400,
  forbidden: 403,
  conflict: 409,
  internalServerError: 500,
};

export const ENV_BOUNDS = {
  minPositiveInt: 1,
  portMax: 65_535,
  logMaxLimitMax: 10_000,
  timeoutMinMs: 1_000,
  shortTimeoutMinMs: 100,
  timeoutMaxMs: 3_600_000,
  dayMs: 86_400_000,
  chatMaxMessagesMax: 1_000,
  chatMaxContentCharsMax: 200_000,
  historyMax: 10_000,
  criticalRepeatsMax: 1_000,
  subAgentNumCtxMin: 512,
  subAgentNumCtxMax: 262_144,
};

export const CONFIG_DEFAULTS = {
  host: '0.0.0.0',
  port: 8080,
  httpsPort: HTTP_DEFAULT_PORTS.https,
  ollamaHost: 'http://ollama.huis:11434',
  toolIntentModel: 'ministral-3:3b',
  healthIntervalMs: 30_000,
  healthTimeoutMs: 5_000,
  maxBackups: 25,
};

export const PATH_NAMES = {
  dataDir: 'data',
  publicDir: 'public',
  tlsDir: 'tls',
  tlsCert: 'dashboard.crt',
  tlsKey: 'dashboard.key',
  dashboard: 'dashboard.json',
  backups: 'backups',
  approvedModels: 'approved-models.json',
  chatlogDb: 'chatlog.db',
};

export const SERVER_LIMITS = {
  jsonBodyLimit: '25mb', // pasted screenshots ride as base64 in chat messages
  logsDefaultLimit: 40,
  logsMaxLimit: 200,
};

export const SCRAPER_LIMITS = {
  fetchTimeoutMs: 12_000,
  maxTextChars: 16_000, // visible text handed to the model in legacy single-pass preview mode
  maxColumns: 8,
  cellChars: 400,
  // Full pager: process the scraped page in slices of ~pageTokens tokens each.
  defaultPageTokens: 4_000,
  defaultSourceMode: 'follow',
  defaultSourceProcess: 'per-page',
  charsPerToken: 4, // rough estimate (no tokenizer); tokens × 4 ≈ chars
  maxPageTokens: 12_000, // largest slice the user may configure
  pageOverlapChars: 800, // carry context across slice boundaries
  pageBoundaryScanChars: 1_000, // look ahead this far for a cleaner newline break
};

export const SSE_LIMITS = {
  heartbeatMs: 25_000,
  coalesceMs: 100,
};

export const AGENT_LIMITS = {
  defaultMaxToolCalls: 16,
  toolCallMin: 1,
  toolCallMax: 100,
  reviewTimeoutMs: 90_000,
  toolIntentTimeoutMs: 30_000,
  reviewPreviewChars: 120,
  toolIntentInputChars: 2_000,
  toolIntentTraceChars: 2_000,
  offeredChoicesMax: 6,
  followupsMax: 4,
  scraperReadDefault: 25, // rows returned by read_scraper when no limit is given
  scraperReadMax: 50, // cap on rows per read_scraper call (page for more)
};

export const OLLAMA_LIMITS = {
  chatTimeoutMs: 180_000,
  loadTimeoutMs: 300_000,
  defaultTemperature: 0,
  unloadKeepAlive: 0,
  errorBodyPreviewChars: 300,
};

export const PROMPT_LIMITS = {
  maxChars: 20_000,
};

export const CHAT_MESSAGE_LIMITS = {
  maxMessages: 40,
  maxContentChars: 8_000,
  maxImagesPerMessage: 4,
  maxImageChars: 12_000_000, // base64 chars ≈ 9MB binary per image
};

export const CHATLOG_CLI_LIMITS = {
  defaultRecent: 20,
  maxRecent: 200,
  userPreviewChars: 160,
  replyPreviewChars: 200,
  argsPreviewChars: 80,
  sessionPreviewChars: 8,
};

export const VALIDATION_DEFAULTS = {
  threshold: 0.8,
  criticalRepeats: 5,
  subAgentNumCtx: 4096,
  temperatureMin: 0.3,
  temperatureSpread: 0.4,
  decimalPlaces: 2,
  scoreDecimalPlaces: 3,
  runIdRadix: 36,
};

export const REDTEAM_LIMITS = {
  dangerousReplyChars: 400,
  replyPreviewChars: 240,
};

export const TOOLING_LIMITS = {
  sourceFileMaxLines: 500,
};

export const STORE_LIMITS = {
  defaultMaxHistory: 50,
  minIndex: 0,
  noteSearchLabelChars: 50,
  searchResults: 10,
};

export const SCHEMA_LIMITS = {
  defaultStringChars: 2_000,
  colorChars: 30,
  tileNameChars: 120,
  tileDescriptionChars: 500,
  tileIconChars: 40,
  workspaceNameChars: 120,
  sectionNameChars: 120,
  sectionDescriptionChars: 500,
  workspaceIdChars: 100,
  noteTextChars: 2_000,
  featureTitleChars: 200,
  featureDetailChars: 2_000,
  gameMemoryChars: 2_000,
  gameSayChars: 300,
  gameModelChars: 120,
  triggerNameChars: 120,
  triggerHistoryMax: 12,
  scraperNameChars: 120,
  scraperUrlChars: 2_000,
  scraperInstructionChars: 600,
  scraperNoteChars: 500,
  triggerCooldownMaxMs: 365 * 24 * 60 * 60 * 1000, // a year (room for month-scale cooldowns)
  triggerCooldownDefaultMs: 6 * 60 * 60 * 1000, // 6 hours
  requestedByChars: 120,
  dashboardTitleChars: 120,
  layoutMin: 0,
  layoutMinSize: 1,
  gridColumns: 12,
};

export const HEALTH_TYPES = ['http', 'tcp', 'none'];
export const FEATURE_REQUEST_STATUSES = ['open', 'planned', 'done', 'rejected'];
export const PROBLEM_STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];
export const SECTION_HEADING_EFFECTS = ['none', 'rainbow'];
export const WORKSPACE_BACKGROUND_EFFECTS = ['none', 'waves', 'orbits', 'plasma', 'stars', 'formula'];

export const NOTE_COLOR_NAMES = {
  '#f6d365': 'yellow',
  '#a0e7a0': 'green',
  '#9bd0ff': 'blue',
  '#ffb3c1': 'pink',
  '#e0c3fc': 'purple',
  transparent: 'transparent',
};

export const DEFAULT_DASHBOARD = {
  title: 'Huis',
  sections: [
    {
      name: 'Infrastructure',
      tiles: [
        {
          name: 'Ollama',
          url: 'http://ollama.huis:11434',
          description: 'Local LLM server',
          icon: '🧠',
          health: { enabled: true, type: 'http', target: 'http://ollama.huis:11434/api/version' },
        },
      ],
    },
    { name: 'Services', tiles: [] },
  ],
};
