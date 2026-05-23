import { apiRequest } from './apiClient';

export const CashService = {
  createPick(input: {
    amount: number;
    status?: 'PENDING' | 'APPROVED';
    userName?: string;
    accountId?: string;
    shiftId?: string;
    shiftStart?: number;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; cashPick: any }>('/api/cash/pick', {
      method: 'POST',
      body: { action: 'CREATE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  approvePick(input: { cashPickId: string; businessId: string; shopId: string }) {
    return apiRequest<{ success: boolean; cashPickId: string }>('/api/cash/pick', {
      method: 'POST',
      body: { action: 'APPROVE', ...input },
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};

export const ShiftService = {
  openShift(input: {
    id: string;
    startTime: number;
    cashierId?: string;
    cashierName: string;
    tillId: string;
    tillName: string;
    openingCash: number;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; shift: any; idempotent?: boolean }>('/api/shifts/open', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};

export const ClosingService = {
  closeShift(input: {
    shiftId: string;
    startTime: number;
    report: any;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; reportId: string; shiftId: string; idempotent?: boolean }>('/api/close/shift', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  closeDay(input: {
    summary: any;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean; summaryId: string; idempotent?: boolean }>('/api/close/day', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};
