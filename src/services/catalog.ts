import type { Category, ServiceItem } from '../db';
import { apiRequest } from './apiClient';

export const CategoryService = {
  save(input: { category: Partial<Category> & { id?: string }; businessId: string; shopId?: string | null }) {
    return apiRequest<{ success: boolean; category: Category }>('/api/catalog/category', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  delete(input: { categoryId: string; businessId: string; shopId?: string | null }) {
    return apiRequest<{ success: boolean; categoryId: string }>('/api/catalog/category', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
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
