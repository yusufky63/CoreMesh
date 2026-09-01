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

function resolveRequest(request: Request, kind: string) {
  const provider = providers[kind as HostedProviderKind];
  const path = new URL(request.url).searchParams.get('path') || '';
  if (!provider || !provider.paths.includes(path)) return null;
  const suppliedKey =
    request.headers.get('authorization')?.replace(/^Bearer\s+/iu, '') ||
    request.headers.get('x-api-key');
  const key = suppliedKey || getServerSecret(provider.envKey);
  return { provider, path, key };
}

async function relay(request: Request, kind: string) {
  const resolved = resolveRequest(request, kind);
  if (!resolved)
    return Response.json(
      { error: 'Unsupported provider route.' },
      { status: 404, headers: { 'cache-control': 'no-store' } },
    );
  if (!resolved.key)
    return Response.json(
      { error: 'This provider is not configured for this deployment.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  const isAnthropic = kind === 'anthropic';
  const headers: Record<string, string> = isAnthropic
    ? {
        'x-api-key': resolved.key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      }
    : {
        authorization: `Bearer ${resolved.key}`,
        'content-type': 'application/json',
      };
  const body = request.method === 'POST' ? await request.text() : undefined;
  if (body && body.length > 2_000_000)
    return Response.json(
      { error: 'Request is too large.' },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    );
  const response = await fetch(
    `${resolved.provider.baseUrl}/${resolved.path}`,
    {
      method: request.method,
      headers,
      body,
    },
  );
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
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
    return Response.json(
      { error: 'JSON content is required.' },
      { status: 415, headers: { 'cache-control': 'no-store' } },
    );
  return relay(request, (await context.params).kind);
}
import { getServerSecret } from '@/lib/server-env';
