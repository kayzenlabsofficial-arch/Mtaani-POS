import { apiRequest } from './apiClient';

export const StockService = {
  restock(input: {
    productId: string;
    quantity: number;
    costPrice?: number;
    reference?: string;
    businessId: string;
    branchId: string;
    shiftId?: string;
  }) {
    return apiRequest<{ success: boolean; productId: string; stockQuantity: number; costPrice?: number }>('/api/stock/restock', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  approveAdjustment(input: {
    requestId: string;
    businessId: string;
    branchId: string;
    approvedBy?: string;
  }) {
    return apiRequest<{ success: boolean; productId?: string; stockQuantity?: number }>('/api/stock/adjustment-approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  rejectAdjustment(input: {
    requestId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean }>('/api/stock/adjustment-reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
