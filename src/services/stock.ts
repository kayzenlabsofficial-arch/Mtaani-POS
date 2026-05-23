import { apiRequest } from './apiClient';

export const StockService = {
  requestAdjustment(input: {
    productId: string;
    newQty: number;
    reason: string;
    businessId: string;
    shopId: string;
    preparedBy?: string;
  }) {
    return apiRequest<{ success: boolean; adjustment: any }>('/api/stock/adjustment-request', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  restock(input: {
    productId: string;
    quantity: number;
    costPrice?: number;
    expiryDate?: number;
    reference?: string;
    businessId: string;
    shopId: string;
    shiftId?: string;
  }) {
    return apiRequest<{ success: boolean; productId: string; stockQuantity: number; costPrice?: number; expiryDate?: number }>('/api/stock/restock', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  approveAdjustment(input: {
    requestId: string;
    businessId: string;
    shopId: string;
    approvedBy?: string;
  }) {
    return apiRequest<{ success: boolean; productId?: string; stockQuantity?: number }>('/api/stock/adjustment-approve', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  rejectAdjustment(input: {
    requestId: string;
    businessId: string;
    shopId: string;
  }) {
    return apiRequest<{ success: boolean }>('/api/stock/adjustment-reject', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};
