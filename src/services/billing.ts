import type { BillingPayment } from '../db';
import { apiRequest } from './apiClient';

export type BillingStatus = 'OK' | 'REMINDER' | 'LOCKED';

export type BillingInfo = {
  businessId: string;
  businessName: string;
  businessCode: string;
  billingStatus: BillingStatus;
  amountDue: number;
  dueAt: number | null;
  message: string;
  lastPaidAt: number | null;
};

export type BillingStatusResponse = {
  success: boolean;
  billing: BillingInfo;
  payment?: BillingPayment | null;
  recentPayments?: BillingPayment[];
};

export type BillingPayResponse = {
  success: boolean;
  message?: string;
  redirectUrl?: string;
  billing: BillingInfo;
  payment: BillingPayment;
};

export const BillingService = {
  status(input: { businessId: string; checkoutRequestId?: string }) {
    const params = new URLSearchParams({ businessId: input.businessId });
    if (input.checkoutRequestId) params.set('checkoutRequestId', input.checkoutRequestId);
    return apiRequest<BillingStatusResponse>(`/api/billing/status?${params.toString()}`, {
      businessId: input.businessId,
    });
  },

  pay(input: { businessId: string; phone: string }) {
    return apiRequest<BillingPayResponse>('/api/billing/pay', {
      method: 'POST',
      businessId: input.businessId,
      body: input,
    });
  },
};
