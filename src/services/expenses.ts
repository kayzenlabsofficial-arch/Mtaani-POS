import type { Expense } from '../db';
import { apiRequest } from './apiClient';

type ExpenseResponse = {
  success: boolean;
  expense: Expense;
  idempotent?: boolean;
};

export const ExpenseService = {
  submit(expense: Expense | any) {
    return apiRequest<ExpenseResponse>('/api/expenses/submit', {
      method: 'POST',
      body: { expense },
      businessId: expense.businessId,
      shopId: expense.shopId,
    });
  },

  approve(input: {
    expenseId: string;
    businessId: string;
    shopId: string;
    approvedBy?: string;
  }) {
    return apiRequest<ExpenseResponse>('/api/expenses/approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  reject(input: {
    expenseId: string;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; expenseId: string }>('/api/expenses/reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  delete(input: {
    expenseId: string;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; expenseId: string }>('/api/expenses/delete', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};
