export const MAIN_ACCOUNT_NAME = 'Main account';
export const MAIN_ACCOUNT_NUMBER = 'PICKED-CASH';
export const PICKED_CASH_ACCOUNT_NAME = MAIN_ACCOUNT_NAME;
export const PICKED_CASH_ACCOUNT_NUMBER = 'PICKED-CASH';

export function pickedCashAccountId(businessId?: string | null): string {
  const id = String(businessId || '').trim();
  return id ? `picked_cash_${id}` : '';
}

export const mainAccountId = pickedCashAccountId;

export function getMainAccount(accounts: any[] | undefined, businessId?: string | null) {
  const id = pickedCashAccountId(businessId);
  const existing = (accounts || []).find(account =>
    account?.id === id ||
    account?.accountNumber === MAIN_ACCOUNT_NUMBER ||
    account?.accountNumber === PICKED_CASH_ACCOUNT_NUMBER ||
    String(account?.name || '').trim().toLowerCase() === MAIN_ACCOUNT_NAME.toLowerCase() ||
    String(account?.name || '').trim().toLowerCase() === PICKED_CASH_ACCOUNT_NAME.toLowerCase()
  );
  if (existing) return { ...existing, name: MAIN_ACCOUNT_NAME };
  if (!id || !businessId) return null;
  return {
    id,
    name: MAIN_ACCOUNT_NAME,
    type: 'CASH',
    accountNumber: MAIN_ACCOUNT_NUMBER,
    balance: 0,
    businessId,
  };
}

export const getPickedCashAccount = getMainAccount;

export function singleFinanceAccount(accounts: any[] | undefined, businessId?: string | null): any[] {
  const account = getMainAccount(accounts, businessId);
  return account ? [account] : [];
}
