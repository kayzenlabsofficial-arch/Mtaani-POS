import { authorizeRequest } from '../authUtils';

interface Env {
  IMAGES_KV: KVNamespace;
  API_SECRET?: string;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;
  const auth = await authorizeRequest(request, env);
  if (!auth.ok) return auth.response;
  if (!auth.service && auth.principal.role !== 'ADMIN' && auth.principal.role !== 'MANAGER' && auth.principal.role !== 'ROOT') {
    return new Response(JSON.stringify({ error: 'Admin or manager access required.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  const formData = await request.formData();
  const file = formData.get('file') as File;

  if (!file) {
    return new Response('No file uploaded', { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return new Response(JSON.stringify({ error: 'Only JPEG, PNG, WebP, or GIF images are allowed.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return new Response(JSON.stringify({ error: 'Image is too large. Use an image below 2 MB.' }), {
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = crypto.randomUUID();
  const buffer = await file.arrayBuffer();

  await env.IMAGES_KV.put(id, buffer, {
    metadata: {
      name: file.name,
      type: file.type,
      uploadedBy: auth.principal.userId,
      businessId: auth.principal.businessId || '',
    },
  });

  return new Response(JSON.stringify({ id, url: `/api/images/${id}` }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, params } = context;
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  if (!id) return new Response('Not found', { status: 404 });

  const { value, metadata } = await env.IMAGES_KV.getWithMetadata(id, { type: 'arrayBuffer' });

  if (!value) return new Response('Not found', { status: 404 });

  return new Response(value, {
    headers: {
      'Content-Type': (metadata as any)?.type || 'image/png',
      'Cache-Control': 'public, max-age=31536000',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
