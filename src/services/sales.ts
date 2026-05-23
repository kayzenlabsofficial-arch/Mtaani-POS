import type { Transaction } from '../db';
import { apiRequest } from './apiClient';

export type CheckoutResponse = {
  success: boolean;
  transaction: Transaction;
  refund?: any;
  idempotent?: boolean;
};

export const SalesService = {
  checkout(transaction: Transaction, options: { idempotencyKey?: string } = {}) {
    return apiRequest<CheckoutResponse>('/api/sales/checkout', {
      method: 'POST',
      body: {
        transaction,
        idempotencyKey: options.idempotencyKey || transaction.id,
      },
      businessId: transaction.businessId,
      shopId: transaction.shopId,
    });
  },

  requestRefund(input: {
    transactionId: string;
    businessId: string;
    shopId: string;
    itemsToReturn?: { productId: string; quantity: number }[];
  }) {
    return apiRequest<CheckoutResponse>('/api/sales/refund-request', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  approveRefund(input: {
    transactionId: string;
    businessId: string;
    shopId: string;
    itemsToReturn?: { productId: string; quantity: number }[];
    approvedBy?: string;
    idempotencyKey?: string;
  }) {
    return apiRequest<CheckoutResponse>('/api/sales/refund-approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  rejectRefund(input: {
    transactionId: string;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; transactionId: string }>('/api/sales/refund-reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};
