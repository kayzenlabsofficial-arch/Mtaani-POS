import type { Category, ExpenseAccount, ServiceItem } from '../db';
import { apiRequest } from './apiClient';

export const CategoryService = {
  save(input: { category: Partial<Category> & { id?: string }; businessId: string; branchId?: string | null }) {
    return apiRequest<{ success: boolean; category: Category }>('/api/catalog/category', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  delete(input: { categoryId: string; businessId: string; branchId?: string | null }) {
    return apiRequest<{ success: boolean; categoryId: string }>('/api/catalog/category', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

export const ExpenseAccountService = {
  save(input: { account: Partial<ExpenseAccount> & { id?: string }; businessId: string }) {
    return apiRequest<{ success: boolean; account: ExpenseAccount }>('/api/catalog/expense-account', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
    });
  },

  delete(input: { accountId: string; businessId: string }) {
    return apiRequest<{ success: boolean; accountId: string }>('/api/catalog/expense-account', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
    });
  },
};

export const ServiceItemService = {
  save(input: { service: Partial<ServiceItem> & { id?: string }; businessId: string }) {
    return apiRequest<{ success: boolean; service: ServiceItem }>('/api/catalog/service-item', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
    });
  },
};

