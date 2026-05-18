const ENCRYPTED_PREFIX = 'enc:v1:';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importAesKey(keyMaterial: string): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(keyMaterial);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export function isEncryptedSecret(value?: string | null): boolean {
  return typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX);
}

export async function encryptSecret(value: string, keyMaterial: string): Promise<string> {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const key = await importAesKey(keyMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(trimmed));
  return `${ENCRYPTED_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(value?: string | null, keyMaterial?: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (!isEncryptedSecret(value)) return value;
  if (!keyMaterial) {
    throw new Error('M-Pesa safe storage key is missing. Add MPESA_CREDENTIAL_ENCRYPTION_KEY as a Pages secret.');
  }

  const [, , ivPart, cipherPart] = value.split(':');
  if (!ivPart || !cipherPart) throw new Error('Saved M-Pesa secret is damaged.');
  const key = await importAesKey(keyMaterial);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(ivPart) },
    key,
    base64ToBytes(cipherPart),
  );
  return new TextDecoder().decode(plain);
}
