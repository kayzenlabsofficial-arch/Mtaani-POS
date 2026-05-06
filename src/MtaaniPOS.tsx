import React, { useState, useEffect } from 'react';
import { 
  ShoppingCart, Minus, Plus, Trash2, Smartphone, Receipt, Package, 
  Wifi, WifiOff, Store, FileText, FileMinus, BarChart3, Settings, 
  Truck, Users, LayoutDashboard, DollarSign, Printer, Activity, 
  CheckCircle2, Banknote, Save, RotateCcw, ClipboardList, BadgePercent, 
  ShieldCheck, Lock, CalendarCheck, KeyRound, Check, Hand, 
  LogOut, Search, Menu, X, ChevronRight, Bell, User, MoreHorizontal, Grid, Building2, MapPin, ReceiptText, Share2, Loader2
} from 'lucide-react';
import { useLiveQuery } from './clouddb';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { db, seedInitialData, type Transaction, type Shift, type Branch } from './db';
import { useStore } from './store';
import { useToast } from './context/ToastContext';
import { MpesaService } from './services/mpesa';
import { verifyPassword, hashPassword, isLockedOut, recordFailedAttempt, resetAttempts, sanitizeString, isValidBusinessCode } from './security';

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

      // 1. Create Business record (no businessId header needed for this table)
      await db.businesses.add({
        id: newBusinessId,
        name: form.name,
        code: form.code.toUpperCase(),
        isActive: 1,
        updated_at: Date.now()
      } as any);

      // CRITICAL: Set the active business ID so the next requests
      // include the correct X-Business-ID header
      setActiveBusinessId(newBusinessId);
      // Small delay to ensure the store state is updated before next fetch
      await new Promise(r => setTimeout(r, 50));

      // 2. Create Default Admin User for this business
      await db.users.add({
        id: crypto.randomUUID(),
        name: 'admin',
        password: defaultPasswordHash, // stored as SHA-256 hash
        role: 'ADMIN',
        businessId: newBusinessId,
        updated_at: Date.now()
      });

      // 3. Create Default 'Main Branch' for this business
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
      // Always restore the context to null (system manager has no business)
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
           <input type="text" placeholder="Business Code (e.g. MTAANI02)" value={form.code} onChange={e => setForm({...form, code: e.target.value})} className="flex-1 px-4 py-3 rounded-xl border border-slate-200 uppercase" required />
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
  
  const { success, error } = useToast();

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
    // Initialize history
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

  // Store Hooks (Top-level)
  const cart = useStore(state => state.cart);
  const clearCart = useStore(state => state.clearCart);
  const removeFromCart = useStore(state => state.removeFromCart);
  const updateQuantity = useStore(state => state.updateQuantity);
  const setQuantity = useStore(state => state.setQuantity);
  const activeShift = useStore(state => state.activeShift);
  const setActiveShift = useStore(state => state.setActiveShift);
  const currentUser = useStore(state => state.currentUser);
  const setCurrentUser = useStore(state => state.setCurrentUser);
  const activeBranchId = useStore(state => state.activeBranchId);
  const setActiveBranchId = useStore(state => state.setActiveBranchId);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const setActiveBusinessId = useStore(state => state.setActiveBusinessId);
  const selectedCustomerId = useStore(state => state.selectedCustomerId);
  
  const allCustomers = useLiveQuery(() => db.customers.toArray(), [], []);
  const selectedCustomer = allCustomers?.find(c => c.id === selectedCustomerId);

  const [loginForm, setLoginForm] = useState({ businessCode: '', username: '', password: '', openingFloat: '' });
  const [loginStep, setLoginStep] = useState<'LOGIN' | 'BRANCH' | 'FLOAT'>('LOGIN');
  const [pendingUser, setPendingUser] = useState<any>(null);
  const [availableBranches, setAvailableBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>('');
  const [isSystemManager, setIsSystemManager] = useState(false);

  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isCashModalOpen, setIsCashModalOpen] = useState(false);
  const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
  const [isSharing, setIsSharing] = useState(false);
  const [isSavingPDF, setIsSavingPDF] = useState(false);
  const [amountTendered, setAmountTendered] = useState("");

  // M-Pesa State
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isMpesaModalOpen, setIsMpesaModalOpen] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaState, setMpesaState] = useState<'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [mpesaRequestId, setMpesaRequestId] = useState<string | null>(null);
  const [mpesaMessage, setMpesaMessage] = useState('');

  // ── NETWORK STATUS MONITOR ────────────────────────────────────────────────
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
  // Group state is no longer needed with bottom nav


  // Initialization
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    const init = async () => {
      await db.init();
      await seedInitialData();
      const shift = await db.shifts.where('status').equals('OPEN').first();
      if (shift) setActiveShift(shift);
    };
    init();

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── BACK BUTTON HANDLING (Prevent Quitting) ───────────────────────────────
  useEffect(() => {
    // Push an initial state
    window.history.pushState({ page: 'home' }, '');
    
    const handlePopState = (e: PopStateEvent) => {
      // If user tries to go back, we check if we can close something first
      if (isMoreMenuOpen) {
        setIsMoreMenuOpen(false);
        window.history.pushState({ page: 'home' }, '');
        return;
      }
      
      if (isExpenseModalOpen) {
        setIsExpenseModalOpen(false);
        window.history.pushState({ page: 'home' }, '');
        return;
      }

      // Default: push state back to prevent quitting the PWA
      window.history.pushState({ page: 'home' }, '');
      info("Navigation locked. Use the menu to switch tabs.");
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isMoreMenuOpen, isExpenseModalOpen]);

  // ── SESSION TIMEOUT (8 hours idle = auto-logout) ──────────────────────────
  useEffect(() => {
    if (!currentUser) return; // Only apply when logged in

    const SESSION_LIMIT_MS = 8 * 60 * 60 * 1000;      // 8 hours
    const WARN_BEFORE_MS  = 10 * 60 * 1000;            // warn at 7h50m
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
        // Trigger logout
        setCurrentUser(null);
        setActiveShift(null);
        setActiveBranchId(null);
        setActiveBusinessId(null);
        setLoginStep('LOGIN');
      } else if (!warned && idle >= SESSION_LIMIT_MS - WARN_BEFORE_MS) {
        warned = true;
        warning('Your session will expire in 10 minutes due to inactivity.');
      }
    }, 60000); // check every minute

    return () => {
      clearInterval(sessionCheck);
      events.forEach(e => window.removeEventListener(e, resetActivity));
    };
  }, [currentUser]);

  // ── AUTO-SYNC SENSITIVITY (Polling & Visibility) ──────────────────────────
  useEffect(() => {
    const doSync = async () => {
      if (isOnline && !isSyncing) {
        try {
          // Trigger a re-hydration of key tables to catch remote changes
          await db.init();
          
          // Update lastSyncAt for the active shift so admin can track online status
          if (activeShift) {
            await db.shifts.update(activeShift.id, { lastSyncAt: Date.now() });
          }
        } catch (e) {
          console.warn('[AutoSync] background refresh failed', e);
        }
      }
    };

    const poll = setInterval(doSync, 30000); // 30 seconds polling for "sensitive" updates
    
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        doSync();
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(poll);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOnline, isSyncing, activeShift]);

  // ── M-PESA POLLING ────────────────────────────────────────────────────────
  useEffect(() => {
    let interval: NodeJS.Timeout;
    let pollCount = 0;
    const MAX_POLLS = 20; // ~60 seconds (3s * 20)

    if (mpesaState === 'POLLING' && mpesaRequestId) {
      interval = setInterval(async () => {
        pollCount++;
        const status = await MpesaService.checkStatus(mpesaRequestId);
        
        if (status.found) {
           if (status.resultCode === 0) {
             setMpesaState('SUCCESS');
             setMpesaMessage(`Payment successful! Receipt: ${status.receiptNumber}`);
             success(`M-Pesa payment received: ${status.receiptNumber}`);
             setTimeout(() => {
               setIsMpesaModalOpen(false);
               handleCheckout('PAID', 'MPESA'); // Complete sale automatically
             }, 2000);
           } else if (status.resultCode === 999) {
             // Still pending, do nothing and continue polling
             console.log("[M-Pesa] Payment still pending...");
           } else {
             // Actual failure from Safaricom
             setMpesaState('FAILED');
             setMpesaMessage(`Payment failed/cancelled: ${status.resultDesc}`);
             error(`M-Pesa failed: ${status.resultDesc}`);
           }
        } else {
          // Not found in DB yet
          console.log("[M-Pesa] Record not found yet, retrying...");
        }

        if (pollCount >= MAX_POLLS && mpesaState === 'POLLING') {
          setMpesaState('FAILED');
          setMpesaMessage("Polling timed out. Please check the transaction status manually.");
          error("M-Pesa polling timed out.");
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [mpesaState, mpesaRequestId]);

  // Settings
  const savedSettings = useLiveQuery(() => db.settings.get('core'), []);
  const [storeName, setStoreName] = useState('Mtaani Shop');

  useEffect(() => {
    if (savedSettings) setStoreName(savedSettings.storeName);
  }, [savedSettings]);

  // Resolve active branch name for header display
  const activeBranchName = useLiveQuery(
    () => activeBranchId ? db.branches.get(activeBranchId).then(b => b?.name) : Promise.resolve(undefined),
    [activeBranchId]
  );


  // Auth Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginForm.businessCode || !loginForm.username || !loginForm.password) return;

    const rawCode = loginForm.businessCode.trim().toUpperCase();
    const rawUser = loginForm.username.trim();

    // ── Brute Force Check ──────────────────────────────────────────────────
    const lockout = isLockedOut(rawCode);
    if (lockout.locked) {
      const mins = Math.floor(lockout.secondsLeft / 60);
      const secs = lockout.secondsLeft % 60;
      error(`Too many failed attempts. Try again in ${mins}m ${secs}s.`);
      return;
    }

    // ── System Manager Intercept (bypass check) ────────────────────────────
    if (rawCode === 'SYSTEM' && rawUser.toLowerCase() === 'admin') {
      console.log('[Auth] System Manager login attempt...');
      
      // Master password comparison
      if (loginForm.password === 'Kayzen@Secure#POS2026') {
        console.log('[Auth] System Manager login successful.');
        setIsSystemManager(true);
        setLoginForm({ businessCode: '', username: '', password: '', openingFloat: '' });
        resetAttempts('SYSTEM');
        return;
      } else {
        console.warn('[Auth] System Manager login failed: Invalid password.');
        recordFailedAttempt('SYSTEM');
        error('Invalid System Manager credentials.');
        return;
      }
    }

    try {
      setIsSyncing(true);
      
      // 1. Verify Business Code
      const allBusinesses = await db.businesses.toArray();
      const business = allBusinesses.find(b => b.code.toUpperCase() === rawCode);
      
      if (!business) {
        recordFailedAttempt(rawCode);
        error('Invalid Business Code.');
        setIsSyncing(false);
        return;
      }

      if (business.isActive === 0) {
        error('Account suspended. Please contact Kayzen Labs.');
        setIsSyncing(false);
        return;
      }
      
      // 2. Switch Context and Sync Data
      if (activeBusinessId !== business.id) {
         setActiveBusinessId(business.id);
         await db.sync();
      }
      
      // 3. Verify User — compare using verifyPassword (supports legacy + hashed)
      const allUsers = await db.users.toArray();
      const matchedUser = allUsers.find(u => 
        u.name.toLowerCase() === rawUser.toLowerCase() && 
        u.businessId === business.id
      );
      const isValid = matchedUser ? await verifyPassword(loginForm.password, matchedUser.password) : false;

      if (matchedUser && isValid) {
        resetAttempts(rawCode); // clear lockout on success
        // Load active branches
        const allBranches = await db.branches.toArray();
        const active = allBranches.filter(b => b.isActive);
        setPendingUser(matchedUser);
        setAvailableBranches(active);

        if (active.length === 1) {
          setSelectedBranchId(active[0].id);
          setActiveBranchId(active[0].id);
          await db.sync();
          if (matchedUser.role === 'CASHIER') {
            setLoginStep('FLOAT');
          } else {
            // Restore any open shift for this branch from D1
            const openShift = await db.shifts.where('status').equals('OPEN')
              .and(s => s.branchId === active[0].id).first();
            if (openShift) setActiveShift(openShift);
            setCurrentUser(matchedUser);
            setPendingUser(null);
            setLoginForm({ businessCode: '', username: '', password: '', openingFloat: '' });
            setLoginStep('LOGIN');
            success(`Welcome back, ${matchedUser.name}!`);
          }
        } else {
          setSelectedBranchId(active[0]?.id || '');
          setLoginStep('BRANCH');
        }
      } else {
        recordFailedAttempt(rawCode);
        const lockCheck = isLockedOut(rawCode);
        if (lockCheck.locked) {
          error(`Too many failed attempts. Locked for 5 minutes.`);
        } else {
          error('Invalid credentials.');
        }
      }
    } catch (err) {
      error("Connection Error. Please check your internet.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleBranchSelect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBranchId || !pendingUser) return;
    try {
      setIsSyncing(true);
      setActiveBranchId(selectedBranchId);
      await db.sync(); // Sync branch-specific data now that branchId is set
      
      if (pendingUser.role === 'CASHIER') {
        setLoginStep('FLOAT');
      } else {
        // Restore any open shift for this branch from D1
        const openShift = await db.shifts.where('status').equals('OPEN')
          .and(s => s.branchId === selectedBranchId).first();
        if (openShift) setActiveShift(openShift);
        setCurrentUser(pendingUser);
        setPendingUser(null);
        setLoginForm({ businessCode: '', username: '', password: '', openingFloat: '' });
        setLoginStep('LOGIN');
        success(`Welcome back, ${pendingUser.name}!`);
      }
    } catch (err) {
      error("Failed to sync branch data.");
    } finally {
      setIsSyncing(false);
    }
  };

  const handleFinalizeLoginWithFloat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUser || !loginForm.openingFloat) return;

    if (!navigator.onLine) {
        error("Internet connection required. You must be online to open a shift.");
        return;
    }

    try {
        setIsSyncing(true);
        // RULE: Cannot open a new shift if one is already active on this branch
        const existingShift = await db.shifts.where('status').equals('OPEN').and(s => s.branchId === activeBranchId).first();
        if (existingShift) {
            error(`Cannot open a new shift. ${existingShift.cashierName}'s shift is still active. Please close it first.`);
            setIsSyncing(false);
            return;
        }

        const newShift: Shift = {
           id: crypto.randomUUID(),
           startTime: Date.now(),
           openingFloat: Number(loginForm.openingFloat),
           cashierName: pendingUser.name,
           status: 'OPEN',
           branchId: activeBranchId!,
           businessId: activeBusinessId!
        };
        
        await db.shifts.add(newShift);
        setActiveShift(newShift);
        setCurrentUser(pendingUser);
        setPendingUser(null);
        setLoginForm({ businessCode: '', username: '', password: '', openingFloat: '' });
        setLoginStep('LOGIN');
        success(`Personal shift initialized for ${pendingUser.name}.`);
    } catch (err) {
        console.error("Shift creation failed:", err);
        error("Failed to save shift to the server. Please check your internet connection and try again.");
    } finally {
        setIsSyncing(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setActiveShift(null);
    setActiveBranchId(null);
    setActiveBusinessId(null);
    setLoginStep('LOGIN');
    info("Logged out successfully.");
  };

  const handleCheckout = async (status: 'QUOTE' | 'PAID', paymentMethod: 'CASH' | 'MPESA') => {
    if (cart.length === 0) return;
    
    const total = cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0);
    
    try {
      setIsSyncing(true);
      const transaction: Transaction = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        items: cart.map(item => ({
          productId: item.id,
          name: item.name,
          snapshotPrice: item.sellingPrice,
          quantity: item.cartQuantity,
          taxCategory: item.taxCategory
        })),
        subtotal: total,
        tax: total * 0.16,
        total: total,
        status: status,
        paymentMethod: paymentMethod,
        cashierName: currentUser?.name || 'Unknown',
        branchId: activeBranchId!,
        businessId: activeBusinessId!,
        amountTendered: paymentMethod === 'CASH' && amountTendered ? Number(amountTendered) : undefined,
        changeGiven: paymentMethod === 'CASH' && amountTendered ? Number(amountTendered) - total : undefined
      };

      // To ensure data integrity, we should ideally use a server-side transaction.
      // Since we are using a REST-like API over D1, we'll implement a "Transaction Log"
      // pattern: first save the transaction, then update stock.
      await db.transactions.add(transaction);
      
      if (status === 'PAID') {
        // Update stock and log movement
        const stockUpdates = [];
        for (const item of cart) {
          const product = await db.products.get(item.id);
          if (product) {
            stockUpdates.push({
              id: item.id,
              newQty: Math.max(0, product.stockQuantity - item.cartQuantity),
              movement: {
                id: crypto.randomUUID(),
                productId: item.id,
                type: 'OUT',
                quantity: -item.cartQuantity,
                timestamp: transaction.timestamp,
                reference: `Sale #${transaction.id.split('-')[0].toUpperCase()}`,
                branchId: activeBranchId!,
                businessId: activeBusinessId!
              }
            });
          }
        }

        // Execute updates. If one fails, we have the transaction record to reconcile.
        for (const update of stockUpdates) {
          await db.products.update(update.id, { stockQuantity: update.newQty });
          if (db.stockMovements) {
            await db.stockMovements.add(update.movement);
          }
        }
      }

      clearCart();
      setIsCartOpen(false);
      setAmountTendered("");
      setCompletedTransaction(transaction);
      
      if (status === 'PAID') {
        success("Sale completed successfully!");
      } else {
        info("Quote saved.");
      }
    } catch (err) {
      console.error(err);
      error("Failed to complete sale.");
    } finally {
      setIsSyncing(false);
    }
  };

  if (isSystemManager) {
    return <SystemManagerDashboard onLogout={() => setIsSystemManager(false)} />;
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen grad-blue flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden border border-white/20">
          <div className="p-10 text-center">
            <div className="w-20 h-20 bg-blue-50 rounded-[2rem] flex items-center justify-center mx-auto mb-6 shadow-sm">
              <Store size={40} className="text-blue-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight mb-2">{storeName}</h2>
            <p className="text-slate-500 font-medium mb-10">Mtaani Enterprise Suite</p>

            {/* ── STEP 1: Login ─────────────────────────────────────────── */}
            {loginStep === 'LOGIN' && (
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block ml-4 text-left">Business Code</label>
                  <input 
                    type="text" 
                    value={loginForm.businessCode}
                    onChange={e => setLoginForm({...loginForm, businessCode: e.target.value.toUpperCase()})}
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700 uppercase"
                    placeholder="e.g. MTAANI01"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block ml-4 text-left">Username</label>
                  <input 
                    type="text" 
                    value={loginForm.username}
                    onChange={e => setLoginForm({...loginForm, username: e.target.value})}
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700"
                    placeholder="Enter username"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block ml-4 text-left">Password</label>
                  <input 
                    type="password" 
                    value={loginForm.password}
                    onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700"
                    placeholder="Enter password"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isSyncing}
                  className="w-full py-5 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 shadow-xl disabled:opacity-50"
                >
                  {isSyncing ? 'Authenticating...' : 'Sign In'}
                </button>
              </form>
            )}

            {/* ── STEP 2: Branch Selection ──────────────────────────────── */}
            {loginStep === 'BRANCH' && (
              <form onSubmit={handleBranchSelect} className="space-y-6 text-left">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-4 text-center">Select Branch Location</p>
                  <div className="space-y-2">
                    {availableBranches.map(branch => (
                      <label
                        key={branch.id}
                        className={`flex items-center gap-4 p-4 rounded-2xl border-2 cursor-pointer transition-all ${
                          selectedBranchId === branch.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-100 bg-slate-50 hover:border-slate-200'
                        }`}
                      >
                        <input
                          type="radio"
                          name="branch"
                          value={branch.id}
                          checked={selectedBranchId === branch.id}
                          onChange={() => setSelectedBranchId(branch.id)}
                          className="hidden"
                        />
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                          selectedBranchId === branch.id ? 'bg-blue-600 text-white' : 'bg-white text-slate-400 border border-slate-200'
                        }`}>
                          <Building2 size={18} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-black text-sm text-slate-900">{branch.name}</p>
                          <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <MapPin size={10} />{branch.location}
                          </p>
                        </div>
                        {selectedBranchId === branch.id && <CheckCircle2 size={18} className="text-blue-600 shrink-0" />}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => { setLoginStep('LOGIN'); setPendingUser(null); }}
                    className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-600 font-black uppercase tracking-widest text-[10px] hover:bg-slate-200 transition-all"
                  >
                    Back
                  </button>
                  <button 
                    type="submit"
                    disabled={!selectedBranchId}
                    className="flex-[2] py-4 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest text-[10px] hover:bg-blue-600 transition-all active:scale-95 shadow-xl disabled:opacity-50"
                  >
                    Continue
                  </button>
                </div>
              </form>
            )}

            {/* ── STEP 3: Opening Float (Cashiers only) ────────────────── */}
            {loginStep === 'FLOAT' && (
              <form onSubmit={handleFinalizeLoginWithFloat} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 block ml-4 text-left">Opening Float (KES)</label>
                  <input 
                    type="number" 
                    autoFocus
                    value={loginForm.openingFloat}
                    onChange={e => setLoginForm({...loginForm, openingFloat: e.target.value})}
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white transition-all outline-none font-bold text-slate-700"
                    placeholder="0.00"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={isSyncing}
                  className="w-full py-5 rounded-2xl bg-slate-900 text-white font-black uppercase tracking-widest hover:bg-blue-600 transition-all active:scale-95 shadow-xl disabled:opacity-50"
                >
                  {isSyncing ? 'Starting shift...' : 'Start Shift'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex bg-slate-100 overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <Sidebar 
        activeTab={activeTab}
        onTabChange={navigateToTab}
        onLogout={handleLogout}
        onSync={db.sync.bind(db)}
        isSyncing={isSyncing}
        currentUser={currentUser}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white px-6 py-3 border-b border-slate-200 flex justify-between items-center z-20 shrink-0 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 grad-blue rounded-xl flex items-center justify-center shadow-blue">
            <Store size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-base font-black tracking-tight text-slate-900 leading-none">{storeName}</h1>
            {activeBranchName && (
              <div className="flex items-center gap-1 mt-0.5">
                <MapPin size={8} className="text-blue-400" />
                {currentUser?.role === 'ADMIN' ? (
                  <select 
                    value={activeBranchId || ''} 
                    onChange={async (e) => {
                      const bid = e.target.value;
                      if (bid) {
                        setActiveBranchId(bid);
                        setIsSyncing(true);
                        try {
                          await db.sync();
                          success(`Switched to ${activeBranchName || 'branch'}`);
                        } finally {
                          setIsSyncing(false);
                        }
                      }
                    }}
                    className="bg-transparent text-[9px] font-bold text-slate-400 border-none p-0 focus:ring-0 cursor-pointer hover:text-blue-600 transition-colors"
                  >
                    <option value={activeBranchId || ''}>{activeBranchName}</option>
                    {/* The actual branch list will be populated below */}
                    <BranchOptions activeBranchId={activeBranchId} />
                  </select>
                ) : (
                  <p className="text-[9px] font-bold text-slate-400">{activeBranchName}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <button 
            onClick={() => toggleCart(true)}
            className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all shadow-sm"
          >
            <ShoppingCart size={18} />
            {cart.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-white animate-bounce-in">
                {cart.length}
              </span>
            )}
          </button>

          <button 
            onClick={() => setIsMoreMenuOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-900 text-white hover:bg-slate-800 transition-all shadow-sm ml-1"
          >
            <User size={18} />
          </button>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-red-600 text-white text-center text-[10px] font-black py-2 uppercase tracking-widest">
          ⚠️ Offline Mode — Changes will sync when reconnected
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <main className="flex-1 overflow-y-auto relative custom-scrollbar bg-slate-100 pb-24">
        {activeTab === 'REGISTER' && <RegisterTab />}
        {activeTab === 'DASHBOARD' && <DashboardTab setActiveTab={setActiveTab} openExpenseModal={() => setIsExpenseModalOpen(true)} />}
        {activeTab === 'INVENTORY' && <InventoryTab />}
        {activeTab === 'CUSTOMERS' && <CustomersTab />}
        {activeTab === 'SUPPLIERS' && <SuppliersTab setActiveTab={setActiveTab} />}
        {activeTab === 'EXPENSES' && <ExpensesTab />}
        {activeTab === 'REFUNDS' && <RefundsTab setActiveTab={setActiveTab} />}
        {activeTab === 'PURCHASES' && <PurchasesTab />}
        {activeTab === 'SUPPLIER_PAYMENTS' && <SupplierPaymentsTab />}
        {activeTab === 'DOCUMENTS' && <DocumentsTab />}
        {activeTab === 'REPORTS' && <ReportsTab />}
        {activeTab === 'ADMIN_PANEL' && <AdminPanel updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
      </main>

      {/* Bottom Navigation Bar */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-md border-t border-slate-200 px-2 py-2 flex justify-around items-center z-40 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] pb-safe">
        {[
          { id: 'REGISTER', label: 'Register', icon: ShoppingCart },
          { id: 'DASHBOARD', label: 'Overview', icon: LayoutDashboard },
          { id: 'INVENTORY', label: 'Store', icon: Package },
          { id: 'SUPPLIERS', label: 'Suppliers', icon: Truck },
          { id: 'MORE', label: 'More', icon: Grid },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === 'MORE') toggleMoreMenu(true);
              else navigateToTab(item.id as any);
            }}
            className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
              (activeTab === item.id && item.id !== 'MORE') || (item.id === 'MORE' && isMoreMenuOpen)
                ? 'text-blue-600 bg-blue-50'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            <item.icon size={22} className={activeTab === item.id && item.id !== 'MORE' ? 'fill-blue-600/10' : ''} />
            <span className="text-[10px] font-black uppercase tracking-tight">{item.label}</span>
          </button>
        ))}
      </nav>

      {/* More Options Sheet */}
      {isMoreMenuOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm animate-in fade-in" onClick={() => toggleMoreMenu(false)} />
          <div className="relative w-full max-w-xl bg-white rounded-t-[2.5rem] shadow-2xl flex flex-col p-8 animate-in slide-in-from-bottom duration-300 max-h-[85vh]">
            <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0" />
            
            <div className="flex items-center justify-between mb-8 shrink-0">
               <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-50 rounded-2xl flex items-center justify-center">
                     <User size={24} className="text-blue-600" />
                  </div>
                  <div>
                     <p className="text-sm font-black text-slate-900">{currentUser?.name}</p>
                     <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{currentUser?.role} Session</p>
                  </div>
               </div>
               <button onClick={() => toggleMoreMenu(false)} className="w-10 h-10 bg-slate-50 text-slate-400 rounded-xl flex items-center justify-center">
                  <X size={20} />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto no-scrollbar pb-8 space-y-6">
              
              <div>
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Store Operations</h4>
                 <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'CUSTOMERS', label: 'Customers', icon: Users, bg: 'bg-cyan-50', text: 'text-cyan-600' },
                      { id: 'EXPENSES', label: 'Expenses', icon: FileMinus, bg: 'bg-orange-50', text: 'text-orange-600' },
                      { id: 'REFUNDS', label: 'Refunds', icon: RotateCcw, bg: 'bg-red-50', text: 'text-red-600' },
                      { id: 'PURCHASES', label: 'LPOs', icon: ClipboardList, bg: 'bg-blue-50', text: 'text-blue-600' }
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => { navigateToTab(item.id as any); toggleMoreMenu(false); }}
                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group"
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.bg} ${item.text} group-hover:scale-110 transition-transform`}>
                          <item.icon size={18} />
                        </div>
                        <span className="text-[9px] font-black text-slate-900 uppercase tracking-tight text-center leading-tight">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </div>

              <div>
                 <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Administration & Reports</h4>
                 <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'SUPPLIER_PAYMENTS', label: 'Payments', icon: DollarSign, bg: 'bg-green-50', text: 'text-green-600' },
                      { id: 'REPORTS', label: 'Reports', icon: BarChart3, bg: 'bg-purple-50', text: 'text-purple-600' },
                      { id: 'DOCUMENTS', label: 'Records', icon: FileText, bg: 'bg-slate-50', text: 'text-slate-600' },
                      { id: 'ADMIN_PANEL', label: 'Admin', icon: ShieldCheck, bg: 'bg-slate-900', text: 'text-white' },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => { navigateToTab(item.id as any); toggleMoreMenu(false); }}
                        className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all group"
                      >
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.bg} ${item.text} group-hover:scale-110 transition-transform`}>
                          <item.icon size={18} />
                        </div>
                        <span className="text-[9px] font-black text-slate-900 uppercase tracking-tight text-center leading-tight">{item.label}</span>
                      </button>
                    ))}
                 </div>
              </div>
            </div>

            <div className="pt-6 border-t border-slate-100 flex gap-3 shrink-0">
               <button 
                onClick={async () => {
                  try {
                    setIsSyncing(true);
                    await db.sync();
                    success("Data refreshed from cloud.");
                    setTimeout(() => window.location.reload(), 1000);
                  } catch (err) {
                    error("Sync failed. Check connection.");
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                disabled={isSyncing}
                className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-blue-50 text-blue-600 font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all disabled:opacity-50"
              >
                <RotateCcw size={16} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? 'Syncing...' : 'Sync Cloud'}
              </button>
              <button 
                onClick={handleLogout}
                className="flex-1 flex items-center justify-center gap-2 py-4 rounded-2xl bg-red-50 text-red-600 font-black text-[10px] uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all"
              >
                <LogOut size={16} />
                Log Out
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Cart Drawer */}
      {(isCartOpen || activeTab === 'REGISTER') && (
        <div className={`
          fixed inset-0 z-50 flex justify-end 
          lg:static lg:inset-auto lg:z-10 lg:w-96 lg:shadow-[-4px_0_24px_rgba(0,0,0,0.05)] lg:border-l lg:border-slate-200 lg:shrink-0
          ${!isCartOpen && activeTab === 'REGISTER' ? 'hidden lg:flex' : 'flex'}
        `}>
          <div className={`fixed inset-0 bg-slate-900/60 backdrop-blur-sm lg:hidden ${!isCartOpen ? 'hidden' : ''}`} onClick={() => toggleCart(false)} />
          <div className={`relative w-full max-w-md lg:max-w-none bg-white h-full shadow-2xl lg:shadow-none flex flex-col animate-in slide-in-from-right duration-300 lg:animate-none`}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
               <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600">
                    <ShoppingCart size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 leading-none">Current Sale</h3>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Register Session</p>
                  </div>
               </div>
               <button onClick={() => toggleCart(false)} className="w-10 h-10 flex lg:hidden items-center justify-center rounded-xl bg-slate-50 text-slate-400 hover:text-slate-900 transition-all">
                 <X size={20} />
               </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-4">
               {cart.length === 0 ? (
                 <div className="h-full flex flex-col items-center justify-center text-center opacity-40">
                   <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                     <ShoppingCart size={32} />
                   </div>
                   <p className="font-black text-sm uppercase tracking-widest">Cart is Empty</p>
                   <p className="text-xs font-bold mt-1">Add items from the store to begin.</p>
                 </div>
               ) : (
                 cart.map(item => (
                   <div key={item.id} className="flex items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                     <div className="flex-1 min-w-0">
                       <h4 className="font-black text-slate-900 text-sm truncate">{item.name}</h4>
                       <p className="text-xs font-bold text-slate-400">Ksh {item.sellingPrice.toLocaleString()} / {item.unit || 'unit'}</p>
                     </div>
                     <div className="flex items-center gap-1 bg-white rounded-xl border border-slate-200 p-1">
                        <button 
                          onClick={() => updateQuantity(item.id, -1)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"
                        >
                          <Minus size={14} />
                        </button>
                        <input
                          type="number"
                          step="any"
                          value={item.cartQuantity}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            if (!isNaN(val) && val >= 0) {
                              setQuantity(item.id, val);
                            } else if (e.target.value === '') {
                              // Allow temporary empty state while typing
                              setQuantity(item.id, '' as any);
                            }
                          }}
                          onBlur={(e) => {
                             if (e.target.value === '' || parseFloat(e.target.value) <= 0) {
                                setQuantity(item.id, 1);
                             }
                          }}
                          className="w-12 text-center font-black text-sm text-slate-900 border-none outline-none focus:ring-0 p-0"
                        />
                        <button 
                          onClick={() => updateQuantity(item.id, 1)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-50 text-slate-400"
                        >
                          <Plus size={14} />
                        </button>
                     </div>
                     <button 
                       onClick={() => removeFromCart(item.id)}
                       className="w-10 h-10 flex items-center justify-center rounded-xl text-red-400 hover:bg-red-50 hover:text-red-600 transition-all"
                     >
                       <Trash2 size={18} />
                     </button>
                   </div>
                 ))
               )}
            </div>

            {cart.length > 0 && (
              <div className="p-6 border-t border-slate-100 bg-slate-50/50 space-y-4 shrink-0">
                 <div className="space-y-2">
                    <div className="flex justify-between text-slate-500 font-bold text-xs uppercase tracking-widest">
                       <span>Subtotal</span>
                       <span>Ksh {cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-slate-900 font-black text-xl tracking-tight pt-2 border-t border-slate-200">
                       <span>Total Amount</span>
                       <span className="text-blue-600">Ksh {cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0).toLocaleString()}</span>
                    </div>
                 </div>

                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => {
                        if(confirm("Clear current sale?")) clearCart();
                      }}
                      className="px-6 py-4 rounded-2xl bg-white border border-slate-200 text-slate-500 font-black text-[10px] uppercase tracking-widest hover:bg-red-50 hover:text-red-600 hover:border-red-100 transition-all"
                    >
                      Clear All
                    </button>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => setIsCashModalOpen(true)}
                        className="flex-1 px-4 py-4 rounded-2xl bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-600 shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                      >
                        <Banknote size={16} />
                        Cash
                      </button>
                      <button 
                        onClick={() => {
                          setMpesaState('IDLE');
                          setMpesaPhone(selectedCustomer?.phone || '');
                          setMpesaMessage('');
                          setIsMpesaModalOpen(true);
                        }}
                        className="flex-1 px-4 py-4 rounded-2xl bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest hover:bg-blue-700 shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                      >
                        <Smartphone size={16} />
                        M-Pesa
                      </button>
                    </div>
                  </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
      </div>

      {/* Global Modals */}
      <ExpenseModal 
        isOpen={isExpenseModalOpen} 
        onClose={() => setIsExpenseModalOpen(false)} 
      />

      {/* Cash Modal */}
      {isCashModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setIsCashModalOpen(false)} />
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col p-8 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-3xl flex items-center justify-center mb-6 mx-auto">
              <Banknote size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2 text-center">Cash Payment</h2>
            <p className="text-slate-500 text-sm mb-6 text-center">Enter the amount received from the customer.</p>
            
            <div className="bg-slate-50 p-6 rounded-3xl mb-6 border border-slate-100 text-center">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Amount Due</p>
               <p className="text-3xl font-black text-slate-900">Ksh {cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0).toLocaleString()}</p>
            </div>

            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-4">Amount Tendered</label>
                <div className="relative">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">KSH</span>
                  <input 
                    type="number" 
                    className="w-full bg-slate-50 border-2 border-transparent focus:border-green-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4 text-2xl font-black text-slate-900 transition-all outline-none" 
                    placeholder="0" 
                    value={amountTendered} 
                    onChange={(e) => setAmountTendered(e.target.value)} 
                    autoFocus 
                  />
                </div>
              </div>

              {Number(amountTendered) >= cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0) && (
                <div className="bg-green-50 p-5 rounded-2xl border border-green-100 flex justify-between items-center text-green-800 animate-in fade-in slide-in-from-top-2 duration-300">
                   <span className="font-bold text-xs uppercase tracking-widest">Change to give</span>
                   <span className="text-2xl font-black">Ksh {(Number(amountTendered) - cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0)).toLocaleString()}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
               <button onClick={() => setIsCashModalOpen(false)} className="px-6 py-4 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">Cancel</button>
               <button 
                onClick={() => { setIsCashModalOpen(false); handleCheckout('PAID', 'CASH'); }} 
                disabled={Number(amountTendered) < cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0)} 
                className="px-6 py-4 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl disabled:opacity-50 hover:bg-blue-600 shadow-xl transition-all active:scale-95"
              >
                Complete Sale
              </button>
            </div>
          </div>
        </div>
      )}

      {/* M-Pesa STK Push Modal */}
      {isMpesaModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => {
            if (mpesaState !== 'POLLING') setIsMpesaModalOpen(false);
          }} />
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col p-8 animate-in zoom-in-95 duration-200">
            <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-3xl flex items-center justify-center mb-6 mx-auto">
              <Smartphone size={32} />
            </div>
            <h2 className="text-2xl font-black text-slate-900 mb-2 text-center">M-Pesa Payment</h2>
            
            {selectedCustomer && (
              <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-2xl flex items-center gap-3">
                 <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-black text-xs">
                    {selectedCustomer.name.charAt(0)}
                 </div>
                 <div>
                    <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest leading-none">Paying Customer</p>
                    <p className="text-sm font-black text-slate-900 mt-1">{selectedCustomer.name}</p>
                 </div>
              </div>
            )}

            <div className="bg-slate-50 p-6 rounded-3xl mb-6 border border-slate-100 text-center">
               <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Amount Due</p>
               <p className="text-3xl font-black text-slate-900">Ksh {cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0).toLocaleString()}</p>
            </div>

            {mpesaState === 'IDLE' || mpesaState === 'FAILED' ? (
              <>
                <p className="text-slate-500 text-sm mb-6 text-center">Enter the customer's phone number to send an M-Pesa prompt.</p>
                {mpesaState === 'FAILED' && (
                  <div className="mb-4 p-3 bg-red-50 text-red-600 text-xs font-bold rounded-xl text-center">
                    {mpesaMessage}
                  </div>
                )}
                <div className="space-y-4 mb-8">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-4">Phone Number</label>
                    <div className="relative">
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 font-black text-sm">+254</span>
                      <input 
                        type="tel" 
                        className="w-full bg-slate-50 border-2 border-transparent focus:border-blue-500 focus:bg-white rounded-2xl pl-16 pr-6 py-4 text-lg font-black text-slate-900 transition-all outline-none" 
                        placeholder="712345678" 
                        value={mpesaPhone} 
                        onChange={(e) => setMpesaPhone(e.target.value)} 
                        autoFocus 
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                   <button onClick={() => setIsMpesaModalOpen(false)} className="px-6 py-4 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-2xl hover:bg-slate-200 transition-all">Cancel</button>
                   <button 
                    onClick={async () => {
                      if (!mpesaPhone || mpesaPhone.length < 9) return error("Enter a valid phone number");
                      setMpesaState('PUSHING');
                      const total = cart.reduce((acc, item) => acc + (item.sellingPrice * item.cartQuantity), 0);
                      const res = await MpesaService.triggerStkPush(mpesaPhone, total, 'POS', activeBusinessId!, activeBranchId!);
                      if (res.success && res.checkoutRequestId) {
                        setMpesaRequestId(res.checkoutRequestId);
                        setMpesaState('POLLING');
                      } else {
                        setMpesaState('FAILED');
                        setMpesaMessage(res.error || res.message || 'Unknown error');
                      }
                    }} 
                    disabled={!mpesaPhone}
                    className="px-6 py-4 bg-blue-600 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl disabled:opacity-50 hover:bg-blue-700 shadow-xl transition-all active:scale-95"
                  >
                    Send Prompt
                  </button>
                </div>
              </>
            ) : mpesaState === 'PUSHING' ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
                <p className="font-bold text-slate-900">Initiating request...</p>
              </div>
            ) : mpesaState === 'POLLING' ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 border-4 border-slate-100 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
                <p className="font-bold text-slate-900 mb-2">Waiting for customer...</p>
                <p className="text-xs text-slate-500 mb-8">Please ask the customer to enter their M-Pesa PIN.</p>
                
                <button 
                  onClick={() => {
                    setMpesaState('IDLE');
                    handleCheckout('PAID', 'MPESA'); // Allow manual override
                    setIsMpesaModalOpen(false);
                  }}
                  className="px-6 py-3 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-slate-200 transition-all w-full"
                >
                  Verify Manually / Skip
                </button>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Check size={32} />
                </div>
                <p className="font-black text-green-600 mb-2">{mpesaMessage}</p>
                <p className="text-xs text-slate-500 font-bold">Completing transaction...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Receipt Modal */}
      {completedTransaction && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-md" onClick={() => setCompletedTransaction(null)} />
          <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 h-full max-h-[90vh]">
             <div className="flex-1 overflow-y-auto custom-scrollbar">
                <div id="printable-receipt" className="print-receipt-80mm">
                  <div className="p-8 bg-green-50/50 border-b border-green-100 flex flex-col items-center text-center">
                    <div className="w-16 h-16 bg-green-100 text-green-600 rounded-3xl flex items-center justify-center mb-4 shadow-sm">
                        <ReceiptText size={32} />
                    </div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">{storeName}</h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Sales Receipt</p>
                    
                    <div className="flex flex-col items-center gap-1 mt-4 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                        <span>{new Date(completedTransaction.timestamp).toLocaleString('en-KE')}</span>
                        <span>Ref: #{completedTransaction.id.split('-')[0].toUpperCase()}</span>
                    </div>
                    
                    <div className="mt-4 px-3 py-1 bg-green-100 text-green-700 text-[9px] font-black rounded-full tracking-widest uppercase">
                        PAID VIA {completedTransaction.paymentMethod}
                    </div>
                  </div>

                  <div className="p-6 space-y-6">
                    <div className="space-y-4">
                        {completedTransaction.items.map((item, i) => (
                          <div key={i} className="flex justify-between items-start gap-4 text-sm">
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-slate-800 leading-tight truncate">{item.name}</p>
                                <p className="text-slate-500 text-[10px] mt-0.5 font-bold">{item.quantity} x Ksh {item.snapshotPrice.toLocaleString()}</p>
                              </div>
                              <span className="font-black text-slate-900 shrink-0">Ksh {(item.quantity * item.snapshotPrice).toLocaleString()}</span>
                          </div>
                        ))}
                    </div>

                    <div className="pt-4 border-t border-dashed border-slate-200 space-y-2">
                        <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-tight">
                          <span>Subtotal</span>
                          <span>Ksh {completedTransaction.subtotal.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between text-xs font-bold text-slate-500 uppercase tracking-tight">
                          <span>Tax (16%)</span>
                          <span>Ksh {completedTransaction.tax.toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between items-end pt-2">
                          <span className="text-sm font-black text-slate-400 uppercase tracking-widest">Total Paid</span>
                          <span className="text-2xl font-black text-slate-900">Ksh {completedTransaction.total.toLocaleString()}</span>
                        </div>
                        
                        {completedTransaction.paymentMethod === 'CASH' && completedTransaction.amountTendered && (
                          <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                            <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                <span>Amount Paid</span>
                                <span>Ksh {completedTransaction.amountTendered.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-center text-green-700 bg-green-50 p-3 rounded-2xl border border-green-100">
                                <span className="text-[10px] font-black uppercase tracking-widest">Change Given</span>
                                <span className="text-lg font-black italic">Ksh {(completedTransaction.changeGiven || 0).toLocaleString()}</span>
                            </div>
                          </div>
                        )}
                    </div>

                    <div className="text-center pt-4">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-relaxed">
                          Cashier: {completedTransaction.cashierName}<br/>
                          Thank you for shopping with us!
                        </p>
                    </div>
                  </div>
                </div>
             </div>

             <div className="p-6 bg-white border-t border-slate-100 flex flex-col gap-3">
                <div className="flex gap-2">
                   <button 
                    onClick={async () => {
                      setIsSharing(true);
                      try {
                        const filename = `Receipt-${completedTransaction.id.split('-')[0].toUpperCase()}`;
                        await generateAndShareDocument(completedTransaction, filename, null, false);
                        success('PDF shared!');
                      } catch (err) {
                        error('Share failed');
                      } finally { setIsSharing(false); }
                    }}
                    disabled={isSharing}
                    className="flex-1 py-3.5 bg-slate-900 text-white font-black text-[10px] uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all disabled:opacity-50"
                  >
                    {isSharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                    Share
                  </button>
                  <button 
                    onClick={() => window.print()} 
                    className="flex-1 py-3.5 bg-slate-100 text-slate-600 font-black text-[10px] uppercase tracking-widest rounded-2xl flex items-center justify-center gap-2 hover:bg-slate-200 transition-all"
                  >
                    <Printer size={16} /> 
                    Print
                  </button>
                </div>
                <button 
                  onClick={() => setCompletedTransaction(null)} 
                  className="w-full bg-blue-600 text-white py-4 font-black text-xs uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                >
                  New Sale
                </button>
             </div>
          </div>
        </div>
      )}


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
