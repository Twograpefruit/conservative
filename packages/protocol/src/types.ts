/** Wire types shared by the BFF and the GUI. Kept dependency-free. */

export type ISODate = string;

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface ModelRef {
  id: string;
  providerID: string;
  variant?: string;
}

export interface ModelInfo {
  id: string;
  modelID?: string;
  providerID: string;
  name?: string;
  type?: string;
  variants?: string[];
  capabilities?: { tools?: boolean; input?: string[]; output?: string[] };
  cost?: Array<{ input: number; output: number; cache?: { read: number; write: number } }>;
  limit?: { context?: number; output?: number };
  status?: string;
  enabled?: boolean;
}

export interface AgentInfo {
  id: string;
  name?: string;
  description?: string;
  model?: ModelRef;
  mode?: string;
}

export interface SessionInfo {
  id: string;
  parentID?: string;
  projectID?: string;
  agent?: string;
  model?: ModelRef;
  cost?: number;
  tokens?: TokenUsage;
  time: { created: number; updated: number; idle?: number; viewed?: number; archived?: number };
  title?: string;
  status?: 'busy' | 'idle' | 'retry' | 'error';
  error?: unknown;
  location?: { directory: string };
  slug?: string;
}

export type ToolStateStatus = 'streaming' | 'running' | 'completed' | 'error';

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  text: string;
}

export interface ToolPart {
  type: 'tool';
  id: string;
  name: string;
  executed?: boolean;
  state: {
    status: ToolStateStatus;
    input?: unknown;
    content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
    metadata?: Record<string, unknown>;
    error?: string;
  };
  time?: { created?: number; ran?: number; completed?: number };
}

export type MessagePart = TextPart | ReasoningPart | ToolPart | { type: string; [k: string]: unknown };

export interface UserMessage {
  id: string;
  type: 'user';
  time: { created: number };
  text: string;
  files?: unknown[];
}

export interface AssistantMessage {
  id: string;
  type: 'assistant';
  time: { created: number; streamed?: number; completed?: number };
  agent: string;
  model: ModelRef;
  content: MessagePart[];
  snapshot?: { start?: string; end?: string; files?: string[] };
  finish?: string;
  cost?: number;
  tokens?: TokenUsage;
  error?: StructuredError;
  retry?: { attempt?: number; message?: string; time?: number };
}

export interface OtherMessage {
  id: string;
  type: string;
  time?: { created?: number };
  [k: string]: unknown;
}

export type MessageInfo = UserMessage | AssistantMessage | OtherMessage;

export interface StructuredError {
  type?: string;
  message?: string;
  status?: number;
  response?: { body?: string };
}

export interface PromptUploadFile {
  uri: string;
  name: string;
  description?: string;
  mention?: { start: number; end: number; text: string };
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  action: string;
  resources: string[];
  save?: string[];
  metadata?: Record<string, unknown>;
  source?: { type: string; messageID?: string; id?: string };
  message?: string;
}

export interface FileDiffInfo {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: 'added' | 'deleted' | 'modified';
  more?: true;
}

/* ------------------------------- BFF API -------------------------------- */

export interface HealthResponse {
  ok: boolean;
  bff: { version: string; pid: number; uptime: number; port: number; memory: number };
  upstream: {
    mode: 'managed' | 'attach';
    url: string | null;
    healthy: boolean;
    version?: string;
    pid?: number;
    error?: string;
    reconnects?: number;
  };
  eventBus: { connected: boolean; buffered: number; lastSeq: number; clients: number };
}

export interface ProbeResult {
  time: number;
  upstream: { url: string; version: string; pid?: number };
  spec: { ok: boolean; path?: string; version?: string; error?: string };
  endpoints: Record<string, { ok: boolean; status?: number; error?: string; latencyMs?: number }>;
  events: {
    ok: boolean;
    path: string;
    contentType?: string;
    heartbeat: boolean;
    envelope: { id: string; type: string; data: string; seq: string } | null;
    error?: string;
  };
  capabilities: {
    streaming: boolean;
    tools: boolean;
    permissions: boolean;
    sessionDiff: boolean;
    pty: boolean;
    vcs: boolean;
    snapshots: boolean;
    lint: boolean;
  };
  hints: string[];
}

export interface WorkspaceInfo {
  id: string;
  path: string;
  label: string;
  venv: string | null;
  checkCmd: string | null;
  lintCmd: string | null;
  encoding: string;
  eol: 'auto' | 'lf' | 'crlf';
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  mtime?: number;
  ignored?: boolean;
  hasChildren?: boolean;
}

export interface FileContent {
  path: string;
  content: string;
  encoding: string;
  eol: 'lf' | 'crlf' | 'mixed';
  eolSummary: { lf: number; crlf: number };
  hash: string;
  size: number;
  mtime: number;
  binary: boolean;
  readonly: boolean;
  truncated: boolean;
  bom: boolean;
}

export interface WriteFileResult {
  hash: string;
  size: number;
  mtime: number;
  eol: 'lf' | 'crlf' | 'mixed';
}

export interface SearchOptions {
  ws: string;
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  glob?: string;
  maxResults?: number;
  cursor?: string;
}

export interface SearchMatch {
  line: number;
  column: number;
  endColumn: number;
  text: string;
  match: string;
}

export interface SearchFileResult {
  path: string;
  matches: SearchMatch[];
}

export type SearchStreamMessage =
  | { type: 'start'; id: string; query: string }
  | { type: 'file'; file: SearchFileResult }
  | { type: 'done'; files: number; matches: number; truncated: boolean; cursor?: string }
  | { type: 'error'; message: string };

export interface ReplaceOptions {
  ws: string;
  query: string;
  replacement: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  glob?: string;
  preserveCase?: boolean;
}

export interface ReplacePreviewFile {
  path: string;
  matches: number;
  skipped?: string;
  sample: Array<{ line: number; before: string; after: string }>;
}

export interface ReplacePreview {
  id: string;
  files: ReplacePreviewFile[];
  totalMatches: number;
  totalFiles: number;
  skippedFiles: number;
  truncated: boolean;
}

export interface ReplaceApplyResult {
  id: string;
  undoId: string;
  appliedFiles: number;
  appliedMatches: number;
  skipped: Array<{ path: string; reason: string }>;
  backupDir: string;
}

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'untracked' | 'conflict' | 'unknown';
}

export interface GitLogEntry {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
}

export interface SnapshotInfo {
  id: string;
  reason: string;
  time: number;
  files: number;
  createdAt: string;
}

export interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source: string;
  code?: string;
}

export interface PtyInfo {
  id: string;
  title: string;
  cwd: string;
  status: 'running' | 'exited';
  pid?: number;
  exitCode?: number;
}

/* ------------------------------- M6 data -------------------------------- */

export type ConnectionKind = 'sqlite' | 'postgres' | 'mysql' | 'redis';

export interface ConnectionProfile {
  id: string;
  label: string;
  kind: ConnectionKind;
  readOnly: boolean;
  timeoutMs: number;
  rowLimit: number;
  file?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  hasPassword?: boolean;
}

export interface DbTableInfo {
  name: string;
  type: 'table' | 'view';
}

export interface DbColumnInfo {
  name: string;
  type: string;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: unknown;
}

export interface DbIndexInfo {
  name: string;
  unique: boolean;
  columns: string[];
}

export interface DbMetadata {
  tables: DbTableInfo[];
  columns: Record<string, DbColumnInfo[]>;
  indexes: Record<string, DbIndexInfo[]>;
}

export interface DbQueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  kind: 'read' | 'write';
  changes?: number;
}

export interface RedisKeyInfo {
  key: string;
  type: string;
}

export interface RedisScanResult {
  cursor: string;
  keys: RedisKeyInfo[];
  scanned: number;
}

export interface RedisValue {
  key: string;
  type: string;
  value: unknown;
  truncated: boolean;
  ttl: number;
}


export interface ApiError {
  error: string;
  message: string;
  code?: string;
  currentHash?: string;
  currentMtime?: number;
}
