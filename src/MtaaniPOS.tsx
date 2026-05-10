import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, Minus, Plus, Trash2, Smartphone, Receipt, Package, 
  Wifi, WifiOff, Store, FileText, FileMinus, BarChart3, Settings, 
  Truck, Users, LayoutDashboard, DollarSign, Printer, Activity, 
  CheckCircle2, Banknote, Save, RotateCcw, ClipboardList, BadgePercent, 
  ShieldCheck, Lock, CalendarCheck, KeyRound, Check, Hand, 
  LogOut, Search, Menu, X, ChevronRight, Bell, User, MoreHorizontal, Grid, Building2, MapPin, ReceiptText, Share2, Loader2, ChevronDown
} from 'lucide-react';
import { useLiveQuery } from './clouddb';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db, seedInitialData, type Transaction, type Shift, type Branch } from './db';
import { useStore } from './store';
import { useToast } from './context/ToastContext';
import { MpesaService } from './services/mpesa';
import { verifyPassword, hashPassword, isLockedOut, recordFailedAttempt, resetAttempts, sanitizeString, isValidBusinessCode } from './security';
import { flushOutboxNow, sendHeartbeat } from './offline/offlineSync';

declare const __BUILD_DATE__: string;

// Modular Components
import RegisterTab from './components/tabs/RegisterTab';
import DashboardTab from './components/tabs/DashboardTab';
import InventoryTab from './components/tabs/InventoryTab';
import CustomersTab from './components/tabs/CustomersTab';
import SuppliersTab from './components/tabs/SuppliersTab';
import ExpensesTab from './components/tabs/ExpensesTab';
import RefundsTab from './components/tabs/RefundsTab';
import PurchasesTab from './components/tabs/PurchasesTab';
import SupplierPaymentsTab from './components/tabs/SupplierPaymentsTab';
import DocumentsTab from './components/tabs/DocumentsTab';
import ReportsTab from './components/tabs/ReportsTab';
import AdminPanel from './components/tabs/AdminPanel';

// Modals
import AdminVerificationModal from './components/modals/AdminVerificationModal';
import ExpenseModal from './components/modals/ExpenseModal';
import Sidebar from './components/shared/Sidebar';
import ProfileModal from './components/modals/ProfileModal';
import SupplierPaymentModal from './components/modals/SupplierPaymentModal';
import { generateAndShareDocument } from './utils/shareUtils';

function SystemManagerDashboard({ onLogout }: { onLogout: () => void }) {
  const businesses = useLiveQuery(() => db.businesses.toArray(), []);
  const [form, setForm] = useState({ name: '', code: '' });
  const { setActiveBusinessId } = useStore();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.code) return;
    const trimmedCode = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(trimmedCode)) {
      alert('Business Code must be 3-20 alphanumeric characters (A-Z, 0-9)');
      return;
    }
    const prevBusinessId = useStore.getState().activeBusinessId;
    try {
      const newBusinessId = crypto.randomUUID();
      const defaultPasswordHash = await hashPassword('123');

      // 1. Create Business record
      await db.businesses.add({
        id: newBusinessId,
        name: form.name,
        code: form.code.toUpperCase(),
        isActive: 1,
        updated_at: Date.now()
      } as any);

      setActiveBusinessId(newBusinessId);
      await new Promise(r => setTimeout(r, 50));

      // 2. Create Default Admin User
      await db.users.add({
        id: crypto.randomUUID(),
        name: 'admin',
        password: defaultPasswordHash,
        role: 'ADMIN',
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      // 3. Create Default Branch
      await db.branches.add({
        id: crypto.randomUUID(),
        name: 'Main Branch',
        location: 'Default',
        isActive: true,
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      setForm({ name: '', code: '' });
      alert(`✅ Business created!\nDefault login:\n  Username: admin\n  Password: 123`);
    } catch(err: any) {
      console.error(err);
      alert(`Failed to create business: ${err.message || 'Unknown error'}`);
    } finally {
      setActiveBusinessId(prevBusinessId);
    }
  };

  const toggleStatus = async (id: string, currentStatus: number) => {
    try {
      await db.businesses.update(id, { isActive: currentStatus === 1 ? 0 : 1 });
    } catch (err) {
      console.error(err);
      alert("Failed to update status.");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`ARE YOU SURE?\n\nThis will permanently DELETE "${name}" and ALL its products, branches, sales, and users.\n\nThis cannot be undone.`)) return;
    try {
      await db.businesses.delete(id);
    } catch (err) {
      console.error(err);
      alert("Failed to delete business.");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-black text-slate-900">System Manager</h1>
          <button onClick={onLogout} className="px-4 py-2 bg-red-100 text-red-600 rounded-lg font-bold hover:bg-red-200 transition-colors">Logout</button>
        </div>
        
        <form onSubmit={handleCreate} className="flex gap-4 mb-8 bg-slate-50 p-6 rounded-2xl border border-slate-100">
           <input type="text" placeholder="Business Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="flex-1 px-4 py-3 rounded-xl border border-slate-200" required />
           <input type="text" placeholder="Business Code" value={form.code} onChange={e => setForm({...form, code: e.target.value})} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 " required />
           <button type="submit" className="px-6 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-md hover:bg-blue-700 transition-colors">Add Business</button>
        </form>

        <div className="overflow-hidden border border-slate-200 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-100">
                <th className="p-4 font-bold text-slate-600">Business Name</th>
                <th className="p-4 font-bold text-slate-600">Code</th>
                <th className="p-4 font-bold text-slate-600">Status</th>
                <th className="p-4 font-bold text-slate-600 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {businesses?.map(b => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="p-4 font-bold">{b.name}</td>
                  <td className="p-4 text-slate-500 font-mono">{b.code}</td>
                  <td className="p-4">
                    <span className={`px-3 py-1 rounded-full text-xs font-bold ${b.isActive !== 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {b.isActive !== 0 ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="p-4 text-right flex items-center justify-end gap-2">
                    <button onClick={() => toggleStatus(b.id, b.isActive ?? 1)} className={`px-4 py-2 rounded-lg text-sm font-bold text-white transition-colors ${b.isActive !== 0 ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-500 hover:bg-green-600'}`}>
                      {b.isActive !== 0 ? 'Suspend' : 'Activate'}
                    </button>
                    <button onClick={() => handleDelete(b.id, b.name)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <Trash2 size={20} />
                    </button>
                  </td>
                </tr>
              ))}
              {businesses?.length === 0 && <tr><td colSpan={4} className="p-8 text-center text-slate-500">No businesses found.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function MtaaniPOS() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const [activeTab, setActiveTab] = useState<'REGISTER' | 'INVENTORY' | 'DOCUMENTS' | 'REPORTS' | 'SUPPLIERS' | 'CUSTOMERS' | 'DASHBOARD' | 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'SUPPLIER_PAYMENTS' | 'ADMIN_PANEL'>('REGISTER');
  
  const { success, error, info, warning } = useToast();

  // Navigation History Handling
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        if (event.state.tab) setActiveTab(event.state.tab);
        if (event.state.isCartOpen !== undefined) setIsCartOpen(event.state.isCartOpen);
        if (event.state.isMoreMenuOpen !== undefined) setIsMoreMenuOpen(event.state.isMoreMenuOpen);
        if (event.state.hasCompletedTransaction === false) setCompletedTransaction(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    history.replaceState({ tab: 'REGISTER', isCartOpen: false, isMoreMenuOpen: false }, '');
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateToTab = (tab: typeof activeTab) => {
    if (tab !== activeTab) {
      setActiveTab(tab);
      history.pushState({ tab, isCartOpen: false, isMoreMenuOpen: false }, '');
    }
  };

  const toggleCart = (open: boolean) => {
    setIsCartOpen(open);
    if (open) history.pushState({ tab: activeTab, isCartOpen: true }, '');
    else if (window.history.state?.isCartOpen) window.history.back();
  };

  const toggleMoreMenu = (open: boolean) => {
    setIsMoreMenuOpen(open);
    if (open) history.pushState({ tab: activeTab, isMoreMenuOpen: true }, '');
    else if (window.history.state?.isMoreMenuOpen) window.history.back();
  };

  // Store Hooks
  const cart = useStore(state => state.cart);
  const clearCart = useStore(state => state.clearCart);
  const removeFromCart = useStore(state => state.removeFromCart);
  const updateQuantity = useStore(state => state.updateQuantity);
  const setQuantity = useStore(state => state.setQuantity);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const currentUser = useStore(state => state.currentUser);
  const setCurrentUser = useStore(state => state.setCurrentUser);
  const isAdmin = useStore(state => state.isAdmin);
  const isManager = useStore(state => state.isManager);
  const activeBranchId = useStore(state => state.activeBranchId);
  const setActiveBranchId = useStore(state => state.setActiveBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const setActiveBusinessId = useStore(state => state.setActiveBusinessId);
  const selectedCustomerId = useStore(state => state.selectedCustomerId);
  const setSelectedCustomerId = useStore(state => state.setSelectedCustomerId);
  
  const allCustomers = useLiveQuery(() => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);
  const selectedCustomer = allCustomers?.find(c => c.id === selectedCustomerId);

  const financialAccounts = useLiveQuery(() => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);
  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);

  const [loginForm, setLoginForm] = useState({ businessCode: '', username: '', password: '' });
  const [loginStep, setLoginStep] = useState<'LOGIN' | 'BRANCH'>('LOGIN');
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [availableBranches, setAvailableBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [isSystemManager, setIsSystemManager] = useState(false);

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<any>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [amountTendered, setAmountTendered] = useState("");
  const [splitForm, setSplitForm] = useState({
    cashAmount: '',
    secondaryMethod: 'MPESA' as 'MPESA' | 'CREDIT',
    secondaryReference: '',
  });

  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMpesaModalOpen, setIsMpesaModalOpen] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaState, setMpesaState] = useState<'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [mpesaRequestId, setMpesaRequestId] = useState<string | null>(null);
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [discountType, setDiscountType] = useState<'FIXED' | 'PERCENT'>('FIXED');
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [pendingCreditCheckout, setPendingCreditCheckout] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [mpesaMessage, setMpesaMessage] = useState('');
  const mpesaCheckoutFiredRef = React.useRef(false);

  const [expenseForm, setExpenseForm] = useState({
    amount: '',
    category: '',
    description: '',
    source: 'TILL' as 'TILL' | 'ACCOUNT' | 'SHOP',
    accountId: '',
    productId: '',
    quantity: '1'
  });
  
  const allTransactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allExpenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allCashPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;
  const allSupplierPayments = useLiveQuery(() => activeBranchId ? db.supplierPayments.where('branchId').equals(activeBranchId).toArray() : Promise.resolve([]), [activeBranchId], []) ;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todaysPaidTransactions = (allTransactions || []).filter(t => 
    t.status === 'PAID' && 
    (activeShift ? t.shiftId === activeShift.id : (t.timestamp || 0) >= todayStart.getTime())
  );
  
  const cashTotal = todaysPaidTransactions.reduce((sum, t) => {
    if (t.paymentMethod === 'CASH') return sum + (t.total || 0);
    if (t.paymentMethod === 'SPLIT') return sum + (t.splitPayments?.cashAmount || 0);
    return sum;
  }, 0);
  
  const todayTillExpenses = (allExpenses || []).filter(e => 
    e.source === 'TILL' && 
    (activeShift ? e.shiftId === activeShift.id : (e.timestamp || 0) >= todayStart.getTime())
  ).reduce((sum, e) => sum + (e.amount || 0), 0);
  
  const todayTillPayments = (allSupplierPayments || []).filter(p => 
    p.source === 'TILL' && 
    (activeShift ? p.shiftId === activeShift.id : (p.timestamp || 0) >= todayStart.getTime())
  ).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  
  const todayCashPicks = (allCashPicks || []).filter(c => 
    (activeShift ? c.shiftId === activeShift.id : (c.timestamp || 0) >= todayStart.getTime())
  );
  
  const totalPickedAmount = todayCashPicks.reduce((acc, p) => acc + (p.amount || 0), 0);
  const actualCashDrawer = cashTotal - totalPickedAmount - todayTillExpenses - todayTillPayments;

  const products = useLiveQuery(
    () => activeBusinessId && activeBranchId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );

  const handleSaveExpense = async () => {
      if (isSaving) return;
      const amount = Number(expenseForm.amount);
      if (amount <= 0) { error("Invalid amount."); return; }
      if (expenseForm.source === 'TILL' && amount > actualCashDrawer) { error("Insufficient cash in drawer."); return; }
      if (expenseForm.source === 'ACCOUNT' && expenseForm.accountId) {
          const account = await db.financialAccounts.get(expenseForm.accountId);
          if (!account) { error("Selected account not found."); return; }
          if (account.balance < amount) {
              error(`Insufficient funds in "${account.name}". Balance: Ksh ${account.balance.toLocaleString()}`);
              return;
          }
      }
      if (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) { error("Select an account for account-funded expense."); return; }
      if (!currentUser || !activeBranchId) return;

      setIsSaving(true);
      try {
        const expenseId = crypto.randomUUID();
        await db.expenses.add({
           id: expenseId,
           amount,
           category: expenseForm.category,
           description: expenseForm.description,
           timestamp: Date.now(),
           userName: currentUser.name,
           preparedBy: currentUser.name,
           status: 'PENDING',
           source: expenseForm.source,
           accountId: expenseForm.source === 'ACCOUNT' ? expenseForm.accountId : undefined,
           branchId: activeBranchId,
           businessId: activeBusinessId!,
           shiftId: activeShift?.id,
           updated_at: Date.now()
        });

        if (expenseForm.source === 'SHOP' && (expenseForm as any).productId) {
           await db.expenses.update(expenseId, {
              productId: (expenseForm as any).productId,
              quantity: Number((expenseForm as any).quantity) || 1
           } as any);
        }
        setIsExpenseModalOpen(false);
        setExpenseForm({ amount: '', category: '', description: '', source: 'TILL', accountId: '', productId: '', quantity: '1' });
        success("Expense logged successfully.");
      } catch (err: any) {
        error("Failed to save expense: " + err.message);
      } finally {
        setIsSaving(false);
      }
  };

  const handleSavePayment = async (payment: any) => {
    if (isSaving) return;
    try {
      if (!activeBranchId || !activeBusinessId || !selectedSupplierForPayment) return;
      setIsSaving(true);
      const totalDeduction = Number(payment.amount);
      await db.supplierPayments.add({
        ...payment,
        id: crypto.randomUUID(),
        supplierId: selectedSupplierForPayment.id,
        timestamp: Date.now(),
        branchId: activeBranchId,
        businessId: activeBusinessId
      });
      await db.suppliers.update(selectedSupplierForPayment.id, {
        balance: Math.max(0, (selectedSupplierForPayment.balance || 0) - totalDeduction)
      });
      if (payment.source === 'ACCOUNT' && payment.accountId) {
          const account = await db.financialAccounts.get(payment.accountId);
          if (account) {
              await db.financialAccounts.update(account.id, { balance: account.balance - totalDeduction });
          }
      }
      setIsPaymentModalOpen(false);
      success("Payment recorded.");
    } catch (e: any) {
      error("Failed to save payment: " + (e.message || "Unknown error"));
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { flushed } = await flushOutboxNow();
        if (cancelled) return;
        if (flushed > 0) {
          await db.sync();
          await sendHeartbeat({ cashierName: currentUser?.name });
          success(`Reconnected: synced ${flushed} offline sale${flushed === 1 ? '' : 's'}.`);
        }
      } catch (e) { console.warn('[OfflineSync] flush failed', e); }
    };
    run();
    return () => { cancelled = true; };
  }, [isOnline]);

  useEffect(() => {
    const init = async () => {
      await db.init();
      await seedInitialData();
      if (activeBranchId) {
        const shift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === activeBranchId).first();
        if (shift) setActiveShift(shift);
      }
    };
    init();
  }, []);

  useEffect(() => {
    window.history.pushState({ page: 'home' }, '');
    const handlePopState = (e: PopStateEvent) => {
      if (isMoreMenuOpen) {
        setIsMoreMenuOpen(false);
        window.history.pushState({ page: 'home' }, '');
        return;
      }
      if (isExpenseModalOpen || isPaymentModalOpen) {
        setIsExpenseModalOpen(false);
        setIsPaymentModalOpen(false);
        window.history.pushState({ page: 'home' }, '');
        return;
      }
      window.history.pushState({ page: 'home' }, '');
      info("Navigation locked. Use the menu to switch tabs.");
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMoreMenuOpen, isExpenseModalOpen, isPaymentModalOpen]);

  useEffect(() => {
    if (!currentUser) return; 
    const SESSION_LIMIT_MS = 8 * 60 * 60 * 1000;
    const WARN_BEFORE_MS  = 10 * 60 * 1000;
    let lastActivity = Date.now();
    let warned = false;
    const resetActivity = () => { lastActivity = Date.now(); warned = false; };
    const events = ['click', 'keydown', 'mousemove', 'touchstart', 'scroll'];
    events.forEach(e => window.addEventListener(e, resetActivity, { passive: true }));
    const sessionCheck = setInterval(() => {
      const idle = Date.now() - lastActivity;
      if (idle >= SESSION_LIMIT_MS) {
        clearInterval(sessionCheck);
        warning('Session expired. You have been logged out for security.');
        try { localStorage.removeItem('mtaani-pos-storage'); } catch {}
        useStore.getState().resetSession();
        db.resetTenantCaches();
        setCurrentUser(null);
        setActiveShift(null);
        setActiveBranchId(null);
        setActiveBusinessId(null);
        setLoginStep('LOGIN');
      } else if (!warned && idle >= SESSION_LIMIT_MS - WARN_BEFORE_MS) {
        warned = true;
        warning('Your session will expire in 10 minutes due to inactivity.');
      }
    }, 60000);
    return () => {
      clearInterval(sessionCheck);
      events.forEach(e => window.removeEventListener(e, resetActivity));
    };
  }, [currentUser]);

  useEffect(() => {
    const doSync = async () => {
      if (isOnline && !isSyncing) {
        try {
          await db.init();
          if (activeShift) { await db.shifts.update(activeShift.id, { lastSyncAt: Date.now() }); }
        } catch (e) { console.warn('[AutoSync] background refresh failed', e); }
      }
    };
    const poll = setInterval(doSync, 30000);
    const handleVisibilityChange = () => { if (document.visibilityState === 'visible') { doSync(); } };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline, isSyncing, activeShift]);

  useEffect(() => {
    if (mpesaState === 'POLLING') { mpesaCheckoutFiredRef.current = false; }
    let interval: NodeJS.Timeout;
    let pollCount = 0;
    const MAX_POLLS = 20;
    if (mpesaState === 'POLLING' && mpesaRequestId) {
      interval = setInterval(async () => {
        pollCount++;
        const status = await MpesaService.checkStatus(mpesaRequestId);
        if (status.found) {
           if (status.resultCode === 0) {
             clearInterval(interval);
             if (mpesaCheckoutFiredRef.current) return;
             mpesaCheckoutFiredRef.current = true;
             setMpesaState('SUCCESS');
             setMpesaMessage(`Payment successful! Receipt: ${status.receiptNumber}`);
             success(`M-Pesa payment received: ${status.receiptNumber}`);
              setTimeout(() => {
                setIsMpesaModalOpen(false);
                handleCheckout('PAID', 'MPESA', status.receiptNumber, status.phoneNumber);
              }, 2000);
           } else if (status.resultCode === 999) {
             console.log("[M-Pesa] Payment still pending...");
           } else {
             clearInterval(interval);
             setMpesaState('FAILED');
             setMpesaMessage(`Payment failed/cancelled: ${status.resultDesc}`);
             error(`M-Pesa failed: ${status.resultDesc}`);
           }
        }
        if (pollCount >= MAX_POLLS) {
          clearInterval(interval);
          setMpesaState('FAILED');
          setMpesaMessage("Polling timed out.");
          error("M-Pesa polling timed out.");
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [mpesaState, mpesaRequestId]);

  const savedSettings = useLiveQuery(() => activeBusinessId ? db.settings.get('core') : Promise.resolve(undefined), [activeBusinessId]);
  const [storeName, setStoreName] = useState('Mtaani Shop');
  const [storeLocation, setStoreLocation] = useState('Nairobi, Kenya');

  useEffect(() => {
    if (savedSettings) {
      setStoreName(savedSettings.storeName);
      setStoreLocation(savedSettings.location || 'Nairobi, Kenya');
    } else if (!activeBusinessId) {
      setStoreName('Mtaani Shop');
      setStoreLocation('Nairobi, Kenya');
    }
  }, [savedSettings, activeBusinessId]);

  const activeBranchName = useLiveQuery(
    () => activeBranchId ? db.branches.get(activeBranchId).then(b => b?.name) : Promise.resolve(undefined),
    [activeBranchId]
  );
  const activeBranches = useLiveQuery(
    () => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );

  const handleQuickBranchSwitch = async (nextBranchId: string) => {
    if (!nextBranchId || nextBranchId === activeBranchId || !activeBusinessId) return;
    try {
      setIsSyncing(true);
      setActiveBranchId(nextBranchId);
      await db.sync();
      const existingShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === nextBranchId).first();
      setActiveShift(existingShift || null);
      success(`Switched to ${activeBranches.find(b => b.id === nextBranchId)?.name || 'branch'}.`);
    } catch (err: any) { error("Failed to switch branch."); }
    finally { setIsSyncing(false); }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.businessCode || !loginForm.username || !loginForm.password) return;
    const rawCode = loginForm.businessCode.trim().toUpperCase();
    const rawUser = loginForm.username.trim();
    const lockout = isLockedOut(rawCode);
    if (lockout.locked) { error(`Too many failed attempts. Try again later.`); return; }

    if (rawCode === 'SYSTEM' && rawUser.toLowerCase() === 'admin') {
      if (loginForm.password === 'Kayzen@Secure#POS2026') {
        setIsSystemManager(true);
        setLoginForm({ businessCode: '', username: '', password: '' });
        resetAttempts('SYSTEM');
        return;
      } else { recordFailedAttempt('SYSTEM'); error('Invalid System Manager credentials.'); return; }
    }

    try {
      setIsSyncing(true);
      const allBusinesses = await db.businesses.toArray();
      const business = allBusinesses.find(b => b.code.toUpperCase() === rawCode);
      if (!business) { recordFailedAttempt(rawCode); error('Invalid Business Code.'); setIsSyncing(false); return; }
      if (business.isActive === 0) { error('Account suspended.'); setIsSyncing(false); return; }
      
      if (activeBusinessId !== business.id) {
         db.resetTenantCaches();
         setStoreName('Mtaani Shop');
         setStoreLocation('Nairobi, Kenya');
         setActiveBusinessId(business.id);
         await db.sync();
      }
      
      const allUsers = await db.users.where('businessId').equals(business.id).toArray();
      const matchedUser = allUsers.find(u => u.name.toLowerCase() === rawUser.toLowerCase() && u.businessId === business.id);
      const isValid = matchedUser ? await verifyPassword(loginForm.password, matchedUser.password) : false;

      if (matchedUser && isValid) {
        resetAttempts(rawCode); 
        const allBranches = await db.branches.where('businessId').equals(business.id).toArray();
        const active = allBranches.filter(b => b.isActive);
        setPendingUser(matchedUser);
        setAvailableBranches(active);
        let branchToUse = active[0]?.id;
        if (matchedUser.branchId && active.find(b => b.id === matchedUser.branchId)) { branchToUse = matchedUser.branchId; }

        if (matchedUser.role === 'CASHIER') {
          if (!branchToUse) { error("No active branch available."); setIsSyncing(false); return; }
          setActiveBranchId(branchToUse);
          setCurrentUser(matchedUser);
          await db.sync();
          const existingShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === branchToUse && s.cashierName === matchedUser.name).first();
          if (existingShift) { setActiveShift(existingShift); success(`Welcome back!`); }
          else {
            const anyOpenShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === branchToUse).first();
            if (anyOpenShift) { setActiveShift(anyOpenShift); success(`Resuming active shift.`); }
            else {
              const shiftId = crypto.randomUUID();
              const newShift: Shift = { id: shiftId, startTime: Date.now(), cashierName: matchedUser.name, status: 'OPEN', branchId: branchToUse, businessId: activeBusinessId! };
              await db.shifts.add(newShift);
              setActiveShift(newShift);
              success(`Shift started.`);
            }
          }
          setActiveTab('REGISTER');
          setLoginStep('LOGIN');
          setPendingUser(null);
        } else {
           if (active.length === 1) {
              setActiveBranchId(active[0].id);
              setCurrentUser(matchedUser);
              await db.sync();
              const openShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === active[0].id).first();
              if (openShift) setActiveShift(openShift);
              setActiveTab('DASHBOARD');
              setLoginStep('LOGIN');
              setPendingUser(null);
              success(`Welcome back, ${matchedUser.name}!`);
           } else {
              setSelectedBranchId(active[0]?.id || '');
              setLoginStep('BRANCH');
           }
        }
      } else { recordFailedAttempt(rawCode); error('Invalid credentials.'); }
    } catch (err) { error("Connection Error."); }
    finally { setIsSyncing(false); }
  };

  const handleBranchSelect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId || !pendingUser) return;
    try {
      setActiveBranchId(selectedBranchId);
      setCurrentUser(pendingUser);
      await db.sync(); 
      if (pendingUser.role === 'ADMIN') { setActiveTab('DASHBOARD'); setLoginStep('LOGIN'); setPendingUser(null); success(`Welcome back!`); }
      else {
          const existingShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === selectedBranchId && s.cashierName === pendingUser.name).first();
          if (existingShift) { setActiveShift(existingShift); success(`Welcome back!`); }
          else {
            const anyOpenShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === selectedBranchId).first();
            if (anyOpenShift) { setActiveShift(anyOpenShift); success(`Resuming active shift.`); }
            else {
              const shiftId = crypto.randomUUID();
              const newShift: Shift = { id: shiftId, startTime: Date.now(), cashierName: pendingUser.name, status: 'OPEN', branchId: selectedBranchId, businessId: activeBusinessId! };
              await db.shifts.add(newShift);
              setActiveShift(newShift);
              success(`Shift started.`);
            }
          }
          setActiveTab('REGISTER');
          setLoginStep('LOGIN');
          setPendingUser(null);
      }
    } catch (err) { error("Failed to sync branch data."); }
    finally { setIsSyncing(false); }
  };

  const handleLogout = () => {
    try { localStorage.removeItem('mtaani-pos-storage'); } catch {}
    useStore.getState().resetSession();
    db.resetTenantCaches();
    setCurrentUser(null);
    setActiveShift(null);
    setActiveBranchId(null);
    setActiveBusinessId(null);
    setLoginStep('LOGIN');
    info("Logged out successfully.");
  };

  const checkoutLockRef = React.useRef(false);

  const handleCheckout = async (
    status: 'QUOTE' | 'PAID',
    paymentMethod?: 'CASH' | 'MPESA' | 'CREDIT' | 'SPLIT',
    mpesaCode?: string,
    resolvedMpesaCustomer?: string,
    splitPaymentInput?: {
      cashAmount: number;
      secondaryMethod: 'MPESA' | 'CREDIT';
      secondaryAmount: number;
      secondaryReference?: string;
    }
  ) => {
    if (cart.length === 0) return;
    if (!isOnline && status === 'PAID' && paymentMethod !== 'CASH') { error('Offline: only CASH sales allowed.'); return; }
    if (checkoutLockRef.current) return;
    checkoutLockRef.current = true;

    try {
      let currentCustomer = null;
      if (selectedCustomerId) { currentCustomer = await db.customers.get(selectedCustomerId); }
      if (paymentMethod === 'CREDIT' || (paymentMethod === 'SPLIT' && splitPaymentInput?.secondaryMethod === 'CREDIT')) {
        if (!currentCustomer) { setPendingCreditCheckout(paymentMethod === 'CREDIT'); setIsCustomerSelectOpen(true); checkoutLockRef.current = false; return; }
      }

      const subtotal = cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0);
      const discountAmount = discountType === 'PERCENT' ? (subtotal * (discountValue / 100)) : discountValue;
      const total = Math.max(0, subtotal - discountAmount);

      let splitPayments: Transaction['splitPayments'] | undefined;
      if (paymentMethod === 'SPLIT') {
        if (!splitPaymentInput) { error("Split details missing."); return; }
        const cashAmount = Number(splitPaymentInput.cashAmount) || 0;
        const secondaryAmount = Number(splitPaymentInput.secondaryAmount) || 0;
        if (cashAmount <= 0 || secondaryAmount <= 0) { error("Amounts must be above zero."); return; }
        if (Math.abs((cashAmount + secondaryAmount) - total) > 0.01) { error("Split must add up to total."); return; }
        splitPayments = { cashAmount, secondaryMethod: splitPaymentInput.secondaryMethod, secondaryAmount, secondaryReference: splitPaymentInput.secondaryReference || undefined };
      }

      let shiftToUse = activeShift;
      if (status === 'PAID' && !shiftToUse) {
        const openShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === activeBranchId).first();
        if (openShift) { shiftToUse = openShift as any; setActiveShift(openShift); }
        else {
          const newShift: Shift = { id: crypto.randomUUID(), startTime: Date.now(), cashierName: currentUser?.name || 'System', status: 'OPEN', branchId: activeBranchId!, businessId: activeBusinessId!, lastSyncAt: Date.now() };
          await db.shifts.add(newShift as any);
          setActiveShift(newShift as any);
          shiftToUse = newShift as any;
        }
      }

      setIsSyncing(true);
      const transaction: Transaction = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        items: cart.map(item => ({ productId: item.id, name: item.name, snapshotPrice: item.sellingPrice, quantity: item.cartQuantity, taxCategory: item.taxCategory })),
        subtotal: subtotal,
        discountAmount: discountAmount,
        discountReason: discountValue > 0 ? `${discountValue}${discountType === 'PERCENT' ? '%' : ' Ksh'} Discount` : undefined,
        tax: total * 0.16,
        total: total,
        status: status,
        paymentMethod: paymentMethod,
        splitPayments: splitPayments,
        cashierName: currentUser?.name || 'Unknown',
        branchId: activeBranchId!,
        businessId: activeBusinessId!,
        amountTendered: paymentMethod === 'CASH' && amountTendered ? Number(amountTendered) : (paymentMethod === 'MPESA' ? total : (paymentMethod === 'SPLIT' ? splitPayments?.cashAmount : undefined)),
        changeGiven: paymentMethod === 'CASH' && amountTendered ? Number(amountTendered) - total : 0,
        preparedBy: currentCustomer ? currentCustomer.name : undefined,
        mpesaCode: mpesaCode,
        mpesaCustomer: currentCustomer ? currentCustomer.name : resolvedMpesaCustomer,
        shiftId: shiftToUse?.id
      };

      await db.transactions.add(transaction);
      await new Promise(r => setTimeout(r, 100));

      if ((paymentMethod === 'CREDIT' || (paymentMethod === 'SPLIT' && splitPayments?.secondaryMethod === 'CREDIT')) && currentCustomer) {
         const creditAmount = paymentMethod === 'CREDIT' ? total : (splitPayments?.secondaryAmount || 0);
         await db.customers.update(currentCustomer.id, { balance: (Number(currentCustomer.balance) || 0) + creditAmount, totalSpent: (Number(currentCustomer.totalSpent) || 0) + total });
         success(`Credit added.`);
      }
      
      if (status === 'PAID' && isOnline) {
        for (const item of cart) {
          const freshProduct = await db.products.get(item.id);
          if (freshProduct) {
            if (freshProduct.isBundle && freshProduct.components?.length) {
              for (const component of freshProduct.components) {
                const freshComp = await db.products.get(component.productId);
                if (freshComp) {
                  const deductQty = component.quantity * item.cartQuantity;
                  const newCompQty = Math.max(0, freshComp.stockQuantity - deductQty);
                  await db.products.update(component.productId, { stockQuantity: newCompQty });
                  if (db.stockMovements) {
                    await db.stockMovements.add({ id: crypto.randomUUID(), productId: component.productId, type: 'OUT', quantity: -deductQty, timestamp: transaction.timestamp, reference: `Bundle Sale #${transaction.id.split('-')[0].toUpperCase()} (${freshProduct.name})`, branchId: activeBranchId!, businessId: activeBusinessId!, shiftId: shiftToUse?.id });
                  }
                }
              }
              await db.products.update(item.id, { updated_at: Date.now() });
            } else {
              const newQty = Math.max(0, freshProduct.stockQuantity - item.cartQuantity);
              const oversold = freshProduct.stockQuantity < item.cartQuantity;
              await db.products.update(item.id, { stockQuantity: newQty });
              if (db.stockMovements) {
                await db.stockMovements.add({ id: crypto.randomUUID(), productId: item.id, type: 'OUT', quantity: oversold ? -freshProduct.stockQuantity : -item.cartQuantity, timestamp: transaction.timestamp, reference: `Sale #${transaction.id.split('-')[0].toUpperCase()}${oversold ? ' ⚠ OVERSOLD' : ''}`, branchId: activeBranchId!, businessId: activeBusinessId!, shiftId: shiftToUse?.id });
              }
            }
          }
        }
      }
      if (status === 'PAID' && !isOnline) { warning('Offline sale recorded.'); }
      clearCart(); setIsCartOpen(false); setIsSplitModalOpen(false); setSplitForm({ cashAmount: '', secondaryMethod: 'MPESA', secondaryReference: '' }); setAmountTendered(""); setDiscountValue(0); setCompletedTransaction(transaction);
      success(status === 'PAID' ? "Sale completed!" : "Quote saved.");
    } catch (err: any) { error("Transaction failed."); }
    finally { setIsSyncing(false); checkoutLockRef.current = false; }
  };

  const cartSubtotal = cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0);
  const currentSaleTotal = Math.max(0, cartSubtotal - (discountType === 'PERCENT' ? (cartSubtotal * (discountValue / 100)) : discountValue));

  if (isSystemManager) {
    return <SystemManagerDashboard onLogout={() => setIsSystemManager(false)} />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen grad-blue flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-elevated overflow-hidden border border-white/20">
          <div className="p-10 text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Store size={40} className="text-blue-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">{storeName}</h2>
            <p className="text-slate-500 font-medium mb-10">Mtaani Enterprise Suite</p>

            {loginStep === 'LOGIN' && (
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 block ml-4 text-left">Business Code</label>
                  <input type="text" value={loginForm.businessCode} onChange={e => setLoginForm({...loginForm, businessCode: e.target.value.toUpperCase()})} className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700 " placeholder="e.g. MTAANI01" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 block ml-4 text-left">Username</label>
                  <input type="text" value={loginForm.username} onChange={e => setLoginForm({...loginForm, username: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700" placeholder="Enter username" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 block ml-4 text-left">Password</label>
                  <input type="password" value={loginForm.password} onChange={e => setLoginForm({...loginForm, password: e.target.value})} className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700" placeholder="Enter password" />
                </div>
                <button type="submit" disabled={isSyncing} className="w-full py-5 rounded-2xl bg-slate-900 text-white font-black hover:bg-blue-600 transition-all active:scale-95 shadow-xl disabled:opacity-50">{isSyncing ? 'Authenticating...' : 'Sign In'}</button>
              </form>
            )}

            {loginStep === 'BRANCH' && (
              <form onSubmit={handleBranchSelect} className="space-y-6 text-left">
                <div>
                  <p className="text-[10px] font-black text-slate-400 mb-4 text-center">Select Branch Location</p>
                  <div className="space-y-2">
                    {availableBranches.map(branch => (
                      <label key={branch.id} className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${selectedBranchId === branch.id ? 'border-blue-500 bg-blue-50' : 'border-slate-100 bg-slate-50 hover:border-slate-200'}`}>
                        <input type="radio" name="branch" value={branch.id} checked={selectedBranchId === branch.id} onChange={() => setSelectedBranchId(branch.id)} className="hidden" />
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${selectedBranchId === branch.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 border border-slate-200'}`}><Building2 size={18} /></div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm text-slate-900">{branch.name}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5"><MapPin size={10} />{branch.location}</p>
                        </div>
                        {selectedBranchId === branch.id && <CheckCircle2 size={18} className="text-blue-600 shrink-0" />}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => { setLoginStep('LOGIN'); setPendingUser(null); }} className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-bold text-[10px] hover:bg-slate-200 transition-all">Back</button>
                  <button type="submit" disabled={!selectedBranchId} className="flex-[2] py-4 rounded-2xl bg-slate-900 text-white font-bold text-[10px] hover:bg-blue-600 transition-all active:scale-95 shadow-xl disabled:opacity-50">Continue</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-50 overflow-hidden font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <Sidebar activeTab={activeTab} onTabChange={navigateToTab} onLogout={handleLogout} onSync={db.sync.bind(db)} isSyncing={isSyncing} currentUser={currentUser} onOpenProfile={() => setIsProfileModalOpen(true)} />

      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="bg-white/80 backdrop-blur-md px-8 py-4 border-b border-slate-200 flex justify-between items-center z-30 shrink-0 shadow-sm sticky top-0">
          <div className="flex items-center gap-4">
            <div className="lg:hidden">
               <div className="w-10 h-10 grad-blue rounded-xl flex items-center justify-center shadow-blue ring-4 ring-blue-600/10">
                  <ShoppingCart size={20} className="text-white" />
               </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-slate-900 leading-none">{storeName}</h1>
                <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest ${isOnline ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'}`}>
                  {isOnline ? 'Cloud Sync' : 'Offline Mode'}
                </span>
              </div>
              {activeBranchName && (
                <div className="flex items-center gap-2 mt-1.5 group">
                  <div className="flex items-center gap-1.5 px-2 py-0.5 bg-slate-100 rounded-md border border-slate-200 group-hover:border-indigo-300 group-hover:bg-indigo-50 transition-all cursor-default">
                    <MapPin size={10} className="text-indigo-500" />
                    <p className="text-[10px] font-bold text-slate-500 group-hover:text-indigo-600 uppercase tracking-tight">{activeBranchName}</p>
                  </div>
                  {(isAdmin || isManager) && (
                    <div className="relative">
                      <select value={activeBranchId || ''} onChange={(e) => handleQuickBranchSwitch(e.target.value)} className="appearance-none text-[10px] font-black text-indigo-600 bg-white border border-indigo-200 hover:border-indigo-400 rounded-md px-3 py-0.5 pr-6 outline-none shadow-sm cursor-pointer transition-all">
                        {(activeBranches || []).filter(b => b.isActive).map(b => ( <option key={b.id} value={b.id}>{b.name}</option> ))}
                      </select>
                      <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 pointer-events-none" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 lg:hidden">
              <button onClick={() => toggleCart(true)} className="relative w-11 h-11 flex items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all shadow-sm ring-1 ring-indigo-200">
                <ShoppingCart size={20} />
                {cart.length > 0 && ( <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[9px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white animate-bounce-in shadow-md">{cart.length}</span> )}
              </button>
              <button onClick={() => setIsMoreMenuOpen(true)} className="w-11 h-11 flex items-center justify-center rounded-2xl bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-md ml-1 ring-1 ring-white/10"> <Grid size={20} /> </button>
            </div>

            <div className="hidden lg:flex items-center gap-6">
               <div className="flex items-center gap-3 bg-slate-50 px-4 py-2 rounded-2xl border border-slate-200/60">
                  <div className="text-right">
                    <p className="text-xs font-black text-slate-900 leading-none">{currentUser?.name}</p>
                    <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">{currentUser?.role}</p>
                  </div>
                  <div onClick={() => setIsProfileModalOpen(true)} className="w-9 h-9 grad-slate rounded-xl flex items-center justify-center text-white shadow-sm cursor-pointer hover:scale-105 transition-transform border border-white/10"> <User size={18} /> </div>
               </div>
               <div className="w-px h-8 bg-slate-200" />
               <button onClick={handleLogout} className="flex items-center gap-2.5 px-5 py-2.5 rounded-2xl bg-rose-50 text-rose-600 text-xs font-black hover:bg-rose-600 hover:text-white transition-all border border-rose-100 shadow-sm shadow-rose-600/5 active:scale-95"> <LogOut size={16} /> Sign Out </button>
            </div>
          </div>
        </header>

        {!isOnline && ( <div className="bg-rose-600 text-white text-center text-[10px] font-black py-2.5 uppercase tracking-[0.2em] animate-pulse z-20"> ⚠ Offline — Local Storage Enabled </div> )}

        <div className="flex-1 flex overflow-hidden relative">
          <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-slate-50/50">
            <div className="max-w-[1600px] mx-auto p-6 pb-32">
              {activeTab === 'REGISTER' && <RegisterTab />}
              {activeTab === 'DASHBOARD' && <DashboardTab setActiveTab={setActiveTab} openExpenseModal={() => setIsExpenseModalOpen(true)} />}
              {activeTab === 'INVENTORY' && <InventoryTab />}
              {activeTab === 'CUSTOMERS' && <CustomersTab />}
              {activeTab === 'SUPPLIERS' && <SuppliersTab setActiveTab={setActiveTab} financialAccounts={financialAccounts || []} />}
              {activeTab === 'EXPENSES' && <ExpensesTab />}
              {activeTab === 'REFUNDS' && <RefundsTab setActiveTab={setActiveTab} />}
              {activeTab === 'PURCHASES' && <PurchasesTab />}
              {activeTab === 'SUPPLIER_PAYMENTS' && <SupplierPaymentsTab financialAccounts={financialAccounts || []} />}
              {activeTab === 'DOCUMENTS' && <DocumentsTab />}
              {activeTab === 'REPORTS' && <ReportsTab />}
              {activeTab === 'ADMIN_PANEL' && <AdminPanel updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
            </div>
          </main>

          {/* Bottom Navigation */}
          <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200/60 px-4 py-3 flex justify-between items-center z-40 shadow-[0_-10px_30px_rgba(0,0,0,0.08)] pb-safe">
            {[
              { id: 'REGISTER', label: 'POS', icon: ShoppingCart },
              { id: 'DASHBOARD', label: 'Overview', icon: LayoutDashboard, hidden: !isAdmin && !isManager && currentUser?.role !== 'CASHIER' },
              { id: 'INVENTORY', label: 'Store', icon: Package },
              { id: 'SUPPLIERS', label: 'Suppliers', icon: Truck, hidden: !isAdmin && !isManager },
              { id: 'MORE', label: 'Control', icon: Grid },
            ].filter(item => !item.hidden).map((item) => (
              <button key={item.id} onClick={() => { if (item.id === 'MORE') toggleMoreMenu(true); else navigateToTab(item.id as any); }} className={`flex flex-col items-center gap-1.5 px-4 py-2 rounded-2xl transition-all relative ${ (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen) ? 'text-indigo-600 scale-110' : 'text-slate-400 hover:text-slate-600' }`} >
                {((activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen)) && ( <div className="absolute -top-1 w-8 h-1 bg-indigo-600 rounded-full" /> )}
                <item.icon size={22} className={activeTab === item.id && item.id !== 'MORE' ? 'stroke-[2.5px]' : ''} />
                <span className="text-[10px] font-black uppercase tracking-tight">{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* More Options Sheet */}
      {isMoreMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" onClick={() => toggleMoreMenu(false)} />
          <div className="relative w-full max-w-xl bg-white rounded-t-[2.5rem] shadow-elevated flex flex-col p-8 animate-in slide-in-from-bottom duration-300 max-h-[85vh]">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0" />
            <div className="flex items-center justify-between mb-8 shrink-0">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center"> <User size={24} className="text-blue-600" /> </div>
                  <div>
                     <p className="text-sm font-bold text-slate-900">{currentUser?.name}</p>
                     <p className="text-[10px] font-semibold text-slate-400 uppercase">{currentUser?.role} Session</p>
                  </div>
               </div>
               <button onClick={() => toggleMoreMenu(false)} className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center"> <X size={20} /> </button>
            </div>
            <div className="flex-1 overflow-y-auto no-scrollbar pb-8 space-y-6">
              <div>
                 <h4 className="text-[10px] font-black text-slate-400 mb-3 ml-2 uppercase">Store Operations</h4>
                 <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'CUSTOMERS', label: 'Customers', icon: Users, bg: 'bg-cyan-50', text: 'text-cyan-600' },
                      { id: 'EXPENSES', label: 'Expenses', icon: FileMinus, bg: 'bg-orange-50', text: 'text-orange-600' },
                      { id: 'REFUNDS', label: 'Refunds', icon: RotateCcw, bg: 'bg-red-50', text: 'text-red-600' },
                      { id: 'PURCHASES', label: 'LPOs', icon: ClipboardList, bg: 'bg-blue-50', text: 'text-blue-600' },
                      { id: 'DOCUMENTS', label: 'Records', icon: FileText, bg: 'bg-slate-50', text: 'text-slate-600' }
                    ].map(item => (
                      <button key={item.id} onClick={() => { navigateToTab(item.id as any); toggleMoreMenu(false); }} className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group" >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.bg} ${item.text} group-hover:scale-110 transition-transform`}> <item.icon size={18} /> </div>
                        <span className="text-[9px] font-semibold text-slate-900 tracking-tight text-center leading-tight">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </div>
               {(isAdmin || isManager) && (
                 <div>
                    <h4 className="text-[10px] font-bold text-slate-400 mb-3 ml-2 uppercase">Administration</h4>
                    <div className="grid grid-cols-4 gap-3">
                       {[
                         { id: 'SUPPLIER_PAYMENTS', label: 'Payments', icon: DollarSign, bg: 'bg-green-50', text: 'text-green-600' },
                         { id: 'REPORTS', label: 'Reports', icon: BarChart3, bg: 'bg-purple-50', text: 'text-purple-600' },
                         { id: 'ADMIN_PANEL', label: 'Admin', icon: ShieldCheck, bg: 'bg-slate-900', text: 'text-white' },
                       ].filter(item => !(item.id === 'REPORTS' && currentUser?.role === 'CASHIER')).map(item => (
                         <button key={item.id} onClick={() => { navigateToTab(item.id as any); toggleMoreMenu(false); }} className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group" >
                           <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.bg} ${item.text} group-hover:scale-110 transition-transform`}> <item.icon size={18} /> </div>
                            <span className="text-[9px] font-bold text-slate-900 tracking-tight text-center leading-tight">{item.label}</span>
                         </button>
                       ))}
                    </div>
                 </div>
               )}
            </div>
            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
               <button onClick={async () => { try { setIsSyncing(true); await db.sync(); success("Synced."); } catch (err) { error("Sync failed."); } finally { setIsSyncing(false); } }} disabled={!isOnline || isSyncing} className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-50 text-blue-600 font-bold text-[10px] hover:bg-blue-600 hover:text-white transition-all disabled:opacity-50" >
                <RotateCcw size={16} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'Syncing...' : 'Sync Cloud'}
              </button>
              <button onClick={() => { setIsMoreMenuOpen(false); setIsProfileModalOpen(true); }} className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-slate-50 text-slate-600 font-bold text-[10px] hover:bg-slate-900 hover:text-white transition-all" > <KeyRound size={16} /> Password </button>
              <button onClick={handleLogout} className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-red-50 text-red-600 font-bold text-[10px] hover:bg-red-600 hover:text-white transition-all" > <LogOut size={16} /> Logout </button>
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer */}
      {(isCartOpen || activeTab === 'REGISTER') && (
        <div className={`fixed inset-0 z-50 flex justify-end lg:static lg:inset-auto lg:z-10 lg:w-96 lg:shadow-[-4px_0_24px_rgba(0,0,0,0.05)] lg:border-l lg:border-slate-200 lg:shrink-0 ${!isCartOpen && activeTab === 'REGISTER' ? 'hidden lg:flex' : 'flex'}`}>
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm lg:hidden ${!isCartOpen ? 'hidden' : ''}`} onClick={() => toggleCart(false)} />
          <div className={`relative w-full max-w-md lg:max-w-none bg-white h-full shadow-elevated lg:shadow-none flex flex-col animate-in slide-in-from-right duration-300 lg:animate-none`}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600"> <ShoppingCart size={20} /> </div>
                  <div> <h3 className="text-lg font-black text-slate-900 leading-none">Current sale</h3> <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase">Register session</p> </div>
               </div>
               <button onClick={() => toggleCart(false)} className="w-10 h-10 flex lg:hidden items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:text-slate-900 transition-all"> <X size={20} /> </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
               {cart.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                   <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4"> <ShoppingCart size={32} /> </div>
                   <p className="font-bold text-sm">Cart is empty</p>
                 </div>
               ) : (
                 cart.map(item => (
                   <div key={item.id} className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                     <div className="flex-1 min-w-0">
                       <h4 className="font-black text-slate-900 text-sm truncate">{item.name}</h4>
                       <p className="text-xs font-bold text-slate-400">Ksh {item.sellingPrice.toLocaleString()} / {item.unit || 'unit'}</p>
                     </div>
                     <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
                        <button onClick={() => updateQuantity(item.id, -1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"> <Minus size={14} /> </button>
                        <input type="number" step="any" value={item.cartQuantity} onChange={(e) => { const val = parseFloat(e.target.value); if (!isNaN(val) && val >= 0) { setQuantity(item.id, val); } else if (e.target.value === '') { setQuantity(item.id, '' as any); } }} onBlur={(e) => { if (e.target.value === '' || parseFloat(e.target.value) <= 0) { setQuantity(item.id, 1); } }} className="w-12 text-center font-black text-sm text-slate-900 border-none outline-none focus:ring-0 p-0" />
                        <button onClick={() => updateQuantity(item.id, 1)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"> <Plus size={14} /> </button>
                     </div>
                     <button onClick={() => removeFromCart(item.id)} className="w-10 h-10 flex items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"> <Trash2 size={18} /> </button>
                   </div>
                 ))
               )}
            </div>
            {cart.length > 0 && (
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 space-y-4 shrink-0">
                  <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                     <div className="flex items-center justify-between mb-3">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Apply Discount</label>
                        <div className="flex bg-slate-100 p-1 rounded-lg">
                           <button onClick={() => setDiscountType('FIXED')} className={`px-3 py-1 text-[9px] font-black rounded-md transition-all ${discountType === 'FIXED' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>KSH</button>
                           <button onClick={() => setDiscountType('PERCENT')} className={`px-3 py-1 text-[9px] font-black rounded-md transition-all ${discountType === 'PERCENT' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-400'}`}>%</button>
                        </div>
                     </div>
                     <div className="relative">
                        <BadgePercent className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input type="number" value={discountValue || ''} onChange={(e) => setDiscountValue(Number(e.target.value))} placeholder={discountType === 'PERCENT' ? "Percentage" : "Amount"} className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-transparent focus:border-blue-500 rounded-xl text-sm font-bold outline-none transition-all" />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <div className="flex justify-between text-slate-500 font-bold text-xs"> <span>Subtotal</span> <span>Ksh {cartSubtotal.toLocaleString()}</span> </div>
                     {discountValue > 0 && ( <div className="flex justify-between text-red-500 font-bold text-xs"> <span>Discount ({discountType === 'PERCENT' ? `${discountValue}%` : `Ksh ${discountValue}`})</span> <span>- Ksh {(discountType === 'PERCENT' ? (cartSubtotal * (discountValue / 100)) : discountValue).toLocaleString()}</span> </div> )}
                     <div className="flex justify-between text-slate-900 font-black text-xl tracking-tight pt-2 border-t border-slate-200"> <span>Total</span> <span className="text-blue-600">Ksh {currentSaleTotal.toLocaleString()}</span> </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button onClick={() => { if(confirm("Clear sale?")) clearCart(); }} className="px-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-500 font-bold text-[10px] hover:bg-red-50 hover:text-red-600 transition-all uppercase">Clear</button>
                    <div className="flex gap-2">
                     <button onClick={() => setIsCashModalOpen(true)} disabled={isSyncing} className="flex-1 px-4 py-4 rounded-2xl bg-slate-900 text-white font-bold text-[10px] hover:bg-slate-800 shadow-lg transition-all flex items-center justify-center gap-2"> <Banknote size={16} /> Cash </button>
                     <button onClick={() => setIsMpesaModalOpen(true)} disabled={!isOnline || isSyncing || mpesaState !== 'IDLE'} className="flex-1 px-4 py-4 rounded-2xl bg-green-600 text-white font-bold text-[10px] hover:bg-green-700 shadow-lg transition-all flex items-center justify-center gap-2"> <Smartphone size={16} /> M-Pesa </button>
                    </div>
                    <button onClick={() => setIsSplitModalOpen(true)} disabled={!isOnline || isSyncing} className="w-full px-4 py-4 rounded-2xl bg-indigo-600 text-white font-bold text-[10px] shadow-lg transition-all flex items-center justify-center gap-2"> <Activity size={16} /> Split Payment </button>
                    <button onClick={() => handleCheckout('PAID', 'CREDIT')} disabled={!isOnline} className="w-full px-4 py-4 rounded-2xl bg-orange-600 text-white font-bold text-[10px] shadow-lg transition-all flex items-center justify-center gap-2"> <Users size={16} /> Sell on Credit </button>
                  </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Modals */}
      <ProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} currentUser={currentUser} />
      <SupplierPaymentModal isOpen={isPaymentModalOpen} onClose={() => setIsPaymentModalOpen(false)} supplier={selectedSupplierForPayment} onSave={handleSavePayment} financialAccounts={financialAccounts} />
      <ExpenseModal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} expenseForm={expenseForm} setExpenseForm={setExpenseForm} handleSaveExpense={handleSaveExpense} actualCashDrawer={actualCashDrawer} accounts={expenseAccounts || []} financialAccounts={financialAccounts || []} products={products || []} />

      {/* Cash Modal */}
      {isCashModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCashModalOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-elevated relative z-10 flex flex-col p-8 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-3xl flex items-center justify-center mb-6 mx-auto"> <Banknote size={32} /> </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2 text-center">Cash Payment</h2>
            <div className="bg-slate-50 p-6 rounded-3xl mb-6 border border-slate-100 text-center"> <p className="text-[10px] font-bold text-slate-400 mb-1">Total Due</p> <p className="text-3xl font-black text-slate-900">Ksh {currentSaleTotal.toLocaleString()}</p> </div>
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-4">Amount Tendered</label>
                <div className="relative"> <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">KSH</span> <input type="number" className="w-full bg-slate-50 border-2 border-transparent focus:border-green-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4 text-2xl font-black text-slate-900 transition-all outline-none" placeholder="0" value={amountTendered} onChange={(e) => setAmountTendered(e.target.value)} autoFocus /> </div>
              </div>
              {Number(amountTendered) >= currentSaleTotal && ( <div className="bg-green-50 p-5 rounded-2xl border border-green-100 flex justify-between items-center text-green-800 animate-in fade-in"> <span className="font-bold text-xs">Change</span> <span className="text-2xl font-black">Ksh {(Number(amountTendered) - currentSaleTotal).toLocaleString()}</span> </div> )}
            </div>
            <div className="grid grid-cols-2 gap-3">
               <button onClick={() => setIsCashModalOpen(false)} className="px-6 py-4 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-2xl hover:bg-slate-200 transition-all">Cancel</button>
               <button onClick={() => { setIsCashModalOpen(false); handleCheckout('PAID', 'CASH'); }} disabled={Number(amountTendered) < currentSaleTotal} className="px-6 py-4 bg-slate-900 text-white font-bold text-[10px] rounded-2xl hover:bg-blue-600 shadow-xl transition-all">Complete Sale</button>
            </div>
          </div>
        </div>
      )}

      {/* Split Payment Modal */}
      {isSplitModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsSplitModalOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-elevated relative z-10 flex flex-col p-8 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mb-6 mx-auto"> <Activity size={32} /> </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2 text-center">Split Payment</h2>
            <div className="bg-slate-50 p-6 rounded-3xl mb-6 border border-slate-100 text-center"> <p className="text-[10px] font-bold text-slate-400 mb-1">Total Due</p> <p className="text-3xl font-black text-slate-900">Ksh {currentSaleTotal.toLocaleString()}</p> </div>
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-4">Cash Portion</label>
                <div className="relative"> <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">KSH</span> <input type="number" className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4 text-xl font-black text-slate-900 outline-none" value={splitForm.cashAmount} onChange={(e) => setSplitForm({ ...splitForm, cashAmount: e.target.value })} autoFocus /> </div>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-4">Second Method</label>
                <div className="flex gap-2">
                  <button onClick={() => setSplitForm({ ...splitForm, secondaryMethod: 'MPESA' })} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${splitForm.secondaryMethod === 'MPESA' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-slate-200 text-slate-600'}`}>M-Pesa</button>
                  <button onClick={() => setSplitForm({ ...splitForm, secondaryMethod: 'CREDIT' })} className={`flex-1 py-3 rounded-xl text-xs font-bold border transition-colors ${splitForm.secondaryMethod === 'CREDIT' ? 'bg-orange-50 border-orange-500 text-orange-700' : 'bg-white border-slate-200 text-slate-600'}`}>Credit</button>
                </div>
              </div>
              <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-2xl">
                <div className="flex justify-between text-xs font-bold text-slate-700"> <span>Cash</span> <span>Ksh {(Number(splitForm.cashAmount) || 0).toLocaleString()}</span> </div>
                <div className="flex justify-between text-xs font-bold text-slate-700 mt-1"> <span>{splitForm.secondaryMethod}</span> <span>Ksh {Math.max(0, currentSaleTotal - (Number(splitForm.cashAmount) || 0)).toLocaleString()}</span> </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => setIsSplitModalOpen(false)} className="px-6 py-4 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-2xl">Cancel</button>
              <button onClick={() => {
                  const cashAmount = Number(splitForm.cashAmount) || 0;
                  const secondaryAmount = currentSaleTotal - cashAmount;
                  if (cashAmount <= 0 || secondaryAmount <= 0) { error('Invalid split.'); return; }
                  if (splitForm.secondaryMethod === 'CREDIT' && !selectedCustomerId) { setPendingCreditCheckout(false); setIsCustomerSelectOpen(true); return; }
                  handleCheckout('PAID', 'SPLIT', undefined, selectedCustomer?.name, { cashAmount, secondaryMethod: splitForm.secondaryMethod, secondaryAmount, secondaryReference: splitForm.secondaryReference || undefined });
                }} className="px-6 py-4 bg-indigo-600 text-white font-bold text-[10px] rounded-2xl">Complete</button>
            </div>
          </div>
        </div>
      )}

      {/* M-Pesa STK Push Modal */}
      {isMpesaModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => { if (mpesaState !== 'POLLING') setIsMpesaModalOpen(false); }} />
          <div className="bg-white w-full max-w-sm rounded-3xl shadow-elevated relative z-10 flex flex-col p-8 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mb-6 mx-auto"> <Smartphone size={32} /> </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2 text-center">M-Pesa Payment</h2>
            {selectedCustomer && ( <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-2xl flex items-center gap-3"> <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-xs">{selectedCustomer.name.charAt(0)}</div> <div> <p className="text-[10px] font-bold text-blue-600 mb-1">Paying customer</p> <p className="text-sm font-black text-slate-900 mt-1">{selectedCustomer.name}</p> </div> </div> )}
            <div className="bg-slate-50 p-6 rounded-3xl mb-6 border border-slate-100 text-center"> <p className="text-[10px] font-bold text-slate-400 mb-1">Total Due</p> <p className="text-3xl font-black text-slate-900">Ksh {currentSaleTotal.toLocaleString()}</p> </div>
            {mpesaState === 'IDLE' || mpesaState === 'FAILED' ? (
              <>
                <p className="text-slate-500 text-sm mb-6 text-center">Enter phone number for M-Pesa prompt.</p>
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-4">Phone Number</label>
                    <div className="relative"> <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">+254</span> <input type="tel" className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4 text-lg font-black text-slate-900 outline-none" placeholder="712345678" value={mpesaPhone} onChange={(e) => setMpesaPhone(e.target.value)} autoFocus /> </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                   <button onClick={() => setIsMpesaModalOpen(false)} className="px-6 py-4 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-2xl">Cancel</button>
                   <button onClick={async () => { if (!mpesaPhone || mpesaPhone.length < 9) return error("Invalid number"); setMpesaState('PUSHING'); const res = await MpesaService.triggerStkPush(mpesaPhone, currentSaleTotal, 'POS', activeBusinessId!, activeBranchId!); if (res.success && res.checkoutRequestId) { setMpesaRequestId(res.checkoutRequestId); setMpesaState('POLLING'); } else { setMpesaState('FAILED'); setMpesaMessage(res.error || 'Failed'); } }} disabled={!mpesaPhone} className="px-6 py-4 bg-blue-600 text-white font-bold text-[10px] rounded-2xl">Send Prompt</button>
                </div>
              </>
            ) : mpesaState === 'PUSHING' ? ( <div className="text-center py-8"> <div className="w-12 h-12 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" /> <p className="font-bold text-slate-900">Initiating...</p> </div> ) : mpesaState === 'POLLING' ? ( <div className="text-center py-8"> <div className="w-12 h-12 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" /> <p className="font-bold text-slate-900 mb-2">Waiting for customer...</p> <button onClick={() => { if (!confirm('Verify manually?')) return; setMpesaState('IDLE'); handleCheckout('PAID', 'MPESA'); setIsMpesaModalOpen(false); }} className="px-6 py-3 bg-amber-50 text-amber-700 border border-amber-200 font-bold text-[10px] rounded-xl w-full">⚠ Verify manually</button> </div> ) : ( <div className="text-center py-8"> <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4"> <Check size={32} /> </div> <p className="font-black text-green-600 mb-2">{mpesaMessage}</p> </div> )}
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {completedTransaction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setCompletedTransaction(null)} />
          <div className="bg-white w-full max-w-lg rounded-3xl shadow-elevated relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 h-full max-h-[90vh]">
             <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div id="printable-receipt" className="print-receipt-80mm p-7">
                    <div className="text-center mb-6">
                        <h2 className="text-xl font-black text-slate-900">{storeName}</h2>
                        <p className="text-xs text-slate-500 font-semibold">{storeLocation}</p>
                    </div>
                    <div className="space-y-1 mb-6 text-[10px] font-bold text-slate-600 border-y border-dashed border-slate-200 py-3">
                        <p>Receipt: #{completedTransaction.id.split('-')[0].toUpperCase()}</p>
                        <p>Date: {new Date(completedTransaction.timestamp).toLocaleString()}</p>
                        <p>Cashier: {completedTransaction.cashierName}</p>
                        <p>Payment: {completedTransaction.paymentMethod}</p>
                    </div>
                    <table className="w-full text-xs mb-6">
                        <thead>
                            <tr className="border-b border-slate-200 text-slate-400 text-left">
                                <th className="pb-2">Item</th>
                                <th className="pb-2 text-right">Qty</th>
                                <th className="pb-2 text-right">Total</th>
                            </tr>
                        </thead>
                        <tbody className="text-slate-700">
                            {completedTransaction.items.map((item, i) => (
                                <tr key={i}>
                                    <td className="py-2 font-bold">{item.name}</td>
                                    <td className="py-2 text-right">{item.quantity}</td>
                                    <td className="py-2 text-right font-black">{(item.quantity * item.snapshotPrice).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="border-t border-slate-200 pt-4 space-y-1">
                        <div className="flex justify-between text-sm font-black"> <span>Total</span> <span>Ksh {completedTransaction.total.toLocaleString()}</span> </div>
                    </div>
                </div>
             </div>
             <div className="p-6 bg-white border-t border-slate-100 flex flex-col gap-3">
                <div className="flex gap-2">
                   <button onClick={async () => { setIsSharing(true); try { await generateAndShareDocument(completedTransaction, `Receipt-${completedTransaction.id.split('-')[0]}`, null, false, storeName, storeLocation); success('Shared!'); } catch (err) { error('Failed'); } finally { setIsSharing(false); } }} disabled={isSharing} className="flex-1 py-3.5 bg-slate-900 text-white font-bold text-[10px] rounded-2xl flex items-center justify-center gap-2"> {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />} Share </button>
                   <button onClick={async () => { setIsSharing(true); try { await generateAndShareDocument(completedTransaction, `Receipt-${completedTransaction.id.split('-')[0]}`, null, true, storeName, storeLocation); success('Saved!'); } catch (err) { error('Failed'); } finally { setIsSharing(false); } }} className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-bold text-[10px] rounded-2xl flex items-center justify-center gap-2"> <Printer size={16} /> Save PDF </button>
                </div>
                <button onClick={() => setCompletedTransaction(null)} className="w-full bg-blue-600 text-white py-4 font-black text-xs rounded-2xl shadow-lg">New Sale</button>
             </div>
          </div>
        </div>
      )}

      {isCustomerSelectOpen && (
        <CustomerSelectionModal isOpen={isCustomerSelectOpen} onClose={() => setIsCustomerSelectOpen(false)} onSelect={(customer) => { setSelectedCustomerId(customer.id); setIsCustomerSelectOpen(false); if (pendingCreditCheckout) { setPendingCreditCheckout(false); setTimeout(() => handleCheckout('PAID', 'CREDIT'), 100); } }} />
      )}
    </div>
  );
}

function CustomerSelectionModal({ isOpen, onClose, onSelect }: { isOpen: boolean, onClose: () => void, onSelect: (c: any) => void }) {
  const [search, setSearch] = useState("");
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const customers = useLiveQuery(() => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]), [activeBusinessId], []);
  const filtered = (customers || []).filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-elevated flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-8 border-b border-slate-100 flex items-center justify-between"> <div> <h3 className="text-xl font-black text-slate-900">Select Customer</h3> </div> <button onClick={onClose} className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400"> <X size={20} /> </button> </div>
        <div className="p-6">
          <div className="relative mb-6"> <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} /> <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent focus:border-blue-500 rounded-2xl text-sm font-bold outline-none transition-all" autoFocus /> </div>
          <div className="space-y-2 max-h-[350px] overflow-y-auto no-scrollbar pb-4">
            {filtered.map(c => ( <button key={c.id} onClick={() => onSelect(c)} className="w-full flex items-center justify-between p-4 bg-white border-2 border-slate-50 hover:border-blue-500 hover:bg-blue-50/30 rounded-2xl transition-all group"> <div className="flex items-center gap-4"> <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center font-black">{c.name.charAt(0)}</div> <div className="text-left"> <p className="text-sm font-black text-slate-900">{c.name}</p> <p className="text-[10px] font-bold text-slate-400">{c.phone}</p> </div> </div> <ChevronRight className="text-slate-300 group-hover:text-blue-500" size={18} /> </button> ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function BranchOptions({ activeBranchId }: { activeBranchId: string | null }) {
  const branches = useLiveQuery(() => db.branches.where('isActive').equals(1).toArray(), []);
  return (
    <>
      {branches?.filter(b => b.id !== activeBranchId).map(b => (
        <option key={b.id} value={b.id}>{b.name}</option>
      ))}
    </>
  );
}
