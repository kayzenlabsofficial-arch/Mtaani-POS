import type { BusinessSettings } from '../db';
import { apiRequest } from './apiClient';

export const BusinessSettingsService = {
  save(input: { settings: Partial<BusinessSettings> & { id?: string }; businessId: string }) {
    return apiRequest<{ success: boolean; settings: BusinessSettings }>('/api/settings/business', {
      method: 'POST',
      body: { settings: input.settings },
      businessId: input.businessId,
    });
  },
};
