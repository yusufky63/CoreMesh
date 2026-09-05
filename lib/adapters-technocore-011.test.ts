import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAgentRuntime, HttpTechnocoreAdapter } from './adapters';
import { technocoreDidFingerprint } from './crypto';
import type { ProtocolConfig, Provider, RuntimeConnection } from './domain';

const protocol: ProtocolConfig = {
  baseUrl: 'https://technocore.chat',
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
  sourceLabel: 'TECHNOCORE · 0.11.4',
};

const requestUrl = (input: RequestInfo | URL) =>
  typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

afterEach(() => vi.unstubAllGlobals());

describe('Technocore 0.11.x room directory', () => {
  it('reads the JSON directory and keeps engagement aggregates as metadata', async () => {
    const body = JSON.stringify({
      rooms: [
        {
          room: 'technocore',
          last_seq: 4287585,
          bytes: 9385708,
          idle_seconds: 0,
          topic: 'todowork.me',
          window: 188,
          zero_response_share: 0.0053,
          nick_diversity: 0.9628,
        },
        {
          room: 'mb-p-quiet',
          last_seq: '12',
          idle_seconds: 900,
          topic: null,
          window: null,
          zero_response_share: null,
          nick_diversity: null,
        },
        { room: 'Not Valid', last_seq: 1 },
      ],
      total: 3,
    });
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(body, { headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const rooms = await new HttpTechnocoreAdapter(protocol).listRooms();

    expect(requestUrl(fetchMock.mock.calls[0][0])).toBe(
      'https://technocore.chat/rooms?format=json&limit=200',
    );
    expect(rooms).toHaveLength(2);
    expect(rooms[0]).toMatchObject({
      id: 'tc_technocore',
      kind: 'public',
      topic: 'todowork.me',
      messageCount: 4287585,
      engagement: { nickDiversity: 0.9628, zeroResponseShare: 0.0053 },
    });
    expect(rooms[1]).toMatchObject({
      kind: 'private-mailbox',
      topic: '',
      messageCount: 12,
      engagement: { idleSeconds: 900 },
    });
  });

  it('clamps explicit read limits to the documented 1..200 range', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          '{"room":"tclk-offers","count":0,"last_seq":0,"messages":[]}',
          { headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const adapter = new HttpTechnocoreAdapter(protocol);

    await adapter.readRoomState('tclk-offers', undefined, 500);
    await adapter.readRoomState('tclk-offers', undefined, 0);

    expect(requestUrl(fetchMock.mock.calls[0][0])).toContain('limit=200');
    expect(requestUrl(fetchMock.mock.calls[1][0])).toContain('limit=1');
  });

  it('parses tclk1 capability tokens from DID profile notes as a hint', async () => {
    const did = 'did:key:z6MkhB4L6WJjoa31nS3VWqCYKUDbWr6TwFpeN8XsKgMgcbx6';
    const fingerprint = technocoreDidFingerprint(did);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input) => {
        const url = requestUrl(input);
        if (url.includes(`/kv/did-${fingerprint.slice(0, 2)}/`))
          return new Response(
            `${did} mailbox:mb-p-deadbeef tclk1:flop-htlc,PaperRail`,
            { headers: { 'content-type': 'text/plain' } },
          );
        return new Response('', { status: 404 });
      }),
    );

    const profile = await new HttpTechnocoreAdapter(protocol).resolveProfile(
      did,
    );

    expect(profile?.mailbox).toBe('mb-p-deadbeef');
    expect(profile?.rails).toEqual(['flop-htlc', 'paper']);
  });
});

describe('hosted relay client headers', () => {
  const provider: Provider = {
    id: 'provider_deepseek',
    name: 'DeepSeek',
    kind: 'deepseek',
    endpoint: 'https://api.deepseek.com',
    connected: false,
    secretRequired: false,
    serverManagedSecret: true,
  };
  const runtime: RuntimeConnection = {
    id: 'runtime_test',
    type: 'managed-ai',
    name: 'Test',
    providerId: provider.id,
    status: 'untested',
    timeout: 5,
  };

  it('routes hosted providers through the same-origin relay with the session token', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('{"data":[{"id":"deepseek-v4-flash"}]}', {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const health = await new HttpAgentRuntime(
      runtime,
      provider,
      undefined,
      'relay-secret-token',
    ).test();

    expect(health.ok).toBe(true);
    expect(requestUrl(fetchMock.mock.calls[0][0])).toBe(
      '/api/providers/deepseek?path=models',
    );
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('x-coremesh-relay')).toBe('relay-secret-token');
    expect(headers.get('authorization')).toBeNull();
  });

  it('explains an empty answer when thinking consumed the output budget', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              model: 'deepseek-v4-flash',
              choices: [
                {
                  message: { content: '', reasoning_content: 'thinking…' },
                  finish_reason: 'length',
                },
              ],
              usage: {
                total_tokens: 700,
                completion_tokens_details: { reasoning_tokens: 600 },
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      ),
    );

    await expect(
      new HttpAgentRuntime(
        { ...runtime, thinking: true, maxOutput: 600 },
        provider,
        undefined,
        'relay-secret-token',
      ).execute({ system: ['policy'], objective: 'answer', context: '' }),
    ).rejects.toThrow(/output budget on thinking/u);
  });

  it('never attaches the relay token to direct provider calls', async () => {
    vi.stubGlobal('window', {});
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response('{"data":[]}', {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await new HttpAgentRuntime(
      runtime,
      { ...provider, serverManagedSecret: false, secretRequired: true },
      'sk-session',
      'relay-secret-token',
    ).test();

    expect(requestUrl(fetchMock.mock.calls[0][0])).toBe(
      'https://api.deepseek.com/models',
    );
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get('x-coremesh-relay')).toBeNull();
    expect(headers.get('authorization')).toBe('Bearer sk-session');
  });
});
