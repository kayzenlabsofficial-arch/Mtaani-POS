import { apiRequest } from './apiClient';
import type { PurchaseOrder } from '../db';

export type PurchaseReceiveLine = {
  productId: string;
  receivedQuantity: number;
  unitCost: number;
  sellingPrice?: number;
};

export type PurchaseReceiveResponse = {
  success: boolean;
  purchaseOrderId: string;
  totalReceivedCost: number;
  receivedItemCount: number;
};

export const PurchaseService = {
  saveOrder(input: {
    purchaseOrderId?: string;
    supplierId: string;
    items: { productId: string; expectedQuantity: number; unitCost: number }[];
    preparedBy?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; purchaseOrder: PurchaseOrder; autoApproved: boolean }>('/api/purchases/save', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  setApproval(input: {
    purchaseOrderId: string;
    action: 'APPROVE' | 'REJECT';
    approvedBy?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; purchaseOrderId: string; approvalStatus: 'APPROVED' | 'REJECTED' }>('/api/purchases/approval', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  receiveOrder(input: {
    purchaseOrderId: string;
    invoiceNumber: string;
    items: PurchaseReceiveLine[];
    receivedBy: string;
    businessId: string;
    branchId: string;
    shiftId?: string;
  }) {
    return apiRequest<PurchaseReceiveResponse>('/api/purchases/receive', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
