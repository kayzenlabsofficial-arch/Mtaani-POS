import type { CreditNote, Supplier } from '../db';
import type { SupplierPaymentInput } from '../utils/supplierLedger';
import { apiRequest } from './apiClient';

export type SupplierPaymentResponse = {
  success: boolean;
  paymentId: string;
  cashAmount: number;
  creditTotal: number;
  totalDeduction: number;
  allocatedInvoiceCount: number;
};

export type SupplierCreditNoteResponse = {
  success: boolean;
  creditNote: CreditNote;
};

export const SupplierService = {
  saveProfile(input: {
    supplier?: Partial<Supplier> & { id?: string };
    supplierId?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; supplier: Supplier }>('/api/suppliers/profile', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  deleteProfile(input: {
    supplierId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; supplierId: string }>('/api/suppliers/profile', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  settlePayment(input: {
    supplier: Supplier;
    payment: SupplierPaymentInput;
    activeBranchId: string;
    activeBusinessId: string;
    preparedBy: string;
    shiftId?: string;
  }) {
    return apiRequest<SupplierPaymentResponse>('/api/suppliers/payment', {
      method: 'POST',
      body: {
        supplierId: input.supplier.id,
        payment: input.payment,
        preparedBy: input.preparedBy,
        shiftId: input.shiftId,
        businessId: input.activeBusinessId,
        branchId: input.activeBranchId,
      },
      businessId: input.activeBusinessId,
      branchId: input.activeBranchId,
    });
  },

  recordCreditNote(input: {
    supplierId: string;
    amount: number;
    reference?: string;
    reason?: string;
    productId?: string;
    quantity?: number;
    shiftId?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<SupplierCreditNoteResponse>('/api/suppliers/credit-note', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
