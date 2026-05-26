import { useStore } from './store';

export type RuntimeConfig = {
  apiKey: string | null;
};

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  return { apiKey: useStore.getState().authToken || null };
}

export async function getApiKey(): Promise<string> {
  const { apiKey } = await getRuntimeConfig();
  return apiKey || '';
}
