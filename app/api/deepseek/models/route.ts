const deepSeekModelsUrl = 'https://api.deepseek.com/models';

export async function GET(request: Request) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer '))
    return Response.json(
      { error: 'A session API key is required.' },
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
