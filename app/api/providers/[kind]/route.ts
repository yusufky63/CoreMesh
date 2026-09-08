import {
  TokenBucket,
  clientKey,
  decideRelayAccess,
} from '@/lib/relay-auth';
import { getServerSecret } from '@/lib/server-env';

type HostedProviderKind =
  | 'openai-compatible'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'openrouter'
  | 'groq'
  | 'together';

const providers: Record<
  HostedProviderKind,
  { baseUrl: string; envKey: string; paths: string[] }
> = {
  'openai-compatible': {
    baseUrl: 'https://api.openai.com/v1',
    envKey: 'OPENAI_API_KEY',
    paths: ['models', 'chat/completions'],
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    envKey: 'ANTHROPIC_API_KEY',
    paths: ['models', 'messages'],
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envKey: 'GEMINI_API_KEY',
    paths: ['models', 'chat/completions'],
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    envKey: 'DEEPSEEK_API_KEY',
    paths: ['models', 'chat/completions'],
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    envKey: 'OPENROUTER_API_KEY',
    paths: ['models', 'chat/completions'],
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    envKey: 'GROQ_API_KEY',
    paths: ['models', 'chat/completions'],
  },
  together: {
    baseUrl: 'https://api.together.xyz/v1',
    envKey: 'TOGETHER_API_KEY',
    paths: ['models', 'chat/completions'],
  },
};

/**
 * Serverless functions are killed by the platform without a readable error.
 * Cap the function above the upstream timeout so a slow model returns our own
 * message instead of a bare gateway timeout.
 */
export const maxDuration = 60;

const MAX_BODY_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 55_000;
const noStore = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

const relayRpm = Number(getServerSecret('COREMESH_RELAY_RPM')) || 60;
const bucket = new TokenBucket(relayRpm, relayRpm / 60_000);

function deny(status: number, error: string, extra: Record<string, string> = {}) {
  return Response.json(
    { error },
    { status, headers: { ...noStore, ...extra } },
  );
}

async function relay(request: Request, kind: string) {
  const provider = providers[kind as HostedProviderKind];
  const path = (new URL(request.url).searchParams.get('path') || '')
    .trim()
    .replace(/^\/+/u, '');
  if (!provider || !provider.paths.includes(path))
    return deny(404, 'Unsupported provider route.');

  const suppliedKey =
    request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '') ||
    request.headers.get('x-api-key') ||
    null;
  const decision = decideRelayAccess({
    suppliedKey,
    relayToken: request.headers.get('x-coremesh-relay'),
    configuredToken: getServerSecret('COREMESH_RELAY_TOKEN') || null,
    openRelay: getServerSecret('COREMESH_RELAY_OPEN') === '1',
    secFetchSite: request.headers.get('sec-fetch-site'),
    origin: request.headers.get('origin'),
    host: request.headers.get('host'),
  });
  if (!decision.ok) return deny(decision.status, decision.error);

  const limit = bucket.take(
    `${clientKey(request.headers)}:${decision.mode}`,
    Date.now(),
  );
  if (!limit.ok)
    return deny(429, 'Relay rate limit exceeded.', {
      'retry-after': String(limit.retryAfterSeconds),
    });

  const key = suppliedKey || getServerSecret(provider.envKey);
  if (!key) return deny(401, 'This provider is not configured for this deployment.');

  const body = request.method === 'POST' ? await request.text() : undefined;
  if (body && new TextEncoder().encode(body).length > MAX_BODY_BYTES)
    return deny(413, 'Request is too large.');

  const headers: Record<string, string> =
    kind === 'anthropic'
      ? {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }
      : { authorization: `Bearer ${key}`, 'content-type': 'application/json' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${provider.baseUrl}/${path}`, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        ...noStore,
        'content-type':
          response.headers.get('content-type') || 'application/json',
      },
    });
  } catch (error) {
    return deny(
      502,
      error instanceof Error && error.name === 'AbortError'
        ? 'Upstream provider timed out.'
        : 'Upstream provider is unreachable.',
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  return relay(request, (await context.params).kind);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ kind: string }> },
) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json'))
    return deny(415, 'JSON content is required.');
  return relay(request, (await context.params).kind);
}
