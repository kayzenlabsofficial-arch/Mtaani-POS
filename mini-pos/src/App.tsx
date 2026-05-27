import React from 'react';
import { Boxes, ClipboardList, FileText, PackagePlus, ReceiptText, Store, UserRound } from 'lucide-react';
import { MiniApi, clearSession, getStoredSession, saveSession } from './api';
import { usePhoneUi } from './hooks/usePhoneUi';
import { MiniDesktopApp, MiniDesktopAuth } from './ui/desktop/MiniDesktopApp';
import { MiniPhoneApp, MiniPhoneAuth } from './ui/mobile/MiniPhoneApp';
import type { Customer, Product, ReportSummary, Sale, SaleItem, StockMovement, StockReceipt, StoreProfile, User } from './types';
import type { AppTab, LoginInput, SetupInput, Tab } from './ui/types';

export default function App() {
  const stored = getStoredSession();
  const isPhone = usePhoneUi();
  const [token, setToken] = React.useState(stored.token);
  const [user, setUser] = React.useState<User | null>(stored.user);
  const [needsSetup, setNeedsSetup] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<Tab>('REGISTER');
  const [profile, setProfile] = React.useState<StoreProfile>({ id: 'core', storeName: 'Smart POS Mini' });
  const [products, setProducts] = React.useState<Product[]>([]);
  const [sales, setSales] = React.useState<Sale[]>([]);
  const [saleItems, setSaleItems] = React.useState<SaleItem[]>([]);
  const [stockReceipts, setStockReceipts] = React.useState<StockReceipt[]>([]);
  const [stockMovements, setStockMovements] = React.useState<StockMovement[]>([]);
  const [customers, setCustomers] = React.useState<Customer[]>([]);
  const [users, setUsers] = React.useState<User[]>([]);
  const [summary, setSummary] = React.useState<ReportSummary | null>(null);
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const isAdmin = user?.role === 'ADMIN';

  const loadData = React.useCallback(async () => {
    if (!token) return;
    const [profileRes, productsRes, docsRes] = await Promise.all([
      MiniApi.profile(),
      MiniApi.products(),
      MiniApi.documents(),
    ]);
    setProfile(profileRes.profile || { id: 'core', storeName: 'Smart POS Mini' });
    setProducts(productsRes.products || []);
    setSales(docsRes.sales || []);
    setSaleItems(docsRes.saleItems || []);
    setStockReceipts(docsRes.stockReceipts || []);
    setStockMovements(docsRes.stockMovements || []);
    const customerRes = await MiniApi.customers().catch(() => ({ customers: [] }));
    setCustomers(customerRes.customers || []);
    if (isAdmin) {
      const [reportRes, usersRes] = await Promise.all([
        MiniApi.reportSummary().catch(() => ({ summary: null })),
        MiniApi.users().catch(() => ({ users: [] })),
      ]);
      setSummary(reportRes.summary);
      setUsers(usersRes.users || []);
    } else {
      setSummary(null);
      setUsers([]);
    }
  }, [isAdmin, token]);

  React.useEffect(() => {
    MiniApi.setupStatus()
      .then(res => setNeedsSetup(res.needsSetup))
      .catch(err => setNotice(err.message || 'Could not reach Smart POS Mini.'));
  }, []);

  React.useEffect(() => {
    if (token && user) void loadData();
  }, [loadData, token, user]);

  const finishAuth = (nextToken: string, nextUser: User) => {
    saveSession(nextToken, nextUser);
    setToken(nextToken);
    setUser(nextUser);
    setNeedsSetup(false);
  };

  const signOut = () => {
    clearSession();
    setToken('');
    setUser(null);
    setActiveTab('REGISTER');
  };

  const AuthComponent = isPhone ? MiniPhoneAuth : MiniDesktopAuth;
  if (needsSetup) {
    return <AuthComponent mode="setup" onSetup={async (input: SetupInput) => {
      const res = await MiniApi.setup(input);
      finishAuth(res.token, res.user);
    }} onLogin={async () => undefined} />;
  }

  if (!token || !user) {
    return <AuthComponent mode="login" onSetup={async () => undefined} onLogin={async (input: LoginInput) => {
      const res = await MiniApi.login(input);
      finishAuth(res.token, res.user);
    }} />;
  }

  const tabs = ([
    { id: 'REGISTER', label: 'Register', Icon: ReceiptText },
    { id: 'INVENTORY', label: 'Inventory', Icon: Boxes, admin: true },
    { id: 'ADD_STOCK', label: 'Add Stock', Icon: PackagePlus, admin: true },
    { id: 'DOCUMENTS', label: 'Documents', Icon: FileText },
    { id: 'REPORTS', label: 'Reports', Icon: ClipboardList, admin: true },
    { id: 'CUSTOMERS', label: 'Credit', Icon: UserRound },
    { id: 'PROFILE', label: 'Profile', Icon: Store, admin: true },
  ] satisfies AppTab[]).filter(tab => !tab.admin || isAdmin);

  const UiComponent = isPhone ? MiniPhoneApp : MiniDesktopApp;
  return (
    <UiComponent
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      tabs={tabs}
      user={user}
      profile={profile}
      notice={notice}
      busy={busy}
      isAdmin={Boolean(isAdmin)}
      products={products}
      sales={sales}
      saleItems={saleItems}
      stockReceipts={stockReceipts}
      stockMovements={stockMovements}
      customers={customers}
      users={users}
      summary={summary}
      clearNotice={() => setNotice('')}
      refresh={loadData}
      signOut={signOut}
      onCheckout={async input => {
        setBusy(true);
        try {
          const res = await MiniApi.checkout(input);
          setNotice(`Sale ${res.sale.receiptNumber} completed.`);
          await loadData();
        } catch (err: any) {
          setNotice(err.message || 'Checkout failed.');
        } finally {
          setBusy(false);
        }
      }}
      onSaveProduct={async product => {
        await MiniApi.saveProduct(product);
        setNotice('Product saved.');
        await loadData();
      }}
      onDeleteProduct={async id => {
        await MiniApi.deleteProduct(id);
        setNotice('Product deactivated.');
        await loadData();
      }}
      onAddStock={async input => {
        await MiniApi.addStock(input);
        setNotice('Stock added with cost tracked.');
        await loadData();
      }}
      onPayCustomer={async input => {
        await MiniApi.payCustomer(input);
        setNotice('Customer payment recorded.');
        await loadData();
      }}
      onSaveProfile={async input => {
        const res = await MiniApi.saveProfile(input);
        setProfile(res.profile);
        setNotice('Store profile saved.');
      }}
      onSaveUser={async input => {
        await MiniApi.saveUser(input);
        setNotice('User saved.');
        await loadData();
      }}
      onDeactivateUser={async id => {
        await MiniApi.deactivateUser(id);
        setNotice('User deactivated.');
        await loadData();
      }}
    />
  );
}
