import type { Branch, User } from '../db';
import { apiRequest } from './apiClient';

export const StaffService = {
  save(input: {
    user: Partial<User> & { password?: string };
    businessId: string;
    branchId?: string | null;
  }) {
    return apiRequest<{ success: boolean; user: Omit<User, 'password'> }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  delete(input: { userId: string; businessId: string; branchId?: string | null }) {
    return apiRequest<{ success: boolean; userId: string }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  resetPassword(input: { userId: string; newPassword?: string; businessId: string; branchId?: string | null }) {
    return apiRequest<{ success: boolean; userId: string; temporaryPassword?: string }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'RESET_PASSWORD', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

export const BusinessAdminService = {
  create(input: { name: string; code: string }) {
    return apiRequest<{ success: boolean; businessId: string; branchId: string; adminPassword: string }>('/api/admin/business', {
      method: 'POST',
      body: input,
    });
  },
};

export const BranchService = {
  save(input: { branch: Partial<Branch> & { id?: string }; businessId: string; branchId?: string | null }) {
    return apiRequest<{ success: boolean; branch: Branch }>('/api/admin/branch', {
      method: 'POST',
      body: { action: 'SAVE', branch: input.branch, businessId: input.businessId },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  setActive(input: { branchId: string; isActive: boolean; businessId: string }) {
    return apiRequest<{ success: boolean; branchId: string; isActive: number }>('/api/admin/branch', {
      method: 'POST',
      body: { action: 'SET_ACTIVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  delete(input: { branchId: string; businessId: string }) {
    return apiRequest<{ success: boolean; branchId: string }>('/api/admin/branch', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
