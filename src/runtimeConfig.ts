export type RuntimeConfig = {
  apiKey: string | null;
};

let runtimeConfigPromise: Promise<RuntimeConfig> | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (!runtimeConfigPromise) {
    runtimeConfigPromise = (async () => {
      const res = await fetch('/api/runtime-config', { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`GET /api/runtime-config → ${res.status}`);
      }
      const j = (await res.json()) as Partial<RuntimeConfig> | null;
      return { apiKey: j?.apiKey ?? null };
    })();
  }
  return runtimeConfigPromise;
}

export async function getApiKey(): Promise<string> {
  const { apiKey } = await getRuntimeConfig();
  if (!apiKey) {
    throw new Error(
      'API secret is missing. Set API_SECRET as a Cloudflare Pages Secret for this project.'
    );
  }
  return apiKey;
}

