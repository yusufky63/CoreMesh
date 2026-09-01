import { getServerSecret } from '@/lib/server-env';

const deepSeekChatUrl = 'https://api.deepseek.com/chat/completions';

export async function POST(request: Request) {
  const suppliedAuthorization = request.headers.get('authorization');
  const authorization =
    suppliedAuthorization ||
    (getServerSecret('DEEPSEEK_API_KEY')
      ? `Bearer ${getServerSecret('DEEPSEEK_API_KEY')}`
      : null);
  if (!authorization?.startsWith('Bearer '))
    return Response.json(
      { error: 'DeepSeek is not configured for this deployment.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json'))
    return Response.json(
      { error: 'JSON content is required.' },
      { status: 415, headers: { 'cache-control': 'no-store' } },
    );
  const body = await request.text();
  if (body.length > 2_000_000)
    return Response.json(
      { error: 'Request is too large.' },
      { status: 413, headers: { 'cache-control': 'no-store' } },
    );
  const response = await fetch(deepSeekChatUrl, {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body,
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      'content-type':
        response.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
  });
}
