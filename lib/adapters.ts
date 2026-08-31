import { z } from 'zod';
import type {
  ProtocolConfig,
  ProtocolMessage,
  Provider,
  Room,
  RuntimeConnection,
} from './domain';
import { redactSecrets } from './crypto';

const RoomSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  kind: z
    .enum([
      'public',
      'private',
      'mailbox',
      'private-mailbox',
      'owned',
      'ephemeral',
      'private-ephemeral',
    ])
    .default('public'),
  topic: z.string().default(''),
  createdAt: z.string().optional(),
  ownerDid: z.string().optional(),
  messageCount: z.number().optional(),
  signedPercent: z.number().optional(),
});
const MessageSchema = z.object({
  id: z.string().optional(),
  roomId: z.string().optional(),
  room: z.string().optional(),
  from: z.string(),
  text: z.string(),
  createdAt: z.string().optional(),
  seq: z.union([z.string(), z.number()]).optional(),
  nonce: z.string().optional(),
  signature: z.string().optional(),
  sig: z.string().optional(),
  verified: z.boolean().optional(),
});

export interface TechnocoreAdapter {
  listRooms(): Promise<Room[]>;
  readRoom(room: string, since?: string): Promise<ProtocolMessage[]>;
  sendSignedMessage(room: string, message: ProtocolMessage): Promise<void>;
  getNote(namespace: string, key: string): Promise<string | null>;
  createOwnedRoom(room: Room): Promise<void>;
  exportRoom(room: string): Promise<string>;
  getConfig(): Promise<ProtocolConfig>;
}

async function checkedFetch(
  url: string,
  init: RequestInit = {},
  timeout = 15_000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = new Headers(init.headers);
    if (!headers.has('accept')) headers.set('accept', 'application/json');
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

export class HttpTechnocoreAdapter implements TechnocoreAdapter {
  constructor(private readonly config: ProtocolConfig) {
    if (!config.baseUrl || !/^https?:\/\//.test(config.baseUrl))
      throw new Error('A valid HTTP protocol endpoint is required.');
  }
  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }
  async listRooms(): Promise<Room[]> {
    const json = await (await checkedFetch(this.url('/rooms'))).json();
    const parsed = z
      .array(RoomSchema)
      .parse(Array.isArray(json) ? json : (json as { rooms?: unknown }).rooms);
    return parsed.map((room) => ({
      id: room.id || `tc_${room.name}`,
      name: room.name,
      kind: room.kind,
      topic: room.topic,
      source: 'technocore',
      createdAt: room.createdAt || new Date().toISOString(),
      ownerDid: room.ownerDid,
      bookmarked: false,
      messageCount: room.messageCount || 0,
      signedPercent: room.signedPercent || 0,
    }));
  }
  async readRoom(room: string, since?: string): Promise<ProtocolMessage[]> {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const json = await (
      await checkedFetch(
        this.url(`/rooms/${encodeURIComponent(room)}/messages${query}`),
      )
    ).json();
    const parsed = z
      .array(MessageSchema)
      .parse(
        Array.isArray(json) ? json : (json as { messages?: unknown }).messages,
      );
    return parsed.map((message, index) => ({
      id: message.id || `tcmsg_${message.seq || index}`,
      roomId: message.roomId || message.room || room,
      from: message.from,
      text: message.text,
      createdAt: message.createdAt || new Date().toISOString(),
      seq: String(message.seq || index),
      nonce: message.nonce || '',
      signature: message.signature || message.sig,
      verified: Boolean(message.verified),
    }));
  }
  async sendSignedMessage(
    room: string,
    message: ProtocolMessage,
  ): Promise<void> {
    await checkedFetch(
      this.url(`/rooms/${encodeURIComponent(room)}/messages`),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message),
      },
    );
  }
  async getNote(namespace: string, key: string): Promise<string | null> {
    const response = await checkedFetch(
      this.url(
        `/notes/${encodeURIComponent(namespace)}/${encodeURIComponent(key)}`,
      ),
    );
    const body = (await response.json()) as { value?: string | null };
    return body.value ?? null;
  }
  async createOwnedRoom(room: Room): Promise<void> {
    await checkedFetch(this.url('/rooms'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(room),
    });
  }
  async exportRoom(room: string): Promise<string> {
    return (
      await checkedFetch(
        this.url(`/rooms/${encodeURIComponent(room)}/export`),
        { headers: { accept: 'text/plain' } },
      )
    ).text();
  }
  async getConfig(): Promise<ProtocolConfig> {
    const body = (await (
      await checkedFetch(this.url('/config'))
    ).json()) as Partial<ProtocolConfig>;
    return {
      ...this.config,
      readBudget: Number(body.readBudget || this.config.readBudget),
      writeBudget: Number(body.writeBudget || this.config.writeBudget),
      retryAfterMs: Number(body.retryAfterMs || this.config.retryAfterMs),
      duplicateWindowMs: Number(
        body.duplicateWindowMs || this.config.duplicateWindowMs,
      ),
      connected: true,
      sourceLabel: body.sourceLabel || 'TECHNOCORE',
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
}
export interface AgentExecutionResult {
  text: string;
  model: string;
  tokens?: number;
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
  ) {}
  private endpoint() {
    return (this.runtime.endpoint || this.provider?.endpoint || '').replace(
      /\/$/,
      '',
    );
  }
  private headers() {
    return {
      'content-type': 'application/json',
      ...(this.sessionSecret
        ? { authorization: `Bearer ${this.sessionSecret}` }
        : {}),
    };
  }
  async test(): Promise<RuntimeHealth> {
    const started = performance.now();
    try {
      const endpoint = this.endpoint();
      if (!endpoint) throw new Error('Endpoint missing.');
      const isOllama = this.provider?.kind === 'ollama';
      const response = await checkedFetch(
        `${endpoint}${isOllama ? '/api/tags' : '/models'}`,
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
    const body = (await (
      await checkedFetch(
        `${endpoint}/chat/completions`,
        {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({
            model,
            temperature: input.temperature ?? this.runtime.temperature ?? 0.3,
            max_tokens: input.maxOutput ?? this.runtime.maxOutput ?? 1800,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: input.objective },
            ],
          }),
        },
        (this.runtime.timeout || 45) * 1000,
      )
    ).json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { total_tokens?: number };
      model?: string;
    };
    return {
      text: body.choices?.[0]?.message?.content || '',
      model: body.model || model,
      tokens: body.usage?.total_tokens,
      latencyMs: Math.round(performance.now() - started),
    };
  }
  async capabilities(): Promise<string[]> {
    return ['generate', 'classify', 'research', 'summarize'];
  }
}
