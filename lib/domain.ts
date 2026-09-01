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
  lastTest?: string;
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

export interface WorkerLimits {
  maxEventsPerMinute: number;
  maxRunsPerHour: number;
  maxWritesPerMinute: number;
  maxTokensPerDay: number;
  maxCostPerDay: number;
  cooldownSeconds: number;
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
