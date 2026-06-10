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
  thinkingNoticeDelaySeconds: 3,
  coldModelNoticeSeconds: 12,
  thinkingTimerMs: 1_000,
  narrowBelowPx: 900,
};

export const CMDK_UI = {
  resultLimit: 10,
  noteLabelPreviewChars: 60,
};

export const LOGS_UI = {
  apiLimit: 40,
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

export const FEATURE_REQUEST_STATUSES = ['open', 'planned', 'done', 'rejected'];
