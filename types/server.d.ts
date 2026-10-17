export type ReportStatus = 'open' | 'fixed' | 'wontfix';

export interface Report {
  id: string;
  status: ReportStatus;
  note: string;
  createdAt: string;
  closedAt?: string | null;
  reporter: string;
  description: string;
  types: string[];
  context: {
    url: string; title: string;
    viewport: { w: number | null; h: number | null; dpr: number | null } | null;
    scroll: { x: number | null; y: number | null } | null;
    region: { x: number | null; y: number | null; w: number | null; h: number | null } | null;
    userAgent: string; language: string; capturedAt: string;
    elements: { path: string; component: string; text: string }[];
    consoleErrors: { at: string; message: string }[];
    metadata: Record<string, unknown>;
  };
  files: { region: string; full: string };
}

/** Implement this to store reports somewhere else (S3, a database, GitHub Issues...). All methods are async. */
export interface StorageAdapter {
  kind?: string;
  /** Save a new report. Throw an error with `code = 'EXISTS'` if the id is taken, so the server retries with a new id. */
  create(report: Report, files: { region: Buffer; full: Buffer }): Promise<void>;
  get(id: string): Promise<Report | null>;
  /** Newest first. */
  list(): Promise<Report[]>;
  /** Merge `patch` into the stored report (status, note, closedAt) and return it, or null if it does not exist. */
  update(id: string, patch: Partial<Report>): Promise<Report | null>;
  readFile(id: string, name: 'region.png' | 'full.png'): Promise<Buffer | null>;
}

export interface BugframeOptions {
  /** Folder for the built-in filesystem storage. */
  dir?: string;
  /** Or bring your own storage. */
  storage?: StorageAdapter;
  /** URL prefix this API is mounted under, e.g. "/api/bugframe". Default "". */
  basePath?: string;
  /** Public tokens the widget sends as `x-bugframe-token`. Empty = no client token required. */
  clientTokens?: string[];
  /** Secret for the CLI/ops: `Authorization: Bearer <adminToken>` can list everything and close reports. */
  adminToken?: string;
  /** Custom auth. Return 'admin', 'client', true (client) or anything falsy to refuse. Replaces client tokens. */
  authorize?: (req: Request) => Promise<'admin' | 'client' | boolean | null | undefined> | 'admin' | 'client' | boolean | null | undefined;
  /** Browser origins allowed to call the API cross-site. Same-origin always works. Default: none. */
  allowedOrigins?: string[] | '*' | ((origin: string) => boolean);
  maxBodyBytes?: number;
  maxImageBytes?: number;
  maxDescription?: number;
  /** POST /reports limit per IP+reporter. `false` turns it off. Default 10 per minute. */
  rateLimit?: false | { max?: number; windowMs?: number };
  /** Read the client IP from X-Forwarded-For (only behind a proxy you control). */
  trustProxy?: boolean;
  /** `false`: "My reports" returns nothing to clients. */
  publicList?: boolean;
  webhook?: { url: string; secret?: string; includeImages?: boolean; timeoutMs?: number };
  onReport?: (report: Report) => void | Promise<void>;
  logger?: (...args: unknown[]) => void;
  fetch?: typeof fetch;
  now?: () => Date;
  generateId?: (now: Date) => string;
}

export interface Bugframe {
  handle(req: Request, ctx?: { ip?: string }): Promise<Response>;
  matches(url: string | URL): boolean;
  storage: StorageAdapter;
  basePath: string;
}

export function createBugframe(options: BugframeOptions): Bugframe;
export function createFileStorage(options: { dir: string }): StorageAdapter;
export function createMemoryStorage(): StorageAdapter;
export function toNodeListener(bf: Bugframe, options?: { trustProxy?: boolean }): (req: any, res: any, next?: (err?: unknown) => void) => Promise<void>;
export const expressMiddleware: typeof toNodeListener;
export function routeHandlers(bf: Bugframe): { GET: (req: Request) => Promise<Response>; POST: (req: Request) => Promise<Response>; PATCH: (req: Request) => Promise<Response>; OPTIONS: (req: Request) => Promise<Response> };
export function newReportId(now?: Date): string;
export function summarize(report: Report): { id: string; status: ReportStatus; note: string; createdAt: string; description: string; types: string[]; page: string };
export function cleanContext(input: unknown): Report['context'];
export function decodePng(dataUrl: unknown, maxBytes: number): Buffer | null;
export function isPng(buf: Buffer, maxBytes?: number): boolean;
