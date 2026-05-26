import { describe, expect, it } from 'vitest';
import { publicMpesaStatus } from './credentialStore';

describe('M-Pesa credential public status', () => {
  it('returns only masked/public credential state', () => {
    const status = publicMpesaStatus({
      businessId: 'biz-1',
      environment: 'production',
      accountType: 'buygoods',
      product: 'M-PESA EXPRESS',
      shortcode: '123456',
      storeNumber: '654321',
      consumerKeyCipher: 'enc:v2:key',
      consumerSecretCipher: 'enc:v2:secret',
      passkeyCipher: 'enc:v2:passkey',
    } as any, true);

    expect(status).toMatchObject({
      mpesaConfigured: true,
      mpesaEnv: 'production',
      mpesaType: 'buygoods',
      mpesaShortcodeMasked: '****3456',
      mpesaStoreNumberMasked: '****4321',
      credentialsEncrypted: true,
      safeStorageReady: true,
    });
    expect(JSON.stringify(status)).not.toContain('consumerKeyCipher');
    expect(JSON.stringify(status)).not.toContain('consumerSecretCipher');
    expect(JSON.stringify(status)).not.toContain('passkeyCipher');
    expect(JSON.stringify(status)).not.toContain('enc:v2');
  });
});
