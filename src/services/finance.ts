import { apiRequest } from './apiClient';

export type MainAccountAdjustMode = 'IN' | 'OUT' | 'SET';

export interface MainAccountAdjustInput {
  mode: MainAccountAdjustMode;
  amount: number;
  reason?: string;
  userName?: string;
  businessId: string;
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
};
