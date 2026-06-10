export const STORAGE_KEYS = {
  activeModel: 'dash-model',
  chat: 'dash-chat',
  assistantGeometry: 'dash-asst-geom',
  gridCellHeight: 'dash-cellh',
  autoArrange: 'dash-autoarrange',
  showGrid: 'dash-showgrid',
  activeView: 'dash-view',
};

export const NOTE_TRANSPARENT_COLOR = 'transparent';
export const NOTE_COLORS = ['#f6d365', '#a0e7a0', '#9bd0ff', '#ffb3c1', '#e0c3fc', NOTE_TRANSPARENT_COLOR];
export const NOTE_TEXT_COLORS = ['#2a2300', '#000000', '#ffffff', '#1d4ed8', '#b91c1c'];

export const SPEED_LIMITS = {
  msPerSecond: 1_000,
  secondsCutoff: 10,
  fastMs: 2_500,
  okMs: 6_000,
  slowMs: 12_000,
};

export const REFRESH_INTERVALS = {
  clockMs: 30_000,
  healthMs: 30_000,
};

export const LOGS_UI = {
  apiLimit: 40,
  errorPreviewChars: 160,
  replyPreviewChars: 160,
  userPreviewChars: 160,
  timestampStart: 11,
  timestampEnd: 16,
};

export const SEARCH_UI = {
  noteLabelPreviewChars: 60,
  resultLimit: 12,
  jumpDelayMs: 90,
  flashMs: 1_600,
};

export const CHAT_UI = {
  viewportMin: 0,
  thinkingNoticeDelaySeconds: 3,
  coldModelNoticeSeconds: 12,
  thinkingTimerMs: 1_000,
  minVisibleWidth: 120,
  minVisibleHeight: 44,
  resizeSaveDebounceMs: 300,
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
};

export const FONT_WEIGHTS = {
  normal: 400,
  semiBold: 650,
};

const SECTION_STYLE_COLORS = [
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

export const SECTION_PALETTES = {
  background: SECTION_STYLE_COLORS,
  border: SECTION_STYLE_COLORS,
  heading: SECTION_STYLE_COLORS,
};

export const FEATURE_REQUEST_STATUSES = ['open', 'planned', 'done', 'rejected'];
