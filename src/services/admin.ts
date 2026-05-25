import type { User } from '../db';
import { apiRequest } from './apiClient';

export const StaffService = {
  save(input: {
    user: Partial<User> & { password?: string };
    businessId: string;
    shopId?: string | null;
  }) {
    return apiRequest<{ success: boolean; user: Omit<User, 'password'> }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  delete(input: { userId: string; businessId: string; shopId?: string | null }) {
    return apiRequest<{ success: boolean; userId: string }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  resetPassword(input: { userId: string; newPassword?: string; businessId: string; shopId?: string | null }) {
    return apiRequest<{ success: boolean; userId: string; temporaryPassword?: string; mustChangePassword?: boolean }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'RESET_PASSWORD', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};

export const BusinessAdminService = {
  create(input: { name: string; code: string }) {
    return apiRequest<{ success: boolean; businessId: string; adminPassword: string }>('/api/admin/business', {
      method: 'POST',
      body: input,
    });
  },
};
