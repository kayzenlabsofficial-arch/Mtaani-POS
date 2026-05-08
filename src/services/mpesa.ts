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

export const MpesaService = {
  /**
   * Triggers an STK Push to the specified phone number.
   */
  async triggerStkPush(phone: string, amount: number, reference: string = 'POS', businessId: string, branchId: string): Promise<StkPushResponse> {
    try {
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
      const apiKey = await getApiKey();
      const res = await fetch(`${API_BASE}/status/${checkoutRequestId}`, {
        headers: { 'X-API-Key': apiKey }
      });
      return await res.json();
    } catch (err: any) {
      console.error('Status Check Failed:', err);
      return { found: false, error: err.message || 'Network error' };
    }
  }
};
