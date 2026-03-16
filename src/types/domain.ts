export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatTurn {
  id: string;
  sessionId: string;
  role: ChatRole;
  text: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export type MemoryKind = "preference" | "semantic" | "session_state" | "episodic";
export type MemoryScope = "private" | "workspace" | "shared" | "session";
export type RetrievalMode = "keyword" | "embedding" | "hybrid";

export interface MemoryScoreBreakdown {
  retrievalMode?: RetrievalMode;
  semanticSimilarity: number;
  semanticContribution?: number;
  keywordContribution?: number;
  salience: number;
  recency: number;
  confidence: number;
  typeWeight: number;
  overlap: number;
  redundancyPenalty: number;
  finalScore: number;
}

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  summary: string;
  content: string;
  topics: string[];
  entityKeys: string[];
  salience: number;
  fingerprint: string;
  createdAt: string;
  lastSeenAt: string;
  lastAccessedAt?: string;
  ttlDays?: number;
  decayRate: number;
  confidence?: number;
  importance?: number;
  active?: boolean;
  scope?: MemoryScope;
  scopeKey?: string;
  backend?: "local" | "remote";
  sensitive?: boolean;
  memoryGroup?: string;
  supersededAt?: string;
  supersededBy?: string;
  version?: number;
  retrievalReason?: string;
  suppressedReasons?: string[];
  scoreBreakdown?: MemoryScoreBreakdown;
  sourceSessionId: string;
  sourceTurnIds: string[];
  embedding?: number[];
  score?: number;
}

export interface SessionState {
  sessionId: string;
  currentTask?: string;
  constraints: string[];
  decisions: string[];
  openQuestions: string[];
  updatedAt: string;
}

export interface PromptLayer {
  name: string;
  priority: number;
  content: string;
  estimatedTokens: number;
  trimmed: boolean;
}

export interface PromptBuild {
  layers: PromptLayer[];
  totalEstimatedTokens: number;
  assembled: string;
}

export interface CompressionResult {
  summary: string;
  hierarchicalSummaries: string[];
  compressedTurns: ChatTurn[];
  keptRecentTurns: ChatTurn[];
  originalEstimatedTokens?: number;
  estimatedTokens: number;
  savedTokens?: number;
}

export interface CompactedToolResult {
  id?: string;
  sessionId?: string;
  runId?: string;
  toolName: string;
  toolCallId?: string;
  status?: "started" | "running" | "completed" | "failed";
  meta?: string;
  compacted: string;
  estimatedTokens: number;
  originalEstimatedTokens?: number;
  savedTokens?: number;
  durationMs?: number;
  createdAt?: string;
  rawPayload?: unknown;
  rawTrimmed?: boolean;
  error?: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  preview: string;
  turnCount: number;
  userTurns: number;
  assistantTurns: number;
  updatedAt: string;
  archivedAt?: string;
  lastRole?: ChatRole;
  provider?: string;
  model?: string;
}

export interface SessionInspection {
  summary: SessionSummary;
  state: SessionState;
  transcript: ChatTurn[];
  toolResults: CompactedToolResult[];
}

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  generatedAt: string;
  dataDir: string;
  databasePath: string;
  openclawHome: string;
  checks: DoctorCheck[];
}

export type MetricSource = "exact" | "estimated" | "unavailable";

export interface TurnProfile {
  runId: string;
  sessionId: string;
  createdAt: string;
  promptTokens: number;
  promptTokensSource: MetricSource;
  promptBudget: number;
  memoryInjected: number;
  memoryCandidates: number;
  memoryWritten: number;
  toolTokens: number;
  toolTokensSource: MetricSource;
  toolTokensSaved: number;
  toolTokensSavedSource: MetricSource;
  historySummaryTokens: number;
  historySummaryTokensSource: MetricSource;
  compressionSavings: number;
  compressionSavingsSource: MetricSource;
  retrievalCount: number;
  retrievalMode: RetrievalMode;
  keywordContribution: number;
  semanticContribution: number;
}

export interface StoredTurnProfile extends TurnProfile {
  details: Record<string, unknown>;
}

export interface ConfigValidationIssue {
  field: string;
  severity: "warn" | "error";
  message: string;
  repairHint?: string;
}

export interface ConfigValidationReport {
  valid: boolean;
  issues: ConfigValidationIssue[];
  precedence: string[];
}

export type IdentityMode = "local" | "reconnect" | "cloud" | "shared";

export interface IdentityStatus {
  mode: IdentityMode;
  configured: boolean;
  backendType: string;
  workspaceScope?: string;
  userScope?: string;
  identityKeyPresent: boolean;
  apiKeyPresent: boolean;
  memorySpaceId?: string;
  endpoint?: string;
  sharedScope?: string;
  reconnectReady: boolean;
  reachability: "local" | "configured" | "unavailable";
  warnings: string[];
}

export interface ImportFileReport {
  path: string;
  kind: "memory" | "session" | "transcript" | "artifact" | "unknown";
  status: "imported" | "skipped" | "rejected" | "failed";
  imported: number;
  merged: number;
  superseded: number;
  skipped: number;
  rejected: number;
  rejectedSensitive: number;
  uncertain: number;
  scopeCounts?: Partial<Record<MemoryScope, number>>;
  error?: string;
}

export interface ImportJobReport {
  jobId: string;
  mode: "dry-run" | "run";
  createdAt: string;
  completedAt?: string;
  status: "planned" | "completed" | "failed";
  rootPaths: string[];
  scannedFiles: number;
  processedFiles: number;
  imported: number;
  merged: number;
  superseded: number;
  skippedDuplicates: number;
  rejectedNoise: number;
  rejectedSensitive: number;
  uncertainCandidates: number;
  files: ImportFileReport[];
  notes: string[];
  scopeMapping?: Record<string, MemoryScope>;
  snapshotPath?: string;
  scopeCounts?: Partial<Record<MemoryScope, number>>;
}

export interface ExportReport {
  exportId: string;
  kind: "memory" | "profile" | "session";
  format: "json" | "jsonl";
  createdAt: string;
  outputPath: string;
  itemCount: number;
  sessionId?: string;
  scopeCounts?: Partial<Record<MemoryScope, number>>;
}

export interface PruneReport {
  pruneId: string;
  createdAt: string;
  dryRun: boolean;
  scanned: number;
  pruned: number;
  ids: string[];
  notes: string[];
}

export interface MaintenanceReport {
  operation: "reindex" | "compact";
  reportId: string;
  createdAt: string;
  dryRun: boolean;
  scanned: number;
  changed: number;
  ids: string[];
  hygieneScore: number;
  notes: string[];
}

export interface PluginRunContext {
  runId: string;
  sessionId: string;
  prompt: PromptBuild;
  state: SessionState;
  memories: MemoryRecord[];
  compression: CompressionResult;
  toolResults: CompactedToolResult[];
  memoryCandidates: number;
  memoryWriteCount: number;
  toolTokensSaved: number;
  retrievalMode: RetrievalMode;
  keywordContribution: number;
  semanticContribution: number;
  provider: string;
  model: string;
  usage?: {
    input?: number;
    output?: number;
    total?: number;
  };
  lastUpdatedAt: string;
}
