import { apiRequest } from './apiClient';

export type MainAccountAdjustMode = 'IN' | 'OUT' | 'SET';

export interface MainAccountAdjustInput {
  mode: MainAccountAdjustMode;
  amount: number;
  reason?: string;
  userName?: string;
  businessId: string;
}

export interface MainAccountReconcileResponse {
  success: boolean;
  posted: number;
  skipped: number;
  anomalies: Array<{ source: string; id: string; message: string }>;
  account: any;
}

export const MainAccountService = {
  ensure(input: { businessId: string }) {
    return apiRequest<{ success: boolean; account: any }>('/api/finance/account', {
      method: 'POST',
      businessId: input.businessId,
      body: {
        action: 'SAVE',
        businessId: input.businessId,
      },
    });
  },

  adjust(input: MainAccountAdjustInput) {
    return apiRequest<{ success: boolean; account: any; adjustment: any }>('/api/finance/account', {
      method: 'POST',
      businessId: input.businessId,
      body: {
        action: 'ADJUST',
        businessId: input.businessId,
        mode: input.mode,
        amount: input.amount,
        reason: input.reason,
        userName: input.userName,
      },
    });
  },

  reconcileMpesa(input: { businessId: string }) {
    return apiRequest<MainAccountReconcileResponse>('/api/finance/account', {
      method: 'POST',
      businessId: input.businessId,
      body: {
        action: 'RECONCILE_MPESA',
        businessId: input.businessId,
      },
    });
  },
};
