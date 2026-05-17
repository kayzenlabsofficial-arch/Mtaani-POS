import { apiRequest } from './apiClient';

export const CashService = {
  createPick(input: {
    amount: number;
    status?: 'PENDING' | 'APPROVED';
    userName?: string;
    shiftId?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; cashPick: any }>('/api/cash/pick', {
      method: 'POST',
      body: { action: 'CREATE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  approvePick(input: { cashPickId: string; businessId: string; branchId: string }) {
    return apiRequest<{ success: boolean; cashPickId: string }>('/api/cash/pick', {
      method: 'POST',
      body: { action: 'APPROVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

export const ClosingService = {
  closeShift(input: {
    shiftId: string;
    startTime: number;
    report: any;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; reportId: string; shiftId: string }>('/api/close/shift', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  closeDay(input: {
    summary: any;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; summaryId: string }>('/api/close/day', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};

