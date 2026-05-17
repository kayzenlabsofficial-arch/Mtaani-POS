import { apiRequest } from './apiClient';

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
   * Sends an M-Pesa phone request to the specified phone number.
   */
  async triggerStkPush(phone: string, amount: number, reference: string = 'POS', businessId: string, branchId: string): Promise<StkPushResponse> {
    try {
      return await apiRequest<StkPushResponse>(`${API_BASE}/stkpush`, {
        method: 'POST',
        body: { phone, amount, reference, businessId, branchId },
        businessId,
        branchId,
      });
    } catch (err: any) {
      console.error('M-Pesa Request Failed:', err);
      return { error: err.message || 'Network error' };
    }
  },

  /**
   * Checks the status of an existing M-Pesa phone request.
   */
  async checkStatus(checkoutRequestId: string): Promise<MpesaStatusResponse> {
    try {
      return await apiRequest<MpesaStatusResponse>(`${API_BASE}/status/${checkoutRequestId}`);
    } catch (err: any) {
      console.error('Status Check Failed:', err);
      return { found: false, error: err.message || 'Network error' };
    }
  },

  async verifyPayment(code: string, amount: number, businessId: string, branchId: string): Promise<MpesaVerificationResponse> {
    try {
      return await apiRequest<MpesaVerificationResponse>(`${API_BASE}/verify`, {
        method: 'POST',
        body: { code, amount, businessId, branchId },
        businessId,
        branchId,
      });
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
      return await apiRequest<{ success?: boolean; error?: string }>(`${API_BASE}/utilize`, {
        method: 'POST',
        body: input,
        businessId: input.businessId,
        branchId: input.branchId,
      });
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
      const params = new URLSearchParams({
        businessId: input.businessId,
        branchId: input.branchId,
        limit: String(input.limit || 500),
        offset: String(input.offset || 0),
      });
      if (input.from) params.set('from', String(input.from));
      if (input.to) params.set('to', String(input.to));
      if (input.search) params.set('search', input.search);

      const data = await apiRequest<{ rows?: MpesaLedgerRow[]; total?: number }>(`${API_BASE}/transactions?${params.toString()}`, {
        businessId: input.businessId,
        branchId: input.branchId,
      });
      return { rows: data.rows || [], total: Number(data.total || 0) };
    } catch (err: any) {
      console.error('M-Pesa Payments Failed:', err);
      return { rows: [], total: 0, error: err.message || 'Network error' };
    }
  }
};
