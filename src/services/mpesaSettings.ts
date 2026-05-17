import { apiRequest } from './apiClient';

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
    return await apiRequest<{ success?: boolean; error?: string; status?: any }>('/api/mpesa/settings', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  } catch (err: any) {
    return { error: err?.message || 'Could not save M-Pesa settings.' };
  }
}
