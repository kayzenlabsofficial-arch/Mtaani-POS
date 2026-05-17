import type { Expense } from '../db';
import { apiRequest } from './apiClient';

type ExpenseResponse = {
  success: boolean;
  expense: Expense;
};

export const ExpenseService = {
  submit(expense: Expense | any) {
    return apiRequest<ExpenseResponse>('/api/expenses/submit', {
      method: 'POST',
      body: { expense },
      businessId: expense.businessId,
      branchId: expense.branchId,
    });
  },

  approve(input: {
    expenseId: string;
    businessId: string;
    branchId: string;
    approvedBy?: string;
  }) {
    return apiRequest<ExpenseResponse>('/api/expenses/approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  reject(input: {
    expenseId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; expenseId: string }>('/api/expenses/reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  delete(input: {
    expenseId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; expenseId: string }>('/api/expenses/delete', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
