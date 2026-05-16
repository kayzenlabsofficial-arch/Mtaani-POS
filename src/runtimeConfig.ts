export type RuntimeConfig = {
  apiKey: string | null;
};

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const { useStore } = await import('./store');
  return { apiKey: useStore.getState().authToken || null };
}

export async function getApiKey(): Promise<string> {
  const { apiKey } = await getRuntimeConfig();
  return apiKey || '';
}
