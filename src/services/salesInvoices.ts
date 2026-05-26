import type { SalesInvoice, SalesInvoiceItem } from '../db';
import { apiRequest } from './apiClient';

export type SalesInvoiceCommandResponse = {
  success: boolean;
  invoice: SalesInvoice;
  idempotent?: boolean;
};

export const SalesInvoiceService = {
  create(input: {
    invoiceId?: string;
    customerId: string;
    items: SalesInvoiceItem[];
    dueDate?: number;
    notes?: string;
    preparedBy?: string;
    businessId: string;
    shopId: string;
    shiftId?: string;
  }) {
    return apiRequest<SalesInvoiceCommandResponse>('/api/sales/invoice-create', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },

  cancel(input: {
    invoiceId: string;
    businessId: string;
    shopId: string;
    shiftId?: string;
  }) {
    return apiRequest<SalesInvoiceCommandResponse>('/api/sales/invoice-cancel', {
      method: 'POST',
      body: input,
      businessId: input.businessId,
      shopId: input.shopId,
    });
  },
};
