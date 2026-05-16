import { getApiKey } from '../runtimeConfig';

const API_BASE = '/api/billing';

export type BillingDiscountType = 'FIXED' | 'PERCENT';

export interface BillingAccount {
  businessId: string;
  monthlyBaseFee: number;
  pricePerBranch: number;
  discountType: BillingDiscountType;
  discountValue: number;
  dueDay: number;
  bannerEnabled: number;
  bannerMessage: string;
  allowPartial: number;
  minPaymentAmount: number;
  status: string;
  updated_at?: number;
}

export interface BillingInvoice {
  id: string;
  businessId: string;
  period: string;
  branchCount: number;
  monthlyBaseFee: number;
  pricePerBranch: number;
  subtotal: number;
  discountType: BillingDiscountType;
  discountValue: number;
  discountAmount: number;
  totalDue: number;
  amountPaid: number;
  balance: number;
  dueDate: number;
  status: 'PENDING' | 'PARTIAL' | 'PAID' | string;
}

export interface BillingPayment {
  id: string;
  invoiceId: string;
  businessId: string;
  amount: number;
  method: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | string;
  receiptNumber?: string;
  phoneNumber?: string;
  checkoutRequestId?: string;
  resultCode?: number;
  resultDesc?: string;
  timestamp?: number;
}

export interface BillingSummaryRow {
  business: {
    id: string;
    name: string;
    code: string;
    isActive?: number;
  };
  branchCount: number;
  account: BillingAccount;
  invoice: BillingInvoice;
}

async function requestBilling<T>(path: string, options: RequestInit = {}): Promise<T & { error?: string }> {
  try {
    if (typeof window !== 'undefined' && navigator.onLine === false) {
      return { error: 'Offline: billing needs internet.' } as T & { error: string };
    }
    const apiKey = await getApiKey();
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        ...(options.headers || {}),
      },
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ...(data || {}), error: data?.error || `Billing request failed (${res.status})` };
    return data;
  } catch (err: any) {
    return { error: err?.message || 'Billing request failed.' } as T & { error: string };
  }
}

export const BillingService = {
  summary() {
    return requestBilling<{ rows: BillingSummaryRow[] }>('/summary');
  },

  current(businessId: string, period?: string) {
    const params = new URLSearchParams({ businessId });
    if (period) params.set('period', period);
    return requestBilling<{ account: BillingAccount; invoice: BillingInvoice; showBanner: boolean }>(`/current?${params.toString()}`);
  },

  saveAccount(account: Partial<BillingAccount> & { businessId: string }) {
    return requestBilling<{ success: boolean; account: BillingAccount; invoice: BillingInvoice }>('/account', {
      method: 'POST',
      body: JSON.stringify(account),
    });
  },

  generateInvoice(businessId: string, period?: string) {
    return requestBilling<{ success: boolean; invoice: BillingInvoice }>('/invoice', {
      method: 'POST',
      body: JSON.stringify({ businessId, period }),
    });
  },

  recordPayment(input: {
    businessId: string;
    amount: number;
    method: string;
    receiptNumber?: string;
    notes?: string;
    recordedBy?: string;
    period?: string;
  }) {
    return requestBilling<{ success: boolean; paymentId: string; invoice: BillingInvoice }>('/payment', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  sendStk(input: {
    businessId: string;
    phone: string;
    amount: number;
    period?: string;
  }) {
    return requestBilling<{ success: boolean; paymentId: string; invoiceId: string; checkoutRequestId: string; message: string }>('/stkpush', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  status(paymentId: string) {
    return requestBilling<{ found: boolean; payment?: BillingPayment; invoice?: BillingInvoice }>(`/status/${encodeURIComponent(paymentId)}`);
  },
};
