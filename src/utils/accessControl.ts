import type { User } from '../db';

export type ActionKey =
  | 'sale.checkout'
  | 'sale.refund.request'
  | 'expense.create'
  | 'expense.delete'
  | 'report.view'
  | 'admin.manage';

const POLICY: Record<ActionKey, Array<User['role']>> = {
  'sale.checkout': ['ADMIN', 'MANAGER', 'CASHIER'],
  'sale.refund.request': ['ADMIN', 'MANAGER', 'CASHIER'],
  'expense.create': ['ADMIN', 'MANAGER'],
  'expense.delete': ['ADMIN'],
  'report.view': ['ADMIN', 'MANAGER'],
  'admin.manage': ['ADMIN'],
};

export function canPerform(user: User | null | undefined, action: ActionKey): boolean {
  if (!user) return false;
  return POLICY[action].includes(user.role);
}

