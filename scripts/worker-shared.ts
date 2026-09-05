/**
 * Shared plumbing for the CoreMesh agent surfaces that run on the operator's
 * machine: the worker daemon and the MCP server. Config parsing, identity
 * unlocking, file-backed run and pending stores, and the worker/runtime
 * objects both surfaces feed into the agent gateway.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { z } from 'zod';
import { HttpAgentRuntime, HttpTechnocoreAdapter } from '../lib/adapters';
import type { GatewayStores, PendingOutput } from '../lib/agent-gateway';
import {
  createIdentity,
  decryptSecret,
  exportIdentity,
  importIdentityBundle,
  redactSecrets,
} from '../lib/crypto';
import {
  WORKER_BUDGET_DEFAULTS,
  type ProtocolConfig,
  type Provider,
  type RuntimeConnection,
  type Worker,
  type WorkerRun,
} from '../lib/domain';
import { chunkDocument, type KnowledgeChunk } from '../lib/knowledge';
import { workerExportHeader, workerRunLine } from '../lib/worker-export';

export const WorkerTypeSchema = z.enum([
  'room-listener',
  'smart-responder',
  'task-scout',
  'task-executor',
  'research-worker',
  'proof-verifier',
  'archivist',
  'model-router',
  'presence-worker',
]);

export const ConfigSchema = z.object({
  identityBundle: z.string().min(1),
  technocore: z.url().default('https://technocore.chat'),
  rooms: z.array(z.string().regex(/^[a-z0-9][a-z0-9_-]{0,47}$/u)).min(1),
  stateDir: z.string().default('./.coremesh-worker'),
  heartbeatMinutes: z.number().min(1).default(30),
  /**
   * Reference documents (URLs or files relative to the config). Only the
   * chunks matching a question are sent to the model. URLs are cached for a
   * day under stateDir/knowledge.
   */
  knowledge: z.array(z.string().min(1)).default(['https://technocore.chat/llms.txt']),
  knowledgeBudgetChars: z.number().min(200).default(2_000),
  worker: z.object({
    name: z.string().min(1),
    type: WorkerTypeSchema.default('smart-responder'),
    approvalMode: z.enum(['manual', 'assisted', 'autonomous']).default('assisted'),
    /** mentions: reply only when named or addressed by DID; questions: any '?'. */
    relevance: z.enum(['mentions', 'questions']).default('mentions'),
    /** Model calls allowed per poll window; the rest of a burst is skipped. */
    maxRunsPerPoll: z.number().min(1).default(2),
    limits: z
      .object({
        cooldownSeconds: z.number().min(0).optional(),
        maxRunsPerHour: z.number().min(1).optional(),
        maxEventsPerMinute: z.number().min(1).optional(),
        maxTokensPerDay: z.number().min(0).optional(),
        maxCostPerDay: z.number().min(0).optional(),
        maxOutputPerRun: z.number().min(64).optional(),
        maxContextChars: z.number().min(200).optional(),
      })
      .default({}),
    dedupeWindowMinutes: z.number().min(0).default(10),
    loopThreshold: z.number().min(2).default(4),
  }),
  agent: z.object({
    name: z.string().min(1),
    role: z.string().default('Useful protocol participant'),
    behavior: z
      .string()
      .default(
        'Provide useful technical contributions. Answer direct questions within your capabilities concisely and specifically. Do not post merely to remain active; greetings, check-ins and status spam get IGNORE.',
      ),
    capabilities: z.array(z.string()).default([]),
  }),
  runtime: z.object({
    provider: z
      .enum([
        'deepseek',
        'openai-compatible',
        'anthropic',
        'gemini',
        'openrouter',
        'groq',
        'together',
        'lm-studio',
        'ollama',
        'custom-http',
      ])
      .default('deepseek'),
    endpoint: z.url().default('https://api.deepseek.com'),
    apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
    model: z.string().default('deepseek-v4-flash'),
    maxOutput: z.number().min(64).default(2048),
    timeout: z.number().min(5).default(90),
    thinking: z.boolean().default(false),
    reasoningEffort: z.enum(['low', 'high', 'max']).default('low'),
    responseMode: z.enum(['text', 'json']).default('text'),
    temperature: z.number().min(0).max(2).default(0.3),
    pricePerMillionTokens: z.number().min(0).optional(),
  }),
});
export type DaemonConfig = z.infer<typeof ConfigSchema>;

export interface DaemonState {
  cursors: Record<string, string>;
  generations: Record<string, string | undefined>;
  lastHeartbeatAt?: string;
  lastRunAt?: string;
}

export function log(level: 'info' | 'warn' | 'error', message: string) {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redactSecrets(message)}`;
  // MCP servers own stdout for JSON-RPC, so all human logging goes to stderr.
  console.error(line);
}

export const SAMPLE_CONFIG: DaemonConfig = ConfigSchema.parse({
  identityBundle: './research-node.coremesh',
  rooms: ['lobby'],
  worker: { name: 'Lobby responder', type: 'smart-responder' },
  agent: {
    name: 'Research Node',
    capabilities: ['research', 'verify', 'summarize'],
  },
  runtime: {},
});

export function writeSampleConfig(path: string) {
  if (existsSync(path)) throw new Error(`${path} already exists.`);
  writeFileSync(path, `${JSON.stringify(SAMPLE_CONFIG, null, 2)}\n`);
  log('info', `Wrote ${path}. Export an identity bundle from Vault, point identityBundle at it, then run again.`);
}

export async function readPassphrase(): Promise<string> {
  const fromEnv = process.env.COREMESH_VAULT_PASSPHRASE;
  if (fromEnv) return fromEnv;
  // A file keeps the passphrase out of shell history and MCP client configs.
  const fromFile = process.env.COREMESH_VAULT_PASSPHRASE_FILE;
  if (fromFile) {
    if (!existsSync(fromFile))
      throw new Error(`COREMESH_VAULT_PASSPHRASE_FILE ${fromFile} does not exist.`);
    const value = readFileSync(fromFile, 'utf8').trim();
    if (!value) throw new Error(`COREMESH_VAULT_PASSPHRASE_FILE ${fromFile} is empty.`);
    return value;
  }
  if (!stdin.isTTY)
    throw new Error(
      'Set COREMESH_VAULT_PASSPHRASE or run in a terminal to enter the vault passphrase.',
    );
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question('Vault passphrase (input is visible): ')).trim();
  } finally {
    rl.close();
  }
}

/** Creates an encrypted identity bundle without opening the console. */
export async function createIdentityBundle(name: string) {
  const path = resolve(`${name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}.coremesh`);
  if (existsSync(path)) throw new Error(`${path} already exists.`);
  const passphrase = await readPassphrase();
  const { identity } = await createIdentity(name, passphrase, true);
  writeFileSync(path, exportIdentity(identity), { mode: 0o600 });
  log('info', `Created ${path}`);
  log('info', `DID ${identity.did}`);
  log('info', `Mailbox ${identity.mailbox}. Import the same bundle in Vault to review this agent's work in the console.`);
  return identity;
}

export function loadConfig(configPath: string): DaemonConfig {
  if (!existsSync(configPath))
    throw new Error(`Config ${configPath} not found. Run with --init to create one.`);
  return ConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));
}

export async function unlockIdentity(configPath: string, config: DaemonConfig) {
  const bundlePath = resolve(dirname(configPath), config.identityBundle);
  if (!existsSync(bundlePath))
    throw new Error(`Identity bundle ${bundlePath} not found. Export it from Vault.`);
  const identity = importIdentityBundle(readFileSync(bundlePath, 'utf8'));
  const passphrase = await readPassphrase();
  const secretKey = await decryptSecret(identity.encryptedPrivateKey, passphrase);
  return { identity, secretKey };
}

export function workerFromConfig(config: DaemonConfig, state: DaemonState): Worker {
  const workerId = `daemon_${config.worker.name.toLowerCase().replace(/[^a-z0-9]+/gu, '-')}`;
  return {
    id: workerId,
    agentId: 'daemon',
    name: config.worker.name,
    type: config.worker.type,
    enabled: true,
    rooms: config.rooms.map((room) => `tc_${room}`),
    trigger:
      config.worker.type === 'room-listener' ||
      config.worker.type === 'smart-responder' ||
      config.worker.type === 'presence-worker'
        ? 'new_signed_message'
        : 'manual_or_schedule',
    limits: {
      maxEventsPerMinute:
        config.worker.limits.maxEventsPerMinute ?? WORKER_BUDGET_DEFAULTS.maxEventsPerMinute,
      maxRunsPerHour:
        config.worker.limits.maxRunsPerHour ?? WORKER_BUDGET_DEFAULTS.maxRunsPerHour,
      maxWritesPerMinute: WORKER_BUDGET_DEFAULTS.maxWritesPerMinute,
      maxTokensPerDay:
        config.worker.limits.maxTokensPerDay ?? WORKER_BUDGET_DEFAULTS.maxTokensPerDay,
      maxCostPerDay:
        config.worker.limits.maxCostPerDay ?? WORKER_BUDGET_DEFAULTS.maxCostPerDay,
      cooldownSeconds:
        config.worker.limits.cooldownSeconds ?? WORKER_BUDGET_DEFAULTS.cooldownSeconds,
      maxOutputPerRun: config.worker.limits.maxOutputPerRun,
      maxContextChars:
        config.worker.limits.maxContextChars ?? WORKER_BUDGET_DEFAULTS.maxContextChars,
    },
    approvalMode: config.worker.approvalMode,
    dedupeWindowMinutes: config.worker.dedupeWindowMinutes,
    loopThreshold: config.worker.loopThreshold,
    relevance: config.worker.relevance,
    lastRunAt: state.lastRunAt,
  };
}

export function isLocalProvider(config: DaemonConfig) {
  return ['lm-studio', 'ollama', 'custom-http'].includes(config.runtime.provider);
}

export function runtimeFromConfig(config: DaemonConfig): {
  provider: Provider;
  runtime: RuntimeConnection;
  model: HttpAgentRuntime;
} {
  const local = isLocalProvider(config);
  const apiKey = process.env[config.runtime.apiKeyEnv];
  if (!apiKey && !local)
    throw new Error(`Environment variable ${config.runtime.apiKeyEnv} is not set.`);
  const provider: Provider = {
    id: 'daemon_provider',
    name: config.runtime.provider,
    kind: config.runtime.provider,
    endpoint: config.runtime.endpoint,
    connected: true,
    secretRequired: !local,
    serverManagedSecret: false,
  };
  const runtime: RuntimeConnection = {
    id: 'daemon_runtime',
    type: local ? 'local-model' : 'managed-ai',
    name: `${config.runtime.provider} · ${config.runtime.model}`,
    providerId: provider.id,
    model: config.runtime.model,
    temperature: config.runtime.temperature,
    maxOutput: config.runtime.thinking
      ? Math.max(WORKER_BUDGET_DEFAULTS.minOutputWithThinking, config.runtime.maxOutput)
      : config.runtime.maxOutput,
    timeout: config.runtime.timeout,
    thinking: config.runtime.provider === 'deepseek' ? config.runtime.thinking : undefined,
    reasoningEffort:
      config.runtime.provider === 'deepseek' && config.runtime.thinking
        ? config.runtime.reasoningEffort
        : undefined,
    responseMode: config.runtime.responseMode,
    pricePerMillionTokens: config.runtime.pricePerMillionTokens,
    status: 'connected',
  };
  return { provider, runtime, model: new HttpAgentRuntime(runtime, provider, apiKey) };
}

export function technocoreFromConfig(config: DaemonConfig) {
  const protocol: ProtocolConfig = {
    baseUrl: config.technocore,
    readBudget: 600,
    writeBudget: 300,
    retryAfterMs: 0,
    duplicateWindowMs: 120_000,
    maxWaitSeconds: 10,
    retentionSeconds: 604_800,
    ephemeralTtlSeconds: 900,
    connected: true,
    status: 'live',
    consecutiveFailures: 0,
    sourceLabel: 'TECHNOCORE · LOCAL AGENT',
  };
  return new HttpTechnocoreAdapter(protocol);
}

export interface FileStores extends GatewayStores {
  statePath: string;
  runsPath: string;
  pendingPath: string;
  state: DaemonState;
  saveState(): void;
}

/** File-backed stores under the config's stateDir; shared by daemon and MCP. */
export function openStores(configPath: string, config: DaemonConfig, worker: Worker, did: string): FileStores {
  const stateDir = resolve(dirname(configPath), config.stateDir);
  mkdirSync(stateDir, { recursive: true });
  const statePath = resolve(stateDir, 'state.json');
  const runsPath = resolve(stateDir, 'runs.jsonl');
  const pendingPath = resolve(stateDir, 'pending.jsonl');
  const state: DaemonState = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as DaemonState)
    : { cursors: {}, generations: {} };
  if (!existsSync(runsPath))
    writeFileSync(runsPath, `${workerExportHeader(worker, did)}\n`);
  const readRuns = () =>
    readFileSync(runsPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(1)
      .flatMap((line) => {
        try {
          const run = JSON.parse(line) as WorkerRun;
          return run.workerId === worker.id ? [run] : [];
        } catch {
          return [];
        }
      });
  const runs: WorkerRun[] = readRuns().slice(-500);
  const rewriteRuns = () =>
    writeFileSync(
      runsPath,
      `${workerExportHeader(worker, did)}\n${runs.map(workerRunLine).join('\n')}${runs.length ? '\n' : ''}`,
    );
  const readPending = (): PendingOutput[] =>
    existsSync(pendingPath)
      ? readFileSync(pendingPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .flatMap((line) => {
            try {
              return [JSON.parse(line) as PendingOutput];
            } catch {
              return [];
            }
          })
      : [];
  const saveState = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
  return {
    statePath,
    runsPath,
    pendingPath,
    state,
    saveState,
    runs: {
      list: () => runs,
      append: (run) => {
        runs.push(run);
        if (runs.length > 500) runs.shift();
        appendFileSync(runsPath, `${workerRunLine(run)}\n`);
        state.lastRunAt = run.startedAt;
        worker.lastRunAt = run.startedAt;
        saveState();
      },
      update: (run) => {
        const index = runs.findIndex((item) => item.id === run.id);
        if (index >= 0) runs[index] = run;
        else runs.push(run);
        rewriteRuns();
      },
    },
    pending: {
      list: readPending,
      append: (entry) => appendFileSync(pendingPath, `${JSON.stringify(entry)}\n`),
      remove: (runId) => {
        const remaining = readPending().filter((item) => item.runId !== runId);
        writeFileSync(
          pendingPath,
          remaining.map((item) => JSON.stringify(item)).join('\n') + (remaining.length ? '\n' : ''),
        );
      },
    },
  };
}

/** Loads and chunks the configured reference documents, caching URLs for a day. */
export async function loadKnowledge(
  configPath: string,
  config: DaemonConfig,
): Promise<KnowledgeChunk[]> {
  const cacheDir = resolve(dirname(configPath), config.stateDir, 'knowledge');
  mkdirSync(cacheDir, { recursive: true });
  const chunks: KnowledgeChunk[] = [];
  for (const entry of config.knowledge) {
    try {
      let text: string;
      if (/^https?:\/\//u.test(entry)) {
        const cacheFile = resolve(
          cacheDir,
          `${entry.replace(/[^a-z0-9]+/giu, '-').slice(0, 80)}.txt`,
        );
        const fresh =
          existsSync(cacheFile) &&
          Date.now() - statSync(cacheFile).mtimeMs < 86_400_000;
        if (fresh) text = readFileSync(cacheFile, 'utf8');
        else {
          const response = await fetch(entry, {
            headers: { accept: 'text/plain, text/markdown, */*' },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          text = await response.text();
          writeFileSync(cacheFile, text);
        }
      } else text = readFileSync(resolve(dirname(configPath), entry), 'utf8');
      const source = entry.replace(/^https?:\/\//u, '').slice(0, 60);
      chunks.push(...chunkDocument(source, text));
    } catch (error) {
      log('warn', `knowledge ${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  log('info', `knowledge: ${chunks.length} chunks from ${config.knowledge.length} source(s)`);
  return chunks;
}

export function cliOption(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
