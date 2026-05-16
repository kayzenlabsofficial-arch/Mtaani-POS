import { getApiKey } from '../runtimeConfig';

export interface SaveMpesaSettingsInput {
  businessId: string;
  branchId: string;
  userId: string;
  adminPassword: string;
  confirmationText: string;
  credentials: {
    consumerKey?: string;
    consumerSecret?: string;
    passkey?: string;
    env: 'sandbox' | 'production';
    type: 'paybill' | 'buygoods';
    storeNumber?: string;
  };
}

export async function saveBranchMpesaSettings(input: SaveMpesaSettingsInput): Promise<{ success?: boolean; error?: string; status?: any }> {
  try {
    if (typeof window !== 'undefined' && navigator.onLine === false) {
      return { error: 'Internet is required to change M-Pesa settings.' };
    }
    const apiKey = await getApiKey();
    const res = await fetch('/api/mpesa/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Business-ID': input.businessId,
        'X-Branch-ID': input.branchId,
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify(input),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error || `M-Pesa settings failed (${res.status})` };
    return data;
  } catch (err: any) {
    return { error: err?.message || 'Could not save M-Pesa settings.' };
  }
}
