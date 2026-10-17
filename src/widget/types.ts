export type Rect = { x: number; y: number; w: number; h: number };

export type ElementInfo = { path: string; component: string; text: string };
export type ConsoleEntry = { at: string; message: string };

/** Everything recorded automatically with a report. Plain data, bounded, no secrets. */
export type ReportContext = {
  url: string;
  title: string;
  viewport: { w: number; h: number; dpr: number };
  scroll: { x: number; y: number };
  region: Rect | null;
  userAgent: string;
  language: string;
  capturedAt: string;
  elements: ElementInfo[];
  consoleErrors: ConsoleEntry[];
  /** Whatever the host app returned from `metadata()` (app version, user id, mode, ...). */
  metadata: Record<string, unknown>;
};

export type ReportStatus = 'open' | 'fixed' | 'wontfix';

export type ReportSummary = {
  id: string;
  status: ReportStatus;
  note: string;
  createdAt: string;
  description: string;
  types: string[];
  page: string;
};

export type Position = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type EnableMode = 'query' | 'storage' | 'always' | 'never' | (() => boolean);

export type Strings = {
  button: string;
  menuReport: string;
  menuMine: string;
  menuTurnOff: string;
  loading: string;
  nothingSent: string;
  captureFailed: string;
  selectHint: string;
  selectTooSmall: string;
  selectCutFailed: string;
  wholeScreen: string;
  cancel: string;
  title: string;
  anotherArea: string;
  previewAlt: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  typesLabel: string;
  send: string;
  sending: string;
  sentTitle: string;
  sentBody: string;
  sentDownloaded: string;
  sendFailed: string;
  downloadInstead: string;
  statusOpen: string;
  statusFixed: string;
  statusWontfix: string;
  openCount: string;
  close: string;
};

export type InitOptions = {
  /** Base URL of the report API (the server's `basePath`), e.g. "/api/bugframe". Omit it for download-only mode. */
  endpoint?: string;
  /** Public client token, sent as `x-bugframe-token`. Not a secret: it only tells the server which project this is. */
  token?: string;
  /** Without an endpoint the report is downloaded as a .zip. Force it with `mode: 'download'`. */
  mode?: 'server' | 'download';
  /** When the widget shows. Default 'query': `?bugs=1` switches it on (remembered in this browser), `?bugs=0` off. */
  enable?: EnableMode | boolean;
  /** Query parameter name for the 'query' mode. Default "bugs". */
  enableParam?: string;
  /** localStorage key remembering the switch. Default "bugframe:enabled". */
  storageKey?: string;
  position?: Position;
  /** Extra distance from the corner in px (added to the safe-area inset). */
  offset?: { x?: number; y?: number };
  /** CSS selectors of other floating buttons the button should sit clear of. */
  avoid?: string[];
  zIndex?: number;
  /** Report types shown as chips. `[]` hides them. */
  types?: string[];
  /** Replace the user-facing texts. Partial; missing keys fall back to the locale. */
  strings?: Partial<Strings>;
  /** 'en' | 'es' | 'pt' | 'auto' (browser language). Default 'auto'. */
  locale?: string;
  /** Record console errors and uncaught exceptions of the last minute. Off by default. */
  captureConsole?: boolean;
  /** Called when a report is sent; return anything JSON-serialisable (app version, user id, current mode, ...). */
  metadata?: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  /** Identifies this person for "My reports". Default: a random id kept in localStorage. */
  reporterId?: string | (() => string);
  /** Blank out `input`, `textarea` and `select` values in the pictures. Default true. */
  maskInputs?: boolean;
  /** Extra selectors painted over in the pictures (`[data-bug-mask]` is always masked). */
  mask?: string[];
  /** Selectors removed from the pictures entirely (chat bubbles, cookie banners). */
  exclude?: string[];
  /** Query parameters whose value is replaced in the recorded URL. Default: token, key, password, secret, auth, code, session... */
  redactParams?: string[];
  /** Maximum device pixel ratio used for pictures. Default 2. */
  maxPixelRatio?: number;
  /** Color of the button and highlights. */
  accent?: string;
  colorScheme?: 'auto' | 'light' | 'dark';
  /** Where the widget host element is appended. Default document.body. */
  container?: HTMLElement;
  /** Hook for tests and custom screenshot engines. Must return a PNG data URL of the viewport. */
  captureFn?: () => Promise<string>;
  fetch?: typeof fetch;
  onSent?: (result: { id: string | null; downloaded: boolean }) => void;
  onError?: (error: Error) => void;
};

export type BugframeInstance = {
  open(): void;
  close(): void;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  destroy(): void;
};
