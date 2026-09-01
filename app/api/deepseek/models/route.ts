import { getServerSecret } from '@/lib/server-env';

const deepSeekModelsUrl = 'https://api.deepseek.com/models';

export async function GET(request: Request) {
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
  const response = await fetch(deepSeekModelsUrl, {
    headers: { authorization },
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
