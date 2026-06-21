// UI constants for the v2 frontend. localStorage keys use a dash2- prefix so
// the old UI's saved state never bleeds into the new one.
export const STORAGE_KEYS = {
  view: 'dash2-view',
  model: 'dash2-model',
  chat: 'dash2-chat',
  dock: 'dash2-dock',
  gridCellHeight: 'dash2-cellh',
  autoArrange: 'dash2-autoarrange',
  showGrid: 'dash2-showgrid',
  deviceLayouts: 'dash2-device-layouts',
  modelsCollapsed: 'dash2-models-collapsed',
  replayHideFake: 'dash2-replay-hidefake',
  replayHideAborted: 'dash2-replay-hideaborted',
};

export const REFRESH_INTERVALS = {
  clockMs: 30_000,
  healthMs: 30_000,
};

export const GRID_UI = {
  columns: 12,
  margin: 8,
  cellHeightMin: 56,
  cellHeightMax: 160,
  cellHeightDefault: 92,
  cellHeightStep: 12,
  layoutPersistDebounceMs: 400,
  collapsedHeight: 1,
  sectionDefaultWidth: 4,
  sectionDefaultHeight: 4,
  noteDefaultWidth: 3,
  noteDefaultHeight: 3,
  gameDefaultWidth: 3,
  gameDefaultHeight: 5,
  scraperDefaultWidth: 5,
  scraperDefaultHeight: 6,
  triggerDefaultWidth: 2,
  triggerDefaultHeight: 2,
  attachLabelChars: 40,
  oneColumnBelowPx: 768,
};

export const FONT_WEIGHTS = {
  normal: 400,
  semiBold: 650,
};

export const SPEED_LIMITS = {
  msPerSecond: 1_000,
  secondsCutoff: 10,
  fastMs: 2_500,
  okMs: 6_000,
  slowMs: 12_000,
};

export const TOAST_UI = {
  durationMs: 4_000,
  undoDurationMs: 6_000,
  errorDurationMs: 7_000,
};

export const PULSE_UI = {
  flashMs: 1_600,
  badgeMs: 3_200,
  jumpDelayMs: 90,
};

export const DOCK_UI = {
  minWidth: 320,
  defaultWidth: 400,
  maxViewportFraction: 0.6,
  composerMinHeight: 64,
  composerMaxViewportFraction: 0.5,
  floatDefaultWidth: 420,
  thinkingNoticeDelaySeconds: 3,
  coldModelNoticeSeconds: 12,
  thinkingTimerMs: 1_000,
  narrowBelowPx: 900,
};

export const VOICE_UI = {
  maxRecordMs: 120_000,
};

// Cooldown presets offered on trigger cards. Months are approximate (30 days).
const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
export const TRIGGER_COOLDOWNS = [
  { label: '1 min', ms: 60_000 },
  { label: '5 min', ms: 5 * 60_000 },
  { label: '30 min', ms: 30 * 60_000 },
  { label: '1 hour', ms: HOUR },
  { label: '6 hours', ms: 6 * HOUR },
  { label: '12 hours', ms: 12 * HOUR },
  { label: '24 hours', ms: DAY },
  { label: '2 days', ms: 2 * DAY },
  { label: '3 days', ms: 3 * DAY },
  { label: '1 week', ms: 7 * DAY },
  { label: '2 weeks', ms: 14 * DAY },
  { label: '1 month', ms: 30 * DAY },
  { label: '3 months', ms: 90 * DAY },
  { label: '6 months', ms: 180 * DAY },
];

export const CMDK_UI = {
  resultLimit: 10,
  noteLabelPreviewChars: 60,
};

export const LOGS_UI = {
  apiLimit: 40,
  // The validation harness's stub model — its runs are test noise in the log.
  fakeModel: 'fake-model',
  // Fetch-abort message logged when a run is cancelled or times out.
  abortedError: 'This operation was aborted',
  errorPreviewChars: 160,
  replyPreviewChars: 160,
  userPreviewChars: 160,
  timestampStart: 11,
  timestampEnd: 16,
};

const STYLE_COLORS = [
  '',
  '#1a2233',
  '#16241a',
  '#2a1f2e',
  '#2a2418',
  '#1a2628',
  '#4c8dff',
  '#3fb950',
  '#f85149',
  '#d29922',
  '#a371f7',
  '#e8eef5',
  '#7aa9ff',
  '#69d28a',
  '#f0b429',
  '#ff9580',
];

export const NOTE_TRANSPARENT_COLOR = 'transparent';
export const NOTE_DEFAULT_COLOR = '#f6d365';
export const NOTE_COLORS = [...STYLE_COLORS, NOTE_TRANSPARENT_COLOR];
export const NOTE_TEXT_COLORS = STYLE_COLORS;

export const SECTION_PALETTES = {
  background: STYLE_COLORS,
  border: STYLE_COLORS,
  heading: STYLE_COLORS,
};
export const SECTION_HEADING_EFFECTS = {
  none: 'none',
  rainbow: 'rainbow',
};

export const WORKSPACE_BACKGROUND_EFFECTS = {
  none: 'none',
  waves: 'waves',
  orbits: 'orbits',
  plasma: 'plasma',
  stars: 'stars',
  formula: 'formula',
};

export const FEATURE_REQUEST_STATUSES = ['open', 'planned', 'done', 'rejected'];
export const PROBLEM_STATUSES = ['open', 'investigating', 'resolved', 'dismissed'];
