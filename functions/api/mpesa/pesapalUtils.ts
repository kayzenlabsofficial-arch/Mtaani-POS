import {
  loadPesaPalRuntimeCredentials,
  type PesaPalRuntimeCredentials,
} from './credentialStore';

type PesaPalOrderInput = {
  amount: number;
  phone: string;
  reference: string;
  businessId: string;
  callbackUrl: string;
  cancellationUrl: string;
  notificationId: string;
};

function cleanText(value: unknown, max = 240) {
  return String(value ?? '').trim().slice(0, max);
}

function formatPhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) cleaned = `254${cleaned.slice(1)}`;
  if (cleaned.startsWith('7') || cleaned.startsWith('1')) cleaned = `254${cleaned}`;
  return cleaned;
}

function merchantReference(value: string) {
  const clean = cleanText(value || `POS-${Date.now()}`, 50).replace(/[^A-Za-z0-9_.:-]/g, '-');
  return clean || `POS-${Date.now()}`;
}

export function pesapalBaseUrl(credentials: PesaPalRuntimeCredentials) {
  return credentials.env === 'production'
    ? 'https://pay.pesapal.com/v3'
    : 'https://cybqa.pesapal.com/pesapalv3';
}

async function pesapalJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok || data?.error?.message || data?.error?.code) {
    throw new Error(data?.error?.message || data?.message || `PesaPal request failed (${res.status}).`);
  }
  return data as T;
}

export async function getPesaPalToken(credentials: PesaPalRuntimeCredentials) {
  const data = await pesapalJson<any>(`${pesapalBaseUrl(credentials)}/api/Auth/RequestToken`, {
    method: 'POST',
    body: JSON.stringify({
      consumer_key: credentials.consumerKey,
      consumer_secret: credentials.consumerSecret,
    }),
  });
  const token = cleanText(data?.token, 4000);
  if (!token) throw new Error('PesaPal did not return an access token.');
  return token;
}

export async function getPesaPalNotificationId(credentials: PesaPalRuntimeCredentials, token: string, ipnUrl: string) {
  if (credentials.ipnId) return credentials.ipnId;
  const authHeaders = { Authorization: `Bearer ${token}` };
  const existingData = await pesapalJson<any>(`${pesapalBaseUrl(credentials)}/api/URLSetup/GetIpnList`, {
    method: 'GET',
    headers: authHeaders,
  }).catch(() => []);
  const existing = Array.isArray(existingData)
    ? existingData
    : Array.isArray(existingData?.ipn_list)
      ? existingData.ipn_list
      : Array.isArray(existingData?.data)
        ? existingData.data
        : [];
  const match = existing.find((item: any) => String(item?.url || '').trim() === ipnUrl && String(item?.ipn_id || '').trim());
  if (match?.ipn_id) return String(match.ipn_id);

  const registered = await pesapalJson<any>(`${pesapalBaseUrl(credentials)}/api/URLSetup/RegisterIPN`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ url: ipnUrl, ipn_notification_type: 'GET' }),
  });
  const ipnId = cleanText(registered?.ipn_id, 120);
  if (!ipnId) throw new Error('PesaPal did not return an IPN notification id.');
  return ipnId;
}

export async function submitPesaPalOrder(credentials: PesaPalRuntimeCredentials, token: string, input: PesaPalOrderInput) {
  const amount = Math.ceil(Number(input.amount) || 0);
  if (amount <= 0) throw new Error('Payment amount is invalid.');
  const phone = formatPhone(input.phone);
  if (!/^254[17]\d{8}$/.test(phone)) throw new Error('Enter a valid M-Pesa phone number.');
  const reference = merchantReference(input.reference);

  const data = await pesapalJson<any>(`${pesapalBaseUrl(credentials)}/api/Transactions/SubmitOrderRequest`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      id: reference,
      currency: credentials.currency,
      amount,
      description: cleanText(`Mtaani POS payment ${reference}`, 100),
      callback_url: input.callbackUrl,
      cancellation_url: input.cancellationUrl,
      redirect_mode: 'TOP_WINDOW',
      notification_id: input.notificationId,
      branch: cleanText(input.businessId, 100),
      billing_address: {
        email_address: '',
        phone_number: phone,
        country_code: 'KE',
        first_name: 'Mtaani',
        middle_name: '',
        last_name: 'Customer',
        line_1: 'Mtaani POS',
        line_2: '',
        city: 'Nairobi',
        state: '',
        postal_code: '',
        zip_code: '',
      },
    }),
  });

  const orderTrackingId = cleanText(data?.order_tracking_id, 160);
  const redirectUrl = cleanText(data?.redirect_url, 2000);
  if (!orderTrackingId || !redirectUrl) throw new Error(data?.message || 'PesaPal did not return a checkout link.');

  return {
    phone,
    amount,
    reference,
    checkoutRequestId: orderTrackingId,
    merchantRequestId: cleanText(data?.merchant_reference, 160) || reference,
    redirectUrl,
  };
}

export async function refreshPesaPalMpesaPayment(
  db: D1Database,
  businessId: string,
  orderTrackingId: string,
  keyMaterial?: string,
) {
  const trackingId = cleanText(orderTrackingId, 160);
  if (!trackingId) return null;
  const credentials = await loadPesaPalRuntimeCredentials(db, businessId, keyMaterial);
  const token = await getPesaPalToken(credentials);
  const status = await pesapalJson<any>(`${pesapalBaseUrl(credentials)}/api/Transactions/GetTransactionStatus?orderTrackingId=${encodeURIComponent(trackingId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });

  const statusDescription = String(status?.payment_status_description || '').toUpperCase();
  const statusCode = Number(status?.status_code);
  const paid = statusCode === 1 || statusDescription === 'COMPLETED';
  const failed = statusCode === 0 || statusCode === 2 || statusCode === 3
    || statusDescription === 'FAILED' || statusDescription === 'REVERSED' || statusDescription === 'INVALID';
  const resultCode = paid ? 0 : failed ? (Number.isFinite(statusCode) ? statusCode : 2) : 999;
  const resultDesc = cleanText(
    status?.description || status?.payment_status_description || status?.message,
    500,
  ) || (paid ? 'Paid via PesaPal' : failed ? 'PesaPal payment failed' : 'PesaPal payment pending');

  await db.prepare(`
    UPDATE mpesaCallbacks
    SET resultCode = ?,
        resultDesc = ?,
        amount = COALESCE(NULLIF(?, 0), amount),
        receiptNumber = COALESCE(NULLIF(?, ''), receiptNumber),
        phoneNumber = COALESCE(NULLIF(?, ''), phoneNumber),
        timestamp = ?
    WHERE checkoutRequestId = ? AND businessId = ?
  `).bind(
    resultCode,
    resultDesc,
    Number(status?.amount || 0),
    cleanText(status?.confirmation_code, 160),
    cleanText(status?.payment_account, 160),
    Date.now(),
    trackingId,
    businessId,
  ).run();

  return db.prepare('SELECT * FROM mpesaCallbacks WHERE checkoutRequestId = ? AND businessId = ? LIMIT 1')
    .bind(trackingId, businessId)
    .first<any>();
}
