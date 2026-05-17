import type { Transaction } from '../db';
import { apiRequest } from './apiClient';

export type CheckoutResponse = {
  success: boolean;
  transaction: Transaction;
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
      branchId: transaction.branchId,
    });
  },

  requestRefund(input: {
    transactionId: string;
    businessId: string;
    branchId: string;
    itemsToReturn?: { productId: string; quantity: number }[];
  }) {
    return apiRequest<CheckoutResponse>('/api/sales/refund-request', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  approveRefund(input: {
    transactionId: string;
    businessId: string;
    branchId: string;
    itemsToReturn?: { productId: string; quantity: number }[];
    approvedBy?: string;
  }) {
    return apiRequest<CheckoutResponse>('/api/sales/refund-approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  rejectRefund(input: {
    transactionId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; transactionId: string }>('/api/sales/refund-reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
