import { getApiKey } from '../runtimeConfig';

const API_BASE = '/api/mpesa';

export interface StkPushResponse {
  success?: boolean;
  message?: string;
  checkoutRequestId?: string;
  error?: string;
}

export interface MpesaStatusResponse {
  found: boolean;
  status?: 'PENDING';
  resultCode?: number;
  resultDesc?: string;
  amount?: number;
  receiptNumber?: string;
  phoneNumber?: string;
  error?: string;
}

export interface MpesaVerificationResponse {
  found: boolean;
  paid: boolean;
  usable: boolean;
  utilizationStatus: 'UTILIZED' | 'UNUTILIZED';
  paymentStatus?: 'PAID' | 'PENDING' | 'FAILED';
  receiptNumber?: string;
  checkoutRequestId?: string;
  amount?: number;
  expectedAmount?: number;
  amountOk?: boolean;
  phoneNumber?: string;
  resultCode?: number;
  resultDesc?: string;
  linkedTransactionId?: string;
  linkedCustomerId?: string;
  linkedCustomerName?: string;
  message?: string;
  error?: string;
}

export interface MpesaLedgerRow {
  checkoutRequestId: string;
  merchantRequestId?: string;
  receiptNumber?: string;
  amount: number;
  phoneNumber?: string;
  resultCode: number;
  resultDesc?: string;
  paymentStatus: 'PAID' | 'PENDING' | 'FAILED';
  utilizationStatus: 'UTILIZED' | 'UNUTILIZED';
  linkedTransactionId?: string | null;
  linkedReceiptNumber?: string | null;
  linkedCustomerName?: string | null;
  utilizedAt?: number | null;
  timestamp: number;
}

export const MpesaService = {
  /**
   * Triggers an STK Push to the specified phone number.
   */
  async triggerStkPush(phone: string, amount: number, reference: string = 'POS', businessId: string, branchId: string): Promise<StkPushResponse> {
    try {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        return { error: 'Offline: M-Pesa requires internet connection.' };
      }
      const apiKey = await getApiKey();
      const res = await fetch(`${API_BASE}/stkpush`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
        },
        body: JSON.stringify({ phone, amount, reference, businessId, branchId })
      });
      return await res.json();
    } catch (err: any) {
      console.error('STK Push Request Failed:', err);
      return { error: err.message || 'Network error' };
    }
  },

  /**
   * Polls the status of an existing STK Push request.
   */
  async checkStatus(checkoutRequestId: string): Promise<MpesaStatusResponse> {
    try {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        return { found: false, error: 'Offline: status check requires internet.' };
      }
      const apiKey = await getApiKey();
      const res = await fetch(`${API_BASE}/status/${checkoutRequestId}`, {
        headers: { 'X-API-Key': apiKey }
      });
      return await res.json();
    } catch (err: any) {
      console.error('Status Check Failed:', err);
      return { found: false, error: err.message || 'Network error' };
    }
  },

  async verifyPayment(code: string, amount: number, businessId: string, branchId: string): Promise<MpesaVerificationResponse> {
    try {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        return { found: false, paid: false, usable: false, utilizationStatus: 'UNUTILIZED', error: 'Offline: M-Pesa verification requires internet.' };
      }
      const apiKey = await getApiKey();
      const res = await fetch(`${API_BASE}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Business-ID': businessId,
          'X-Branch-ID': branchId,
        },
        body: JSON.stringify({ code, amount, businessId, branchId }),
      });
      const data: any = await res.json().catch(() => ({}));
      return data as MpesaVerificationResponse;
    } catch (err: any) {
      console.error('M-Pesa Verify Failed:', err);
      return { found: false, paid: false, usable: false, utilizationStatus: 'UNUTILIZED', error: err.message || 'Network error' };
    }
  },

  async markUtilized(input: {
    code: string;
    transactionId: string;
    businessId: string;
    branchId: string;
    customerId?: string;
    customerName?: string;
  }): Promise<{ success?: boolean; error?: string }> {
    try {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        return { error: 'Offline: M-Pesa utilization requires internet.' };
      }
      const apiKey = await getApiKey();
      const res = await fetch(`${API_BASE}/utilize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          'X-Business-ID': input.businessId,
          'X-Branch-ID': input.branchId,
        },
        body: JSON.stringify(input),
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { error: data?.error || `M-Pesa utilization failed (${res.status})` };
      return data;
    } catch (err: any) {
      console.error('M-Pesa Utilization Failed:', err);
      return { error: err.message || 'Network error' };
    }
  },

  async listTransactions(input: {
    businessId: string;
    branchId: string;
    from?: number;
    to?: number;
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ rows: MpesaLedgerRow[]; total: number; error?: string }> {
    try {
      if (typeof window !== 'undefined' && navigator.onLine === false) {
        return { rows: [], total: 0, error: 'Offline: M-Pesa ledger requires internet.' };
      }
      const apiKey = await getApiKey();
      const params = new URLSearchParams({
        businessId: input.businessId,
        branchId: input.branchId,
        limit: String(input.limit || 500),
        offset: String(input.offset || 0),
      });
      if (input.from) params.set('from', String(input.from));
      if (input.to) params.set('to', String(input.to));
      if (input.search) params.set('search', input.search);

      const res = await fetch(`${API_BASE}/transactions?${params.toString()}`, {
        headers: {
          'X-API-Key': apiKey,
          'X-Business-ID': input.businessId,
          'X-Branch-ID': input.branchId,
        },
        cache: 'no-store',
      });
      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) return { rows: [], total: 0, error: data?.error || `M-Pesa ledger failed (${res.status})` };
      return { rows: data.rows || [], total: Number(data.total || 0) };
    } catch (err: any) {
      console.error('M-Pesa Ledger Failed:', err);
      return { rows: [], total: 0, error: err.message || 'Network error' };
    }
  }
};
