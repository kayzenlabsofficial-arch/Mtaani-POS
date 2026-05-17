import type { Customer, CustomerPayment } from '../db';
import { apiRequest } from './apiClient';

export type CustomerPaymentResponse = {
  success: boolean;
  paymentId: string;
  customerId: string;
  amount: number;
  customerBalance: number;
  allocationCount: number;
};

export const CustomerService = {
  saveProfile(input: {
    customer?: Partial<Customer> & { id?: string };
    customerId?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; customer: Customer }>('/api/customers/profile', {
      method: 'POST',
      body: { action: 'SAVE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  deleteProfile(input: {
    customerId: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<{ success: boolean; customerId: string }>('/api/customers/profile', {
      method: 'POST',
      body: { action: 'DELETE', ...input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },

  recordPayment(input: {
    customerId: string;
    amount: number;
    paymentMethod: CustomerPayment['paymentMethod'];
    reference: string;
    transactionCode?: string;
    allocations?: CustomerPayment['allocations'];
    preparedBy?: string;
    businessId: string;
    branchId: string;
  }) {
    return apiRequest<CustomerPaymentResponse>('/api/customers/payment', {
      method: 'POST',
      body: { payment: input },
      businessId: input.businessId,
      branchId: input.branchId,
    });
  },
};
