interface Env {
  ROOT_USERNAME?: string;
  ROOT_PASSWORD?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders },
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => new Response(null, { headers: corsHeaders });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const body = await request.json().catch(() => null) as any;
  const username = String(body?.username || '').trim();
  const password = String(body?.password || '');

  if (!env.ROOT_USERNAME || !env.ROOT_PASSWORD) {
    return json({ error: 'Root login is not configured.' }, 500);
  }

  if (username === env.ROOT_USERNAME && password === env.ROOT_PASSWORD) {
    return json({
      id: 'root',
      name: 'System Root',
      role: 'ROOT',
    });
  }

  return json({ error: 'Invalid root credentials.' }, 401);
};
