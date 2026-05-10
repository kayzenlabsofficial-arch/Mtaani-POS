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
import { db, seedInitialData, type Transaction, type Shift, type Branch, type Business } from './db';
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

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

function SystemManagerDashboard({ onLogout }: { onLogout: () => void }) {
  const businesses = useLiveQuery(() => db.businesses.toArray(), []);
  const [form, setForm] = useState({ name: '', code: '' });
  const { setActiveBusinessId } = useStore();

  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);

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

      await db.businesses.add({
        id: newBusinessId,
        name: form.name,
        code: trimmedCode,
        isActive: 1,
        updated_at: Date.now()
      } as any);

      setActiveBusinessId(newBusinessId);
      await new Promise(r => setTimeout(r, 50));

      await db.users.add({
        id: crypto.randomUUID(),
        name: 'admin',
        password: defaultPasswordHash,
        role: 'ADMIN',
        businessId: newBusinessId,
        updated_at: Date.now()
      });

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

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8 animate-in fade-in font-hanken">
       <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-12">
             <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center shadow-lg shadow-primary/20">
                   <MaterialIcon name="shield_person" className="text-white text-3xl" />
                </div>
                <div>
                   <h1 className="text-3xl font-black tracking-tight">System Manager</h1>
                   <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mt-1">Enterprise Root Override Node</p>
                </div>
             </div>
             <div className="flex items-center gap-4">
                <div className="hidden md:flex items-center gap-3 px-4 py-2 bg-slate-900 border border-slate-800 rounded-full">
                   <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                   <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Global Master Link Active</span>
                </div>
                <button onClick={onLogout} className="px-8 py-3 bg-error/10 text-error border border-error/20 rounded-xl font-bold text-sm hover:bg-error hover:text-white transition-all">Sign Out Root</button>
             </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
             {/* Left Panel: Creation */}
             <div className="lg:col-span-1 space-y-8">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-xl">
                   <h3 className="text-xl font-black mb-8 flex items-center gap-3">
                      <MaterialIcon name="add_business" className="text-primary" />
                      Provision Tenant
                   </h3>
                   <form onSubmit={handleCreate} className="space-y-6">
                      <div className="space-y-2">
                         <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Business Identity</label>
                         <input type="text" placeholder="e.g. Mtaani Mart" className="w-full bg-slate-950 border border-slate-800 focus:border-primary rounded-2xl px-6 py-4 outline-none text-sm font-bold transition-all" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                         <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Unique Access Code</label>
                         <input type="text" placeholder="e.g. MTAANI1" className="w-full bg-slate-950 border border-slate-800 focus:border-primary rounded-2xl px-6 py-4 outline-none text-sm font-bold transition-all" value={form.code} onChange={e => setForm({...form, code: e.target.value.toUpperCase()})} />
                      </div>
                      <button type="submit" className="w-full py-5 bg-primary hover:bg-primary-container rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/20 transition-all active:scale-[0.98]">Deploy Global Node</button>
                   </form>
                </div>

                <div className="bg-gradient-to-br from-slate-900 to-slate-950 p-8 rounded-[2.5rem] border border-slate-800">
                   <div className="flex items-center gap-4 mb-4 text-primary">
                      <MaterialIcon name="info" />
                      <h4 className="text-sm font-bold uppercase tracking-widest">Root Protocol</h4>
                   </div>
                   <p className="text-xs text-slate-500 leading-relaxed font-medium">
                      As System Root, you possess absolute authority. Changes made here bypass local business constraints and affect the global D1 registry immediately.
                   </p>
                </div>
             </div>

             {/* Right Panel: Management */}
             <div className="lg:col-span-2">
                <div className="bg-slate-900 p-8 rounded-[2.5rem] border border-slate-800 shadow-xl h-full flex flex-col">
                   <div className="flex items-center justify-between mb-8">
                      <h3 className="text-xl font-black flex items-center gap-3">
                         <MaterialIcon name="hub" className="text-secondary" />
                         Entity Registry
                      </h3>
                      <div className="px-4 py-1.5 bg-slate-950 rounded-full border border-slate-800 text-[10px] font-bold text-slate-500">
                         {businesses?.length || 0} Registered Tenants
                      </div>
                   </div>

                   <div className="flex-1 overflow-y-auto no-scrollbar space-y-4 pr-2">
                      {businesses?.map(b => (
                         <div key={b.id} className="p-6 bg-slate-950 rounded-3xl border border-slate-800 flex justify-between items-center group hover:border-primary/50 transition-all">
                            <div className="flex items-center gap-5">
                               <div className="w-14 h-14 rounded-2xl bg-slate-900 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all">
                                  <MaterialIcon name="storefront" />
                               </div>
                               <div>
                                  <p className="text-lg font-black">{b.name}</p>
                                  <p className="text-[10px] text-slate-500 font-mono tracking-widest mt-1 uppercase">Node ID: {b.code}</p>
                               </div>
                            </div>
                            <button 
                              onClick={() => setSelectedBiz(b)}
                              className="px-6 py-3 bg-slate-900 hover:bg-primary text-primary hover:text-white border border-primary/20 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all"
                            >
                               Manage Control
                            </button>
                         </div>
                      ))}
                      {(!businesses || businesses.length === 0) && (
                        <div className="h-64 flex flex-col items-center justify-center text-slate-700">
                           <MaterialIcon name="cloud_off" className="text-4xl mb-2" />
                           <p className="text-sm font-bold uppercase tracking-tighter">No entities provisioned</p>
                        </div>
                      )}
                   </div>
                </div>
             </div>
          </div>
       </div>

       {/* Management Modal */}
       {selectedBiz && (
         <ManageBusinessModal 
           business={selectedBiz} 
           onClose={() => setSelectedBiz(null)} 
         />
       )}
    </div>
  );
}

function ManageBusinessModal({ business, onClose }: { business: Business, onClose: () => void }) {
  const users = useLiveQuery(() => db.users.where('businessId').equals(business.id).toArray(), [business.id], []);
  const lockout = useLiveQuery(() => db.loginAttempts.get(business.code.toUpperCase()), [business.code], null);
  const { success, error } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const handleResetPassword = async (userId: string, userName: string) => {
     if (!confirm(`Reset password for ${userName} to '123'?`)) return;
     setIsProcessing(true);
     try {
        const newHash = await hashPassword('123');
        await db.users.update(userId, { password: newHash, updated_at: Date.now() });
        success(`Password for ${userName} reset to '123'`);
     } catch (err) {
        error("Reset failed");
     } finally {
        setIsProcessing(true);
     }
  };

  const handleClearLockout = async () => {
     if (!confirm(`Break security lockout for ${business.name}?`)) return;
     setIsProcessing(true);
     try {
        await resetAttempts(business.code);
        success("Security lockout cleared");
     } catch (err) {
        error("Failed to clear lockout");
     } finally {
        setIsProcessing(false);
     }
  };

  return (
     <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
        <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-xl animate-in fade-in" onClick={onClose} />
        <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-[3rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95">
           <div className="p-10 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <div className="flex items-center gap-5">
                 <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center text-primary">
                    <MaterialIcon name="admin_panel_settings" className="text-3xl" />
                 </div>
                 <div>
                    <h3 className="text-2xl font-black text-white">{business.name}</h3>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Tenant Control Center • {business.code}</p>
                 </div>
              </div>
              <button onClick={onClose} className="w-12 h-12 bg-slate-800 text-slate-400 hover:text-white rounded-full flex items-center justify-center transition-all">
                 <MaterialIcon name="close" />
              </button>
           </div>

           <div className="p-10 space-y-10 overflow-y-auto no-scrollbar max-h-[70vh]">
              {/* Lockout Section */}
              <div className="bg-slate-950 p-8 rounded-3xl border border-slate-800 flex items-center justify-between">
                 <div>
                    <h4 className="text-sm font-bold text-white mb-1 uppercase tracking-tight">Brute-Force Status</h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                       {lockout?.lockedUntil && Date.now() < lockout.lockedUntil 
                         ? `NODE LOCKED until ${new Date(lockout.lockedUntil).toLocaleTimeString()}`
                         : lockout?.count ? `${lockout.count} failed attempts detected` : "Security status optimal. No locks active."}
                    </p>
                 </div>
                 {(lockout?.count || (lockout?.lockedUntil && Date.now() < lockout.lockedUntil)) && (
                    <button 
                      onClick={handleClearLockout}
                      className="px-6 py-3 bg-error/10 text-error border border-error/20 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-error hover:text-white transition-all"
                    >
                       Break Lockout
                    </button>
                 )}
              </div>

              {/* User Management */}
              <div className="space-y-4">
                 <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-2">Authorized Users</h4>
                 <div className="grid grid-cols-1 gap-3">
                    {users?.map(u => (
                       <div key={u.id} className="p-5 bg-slate-950 rounded-2xl border border-slate-800 flex items-center justify-between group">
                          <div className="flex items-center gap-4">
                             <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-secondary font-black text-xs">
                                {u.name.charAt(0).toUpperCase()}
                             </div>
                             <div>
                                <p className="text-sm font-bold text-white">{u.name}</p>
                                <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">{u.role}</p>
                             </div>
                          </div>
                          <button 
                            onClick={() => handleResetPassword(u.id, u.name)}
                            className="p-2 text-slate-500 hover:text-primary transition-colors opacity-0 group-hover:opacity-100"
                            title="Reset Password"
                          >
                             <MaterialIcon name="key_reset" />
                          </button>
                       </div>
                    ))}
                 </div>
              </div>
           </div>
        </div>
     </div>
  );
}

export default function MtaaniPOS() {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'DASHBOARD' | 'INVENTORY' | 'CUSTOMERS' | 'SUPPLIERS' | 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'SUPPLIER_PAYMENTS' | 'DOCUMENTS' | 'REPORTS' | 'ADMIN_PANEL'>('REGISTER');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCartOpen, toggleCart] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [isMpesaModalOpen, setIsMpesaModalOpen] = useState(false);
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false);
  const [isCustomerSelectOpen, setIsCustomerSelectOpen] = useState(false);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<any>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const { 
    cart, clearCart, cartSubtotal, currentSaleTotal, 
    discountValue, discountType, setDiscountValue, setDiscountType,
    updateQuantity, removeFromCart, setQuantity,
    currentUser, login, logout, isSystemAdmin,
    activeBusinessId, setActiveBusinessId,
    activeBranchId, setActiveBranchId,
    amountTendered, setAmountTendered,
    mpesaPhone, setMpesaPhone,
    mpesaState, setMpesaState,
    mpesaRequestId, setMpesaRequestId,
    mpesaMessage, setMpesaMessage
  } = useStore();

  const { success, error } = useToast();
  
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [businessCode, setBusinessCode] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  const businesses = useLiveQuery(() => db.businesses.toArray(), []);
  const branches = useLiveQuery(() => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const activeBranch = branches?.find(b => b.id === activeBranchId);

  const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
  const [pendingCreditCheckout, setPendingCreditCheckout] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const selectedCustomer = useLiveQuery(() => selectedCustomerId ? db.customers.get(selectedCustomerId) : null, [selectedCustomerId]);

  const [splitForm, setSplitForm] = useState({
    cashAmount: '',
    secondaryMethod: 'MPESA' as 'MPESA' | 'CREDIT',
    secondaryAmount: 0,
    secondaryReference: ''
  });

  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'General',
    accountId: '',
    financialAccountId: '',
    productId: ''
  });

  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const financialAccounts = useLiveQuery(() => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const products = useLiveQuery(() => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);

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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setLoginError("");

    const isRoot = username === process.env.ROOT_USERNAME && password === process.env.ROOT_PASSWORD;
    if (isRoot) {
      login({ id: 'root', name: 'System Root', role: 'ROOT' } as any);
      return;
    }

    if (!businessCode) {
      setLoginError("Please enter your Business Code.");
      return;
    }

    const lockoutStatus = await isLockedOut(businessCode);
    if (lockoutStatus.locked) {
      const mins = Math.ceil(lockoutStatus.secondsLeft / 60);
      setLoginError(`Account locked for this business. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`);
      return;
    }

    setIsLoggingIn(true);
    try {
      const biz = await db.businesses.where('code').equals(businessCode.trim().toUpperCase()).first();
      if (!biz) {
        setLoginError("Business not found. Please check your code.");
        return;
      }

      // Establish context before querying tenant-scoped tables
      setActiveBusinessId(biz.id);
      // Wait a tiny bit for the store to update (optional, but safer for concurrent ops)
      await new Promise(r => setTimeout(r, 0));

      const normalizedUsername = username.trim().toLowerCase();
      const user = await db.users
        .where('businessId')
        .equals(biz.id)
        .and(u => String(u.name || '').trim().toLowerCase() === normalizedUsername)
        .first();

      if (user && await verifyPassword(password, user.password)) {
        await resetAttempts(businessCode);
        if (user.branchId) setActiveBranchId(user.branchId);
        login(user);
        success(`Welcome back, ${user.name}!`);
      } else {
        // Clear context if login fails
        setActiveBusinessId(null);
        setLoginError("Invalid username or password.");
        await recordFailedAttempt(businessCode);
      }
    } catch (err) {
      setLoginError("Connection failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to logout?")) {
      logout();
      setActiveBusinessId(null);
      setActiveBranchId(null);
      navigateToTab('REGISTER');
    }
  };

  const navigateToTab = (tab: any) => {
    setActiveTab(tab);
    setSidebarOpen(false);
    setIsMoreMenuOpen(false);
  };

  const toggleMoreMenu = (val: boolean) => {
     setIsMoreMenuOpen(val);
  };

  if (isSystemAdmin) {
    return <SystemManagerDashboard onLogout={logout} />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 font-hanken">
        <div className="w-full max-w-md bg-white rounded-md border border-outline-variant p-10 shadow-lg animate-in slide-up">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-blue">
               <MaterialIcon name="store" className="text-white text-3xl" />
            </div>
            <h1 className="text-3xl font-bold text-primary">Mtaani POS</h1>
            <p className="text-on-surface-variant font-mono text-[10px] uppercase tracking-widest mt-2">Enterprise Access Node</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Business Code</label>
               <input type="text" placeholder="Enter Entity ID" className="w-full bg-surface-container-low border border-outline-variant rounded-md px-6 py-4 text-sm font-bold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" value={businessCode} onChange={(e) => setBusinessCode(e.target.value.toUpperCase())} />
            </div>
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Identity</label>
               <input type="text" placeholder="Username" className="w-full bg-surface-container-low border border-outline-variant rounded-md px-6 py-4 text-sm font-bold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-1.5">
               <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Access Key</label>
               <input type="password" placeholder="Password" className="w-full bg-surface-container-low border border-outline-variant rounded-md px-6 py-4 text-sm font-bold text-on-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>

            {loginError && (
              <div className="p-4 bg-error-container text-on-error-container rounded-md flex items-center gap-3 animate-in fade-in">
                 <MaterialIcon name="error" className="text-error" />
                 <p className="text-xs font-bold">{loginError}</p>
              </div>
            )}

            <button type="submit" disabled={isLoggingIn} className="w-full py-4.5 bg-primary text-white rounded-md font-bold text-xs uppercase tracking-widest shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50">
               {isLoggingIn ? <MaterialIcon name="sync" className="animate-spin text-sm" /> : <MaterialIcon name="lock_open" className="text-sm" />}
               Establish Connection
            </button>
          </form>

          <p className="mt-10 text-center text-[10px] font-bold text-outline uppercase tracking-tighter">
            Cloud Sync Status: {isOnline ? 'Online Ready' : 'Local Offline Mode'}
          </p>
        </div>
      </div>
    );
  }

  const handleCheckout = async (status: 'PAID' | 'UNPAID', method: string, mpesaRef?: string, customerName?: string, splitData?: any) => {
    if (cart.length === 0 || !activeBranchId) return;
    
    try {
      const transactionId = crypto.randomUUID();
      const newTransaction: Transaction = {
        id: transactionId,
        items: cart.map(item => ({
          productId: item.id,
          name: item.name,
          quantity: item.cartQuantity,
          snapshotPrice: item.sellingPrice,
          snapshotCost: item.costPrice || 0,
          category: item.category
        })),
        total: currentSaleTotal,
        paymentMethod: method,
        mpesaReference: mpesaRef,
        status,
        timestamp: Date.now(),
        businessId: activeBusinessId!,
        branchId: activeBranchId!,
        cashierId: currentUser.id,
        cashierName: currentUser.name,
        customerId: selectedCustomerId || undefined,
        customerName: customerName || selectedCustomer?.name,
        discount: discountValue,
        discountType: discountType,
        isSynced: 0,
        updated_at: Date.now(),
        splitData: splitData || undefined
      };

      await db.transactions.add(newTransaction);
      
      for (const item of cart) {
        const prod = await db.products.get(item.id);
        if (prod) {
          await db.products.update(item.id, {
            stockQuantity: Math.max(0, (prod.stockQuantity || 0) - item.cartQuantity),
            updated_at: Date.now()
          });
        }
      }

      setCompletedTransaction(newTransaction);
      clearCart();
      setSelectedCustomerId(null);
      setDiscountValue(0);
      success("Transaction completed successfully.");
      
      if (isOnline) {
        db.sync().catch(() => {});
      }
    } catch (err) {
      error("Transaction failed. Please try again.");
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden font-hanken">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={navigateToTab} 
        onLogout={handleLogout}
        onSync={async () => {
          setIsSyncing(true);
          try { await db.sync(); success("Synced."); } catch (err) { error("Sync failed."); }
          finally { setIsSyncing(false); }
        }}
        isSyncing={isSyncing}
        currentUser={currentUser}
        onOpenProfile={() => setIsProfileModalOpen(true)}
      />
      
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        
        {/* Top App Bar (Stitch UI Style) */}
        <header className="w-full top-0 sticky bg-background border-b border-outline-variant z-50">
           <div className="flex items-center justify-between px-6 py-3 w-full md:px-12">
              <div className="flex items-center gap-4">
                 <div className="w-10 h-10 rounded-full border border-outline-variant overflow-hidden bg-surface-container cursor-pointer hover:ring-4 hover:ring-primary/10 transition-all" onClick={() => setIsProfileModalOpen(true)}>
                    <img src="https://lh3.googleusercontent.com/aida-public/AB6AXuBanTVrDxgpc9k9_6zty19qXOLkfASYjRkPwQ_ImJ3zEw6tzpyfs7xlMCV1IitVdQ7l1jfwp4DlnS9ATDcQKEJWJ-uq0CWDgk5KkKbpEGNmzP4ld_l4eoeTKGNw70t2T7rIu_M2yTlJNVPd6UXlmcDvkMwlA4K3bf1CDnO8dRt5b1BYZ8b1jbVZ6N4yJQFXev6xV13LNa3awM1O2xkB3Hs7xcWlwHWy2RMXWZ-YWif-Jp2HhuiJRJxSswmn-zRE8ugFa13qjDYidMo" className="w-full h-full object-cover" />
                 </div>
                 <h1 className="text-xl font-bold text-primary truncate max-w-[150px] md:max-w-none">
                    {activeBranch?.name || 'Main Station'} • TRM-01
                 </h1>
              </div>
              
              <div className="flex items-center gap-4">
                 <button 
                   onClick={async () => { setIsSyncing(true); try { await db.sync(); } finally { setIsSyncing(false); } }}
                   className="p-2.5 text-primary hover:bg-surface-container rounded-lg transition-all active:scale-90"
                 >
                    <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} />
                 </button>
                 <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-surface-container rounded-full border border-outline-variant">
                    <span className="font-mono text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">{isOnline ? 'Online' : 'Offline'}</span>
                    <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-primary' : 'bg-outline'}`} />
                 </div>
              </div>
           </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar relative p-6 md:p-12">
          <div className="max-w-[1440px] mx-auto">
            {activeTab === 'REGISTER' && <RegisterTab toggleCart={toggleCart} />}
            {activeTab === 'DASHBOARD' && <DashboardTab setActiveTab={navigateToTab} openExpenseModal={() => setIsExpenseModalOpen(true)} />}
            {activeTab === 'INVENTORY' && <InventoryTab />}
            {activeTab === 'CUSTOMERS' && <CustomersTab />}
            {activeTab === 'SUPPLIERS' && <SuppliersTab />}
            {activeTab === 'PURCHASES' && <PurchasesTab />}
            {activeTab === 'EXPENSES' && <ExpensesTab />}
            {activeTab === 'SUPPLIER_PAYMENTS' && <SupplierPaymentsTab />}
            {activeTab === 'REFUNDS' && <RefundsTab />}
            {activeTab === 'DOCUMENTS' && <DocumentsTab />}
            {activeTab === 'REPORTS' && <ReportsTab />}
            {activeTab === 'ADMIN_PANEL' && <AdminPanel updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
          </div>
        </main>

        {/* Mobile Bottom Navigation (Stitch UI Style) */}
        <nav className="fixed bottom-0 left-0 w-full flex justify-around items-center bg-surface-container-lowest px-2 pb-safe border-t border-outline-variant h-20 md:hidden z-50">
           {[
             { id: 'DASHBOARD', label: 'Dash', icon: 'dashboard' },
             { id: 'REGISTER', label: 'Sale', icon: 'point_of_sale' },
             { id: 'INVENTORY', label: 'Stock', icon: 'inventory_2' },
             { id: 'MORE', label: 'More', icon: 'more_horiz' },
           ].map((item) => (
             <button 
               key={item.id} 
               onClick={() => { if (item.id === 'MORE') toggleMoreMenu(true); else navigateToTab(item.id as any); }} 
               className={`flex flex-col items-center justify-center min-w-[72px] h-14 rounded-full transition-all duration-300 ${ (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen) ? 'bg-primary-container text-white scale-110 shadow-lg' : 'text-on-surface-variant' }`}
             >
               <MaterialIcon name={item.icon} style={ (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen) ? { fontVariationSettings: "'FILL' 1" } : {} } />
               <span className="font-mono text-[9px] mt-1 font-bold uppercase tracking-tighter">{item.label}</span>
             </button>
           ))}
        </nav>

        {/* Floating Action Button (Only on Mobile for quick sale) */}
        {activeTab !== 'REGISTER' && (
          <button 
            onClick={() => navigateToTab('REGISTER')}
            className="fixed right-6 bottom-24 w-14 h-14 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-transform md:hidden z-40"
          >
            <MaterialIcon name="add_shopping_cart" style={{ fontSize: '28px' }} />
          </button>
        )}

      </div>

      {/* More Options Sheet (Stitch Style) */}
      {isMoreMenuOpen && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md animate-in fade-in" onClick={() => toggleMoreMenu(false)} />
          <div className="relative w-full max-w-xl bg-white rounded-t-[2.5rem] shadow-2xl flex flex-col p-10 animate-in slide-in-from-bottom duration-500 max-h-[85vh]">
            <div className="w-12 h-1.5 bg-outline-variant rounded-full mx-auto mb-8 shrink-0" />
            
            <div className="flex-1 overflow-y-auto no-scrollbar pb-8 space-y-10">
              <div className="space-y-4">
                 <h4 className="font-mono text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Operational Nodes</h4>
                 <div className="grid grid-cols-4 gap-4">
                    {[
                      { id: 'CUSTOMERS', label: 'Clients', icon: 'group' },
                      { id: 'EXPENSES', label: 'Expenses', icon: 'payments' },
                      { id: 'REFUNDS', label: 'Returns', icon: 'keyboard_return' },
                      { id: 'DOCUMENTS', label: 'Archive', icon: 'receipt_long' }
                    ].map(item => (
                      <button key={item.id} onClick={() => navigateToTab(item.id as any)} className="flex flex-col items-center gap-3 p-2 group">
                        <div className="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-white transition-all shadow-sm"> <MaterialIcon name={item.icon} /> </div>
                        <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-tighter text-center">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </div>

              <div className="space-y-4">
                 <h4 className="font-mono text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Administration</h4>
                 <div className="grid grid-cols-4 gap-4">
                    {[
                      { id: 'SUPPLIERS', label: 'Vendors', icon: 'local_shipping' },
                      { id: 'PURCHASES', label: 'Buying', icon: 'shopping_bag' },
                      { id: 'REPORTS', label: 'Intel', icon: 'analytics' },
                      { id: 'ADMIN_PANEL', label: 'System', icon: 'settings' }
                    ].map(item => (
                      <button key={item.id} onClick={() => navigateToTab(item.id as any)} className="flex flex-col items-center gap-3 p-2 group">
                        <div className="w-14 h-14 rounded-2xl bg-surface-container flex items-center justify-center text-secondary group-hover:bg-secondary group-hover:text-white transition-all shadow-sm"> <MaterialIcon name={item.icon} /> </div>
                        <span className="font-mono text-[9px] font-bold text-on-surface-variant uppercase tracking-tighter text-center">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </div>
            </div>

            <div className="pt-8 border-t border-outline-variant flex gap-4 shrink-0">
               <button onClick={handleLogout} className="flex-1 py-4.5 rounded-2xl bg-error-container text-error font-bold text-[10px] uppercase tracking-widest hover:bg-error hover:text-white transition-all shadow-sm">Sign Out Node</button>
            </div>
          </div>
        </div>
      )}

      {/* Global Modals & Notifications */}
      <ProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} currentUser={currentUser} />
      <ExpenseModal isOpen={isExpenseModalOpen} onClose={() => setIsExpenseModalOpen(false)} expenseForm={expenseForm} setExpenseForm={setExpenseForm} handleSaveExpense={() => {}} actualCashDrawer={0} accounts={expenseAccounts || []} financialAccounts={financialAccounts || []} products={products || []} />
      
      {/* ... other modals would be refactored similarly ... */}

    </div>
  );
}
