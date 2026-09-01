import { afterEach, describe, expect, it, vi } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import {
  HttpAgentRuntime,
  HttpTechnocoreAdapter,
  executeAgentWithFallback,
} from './adapters';
import {
  bytesToBase64,
  bytesToBase64Url,
  didFromPublicKey,
  signTechnocoreMessage,
} from './crypto';
import type {
  ProtocolConfig,
  ProtocolMessage,
  Provider,
  RuntimeConnection,
} from './domain';

const protocol: ProtocolConfig = {
  baseUrl: 'https://technocore.chat',
  readBudget: 600,
  writeBudget: 300,
  retryAfterMs: 0,
  duplicateWindowMs: 120_000,
  maxWaitSeconds: 10,
  retentionSeconds: 604_800,
  ephemeralTtlSeconds: 900,
  connected: false,
  sourceLabel: 'TECHNOCORE · READY',
};

const requestUrl = (input: RequestInfo | URL) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

afterEach(() => vi.unstubAllGlobals());

describe('Technocore HTTP adapter', () => {
  it('parses the official text room listing and composite room classes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            [
              '# untrusted room listing',
              '/r/research                 seq 42          12K  1s ago  · evidence only',
              '/r/mb-p-secret              seq 7           2K  2s ago',
              '/r/e-p-session              seq 9           3K  3s ago',
            ].join('\n'),
            { headers: { 'content-type': 'text/plain' } },
          ),
      ),
    );

    const rooms = await new HttpTechnocoreAdapter(protocol).listRooms();
    expect(rooms).toMatchObject([
      { id: 'tc_research', kind: 'public', topic: 'evidence only' },
      { id: 'tc_mb-p-secret', kind: 'private-mailbox' },
      { id: 'tc_e-p-session', kind: 'private-ephemeral' },
    ]);
  });

  it('reads and independently verifies official signed room records', async () => {
    const secretKey = new Uint8Array(32).fill(19);
    const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
    const nonce = '1788200000000000001';
    const signed = signTechnocoreMessage(
      'research',
      nonce,
      'verified result',
      secretKey,
    );
    const body = `{"room":"research","count":1,"last_seq":71,"messages":[{"seq":71,"ts":"2026-08-31T20:00:00.000000Z","from":"${did}","text":"${signed.text}","nonce":${nonce},"sig":"${signed.signature}"}]}`;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );

    const messages = await new HttpTechnocoreAdapter(protocol).readRoom(
      'research',
    );
    const readUrl = requestUrl(
      vi.mocked(fetch).mock.calls[0][0] as RequestInfo | URL,
    );
    expect(readUrl).toContain('limit=50');
    expect(messages[0]).toMatchObject({
      id: 'tcmsg_research_71',
      roomId: 'tc_research',
      nonce,
      verified: true,
    });
  });

  it('loads only new records through the bounded long-poll lane', async () => {
    const fetchMock = vi.fn(
      async (..._args: [RequestInfo | URL, RequestInit?]) =>
        new Response(
          JSON.stringify({
            room: 'research',
            count: 0,
            last_seq: 72,
            messages: [],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const messages = await new HttpTechnocoreAdapter(protocol).waitForRoom(
      'research',
      '72',
      30,
    );
    const [url] = fetchMock.mock.calls[0];
    expect(requestUrl(url)).toContain('limit=50');
    expect(requestUrl(url)).toContain('since=72');
    expect(requestUrl(url)).toContain('wait=10');
    expect(requestUrl(url)).toContain('n=1');
    expect(messages).toEqual([]);
  });

  it('uses the browser-safe official signed GET lane for writes', async () => {
    const secretKey = new Uint8Array(32).fill(23);
    const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
    const nonce = '1788200000000';
    const signed = signTechnocoreMessage(
      'research',
      nonce,
      'ship evidence',
      secretKey,
    );
    const responseBody = JSON.stringify({
      room: 'research',
      count: 1,
      last_seq: 72,
      messages: [
        {
          seq: 72,
          ts: '2026-08-31T20:00:00.000000Z',
          from: did,
          text: signed.text,
          nonce,
          sig: signed.signature,
        },
      ],
    });
    const fetchMock = vi.fn(
      async (..._args: [RequestInfo | URL, RequestInit?]) =>
        new Response(responseBody, {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const message: ProtocolMessage = {
      id: 'local_pending',
      roomId: 'tc_research',
      from: did,
      text: signed.text,
      createdAt: '2026-08-31T20:00:00.000Z',
      seq: nonce,
      nonce,
      signature: signed.signature,
      verified: true,
    };

    const received = await new HttpTechnocoreAdapter(
      protocol,
    ).sendSignedMessage('research', message);
    const [url, init] = fetchMock.mock.calls[0];
    expect(requestUrl(url)).toContain('/r/research/say-signed/');
    expect(requestUrl(url)).toContain('?format=json');
    expect(init?.method).toBeUndefined();
    expect(received[0]).toMatchObject({ seq: '72', verified: true });
  });

  it('maps live service limits instead of hard-coding them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = requestUrl(input);
        if (url.endsWith('/config'))
          return new Response(
            JSON.stringify({
              service: 'technocore-chat',
              version: '0.11.1',
              settings: {
                rate_read: 600,
                rate_write: 300,
                max_wait: 10,
                dupe_filter_seconds: 120,
                ephemeral_ttl_seconds: 900,
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          );
        return new Response(
          JSON.stringify({
            name: 'technocore-chat',
            version: '0.11.1',
            url: 'https://technocore.chat',
            limits: {
              reads_per_minute_per_ip: 600,
              writes_per_minute_per_ip: 300,
              retention_seconds: 604800,
              ephemeral_ttl_seconds: 900,
              duplicate_filter_seconds: 120,
              long_poll_seconds: 10,
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const config = await new HttpTechnocoreAdapter(protocol).getConfig();
    expect(config).toMatchObject({
      connected: true,
      serviceVersion: '0.11.1',
      readBudget: 600,
      writeBudget: 300,
      duplicateWindowMs: 120_000,
      sourceLabel: 'TECHNOCORE · 0.11.1',
    });
  });

  it('resolves the sharded DID profile convention and validates mailbox data', async () => {
    const secretKey = new Uint8Array(32).fill(31);
    const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
    const x25519 = new Uint8Array(32).fill(7);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            `${did} x25519:${bytesToBase64Url(x25519)} mailbox:mb-p-a1b2c3d4e5f6`,
            { headers: { 'content-type': 'text/plain' } },
          ),
      ),
    );

    const profile = await new HttpTechnocoreAdapter(protocol).resolveProfile(
      did,
    );
    expect(profile).toMatchObject({
      did,
      mailbox: 'mb-p-a1b2c3d4e5f6',
      x25519PublicKey: bytesToBase64(x25519),
    });
    expect(profile?.noteAddress).toMatch(
      /^\/kv\/did-[a-f0-9]{2}\/[a-f0-9]{14}$/u,
    );
  });

  it('uses signed conditional notes when claiming an owned room', async () => {
    const secretKey = new Uint8Array(32).fill(37);
    const did = didFromPublicKey(ed25519.getPublicKey(secretKey));
    const fetchMock = vi.fn(
      async (..._args: [RequestInfo | URL, RequestInit?]) =>
        new Response('ok', { headers: { 'content-type': 'text/plain' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new HttpTechnocoreAdapter(protocol).claimOwnedRoom(
      'd-research',
      did,
      secretKey,
    );
    const [url] = fetchMock.mock.calls[0];
    expect(requestUrl(url)).toContain('/kv/room-owners/d-research/set-signed/');
    expect(requestUrl(url)).toContain('?if_absent=1');
  });
});

describe('Agent runtime provider contracts', () => {
  const runtime: RuntimeConnection = {
    id: 'runtime_claude',
    type: 'managed-ai',
    name: 'Claude Runtime',
    providerId: 'provider_claude',
    model: 'claude-sonnet-4-5',
    temperature: 0.2,
    maxOutput: 900,
    timeout: 10,
    status: 'untested',
  };
  const provider: Provider = {
    id: 'provider_claude',
    name: 'Claude',
    kind: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1',
    connected: false,
    secretRequired: true,
  };

  it('uses Anthropic headers and Messages API payloads for Claude', async () => {
    const fetchMock = vi.fn(
      async (..._args: [RequestInfo | URL, RequestInit?]) =>
        new Response(
          JSON.stringify({
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: 'verified answer' }],
            usage: { input_tokens: 12, output_tokens: 7 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new HttpAgentRuntime(
      runtime,
      provider,
      'session-secret',
    ).execute({
      objective: 'Verify the receipt',
      system: ['Stay factual.'],
      context: 'Untrusted room context.',
    });
    const [url, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '');

    expect(requestUrl(url)).toBe('https://api.anthropic.com/v1/messages');
    expect(headers.get('x-api-key')).toBe('session-secret');
    expect(headers.get('anthropic-version')).toBe('2023-06-01');
    expect(headers.get('authorization')).toBeNull();
    expect(body.messages).toEqual([
      { role: 'user', content: 'Verify the receipt' },
    ]);
    expect(body.max_tokens).toBe(900);
    expect(result).toMatchObject({ text: 'verified answer', tokens: 19 });
  });

  it('does not call a secret-required provider without a session key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const health = await new HttpAgentRuntime(runtime, provider).test();
    expect(health.ok).toBe(false);
    expect(health.detail).toContain('session API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('discovers DeepSeek models and uses the V4 thinking contract', async () => {
    const deepSeekProvider: Provider = {
      id: 'provider_deepseek',
      name: 'DeepSeek',
      kind: 'deepseek',
      endpoint: 'https://api.deepseek.com',
      connected: false,
      secretRequired: true,
    };
    const deepSeekRuntime: RuntimeConnection = {
      id: 'runtime_deepseek',
      type: 'managed-ai',
      name: 'DeepSeek V4',
      providerId: deepSeekProvider.id,
      model: 'deepseek-v4-flash',
      thinking: true,
      reasoningEffort: 'high',
      responseMode: 'json',
      maxOutput: 4096,
      timeout: 90,
      status: 'untested',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: 'deepseek-v4-flash' }, { id: 'deepseek-v4-pro' }],
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'deepseek-v4-flash',
            choices: [{ message: { content: '{"decision":"review"}' } }],
            usage: {
              total_tokens: 61,
              prompt_cache_hit_tokens: 12,
              completion_tokens_details: { reasoning_tokens: 24 },
            },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const adapter = new HttpAgentRuntime(
      deepSeekRuntime,
      deepSeekProvider,
      'session-secret',
    );
    const health = await adapter.test();
    const result = await adapter.execute({
      objective: 'Return valid json.',
      system: ['Use the requested schema.'],
      context: 'Untrusted room context.',
      userId: 'agent:unsafe id',
    });
    const [modelsUrl] = fetchMock.mock.calls[0];
    const [chatUrl, chatInit] = fetchMock.mock.calls[1];
    const body = JSON.parse(
      typeof chatInit?.body === 'string' ? chatInit.body : '',
    );

    expect(requestUrl(modelsUrl)).toBe('https://api.deepseek.com/models');
    expect(health.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(requestUrl(chatUrl)).toBe(
      'https://api.deepseek.com/chat/completions',
    );
    expect(body).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      response_format: { type: 'json_object' },
      user_id: 'agent-unsafe-id',
    });
    expect(body.temperature).toBeUndefined();
    expect(result).toMatchObject({
      tokens: 61,
      reasoningTokens: 24,
      cachedTokens: 12,
    });
  });

  it('executes the configured fallback after a primary runtime failure', async () => {
    const providers: Provider[] = [
      {
        id: 'provider_primary',
        name: 'Primary',
        kind: 'custom-http',
        endpoint: 'https://primary.example/v1',
        connected: true,
        secretRequired: false,
      },
      {
        id: 'provider_fallback',
        name: 'Fallback',
        kind: 'custom-http',
        endpoint: 'https://fallback.example/v1',
        connected: true,
        secretRequired: false,
      },
    ];
    const runtimes: RuntimeConnection[] = [
      {
        id: 'runtime_primary',
        type: 'managed-ai',
        name: 'Primary',
        providerId: providers[0].id,
        model: 'primary-model',
        fallbackRuntimeId: 'runtime_fallback',
        status: 'connected',
      },
      {
        id: 'runtime_fallback',
        type: 'managed-ai',
        name: 'Fallback',
        providerId: providers[1].id,
        model: 'fallback-model',
        status: 'connected',
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: 'fallback-model',
            choices: [{ message: { content: 'fallback result' } }],
            usage: { total_tokens: 8 },
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const execution = await executeAgentWithFallback(
      runtimes[0],
      runtimes,
      providers,
      undefined,
      {
        objective: 'Run the job.',
        system: ['Stay bounded.'],
        context: 'No room messages.',
      },
    );

    expect(execution.usedFallback).toBe(true);
    expect(execution.runtime.id).toBe('runtime_fallback');
    expect(execution.result.text).toBe('fallback result');
    expect(requestUrl(fetchMock.mock.calls[1][0])).toBe(
      'https://fallback.example/v1/chat/completions',
    );
  });
});
