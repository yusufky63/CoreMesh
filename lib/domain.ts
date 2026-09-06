export type RoomKind =
  | 'public'
  | 'private'
  | 'mailbox'
  | 'private-mailbox'
  | 'owned'
  | 'ephemeral'
  | 'private-ephemeral';
export type RuntimeType =
  | 'managed-ai'
  | 'local-model'
  | 'external-agent'
  | 'mcp'
  | 'agent-skill'
  | 'http'
  | 'identity-only';
export type ApprovalMode = 'manual' | 'assisted' | 'autonomous';
export type TaskStatus =
  | 'draft'
  | 'open'
  | 'applied'
  | 'assigned'
  | 'running'
  | 'submitted'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'disputed'
  | 'cancelled';

export interface Identity {
  id: string;
  name: string;
  did: string;
  fingerprint: string;
  publicKey: string;
  encryptedPrivateKey: string;
  x25519PublicKey?: string;
  encryptedX25519PrivateKey?: string;
  mailbox?: string;
  createdAt: string;
  /** Set when the DID note (mailbox + X25519) was last published to Technocore. */
  profilePublishedAt?: string;
}

export interface EncryptedBundle {
  version: 1;
  algorithm: 'argon2id-aes-256-gcm';
  salt: string;
  iv: string;
  ciphertext: string;
}

export interface Provider {
  id: string;
  name: string;
  kind:
    | 'openai-compatible'
    | 'anthropic'
    | 'gemini'
    | 'deepseek'
    | 'openrouter'
    | 'groq'
    | 'together'
    | 'lm-studio'
    | 'ollama'
    | 'custom-http';
  endpoint: string;
  connected: boolean;
  secretRequired: boolean;
  serverManagedSecret?: boolean;
  lastTest?: string;
  lastLatencyMs?: number;
  models?: string[];
}

export interface RuntimeConnection {
  id: string;
  type: RuntimeType;
  name: string;
  endpoint?: string;
  providerId?: string;
  model?: string;
  temperature?: number;
  maxOutput?: number;
  timeout?: number;
  fallbackRuntimeId?: string;
  thinking?: boolean;
  reasoningEffort?: 'low' | 'high' | 'max';
  responseMode?: 'text' | 'json';
  /** Operator-entered blended price in USD per million tokens; enables cost budgets. */
  pricePerMillionTokens?: number;
  status: 'untested' | 'connected' | 'error';
}

export interface Agent {
  id: string;
  identityId: string;
  runtimeId: string;
  name: string;
  role: string;
  capabilities: string[];
  behavior: string;
  /** Operator-provided reference text; only matching chunks reach a run. */
  knowledge?: string;
  trusted: boolean;
}

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  topic: string;
  source: 'technocore' | 'local';
  createdAt: string;
  ownerDid?: string;
  bookmarked: boolean;
  messageCount: number;
  signedPercent: number;
  /** Server-computed engagement aggregates from `/rooms?format=json`. */
  engagement?: {
    idleSeconds?: number;
    bytes?: number;
    window?: number;
    zeroResponseShare?: number;
    nickDiversity?: number;
  };
}

export interface ProtocolMessage {
  id: string;
  roomId: string;
  from: string;
  text: string;
  createdAt: string;
  seq: string;
  nonce: string;
  signature?: string;
  verified: boolean;
  encrypted?: boolean;
  inReplyTo?: string;
  recipientDid?: string;
}

export interface E2ESession {
  id: string;
  identityId: string;
  peerDid: string;
  roomName: string;
  sealedEnvelope: string;
  createdAt: string;
}

export interface WorkerLimits {
  maxEventsPerMinute: number;
  maxRunsPerHour: number;
  maxWritesPerMinute: number;
  maxTokensPerDay: number;
  maxCostPerDay: number;
  cooldownSeconds: number;
  /** Per-run output cap; the runtime's own cap still applies when lower. */
  maxOutputPerRun?: number;
  /** Characters of room context handed to the model per run. */
  maxContextChars?: number;
}

export const WORKER_BUDGET_DEFAULTS = {
  cooldownSeconds: 30,
  maxRunsPerHour: 20,
  maxEventsPerMinute: 20,
  maxWritesPerMinute: 3,
  maxTokensPerDay: 200_000,
  maxCostPerDay: 10,
  maxContextChars: 4_000,
  /** Per-run output caps by worker type: chat-sized replies stay small. */
  maxOutputPerRun: {
    'room-listener': 800,
    'smart-responder': 1_200,
    'presence-worker': 400,
    'proof-verifier': 1_200,
    'model-router': 800,
    archivist: 1_600,
    'task-scout': 1_600,
    'task-executor': 4_096,
    'research-worker': 4_096,
  } as Record<Worker['type'], number>,
  /** DeepSeek thinking needs room for reasoning before the answer. */
  minOutputWithThinking: 2_048,
};

export function workerOutputCap(worker: Worker, runtimeMax?: number): number {
  const cap =
    worker.limits.maxOutputPerRun ??
    WORKER_BUDGET_DEFAULTS.maxOutputPerRun[worker.type] ??
    1_600;
  return Math.max(64, Math.min(cap, runtimeMax ?? cap));
}

export function estimateRunCost(
  tokens: number | undefined,
  pricePerMillionTokens: number | undefined,
): number {
  if (!tokens || !pricePerMillionTokens || pricePerMillionTokens <= 0)
    return 0;
  return Math.round((tokens / 1_000_000) * pricePerMillionTokens * 10_000) /
    10_000;
}

export interface Worker {
  id: string;
  agentId: string;
  name: string;
  type:
    | 'room-listener'
    | 'smart-responder'
    | 'task-scout'
    | 'task-executor'
    | 'research-worker'
    | 'proof-verifier'
    | 'archivist'
    | 'model-router'
    | 'presence-worker';
  enabled: boolean;
  rooms: string[];
  trigger: string;
  runtimeOverrideId?: string;
  limits: WorkerLimits;
  approvalMode: ApprovalMode;
  lastRunAt?: string;
  dedupeWindowMinutes: number;
  loopThreshold: number;
  /**
   * What a smart-responder treats as relevant: any question mark, or only
   * lines that mention the agent by name or DID. Mentions are the frugal
   * default for busy public rooms.
   */
  relevance?: 'questions' | 'mentions';
}

export interface WorkerRun {
  id: string;
  workerId: string;
  trigger: string;
  runtime: string;
  startedAt: string;
  durationMs: number;
  tokens: number;
  cost: number;
  decision: string;
  status: 'success' | 'ignored' | 'blocked' | 'failed';
  logs: { at: string; type: string; detail: string }[];
}

export interface TaskArtifact {
  name: string;
  uri: string;
  sha256: string;
  /** Local copy of the content so receipts can be re-verified without pasting. */
  content?: string;
}

export interface Task {
  id: string;
  ownerDid: string;
  title: string;
  description: string;
  type:
    | 'research'
    | 'code'
    | 'verify'
    | 'data'
    | 'content'
    | 'translation'
    | 'agent-to-agent'
    | 'custom';
  room?: string;
  status: TaskStatus;
  requiredCapabilities: string[];
  assignedAgentDid?: string;
  visibility: 'public' | 'private';
  memory: {
    goal: string;
    currentState: string;
    openQuestions: string;
    decisions: string;
    nextActions: string;
    version: number;
  };
  artifacts: TaskArtifact[];
  createdAt: string;
}

export interface WorkReceipt {
  version: 'coremesh-work-v1';
  taskId: string;
  agentDid: string;
  room: string;
  seq: string;
  nonce: string;
  signature: string;
  artifact: TaskArtifact;
  createdAt: string;
}

export interface ProtocolConfig {
  baseUrl: string;
  readBudget: number;
  writeBudget: number;
  retryAfterMs: number;
  duplicateWindowMs: number;
  maxWaitSeconds: number;
  retentionSeconds: number;
  ephemeralTtlSeconds: number;
  serviceVersion?: string;
  connectedAt?: string;
  connected: boolean;
  status: 'connecting' | 'live' | 'degraded' | 'offline';
  lastCheckedAt?: string;
  lastSuccessfulAt?: string;
  consecutiveFailures: number;
  sourceLabel: string;
}

export const roomPrefix: Record<RoomKind, string> = {
  public: '',
  private: 'p-',
  mailbox: 'mb-',
  'private-mailbox': 'mb-p-',
  owned: 'd-',
  ephemeral: 'e-',
  'private-ephemeral': 'e-p-',
};

export const roomKindLabel: Record<RoomKind, string> = {
  public: 'PUBLIC',
  private: 'PRIVATE',
  mailbox: 'MAILBOX',
  'private-mailbox': 'PRIVATE MAILBOX',
  owned: 'MANAGED',
  ephemeral: 'TEMPORARY',
  'private-ephemeral': 'PRIVATE TEMPORARY',
};

export const taskTransitions: Record<TaskStatus, TaskStatus[]> = {
  draft: ['open', 'cancelled'],
  open: ['applied', 'assigned', 'cancelled'],
  applied: ['assigned', 'cancelled'],
  assigned: ['running', 'cancelled'],
  running: ['submitted', 'failed', 'cancelled'],
  submitted: ['verifying', 'disputed'],
  verifying: ['completed', 'disputed', 'failed'],
  completed: [],
  failed: ['running'],
  disputed: ['verifying', 'cancelled'],
  cancelled: [],
};
