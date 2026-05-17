import type { FinancialAccount } from '../db';
import { apiRequest } from './apiClient';

export const FinanceService = {
  saveAccount(input: {
    account: Partial<FinancialAccount> & { id?: string };
    businessId: string;
    branchId?: string | null;
  }) {
    return apiRequest<{ success: boolean; account: FinancialAccount }>('/api/finance/account', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  deleteAccount(input: {
    accountId: string;
    businessId: string;
    branchId?: string | null;
  }) {
    return apiRequest<{ success: boolean; accountId: string }>('/api/finance/account', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  adjustAccount(input: {
    accountId: string;
    action: 'DEPOSIT' | 'WITHDRAW';
    amount: number;
    businessId: string;
    branchId?: string | null;
  }) {
    return apiRequest<{ success: boolean; accountId: string; balance: number }>('/api/finance/account', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

