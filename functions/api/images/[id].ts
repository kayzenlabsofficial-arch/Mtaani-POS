interface Env {
  IMAGES_KV: KVNamespace;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return new Response('No file uploaded', { status: 400 });
  }

  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();

  await env.IMAGES_KV.put(id, buffer, {
    metadata: {
      name: file.name,
      type: file.type
    }
  });

  return new Response(JSON.stringify({ id, url: `/api/images/${id}` }));
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const id = params.path?.[0]; // Assuming [[path]] router or similar

  if (!id) return new Response('Not found', { status: 404 });

  const { value, metadata } = await env.IMAGES_KV.getWithMetadata(id, { type: 'arrayBuffer' });

  if (!value) return new Response('Not found', { status: 404 });

  return new Response(value, {
    headers: {
      'Content-Type': (metadata as any)?.type || 'image/png',
      'Cache-Control': 'public, max-age=31536000'
    }
  });
};
