import type { LucideIcon } from 'lucide-react';
import type { Customer, PaymentMethod, Product, ReportSummary, Sale, SaleItem, StockMovement, StockReceipt, StoreProfile, User } from '../types';

export type Tab = 'REGISTER' | 'INVENTORY' | 'ADD_STOCK' | 'DOCUMENTS' | 'REPORTS' | 'CUSTOMERS' | 'PROFILE';

export type AppTab = {
  id: Tab;
  label: string;
  Icon: LucideIcon;
  admin?: boolean;
};

export type SetupInput = {
  storeName: string;
  name: string;
  username: string;
  password: string;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type CheckoutInput = {
  paymentMethod: PaymentMethod;
  mpesaReference?: string;
  customer?: { name?: string; phone?: string };
  items: Array<{ productId: string; quantity: number }>;
};

export type AddStockInput = {
  note?: string;
  items: Array<{ productId: string; quantity: number; unitCost: number }>;
};

export type CreditPaymentInput = {
  customerId: string;
  amount: number;
  paymentMethod: 'CASH' | 'MPESA';
  reference?: string;
};

export type MiniAuthProps = {
  mode: 'setup' | 'login';
  onSetup: (input: SetupInput) => Promise<void>;
  onLogin: (input: LoginInput) => Promise<void>;
};

export type MiniUiProps = {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  tabs: AppTab[];
  user: User;
  profile: StoreProfile;
  notice: string;
  busy: boolean;
  isAdmin: boolean;
  products: Product[];
  sales: Sale[];
  saleItems: SaleItem[];
  stockReceipts: StockReceipt[];
  stockMovements: StockMovement[];
  customers: Customer[];
  users: User[];
  summary: ReportSummary | null;
  clearNotice: () => void;
  refresh: () => Promise<void>;
  signOut: () => void;
  onCheckout: (input: CheckoutInput) => Promise<void>;
  onSaveProduct: (product: Partial<Product>) => Promise<void>;
  onDeleteProduct: (id: string) => Promise<void>;
  onAddStock: (input: AddStockInput) => Promise<void>;
  onPayCustomer: (input: CreditPaymentInput) => Promise<void>;
  onSaveProfile: (input: { storeName: string; logoDataUrl?: string | null }) => Promise<void>;
  onSaveUser: (input: Partial<User> & { password?: string }) => Promise<void>;
  onDeactivateUser: (id: string) => Promise<void>;
};
