import type { User } from '../db';
import { apiRequest } from './apiClient';

export type SafeUser = Omit<User, 'password'>;

export const AccountService = {
  completeSetup(input: { name: string; password: string }) {
    return apiRequest<{ success: boolean; user: SafeUser }>('/api/user/account-setup', {
      method: 'POST',
      body: input,
    });
  },
};
