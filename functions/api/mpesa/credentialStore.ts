import { assertSafeCredentialKey, decryptSecret, encryptSecret, isEncryptedSecret } from './secureCredentials';

export type MpesaEnvironment = 'sandbox' | 'production';
export type MpesaAccountType = 'paybill' | 'buygoods';

export type MpesaCredentialInput = {
  consumerKey?: string;
  consumerSecret?: string;
  passkey?: string;
  env?: string;
  type?: string;
  product?: string;
  shortcode?: string;
  storeNumber?: string;
};

export type MpesaPublicStatus = {
  mpesaConfigured: boolean;
  mpesaConsumerKeySet: boolean;
  mpesaConsumerSecretSet: boolean;
  mpesaPasskeySet: boolean;
  mpesaEnv: MpesaEnvironment;
  mpesaType: MpesaAccountType;
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
};

export type MpesaRuntimeCredentials = {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
  env: MpesaEnvironment;
  type: MpesaAccountType;
  product: string;
  shortcode: string;
  storeNumber?: string;
};

type CredentialRow = {
  businessId: string;
  settingsId?: string | null;
  environment?: string | null;
  accountType?: string | null;
  product?: string | null;
  shortcode?: string | null;
  storeNumber?: string | null;
  consumerKeyCipher?: string | null;
  consumerSecretCipher?: string | null;
  passkeyCipher?: string | null;
  credentialsVersion?: string | null;
  lastTestAt?: number | null;
  lastTestStatus?: string | null;
  lastTestMessage?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
};

type LegacySettings = {
  id?: string | null;
  tillNumber?: string | null;
  mpesaConsumerKey?: string | null;
  mpesaConsumerSecret?: string | null;
  mpesaPasskey?: string | null;
  mpesaEnv?: string | null;
  mpesaType?: string | null;
  mpesaStoreNumber?: string | null;
};

const SECRET_FIELDS = [
  ['consumerKeyCipher', 'mpesaConsumerKey', 'consumerKey'] as const,
  ['consumerSecretCipher', 'mpesaConsumerSecret', 'consumerSecret'] as const,
  ['passkeyCipher', 'mpesaPasskey', 'passkey'] as const,
];

const DEFAULT_MPESA_PRODUCT = 'M-PESA EXPRESS';

export function normalizeMpesaEnv(value: unknown): MpesaEnvironment {
  return String(value || '').toLowerCase() === 'production' ? 'production' : 'sandbox';
}

export function normalizeMpesaType(value: unknown): MpesaAccountType {
  return String(value || '').toLowerCase() === 'buygoods' ? 'buygoods' : 'paybill';
}

function cleanText(value: unknown, max = 120) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeProduct(value: unknown) {
  return cleanText(value || DEFAULT_MPESA_PRODUCT, 80) || DEFAULT_MPESA_PRODUCT;
}

function secretAad(businessId: string, field: string) {
  return `mtaani-pos:mpesa:enc:v2:${businessId}:${field}`;
}

function maskNumber(value?: string | null) {
  const text = cleanText(value);
  if (!text) return '';
  if (text.length <= 4) return '****';
  return `${'*'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

function hasAllSecretCiphers(row?: CredentialRow | null) {
  return !!(row?.consumerKeyCipher && row.consumerSecretCipher && row.passkeyCipher);
}

function hasPublicNumber(row?: CredentialRow | null) {
  return !!cleanText(row?.shortcode);
}

export async function ensureMpesaCredentialSchema(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mpesaCredentials (
      businessId TEXT PRIMARY KEY,
      settingsId TEXT,
      environment TEXT NOT NULL DEFAULT 'sandbox',
      accountType TEXT NOT NULL DEFAULT 'paybill',
      product TEXT NOT NULL DEFAULT 'M-PESA EXPRESS',
      shortcode TEXT,
      storeNumber TEXT,
      consumerKeyCipher TEXT,
      consumerSecretCipher TEXT,
      passkeyCipher TEXT,
      credentialsVersion TEXT DEFAULT 'enc:v2',
      lastTestAt INTEGER,
      lastTestStatus TEXT,
      lastTestMessage TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `).run();

  for (const sql of [
    'ALTER TABLE mpesaCredentials ADD COLUMN settingsId TEXT',
    "ALTER TABLE mpesaCredentials ADD COLUMN environment TEXT NOT NULL DEFAULT 'sandbox'",
    "ALTER TABLE mpesaCredentials ADD COLUMN accountType TEXT NOT NULL DEFAULT 'paybill'",
    "ALTER TABLE mpesaCredentials ADD COLUMN product TEXT NOT NULL DEFAULT 'M-PESA EXPRESS'",
    'ALTER TABLE mpesaCredentials ADD COLUMN shortcode TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN storeNumber TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN consumerKeyCipher TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN consumerSecretCipher TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN passkeyCipher TEXT',
    "ALTER TABLE mpesaCredentials ADD COLUMN credentialsVersion TEXT DEFAULT 'enc:v2'",
    'ALTER TABLE mpesaCredentials ADD COLUMN lastTestAt INTEGER',
    'ALTER TABLE mpesaCredentials ADD COLUMN lastTestStatus TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN lastTestMessage TEXT',
    'ALTER TABLE mpesaCredentials ADD COLUMN created_at INTEGER',
    'ALTER TABLE mpesaCredentials ADD COLUMN updated_at INTEGER',
    'CREATE INDEX IF NOT EXISTS idx_mpesaCredentials_updated ON mpesaCredentials(updated_at)',
  ]) {
    try { await db.prepare(sql).run(); } catch {}
  }
}

async function getCredentialRow(db: D1Database, businessId: string): Promise<CredentialRow | null> {
  await ensureMpesaCredentialSchema(db);
  return db.prepare('SELECT * FROM mpesaCredentials WHERE businessId = ? LIMIT 1').bind(businessId).first<CredentialRow>();
}

async function getLegacySettings(db: D1Database, businessId: string): Promise<LegacySettings | null> {
  try {
    return await db.prepare(`
      SELECT id, tillNumber, mpesaConsumerKey, mpesaConsumerSecret, mpesaPasskey, mpesaEnv, mpesaType, mpesaStoreNumber
      FROM settings
      WHERE businessId = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `).bind(businessId).first<LegacySettings>();
  } catch {
    try {
      return await db.prepare(`
        SELECT id, tillNumber
        FROM settings
        WHERE businessId = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).bind(businessId).first<LegacySettings>();
    } catch {
      return null;
    }
  }
}

async function clearLegacySettings(db: D1Database, businessId: string) {
  try {
    await db.prepare(`
      UPDATE settings
      SET mpesaConsumerKey = NULL,
          mpesaConsumerSecret = NULL,
          mpesaPasskey = NULL,
          mpesaEnv = NULL,
          mpesaType = NULL,
          mpesaStoreNumber = NULL
      WHERE businessId = ?
    `).bind(businessId).run();
  } catch {
    // Fresh databases no longer create these legacy columns.
  }
}

async function upsertCredentialRow(db: D1Database, row: CredentialRow) {
  const now = Date.now();
  await db.prepare(`
    INSERT INTO mpesaCredentials (
      businessId, settingsId, environment, accountType, product, shortcode, storeNumber,
      consumerKeyCipher, consumerSecretCipher, passkeyCipher, credentialsVersion,
      lastTestAt, lastTestStatus, lastTestMessage, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'enc:v2', ?, ?, ?, ?, ?)
    ON CONFLICT(businessId) DO UPDATE SET
      settingsId = excluded.settingsId,
      environment = excluded.environment,
      accountType = excluded.accountType,
      product = excluded.product,
      shortcode = excluded.shortcode,
      storeNumber = excluded.storeNumber,
      consumerKeyCipher = excluded.consumerKeyCipher,
      consumerSecretCipher = excluded.consumerSecretCipher,
      passkeyCipher = excluded.passkeyCipher,
      credentialsVersion = 'enc:v2',
      lastTestAt = excluded.lastTestAt,
      lastTestStatus = excluded.lastTestStatus,
      lastTestMessage = excluded.lastTestMessage,
      updated_at = excluded.updated_at
  `).bind(
    row.businessId,
    row.settingsId || null,
    normalizeMpesaEnv(row.environment),
    normalizeMpesaType(row.accountType),
    normalizeProduct(row.product),
    cleanText(row.shortcode) || null,
    cleanText(row.storeNumber) || null,
    row.consumerKeyCipher || null,
    row.consumerSecretCipher || null,
    row.passkeyCipher || null,
    row.lastTestAt || null,
    row.lastTestStatus || null,
    row.lastTestMessage || null,
    row.created_at || now,
    now,
  ).run();
}

async function migrateLegacySettings(db: D1Database, businessId: string, keyMaterial?: string) {
  let row = await getCredentialRow(db, businessId);
  const settings = await getLegacySettings(db, businessId);
  if (!settings) return row;

  const hasLegacySecret = SECRET_FIELDS.some(([, legacyField]) => !!cleanText(settings[legacyField]));
  const hasLegacyMeta = !!(settings.mpesaEnv || settings.mpesaType || settings.mpesaStoreNumber || settings.tillNumber);
  if (!hasLegacySecret && !hasLegacyMeta) return row;

  const next: CredentialRow = {
    businessId,
    settingsId: row?.settingsId || settings.id || `core_${businessId}`,
    environment: row?.environment || normalizeMpesaEnv(settings.mpesaEnv),
    accountType: row?.accountType || normalizeMpesaType(settings.mpesaType),
    product: row?.product || DEFAULT_MPESA_PRODUCT,
    shortcode: row?.shortcode || cleanText(settings.tillNumber) || null,
    storeNumber: row?.storeNumber || cleanText(settings.mpesaStoreNumber) || null,
    consumerKeyCipher: row?.consumerKeyCipher || null,
    consumerSecretCipher: row?.consumerSecretCipher || null,
    passkeyCipher: row?.passkeyCipher || null,
    lastTestAt: row?.lastTestAt || null,
    lastTestStatus: row?.lastTestStatus || null,
    lastTestMessage: row?.lastTestMessage || null,
    created_at: row?.created_at || Date.now(),
  };

  if (hasLegacySecret) {
    const safeKey = assertSafeCredentialKey(keyMaterial);
    for (const [cipherField, legacyField, logicalField] of SECRET_FIELDS) {
      const legacyValue = cleanText(settings[legacyField], 4000);
      if (!legacyValue) continue;
      const plain = await decryptSecret(legacyValue, safeKey, isEncryptedSecret(legacyValue) && legacyValue.startsWith('enc:v2:') ? secretAad(businessId, logicalField) : undefined);
      if (plain) next[cipherField] = await encryptSecret(plain, safeKey, secretAad(businessId, logicalField));
    }
  }

  await upsertCredentialRow(db, next);
  await clearLegacySettings(db, businessId);
  row = await getCredentialRow(db, businessId);
  return row;
}

export function publicMpesaStatus(row?: CredentialRow | null, safeStorageReady = true): MpesaPublicStatus {
  const encryptedValues = [row?.consumerKeyCipher, row?.consumerSecretCipher, row?.passkeyCipher].filter(Boolean);
  return {
    mpesaConfigured: hasAllSecretCiphers(row) && hasPublicNumber(row),
    mpesaConsumerKeySet: !!row?.consumerKeyCipher,
    mpesaConsumerSecretSet: !!row?.consumerSecretCipher,
    mpesaPasskeySet: !!row?.passkeyCipher,
    mpesaEnv: normalizeMpesaEnv(row?.environment),
    mpesaType: normalizeMpesaType(row?.accountType),
    mpesaProduct: normalizeProduct(row?.product),
    mpesaShortcodeSet: !!cleanText(row?.shortcode),
    mpesaStoreNumberSet: !!cleanText(row?.storeNumber),
    mpesaShortcodeMasked: maskNumber(row?.shortcode),
    mpesaStoreNumberMasked: maskNumber(row?.storeNumber),
    credentialsEncrypted: encryptedValues.length > 0 && encryptedValues.every(value => isEncryptedSecret(String(value))),
    safeStorageReady,
    lastTestAt: row?.lastTestAt || null,
    lastTestStatus: row?.lastTestStatus || null,
    lastTestMessage: row?.lastTestMessage || null,
  };
}

export async function getMpesaPublicStatus(db: D1Database, businessId: string, keyMaterial?: string) {
  let safeStorageReady = true;
  try {
    assertSafeCredentialKey(keyMaterial);
  } catch {
    safeStorageReady = false;
  }
  const row = safeStorageReady
    ? await migrateLegacySettings(db, businessId, keyMaterial)
    : await getCredentialRow(db, businessId);
  return publicMpesaStatus(row, safeStorageReady);
}

export async function saveMpesaCredentials(
  db: D1Database,
  businessId: string,
  input: MpesaCredentialInput,
  keyMaterial?: string,
) {
  const safeKey = assertSafeCredentialKey(keyMaterial);
  const existing = await migrateLegacySettings(db, businessId, safeKey);
  const settings = await getLegacySettings(db, businessId);
  const shortcode = cleanText(input.shortcode) || cleanText(settings?.tillNumber) || cleanText(existing?.shortcode);
  const next: CredentialRow = {
    businessId,
    settingsId: existing?.settingsId || settings?.id || `core_${businessId}`,
    environment: normalizeMpesaEnv(input.env ?? existing?.environment),
    accountType: normalizeMpesaType(input.type ?? existing?.accountType),
    product: normalizeProduct(input.product ?? existing?.product),
    shortcode,
    storeNumber: cleanText(input.storeNumber) || cleanText(existing?.storeNumber) || null,
    consumerKeyCipher: existing?.consumerKeyCipher || null,
    consumerSecretCipher: existing?.consumerSecretCipher || null,
    passkeyCipher: existing?.passkeyCipher || null,
    lastTestAt: existing?.lastTestAt || null,
    lastTestStatus: existing?.lastTestStatus || null,
    lastTestMessage: existing?.lastTestMessage || null,
    created_at: existing?.created_at || Date.now(),
  };

  for (const [cipherField, , logicalField] of SECRET_FIELDS) {
    const plain = cleanText(input[logicalField], 4000);
    if (plain) next[cipherField] = await encryptSecret(plain, safeKey, secretAad(businessId, logicalField));
  }

  if (!next.consumerKeyCipher || !next.consumerSecretCipher || !next.passkeyCipher) {
    throw new Error('Enter the consumer key, consumer secret, and passkey before saving M-Pesa.');
  }
  if (!cleanText(next.shortcode)) {
    throw new Error('Enter the M-Pesa shortcode or till number before saving M-Pesa.');
  }

  await upsertCredentialRow(db, next);
  await clearLegacySettings(db, businessId);
  return publicMpesaStatus(await getCredentialRow(db, businessId), true);
}

export async function loadMpesaRuntimeCredentials(
  db: D1Database,
  businessId: string,
  keyMaterial?: string,
): Promise<MpesaRuntimeCredentials> {
  const safeKey = assertSafeCredentialKey(keyMaterial);
  let row = await migrateLegacySettings(db, businessId, safeKey);
  if (!row || !hasAllSecretCiphers(row) || !hasPublicNumber(row)) {
    throw new Error('M-Pesa is not configured.');
  }

  const decrypted = {
    consumerKey: await decryptSecret(row.consumerKeyCipher, safeKey, secretAad(businessId, 'consumerKey')),
    consumerSecret: await decryptSecret(row.consumerSecretCipher, safeKey, secretAad(businessId, 'consumerSecret')),
    passkey: await decryptSecret(row.passkeyCipher, safeKey, secretAad(businessId, 'passkey')),
  };

  if (!decrypted.consumerKey || !decrypted.consumerSecret || !decrypted.passkey) {
    throw new Error('M-Pesa is not configured.');
  }

  if (
    !String(row.consumerKeyCipher || '').startsWith('enc:v2:') ||
    !String(row.consumerSecretCipher || '').startsWith('enc:v2:') ||
    !String(row.passkeyCipher || '').startsWith('enc:v2:')
  ) {
    await saveMpesaCredentials(db, businessId, {
      consumerKey: decrypted.consumerKey,
      consumerSecret: decrypted.consumerSecret,
      passkey: decrypted.passkey,
      env: normalizeMpesaEnv(row.environment),
      type: normalizeMpesaType(row.accountType),
      product: normalizeProduct(row.product),
      shortcode: row.shortcode || '',
      storeNumber: row.storeNumber || '',
    }, safeKey);
    row = await getCredentialRow(db, businessId);
  }

  return {
    consumerKey: decrypted.consumerKey,
    consumerSecret: decrypted.consumerSecret,
    passkey: decrypted.passkey,
    env: normalizeMpesaEnv(row?.environment),
    type: normalizeMpesaType(row?.accountType),
    product: normalizeProduct(row?.product),
    shortcode: cleanText(row?.shortcode),
    storeNumber: cleanText(row?.storeNumber) || undefined,
  };
}

export async function recordMpesaTestResult(
  db: D1Database,
  businessId: string,
  status: 'PASSED' | 'FAILED',
  message: string,
) {
  await ensureMpesaCredentialSchema(db);
  await db.prepare(`
    UPDATE mpesaCredentials
    SET lastTestAt = ?, lastTestStatus = ?, lastTestMessage = ?, updated_at = ?
    WHERE businessId = ?
  `).bind(Date.now(), status, message.slice(0, 240), Date.now(), businessId).run();
}
