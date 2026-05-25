import type { BillingPayment, Business, User } from '../db';
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
    return apiRequest<{ success: boolean; userId: string; mustChangePassword?: boolean }>('/api/admin/staff', {
      method: 'POST',
      body: { action: 'RESET_PASSWORD', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};

export type BusinessBillingStatus = 'OK' | 'REMINDER' | 'LOCKED';

export type BusinessDetails = {
  success: boolean;
  business: Business;
  billing: {
    businessId: string;
    businessName: string;
    businessCode: string;
    billingStatus: BusinessBillingStatus;
    amountDue: number;
    dueAt: number | null;
    message: string;
    lastPaidAt: number | null;
  };
  users: Array<Omit<User, 'password'>>;
  billingPayments: BillingPayment[];
  loginAttempts: Array<{ id: string; count: number; lockedUntil?: number | null; updated_at?: number }>;
};

export const BusinessAdminService = {
  create(input: { name: string; code: string }) {
    return apiRequest<{ success: boolean; businessId: string }>('/api/admin/business', {
      method: 'POST',
      body: { action: 'CREATE', ...input },
    });
  },

  details(businessId: string) {
    return apiRequest<BusinessDetails>(`/api/admin/business?businessId=${encodeURIComponent(businessId)}`);
  },

  updateBilling(input: {
    businessId: string;
    billingStatus: BusinessBillingStatus;
    amountDue: number;
    dueAt?: number | null;
    message?: string;
  }) {
    return apiRequest<BusinessDetails>('/api/admin/business', {
      method: 'POST',
      body: { action: 'UPDATE_BILLING', ...input },
    });
  },

  markPaid(input: { businessId: string; amount?: number; receiptNumber?: string }) {
    return apiRequest<BusinessDetails>('/api/admin/business', {
      method: 'POST',
      body: { action: 'MARK_PAID', ...input },
    });
  },

  clearLoginLockouts(input: { businessId: string }) {
    return apiRequest<BusinessDetails>('/api/admin/business', {
      method: 'POST',
      body: { action: 'CLEAR_LOGIN_LOCKOUTS', ...input },
    });
  },
};
