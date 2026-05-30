import { apiRequest } from './apiClient';

export interface SaveMpesaSettingsInput {
  businessId: string;
  shopId?: string;
  userId: string;
  adminPassword: string;
  credentials: {
    provider?: 'MPESA' | 'PESAPAL';
    consumerKey?: string;
    consumerSecret?: string;
    passkey?: string;
    env: 'sandbox' | 'production';
    type: 'paybill' | 'buygoods';
    product?: string;
    shortcode?: string;
    storeNumber?: string;
    pesapalConsumerKey?: string;
    pesapalConsumerSecret?: string;
    pesapalEnv?: 'sandbox' | 'production';
    pesapalCurrency?: string;
    pesapalIpnId?: string;
  };
}

export interface MpesaSettingsStatus {
  paymentProvider: 'MPESA' | 'PESAPAL';
  activeProviderConfigured: boolean;
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
  mpesaCredentialsEncrypted: boolean;
  pesapalConfigured: boolean;
  pesapalConsumerKeySet: boolean;
  pesapalConsumerSecretSet: boolean;
  pesapalEnv: 'sandbox' | 'production';
  pesapalCurrency: string;
  pesapalIpnIdSet: boolean;
  pesapalCredentialsEncrypted: boolean;
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
    return { error: err?.message || 'Could not load payment API settings.' };
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
    return { error: err?.message || 'Could not save payment API settings.' };
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
    return { error: err?.message || 'Could not test payment API settings.' };
  }
}
