import { z } from 'zod';
import type {
  ProtocolConfig,
  ProtocolMessage,
  Provider,
  Room,
  RuntimeConnection,
} from './domain';
import {
  base64ToBytes,
  base64UrlToBytes,
  bytesToBase64,
  bytesToBase64Url,
  normalizeTechnocoreText,
  redactSecrets,
  signTechnocoreNote,
  technocoreDidFingerprint,
  verifyTechnocoreMessage,
} from './crypto';
import { parseCapabilityToken } from './tclk';

const TechnocoreMessageSchema = z.object({
  from: z.string(),
  text: z.string(),
  ts: z.string(),
  seq: z.union([z.string(), z.number()]),
  nonce: z.union([z.string(), z.number()]).optional(),
  sig: z.string().optional(),
});
const TechnocoreRoomReadSchema = z.object({
  room: z.string(),
  count: z.number(),
  first_seq: z.union([z.string(), z.number(), z.null()]).optional(),
  last_seq: z.union([z.string(), z.number()]),
  generation: z.union([z.string(), z.number()]).optional(),
  wait_held: z.boolean().optional(),
  messages: z.array(TechnocoreMessageSchema),
});

export interface TechnocoreRoomWindow {
  room: string;
  count: number;
  firstSeq?: string;
  lastSeq: string;
  generation?: string;
  waitHeld?: boolean;
  gapDetected: boolean;
  messages: ProtocolMessage[];
}
const TechnocoreConfigSchema = z.object({
  service: z.string(),
  version: z.string(),
  settings: z.object({
    rate_read: z.number(),
    rate_write: z.number(),
    max_wait: z.number(),
    dupe_filter_seconds: z.number(),
    ephemeral_ttl_seconds: z.number(),
  }),
});
const TechnocoreRoomsSchema = z.object({
  rooms: z.array(
    z.object({
      room: z.string(),
      last_seq: z.union([z.string(), z.number()]),
      bytes: z.number().nullish(),
      idle_seconds: z.number().nullish(),
      topic: z.string().nullish(),
      window: z.number().nullish(),
      zero_response_share: z.number().nullish(),
      nick_diversity: z.number().nullish(),
    }),
  ),
});
const TechnocoreAgentSchema = z.object({
  name: z.string(),
  version: z.string(),
  url: z.url(),
  limits: z.object({
    reads_per_minute_per_ip: z.number(),
    writes_per_minute_per_ip: z.number(),
    retention_seconds: z.number(),
    ephemeral_ttl_seconds: z.number(),
    duplicate_filter_seconds: z.number(),
    long_poll_seconds: z.number(),
  }),
});

const roomNamePattern = /^[a-z0-9][a-z0-9_-]{0,47}$/u;

function roomKindFromName(name: string): Room['kind'] {
  if (name.startsWith('mb-p-')) return 'private-mailbox';
  if (name.startsWith('e-p-')) return 'private-ephemeral';
  if (name.startsWith('p-')) return 'private';
  if (name.startsWith('mb-')) return 'mailbox';
  if (name.startsWith('d-')) return 'owned';
  if (name.startsWith('e-')) return 'ephemeral';
  return 'public';
}

function parseJsonPreservingNonce(raw: string): unknown {
  return JSON.parse(
    raw.replace(/("nonce"\s*:\s*)([0-9]{1,19})(?=\s*[,}])/gu, '$1"$2"'),
  );
}

type ParsedTechnocoreRoomRead = z.infer<typeof TechnocoreRoomReadSchema>;

function mapParsedRoomRead(
  room: string,
  parsed: ParsedTechnocoreRoomRead,
): ProtocolMessage[] {
  return parsed.messages.map((message) => {
    const nonce = message.nonce === undefined ? '' : String(message.nonce);
    const signature = message.sig;
    return {
      id: `tcmsg_${room}_${String(message.seq)}`,
      roomId: `tc_${room}`,
      from: message.from,
      text: message.text,
      createdAt: message.ts,
      seq: String(message.seq),
      nonce,
      signature,
      verified: Boolean(
        signature &&
        nonce &&
        verifyTechnocoreMessage(
          room,
          nonce,
          message.text,
          signature,
          message.from,
        ),
      ),
    };
  });
}

function mapRoomRead(room: string, value: unknown): ProtocolMessage[] {
  return mapParsedRoomRead(room, TechnocoreRoomReadSchema.parse(value));
}

/**
 * Technocore prefixes plain-text reads with a "!! UNTRUSTED CONTENT" banner
 * line. It is not part of the stored value, so it must not reach CAS
 * comparisons or the UI.
 */
export function stripUntrustedBanner(text: string): string {
  if (!text.startsWith('!! UNTRUSTED CONTENT')) return text;
  const rest = text.slice(text.indexOf(String.fromCharCode(10)) + 1);
  return rest.replace(/^\s+/u, '');
}

export interface TechnocoreAdapter {
  checkHealth(): Promise<number>;
  listRooms(): Promise<Room[]>;
  readRoomState(
    room: string,
    since?: string,
    limit?: number,
  ): Promise<TechnocoreRoomWindow>;
  readRoom(room: string, since?: string): Promise<ProtocolMessage[]>;
  waitForRoomState(
    room: string,
    since: string,
    waitSeconds?: number,
  ): Promise<TechnocoreRoomWindow>;
  waitForRoom(
    room: string,
    since: string,
    waitSeconds?: number,
  ): Promise<ProtocolMessage[]>;
  sendSignedMessage(
    room: string,
    message: ProtocolMessage,
  ): Promise<ProtocolMessage[]>;
  getNote(namespace: string, key: string): Promise<string | null>;
  setNote(namespace: string, key: string, value: string): Promise<void>;
  resolveProfile(did: string): Promise<TechnocoreProfile | null>;
  publishProfile(
    did: string,
    mailbox: string,
    x25519PublicKey?: string,
    rails?: string[],
  ): Promise<void>;
  setNoteConditional(
    namespace: string,
    key: string,
    value: string,
    condition: { ifAbsent?: boolean; expected?: string },
  ): Promise<boolean>;
  claimOwnedRoom(
    room: string,
    did: string,
    secretKey: Uint8Array,
  ): Promise<void>;
  exportRoom(room: string): Promise<string>;
  getConfig(): Promise<ProtocolConfig>;
}

export interface TechnocoreProfile {
  did: string;
  mailbox?: string;
  x25519PublicKey?: string;
  /** Settlement rails advertised through a `tclk1:` capability token (routing hint only). */
  rails?: string[];
  noteAddress: string;
}

async function checkedFetch(
  url: string,
  init: RequestInit = {},
  timeout = 15_000,
  label = 'Endpoint',
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError')
        throw new Error(`${label} request timed out.`);
      throw new Error(
        `${label} is unreachable from this browser (network error or missing CORS headers).`,
      );
    }
    if (!response.ok) {
      const firstLine = (await response.text()).split('\n')[0] || '';
      let detail = firstLine;
      try {
        const parsed = JSON.parse(firstLine) as {
          error?: unknown;
          message?: unknown;
        };
        const nested =
          typeof parsed.error === 'string'
            ? parsed.error
            : parsed.error &&
                typeof parsed.error === 'object' &&
                typeof (parsed.error as { message?: unknown }).message ===
                  'string'
              ? (parsed.error as { message: string }).message
              : typeof parsed.message === 'string'
                ? parsed.message
                : '';
        if (nested) detail = nested;
      } catch {
        // Not JSON; keep the raw first line.
      }
      detail = redactSecrets(detail);
      const retry = response.headers.get('retry-after');
      throw new Error(
        `${label} HTTP ${response.status}${detail ? ` — ${detail.slice(0, 180)}` : ''}${retry ? ` · retry in ${retry}s` : ''}`,
      );
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

const technocoreFetch = (
  url: string,
  init: RequestInit = {},
  timeout = 15_000,
) => checkedFetch(url, init, timeout, 'Technocore');

export class HttpTechnocoreAdapter implements TechnocoreAdapter {
  private pollCounter = 0;

  constructor(private readonly config: ProtocolConfig) {
    if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl))
      throw new Error('A valid HTTP protocol endpoint is required.');
  }
  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }
  async checkHealth(): Promise<number> {
    const startedAt = performance.now();
    await technocoreFetch(
      this.url('/healthz'),
      { headers: { accept: 'text/plain' }, cache: 'no-store' },
      6_000,
    );
    return Math.max(0, Math.round(performance.now() - startedAt));
  }
  async listRooms(): Promise<Room[]> {
    const response = await technocoreFetch(
      this.url('/rooms?format=json&limit=200'),
    );
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const json = TechnocoreRoomsSchema.safeParse(parsed);
    if (json.success)
      return json.data.rooms
        .filter((entry) => roomNamePattern.test(entry.room))
        .map(
          (entry): Room => ({
            id: `tc_${entry.room}`,
            name: entry.room,
            kind: roomKindFromName(entry.room),
            topic: entry.topic || '',
            source: 'technocore',
            createdAt: new Date().toISOString(),
            bookmarked: false,
            messageCount: Number(entry.last_seq),
            signedPercent: 0,
            engagement: {
              idleSeconds: entry.idle_seconds ?? undefined,
              bytes: entry.bytes ?? undefined,
              window: entry.window ?? undefined,
              zeroResponseShare: entry.zero_response_share ?? undefined,
              nickDiversity: entry.nick_diversity ?? undefined,
            },
          }),
        );
    return this.listRoomsFromText(text);
  }
  /** Fallback for deployments older than 0.11 that only serve the text listing. */
  private listRoomsFromText(text: string): Room[] {
    return text
      .split('\n')
      .filter((line) => line.startsWith('/r/'))
      .map((line): Room | null => {
        const separator = line.indexOf('  · ');
        const record = separator >= 0 ? line.slice(0, separator) : line;
        const topic = separator >= 0 ? line.slice(separator + 4).trim() : '';
        const match = record.match(/^\/r\/(\S+)\s+seq\s+([0-9]+)\s+/u);
        if (!match || !roomNamePattern.test(match[1])) return null;
        const name = match[1];
        return {
          id: `tc_${name}`,
          name,
          kind: roomKindFromName(name),
          topic,
          source: 'technocore',
          createdAt: new Date().toISOString(),
          bookmarked: false,
          messageCount: Number(match[2]),
          signedPercent: 0,
        };
      })
      .filter((room): room is Room => Boolean(room));
  }
  private async readRoomWindow(
    room: string,
    options: { since?: string; waitSeconds?: number; limit?: number } = {},
  ): Promise<TechnocoreRoomWindow> {
    if (!roomNamePattern.test(room))
      throw new Error('Invalid Technocore room.');
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
    const query = new URLSearchParams({ format: 'json', limit: String(limit) });
    if (options.since) query.set('since', options.since);
    if (options.waitSeconds !== undefined) {
      if (!options.since)
        throw new Error('Technocore long polling requires a sequence cursor.');
      const maximum = Math.min(this.config.maxWaitSeconds || 10, 10);
      const wait = Math.max(
        1,
        Math.min(Math.floor(options.waitSeconds), maximum),
      );
      query.set('wait', String(wait));
      this.pollCounter += 1;
      query.set('n', String(this.pollCounter));
    }
    const raw = await (
      await technocoreFetch(
        this.url(`/r/${encodeURIComponent(room)}?${query.toString()}`),
      )
    ).text();
    const parsed = TechnocoreRoomReadSchema.parse(
      parseJsonPreservingNonce(raw),
    );
    if (
      options.waitSeconds !== undefined &&
      parsed.messages.length === 0 &&
      parsed.wait_held === false
    ) {
      const delay = Math.max(
        1,
        Math.min(
          Math.floor(options.waitSeconds),
          Math.min(this.config.maxWaitSeconds || 10, 10),
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, delay * 1000));
    }
    const firstSeq =
      parsed.first_seq === undefined || parsed.first_seq === null
        ? undefined
        : String(parsed.first_seq);
    return {
      room: parsed.room,
      count: parsed.count,
      firstSeq,
      lastSeq: String(parsed.last_seq),
      generation:
        parsed.generation === undefined ? undefined : String(parsed.generation),
      waitHeld: parsed.wait_held,
      gapDetected: Boolean(
        options.since &&
        firstSeq &&
        BigInt(firstSeq) > BigInt(options.since) + BigInt(1),
      ),
      messages: mapParsedRoomRead(room, parsed),
    };
  }
  async readRoomState(
    room: string,
    since?: string,
    limit?: number,
  ): Promise<TechnocoreRoomWindow> {
    return this.readRoomWindow(room, { since, limit });
  }
  async readRoom(room: string, since?: string): Promise<ProtocolMessage[]> {
    return (await this.readRoomState(room, since)).messages;
  }
  async waitForRoomState(
    room: string,
    since: string,
    waitSeconds = 10,
  ): Promise<TechnocoreRoomWindow> {
    if (!/^[0-9]+$/u.test(since))
      throw new Error('Technocore sequence cursor must contain digits.');
    return this.readRoomWindow(room, { since, waitSeconds });
  }
  async waitForRoom(
    room: string,
    since: string,
    waitSeconds = 10,
  ): Promise<ProtocolMessage[]> {
    return (await this.waitForRoomState(room, since, waitSeconds)).messages;
  }
  async sendSignedMessage(
    room: string,
    message: ProtocolMessage,
  ): Promise<ProtocolMessage[]> {
    if (!roomNamePattern.test(room))
      throw new Error('Invalid Technocore room.');
    if (!message.signature)
      throw new Error('A Technocore signature is required.');
    if (!/^[0-9]{1,19}$/u.test(message.nonce))
      throw new Error('Technocore nonce must contain 1–19 digits.');
    const text = normalizeTechnocoreText(message.text);
    const path = `/r/${encodeURIComponent(room)}/say-signed/${encodeURIComponent(message.from)}/${encodeURIComponent(message.signature)}/${message.nonce}/${encodeURIComponent(text)}?format=json`;
    const target = this.url(path);
    const usePost = new TextEncoder().encode(target).length > 14_000;
    const response = usePost
      ? await technocoreFetch(
          this.url(`/r/${encodeURIComponent(room)}?format=json`),
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              did: message.from,
              sig: message.signature,
              nonce: message.nonce,
              text,
            }),
          },
        )
      : await technocoreFetch(target);
    const raw = await response.text();
    if (response.headers.get('content-type')?.includes('application/json'))
      return mapRoomRead(room, parseJsonPreservingNonce(raw));
    return this.readRoom(room);
  }
  async getNote(namespace: string, key: string): Promise<string | null> {
    if (!roomNamePattern.test(namespace) || !roomNamePattern.test(key))
      throw new Error('Invalid Technocore note address.');
    const response = await fetch(
      this.url(
        `/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
      ),
      { headers: { accept: 'text/plain' } },
    );
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Technocore HTTP ${response.status}`);
    const value = stripUntrustedBanner(await response.text());
    return value || null;
  }
  async setNote(
    namespace: string,
    key: string,
    rawValue: string,
  ): Promise<void> {
    if (!roomNamePattern.test(namespace) || !roomNamePattern.test(key))
      throw new Error('Invalid Technocore note address.');
    const value = normalizeTechnocoreText(rawValue);
    if (!value) throw new Error('Technocore note value is required.');
    if (Array.from(value).length > 8192)
      throw new Error('Technocore notes are limited to 8192 characters.');
    const target = this.url(
      `/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/set/${encodeURIComponent(value)}`,
    );
    if (new TextEncoder().encode(target).length > 14_000) {
      await technocoreFetch(
        this.url(
          `/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
        ),
        {
          method: 'POST',
          headers: {
            accept: 'text/plain',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ value }),
        },
      );
      return;
    }
    await technocoreFetch(target, { headers: { accept: 'text/plain' } });
  }
  /**
   * Compare-and-set note write. `ifAbsent` only creates; `expected` replaces
   * only when the current value matches. Returns false on a 409 conflict.
   */
  async setNoteConditional(
    namespace: string,
    key: string,
    rawValue: string,
    condition: { ifAbsent?: boolean; expected?: string },
  ): Promise<boolean> {
    if (!roomNamePattern.test(namespace) || !roomNamePattern.test(key))
      throw new Error('Invalid Technocore note address.');
    const value = normalizeTechnocoreText(rawValue);
    if (!value) throw new Error('Technocore note value is required.');
    const query = new URLSearchParams();
    if (condition.ifAbsent) query.set('if_absent', '1');
    if (condition.expected !== undefined)
      query.set('if', normalizeTechnocoreText(condition.expected));
    const response = await fetch(
      this.url(
        `/kv/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}/set/${encodeURIComponent(value)}?${query.toString()}`,
      ),
      { headers: { accept: 'text/plain' } },
    );
    if (response.status === 409) return false;
    if (!response.ok)
      throw new Error(
        `Technocore HTTP ${response.status}${response.status === 429 ? ' — rate limited' : ''}`,
      );
    return true;
  }
  async resolveProfile(did: string): Promise<TechnocoreProfile | null> {
    const fingerprint = technocoreDidFingerprint(did);
    const shard = fingerprint.slice(0, 2);
    const key = fingerprint.slice(2);
    const sharded = await this.getNote(`did-${shard}`, key);
    const value = sharded || (await this.getNote('did', fingerprint));
    if (!value) return null;
    const tokens = value.split(/\s+/u);
    if (tokens[0] !== did) throw new Error('Technocore profile DID mismatch.');
    const mailbox = tokens
      .find((token) => token.startsWith('mailbox:'))
      ?.slice('mailbox:'.length);
    const x25519 = tokens
      .find((token) => token.startsWith('x25519:'))
      ?.slice('x25519:'.length);
    let x25519PublicKey: string | undefined;
    try {
      if (x25519) {
        const decoded = base64UrlToBytes(x25519);
        if (decoded.length === 32) x25519PublicKey = bytesToBase64(decoded);
      }
    } catch {
      x25519PublicKey = undefined;
    }
    const rails =
      tokens
        .map((token) => parseCapabilityToken(token))
        .find((value) => value !== null) ?? undefined;
    return {
      did,
      mailbox: mailbox && roomNamePattern.test(mailbox) ? mailbox : undefined,
      x25519PublicKey,
      rails,
      noteAddress: `/kv/did-${shard}/${key}`,
    };
  }
  async publishProfile(
    did: string,
    mailbox: string,
    x25519PublicKey?: string,
    rails: string[] = ['paper'],
  ): Promise<void> {
    if (!did.startsWith('did:key:z6Mk'))
      throw new Error('An Ed25519 did:key is required.');
    if (!mailbox.startsWith('mb-') || !roomNamePattern.test(mailbox))
      throw new Error('A signed Technocore mailbox is required.');
    const fingerprint = technocoreDidFingerprint(did);
    const profile = [
      did,
      x25519PublicKey
        ? `x25519:${bytesToBase64Url(base64ToBytes(x25519PublicKey))}`
        : '',
      `mailbox:${mailbox}`,
      rails.length ? `tclk1:${rails.join(',')}` : '',
    ]
      .filter(Boolean)
      .join(' ');
    await this.setNote(
      `did-${fingerprint.slice(0, 2)}`,
      fingerprint.slice(2),
      profile,
    );
  }
  async claimOwnedRoom(
    room: string,
    did: string,
    secretKey: Uint8Array,
  ): Promise<void> {
    if (!/^d-[a-z0-9][a-z0-9_-]{0,45}$/u.test(room))
      throw new Error('Only d-* Technocore rooms can be owned.');
    const nonce = Date.now().toString();
    const signed = signTechnocoreNote(
      'room-owners',
      room,
      nonce,
      did,
      secretKey,
    );
    const target = this.url(
      `/kv/room-owners/${encodeURIComponent(room)}/set-signed/${encodeURIComponent(did)}/${encodeURIComponent(signed.signature)}/${nonce}/${encodeURIComponent(signed.value)}?if_absent=1`,
    );
    await technocoreFetch(target, { headers: { accept: 'text/plain' } });
  }
  async exportRoom(room: string): Promise<string> {
    if (!roomNamePattern.test(room))
      throw new Error('Invalid Technocore room.');
    return (
      await technocoreFetch(this.url(`/r/${encodeURIComponent(room)}/export`), {
        headers: { accept: 'application/x-ndjson' },
      })
    ).text();
  }
  async getConfig(): Promise<ProtocolConfig> {
    const [configResponse, agentResponse] = await Promise.all([
      technocoreFetch(this.url('/config')),
      technocoreFetch(this.url('/.well-known/agent.json')),
    ]);
    const config = TechnocoreConfigSchema.parse(await configResponse.json());
    const agent = TechnocoreAgentSchema.parse(await agentResponse.json());
    return {
      ...this.config,
      baseUrl: agent.url.replace(/\/$/u, ''),
      readBudget: agent.limits.reads_per_minute_per_ip,
      writeBudget: agent.limits.writes_per_minute_per_ip,
      retryAfterMs: 0,
      duplicateWindowMs: config.settings.dupe_filter_seconds * 1000,
      maxWaitSeconds: agent.limits.long_poll_seconds,
      retentionSeconds: agent.limits.retention_seconds,
      ephemeralTtlSeconds: agent.limits.ephemeral_ttl_seconds,
      serviceVersion: agent.version,
      connectedAt: new Date().toISOString(),
      connected: true,
      status: 'live',
      lastCheckedAt: new Date().toISOString(),
      lastSuccessfulAt: new Date().toISOString(),
      consecutiveFailures: 0,
      sourceLabel: `TECHNOCORE · ${agent.version}`,
    };
  }
}

export interface RuntimeHealth {
  ok: boolean;
  latencyMs: number;
  detail: string;
  models?: string[];
}
export interface AgentExecutionInput {
  system: string[];
  objective: string;
  context: string;
  maxOutput?: number;
  temperature?: number;
  userId?: string;
  responseMode?: 'text' | 'json';
}
export interface AgentExecutionResult {
  text: string;
  model: string;
  tokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
  latencyMs: number;
}

export interface AgentRuntime {
  test(): Promise<RuntimeHealth>;
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
  capabilities(): Promise<string[]>;
}

export class HttpAgentRuntime implements AgentRuntime {
  constructor(
    private readonly runtime: RuntimeConnection,
    private readonly provider?: Provider,
    private readonly sessionSecret?: string,
    /** Session-only access token for the hosted CoreMesh relay. */
    private readonly relayToken?: string,
  ) {}
  private endpoint() {
    return (this.runtime.endpoint || this.provider?.endpoint || '').replace(
      /\/$/,
      '',
    );
  }
  private requestUrl(path: '/models' | '/chat/completions' | '/messages') {
    if (this.provider?.serverManagedSecret && typeof window !== 'undefined')
      return `/api/providers/${this.provider.kind}?path=${encodeURIComponent(path.replace(/^\/+/u, ''))}`;
    return `${this.endpoint()}${path}`;
  }
  private headers(): Record<string, string> {
    if (this.provider?.secretRequired && !this.sessionSecret)
      throw new Error('This provider requires a session API key.');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (
      this.provider?.serverManagedSecret &&
      typeof window !== 'undefined' &&
      this.relayToken
    )
      headers['x-coremesh-relay'] = this.relayToken;
    if (this.provider?.kind === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
      if (this.sessionSecret) headers['x-api-key'] = this.sessionSecret;
      return headers;
    }
    if (this.sessionSecret)
      headers.authorization = `Bearer ${this.sessionSecret}`;
    return headers;
  }
  async test(): Promise<RuntimeHealth> {
    const started = performance.now();
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('Endpoint missing.');
      const isOllama = this.provider?.kind === 'ollama';
      const response = await checkedFetch(
        isOllama ? `${endpoint}/api/tags` : this.requestUrl('/models'),
        { headers: this.headers() },
        this.runtime.timeout ? this.runtime.timeout * 1000 : 10_000,
      );
      const body = (await response.json()) as {
        data?: { id?: string }[];
        models?: { name?: string }[];
      };
      const models = isOllama
        ? body.models?.map((item) => item.name || '').filter(Boolean)
        : body.data?.map((item) => item.id || '').filter(Boolean);
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        detail: 'Runtime responded.',
        models,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - started),
        detail: redactSecrets(
          error instanceof Error ? error.message : 'Runtime test failed.',
        ),
      };
    }
  }
  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const started = performance.now();
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Endpoint missing.');
    const model = this.runtime.model || 'default';
    const system = `${input.system.join('\n\n')}\n\n${input.context}`;
    if (this.provider?.kind === 'ollama') {
      const body = (await (
        await checkedFetch(
          `${endpoint}/api/chat`,
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              model,
              stream: false,
              messages: [
                { role: 'system', content: system },
                { role: 'user', content: input.objective },
              ],
              options: {
                temperature:
                  input.temperature ?? this.runtime.temperature ?? 0.3,
                num_predict: input.maxOutput ?? this.runtime.maxOutput ?? 1800,
              },
            }),
          },
          (this.runtime.timeout || 45) * 1000,
        )
      ).json()) as {
        message?: { content?: string };
        eval_count?: number;
        model?: string;
      };
      return {
        text: body.message?.content || '',
        model: body.model || model,
        tokens: body.eval_count,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    if (this.provider?.kind === 'anthropic') {
      const body = (await (
        await checkedFetch(
          this.requestUrl('/messages'),
          {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
              model,
              max_tokens: input.maxOutput ?? this.runtime.maxOutput ?? 1800,
              temperature: input.temperature ?? this.runtime.temperature ?? 0.3,
              system,
              messages: [{ role: 'user', content: input.objective }],
            }),
          },
          (this.runtime.timeout || 45) * 1000,
        )
      ).json()) as {
        content?: { type?: string; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
        model?: string;
      };
      return {
        text:
          body.content
            ?.filter((item) => item.type === 'text')
            .map((item) => item.text || '')
            .join('\n') || '',
        model: body.model || model,
        tokens:
          (body.usage?.input_tokens || 0) + (body.usage?.output_tokens || 0) ||
          undefined,
        latencyMs: Math.round(performance.now() - started),
      };
    }
    const isDeepSeek = this.provider?.kind === 'deepseek';
    const thinking = this.runtime.thinking ?? false;
    const responseMode =
      input.responseMode || this.runtime.responseMode || 'text';
    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: input.maxOutput ?? this.runtime.maxOutput ?? 1800,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: input.objective },
      ],
    };
    if (isDeepSeek) {
      requestBody.thinking = { type: thinking ? 'enabled' : 'disabled' };
      if (thinking)
        requestBody.reasoning_effort = this.runtime.reasoningEffort || 'high';
      else
        requestBody.temperature =
          input.temperature ?? this.runtime.temperature ?? 1;
      if (input.userId)
        requestBody.user_id = input.userId
          .replace(/[^a-zA-Z0-9\-_]/gu, '-')
          .slice(0, 512);
    } else {
      requestBody.temperature =
        input.temperature ?? this.runtime.temperature ?? 0.3;
    }
    if (responseMode === 'json')
      requestBody.response_format = { type: 'json_object' };
    const body = (await (
      await checkedFetch(
        this.requestUrl('/chat/completions'),
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify(requestBody),
        },
        (this.runtime.timeout || 45) * 1000,
      )
    ).json()) as {
      choices?: {
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string;
      }[];
      usage?: {
        total_tokens?: number;
        prompt_cache_hit_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
      model?: string;
    };
    const choice = body.choices?.[0];
    const text = choice?.message?.content || '';
    if (!text) {
      const reasoningTokens =
        body.usage?.completion_tokens_details?.reasoning_tokens || 0;
      if (choice?.finish_reason === 'length' && (thinking || reasoningTokens))
        throw new Error(
          `The model spent the whole output budget on thinking (${reasoningTokens || 'all'} reasoning tokens, finish_reason=length). Raise the runtime's max output tokens or lower the reasoning effort.`,
        );
      throw new Error(
        `The runtime returned an empty response${choice?.finish_reason ? ` (finish_reason=${choice.finish_reason})` : ''}.`,
      );
    }
    return {
      text,
      model: body.model || model,
      tokens: body.usage?.total_tokens,
      reasoningTokens: body.usage?.completion_tokens_details?.reasoning_tokens,
      cachedTokens: body.usage?.prompt_cache_hit_tokens,
      latencyMs: Math.round(performance.now() - started),
    };
  }
  async capabilities(): Promise<string[]> {
    return ['generate', 'classify', 'research', 'summarize'];
  }
}

export async function executeAgentWithFallback(
  primary: RuntimeConnection,
  runtimes: RuntimeConnection[],
  providers: Provider[],
  sessionSecret: string | undefined,
  input: AgentExecutionInput,
  relayToken?: string,
) {
  const primaryProvider = providers.find(
    (provider) => provider.id === primary.providerId,
  );
  try {
    const result = await new HttpAgentRuntime(
      primary,
      primaryProvider,
      sessionSecret,
      relayToken,
    ).execute(input);
    return {
      result,
      runtime: primary,
      provider: primaryProvider,
      usedFallback: false,
    };
  } catch (primaryError) {
    const fallbackRuntime = runtimes.find(
      (runtime) => runtime.id === primary.fallbackRuntimeId,
    );
    if (!fallbackRuntime || fallbackRuntime.type === 'identity-only')
      throw primaryError;
    const fallbackProvider = providers.find(
      (provider) => provider.id === fallbackRuntime.providerId,
    );
    const result = await new HttpAgentRuntime(
      fallbackRuntime,
      fallbackProvider,
      sessionSecret,
      relayToken,
    ).execute({
      ...input,
      maxOutput: fallbackRuntime.maxOutput,
      temperature: fallbackRuntime.temperature,
      responseMode: fallbackRuntime.responseMode,
    });
    return {
      result,
      runtime: fallbackRuntime,
      provider: fallbackProvider,
      usedFallback: true,
    };
  }
}
