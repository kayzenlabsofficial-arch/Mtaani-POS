export const PICKED_CASH_ACCOUNT_NAME = 'Picked cash account';
export const PICKED_CASH_ACCOUNT_NUMBER = 'PICKED-CASH';

export function pickedCashAccountId(businessId?: string | null): string {
  const id = String(businessId || '').trim();
  return id ? `picked_cash_${id}` : '';
}

export function getPickedCashAccount(accounts: any[] | undefined, businessId?: string | null) {
  const id = pickedCashAccountId(businessId);
  const existing = (accounts || []).find(account =>
    account?.id === id ||
    account?.accountNumber === PICKED_CASH_ACCOUNT_NUMBER ||
    String(account?.name || '').trim().toLowerCase() === PICKED_CASH_ACCOUNT_NAME.toLowerCase()
  );
  if (existing) return existing;
  if (!id || !businessId) return null;
  return {
    id,
    name: PICKED_CASH_ACCOUNT_NAME,
    type: 'CASH',
    accountNumber: PICKED_CASH_ACCOUNT_NUMBER,
    balance: 0,
    businessId,
  };
}

export function singleFinanceAccount(accounts: any[] | undefined, businessId?: string | null): any[] {
  const account = getPickedCashAccount(accounts, businessId);
  return account ? [account] : [];
}
