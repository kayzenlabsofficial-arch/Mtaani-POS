import type { CartLine, Customer, PaymentMethod, Product, ReportSummary, Sale, SaleItem, StockMovement, StockReceipt, StoreProfile, User } from './types';

const TOKEN_KEY = 'smart-pos-mini-token';
const USER_KEY = 'smart-pos-mini-user';

export function getStoredSession() {
  const token = localStorage.getItem(TOKEN_KEY) || '';
  const raw = localStorage.getItem(USER_KEY) || '';
  try {
    return { token, user: raw ? JSON.parse(raw) as User : null };
  } catch {
    return { token, user: null };
  }
}

export function saveSession(token: string, user: User) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function api<T>(path: string, options: RequestInit = {}, token = getStoredSession().token): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers as Record<string, string> | undefined) },
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}

export const MiniApi = {
  setupStatus() {
    return api<{ needsSetup: boolean }>('/api/setup/bootstrap', { method: 'GET' }, '');
  },
  setup(input: { storeName: string; name: string; username: string; password: string }) {
    return api<{ success: true; token: string; user: User }>('/api/setup/bootstrap', { method: 'POST', body: JSON.stringify(input) }, '');
  },
  login(input: { username: string; password: string }) {
    return api<{ success: true; token: string; user: User }>('/api/auth/login', { method: 'POST', body: JSON.stringify(input) }, '');
  },
  profile() {
    return api<{ profile: StoreProfile }>('/api/profile');
  },
  saveProfile(input: { storeName: string; logoDataUrl?: string | null }) {
    return api<{ success: true; profile: StoreProfile }>('/api/profile', { method: 'POST', body: JSON.stringify(input) });
  },
  products() {
    return api<{ products: Product[] }>('/api/products');
  },
  saveProduct(product: Partial<Product>) {
    return api<{ success: true; product: Product }>('/api/products', { method: 'POST', body: JSON.stringify({ action: 'SAVE', ...product }) });
  },
  deleteProduct(id: string) {
    return api<{ success: true; id: string }>('/api/products', { method: 'POST', body: JSON.stringify({ action: 'DELETE', id }) });
  },
  receiveStock(input: { note?: string; items: Array<{ productId: string; quantity: number; unitCost: number }> }) {
    return api<{ success: true; receipt: StockReceipt }>('/api/stock/receive', { method: 'POST', body: JSON.stringify(input) });
  },
  addStock(input: { note?: string; items: Array<{ productId: string; quantity: number; unitCost: number }> }) {
    return api<{ success: true; receipt: StockReceipt }>('/api/stock/receive', { method: 'POST', body: JSON.stringify(input) });
  },
  checkout(input: {
    paymentMethod: PaymentMethod;
    mpesaReference?: string;
    customer?: { name?: string; phone?: string };
    items: CartLine[];
  }) {
    return api<{ success: true; sale: Sale; items: SaleItem[] }>('/api/sales/checkout', { method: 'POST', body: JSON.stringify(input) });
  },
  customers() {
    return api<{ customers: Customer[] }>('/api/customers/payment');
  },
  payCustomer(input: { customerId: string; amount: number; paymentMethod: 'CASH' | 'MPESA'; reference?: string }) {
    return api<{ success: true; paymentId: string; customerBalance: number }>('/api/customers/payment', { method: 'POST', body: JSON.stringify(input) });
  },
  documents() {
    return api<{ sales: Sale[]; saleItems: SaleItem[]; stockReceipts: StockReceipt[]; stockMovements: StockMovement[] }>('/api/documents');
  },
  reportSummary() {
    return api<{ summary: ReportSummary }>('/api/reports/summary');
  },
  users() {
    return api<{ users: User[] }>('/api/users');
  },
  saveUser(input: Partial<User> & { password?: string }) {
    return api<{ success: true; user: User }>('/api/users', { method: 'POST', body: JSON.stringify({ action: 'SAVE', ...input }) });
  },
  deactivateUser(id: string) {
    return api<{ success: true; id: string }>('/api/users', { method: 'POST', body: JSON.stringify({ action: 'DEACTIVATE', id }) });
  },
};
