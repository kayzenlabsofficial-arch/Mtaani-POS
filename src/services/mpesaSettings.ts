import { apiRequest } from './apiClient';

export interface SaveMpesaSettingsInput {
  businessId: string;
  shopId?: string;
  userId: string;
  adminPassword: string;
  credentials: {
    consumerKey?: string;
    consumerSecret?: string;
    passkey?: string;
    env: 'sandbox' | 'production';
    type: 'paybill' | 'buygoods';
    product?: string;
    shortcode?: string;
    storeNumber?: string;
  };
}

export interface MpesaSettingsStatus {
  mpesaConfigured: boolean;
  mpesaConsumerKeySet: boolean;
  mpesaConsumerSecretSet: boolean;
  mpesaPasskeySet: boolean;
  mpesaEnv: 'sandbox' | 'production';
  mpesaType: 'paybill' | 'buygoods';
  mpesaProduct: string;
  mpesaShortcodeSet: boolean;
  mpesaStoreNumberSet: boolean;
  mpesaShortcodeMasked: string;
  mpesaStoreNumberMasked: string;
  credentialsEncrypted: boolean;
  safeStorageReady: boolean;
  lastTestAt?: number | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
}

export async function getShopMpesaSettings(businessId: string): Promise<{ success?: boolean; error?: string; status?: MpesaSettingsStatus }> {
  try {
    return await apiRequest<{ success?: boolean; error?: string; status?: MpesaSettingsStatus }>(`/api/mpesa/settings?businessId=${encodeURIComponent(businessId)}`, {
      businessId,
    });
  } catch (err: any) {
    return { error: err?.message || 'Could not load M-Pesa settings.' };
  }
}

export async function saveShopMpesaSettings(input: SaveMpesaSettingsInput): Promise<{ success?: boolean; error?: string; status?: MpesaSettingsStatus }> {
  try {
    const { shopId: _legacyShopId, ...body } = input;
    return await apiRequest<{ success?: boolean; error?: string; status?: MpesaSettingsStatus }>('/api/mpesa/settings', {
      method: 'POST',
      body,
      businessId: input.businessId,
    });
  } catch (err: any) {
    return { error: err?.message || 'Could not save M-Pesa settings.' };
  }
}

export async function testShopMpesaSettings(input: {
  businessId: string;
  userId: string;
  adminPassword: string;
}): Promise<{ success?: boolean; error?: string; message?: string }> {
  try {
    return await apiRequest<{ success?: boolean; error?: string; message?: string }>('/api/mpesa/test', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
    });
  } catch (err: any) {
    return { error: err?.message || 'Could not test M-Pesa settings.' };
  }
}
