import { apiRequest } from './apiClient';

export interface SaveMpesaSettingsInput {
  businessId: string;
  shopId?: string;
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

export async function saveShopMpesaSettings(input: SaveMpesaSettingsInput): Promise<{ success?: boolean; error?: string; status?: any }> {
  try {
    const { shopId: _legacyShopId, ...body } = input;
    return await apiRequest<{ success?: boolean; error?: string; status?: any }>('/api/mpesa/settings', {
      method: 'POST',
      body,
      businessId: input.businessId,
    });
  } catch (err: any) {
    return { error: err?.message || 'Could not save M-Pesa settings.' };
  }
}
