import { useState, useEffect } from 'react';
import { useStore } from '../store';
import { useToast } from '../context/ToastContext';
import { db, type Transaction } from '../db';
import { verifyPassword, isLockedOut, recordFailedAttempt, resetAttempts } from '../security';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function useMtaaniPOS() {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'DASHBOARD' | 'INVENTORY' | 'CUSTOMERS' | 'SUPPLIERS' | 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'SUPPLIER_PAYMENTS' | 'DOCUMENTS' | 'REPORTS' | 'ADMIN_PANEL'>('REGISTER');
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCartOpen, toggleCart] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const { 
    cart, clearCart, currentSaleTotal, 
    discountValue, discountType, setDiscountValue,
    currentUser, login, logout, isSystemAdmin,
    activeBusinessId, setActiveBusinessId,
    activeBranchId, setActiveBranchId
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

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);

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

      setActiveBusinessId(biz.id);
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

  const handleSync = async () => {
    setIsSyncing(true);
    try { 
      await db.sync(); 
      success("Synced successfully."); 
    } catch (err) { 
      error("Sync failed."); 
    } finally { 
      setIsSyncing(false); 
    }
  };

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
        cashierId: currentUser!.id,
        cashierName: currentUser!.name,
        customerId: selectedCustomerId || undefined,
        customerName: customerName,
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

      clearCart();
      setSelectedCustomerId(null);
      setDiscountValue(0);
      success("Transaction completed successfully.");
      
      if (isOnline) {
        db.sync().catch(() => {});
      }
      return newTransaction;
    } catch (err) {
      error("Transaction failed. Please try again.");
      return null;
    }
  };

  return {
    activeTab, navigateToTab,
    isSidebarOpen, setSidebarOpen,
    isMoreMenuOpen, setIsMoreMenuOpen,
    isCartOpen, toggleCart,
    isExpenseModalOpen, setIsExpenseModalOpen,
    isProfileModalOpen, setIsProfileModalOpen,
    isSyncing, handleSync,
    isOnline,
    username, setUsername,
    password, setPassword,
    businessCode, setBusinessCode,
    isLoggingIn, handleLogin,
    handleLogout, loginError,
    currentUser, isSystemAdmin,
    activeBusinessId, activeBranchId, setActiveBranchId,
    handleCheckout,
    selectedCustomerId, setSelectedCustomerId,
    updateServiceWorker, needRefresh
  };
}
