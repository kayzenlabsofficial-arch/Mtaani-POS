import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useStore } from '../store';
import { useToast } from '../context/ToastContext';
import { db, type Transaction } from '../db';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getProductIngredients, isBundleProduct } from '../utils/bundleInventory';
import { SalesService } from '../services/sales';
import { flushOutboxNow } from '../offline/offlineSync';
import { getCurrentShiftId } from '../utils/shiftSession';

export function useMtaaniPOS() {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'DASHBOARD' | 'INVENTORY' | 'CUSTOMERS' | 'SUPPLIERS' | 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'INVOICES' | 'SUPPLIER_PAYMENTS' | 'DOCUMENTS' | 'HR' | 'REPORTS' | 'ADMIN_PANEL'>('REGISTER');
  const activeTabRef = useRef(activeTab);
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [isCartOpen, toggleCart] = useState(false);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  
  const { 
    cart, clearCart,
    currentUser, login, logout, isSystemAdmin,
    activeBusinessId, setActiveBusinessId,
    activeBranchId, setActiveBranchId,
    activeShift,
    setActiveShift
  } = useStore();

  const { success, error } = useToast();
  const currentSaleTotal = cart.reduce((sum, item) => sum + ((item.sellingPrice || 0) * (item.cartQuantity || 0)), 0);
  const discountValue = 0;
  const discountType = 'FIXED';
  const setDiscountValue = (_value: number) => {};
  
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
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const currentState = window.history.state || {};
    if (!currentState.mtaaniTab) {
      window.history.replaceState({ ...currentState, mtaaniTab: true, tab: activeTabRef.current }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      const tab = event.state?.tab;
      if (!tab) return;
      setActiveTab(tab);
      activeTabRef.current = tab;
      setSidebarOpen(false);
      setIsMoreMenuOpen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      flushOutboxNow()
        .then(result => {
          if (result.flushed > 0) success(`${result.flushed} offline sale${result.flushed === 1 ? '' : 's'} synced.`);
          return db.sync();
        })
        .catch(() => {});
    };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setLoginError("");

    setIsLoggingIn(true);
    try {
      const authRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ businessCode: businessCode.trim().toUpperCase(), username: username.trim(), password }),
      });
      const authData: any = await authRes.json().catch(() => ({}));
      if (!authRes.ok) {
        setLoginError(authData?.error || 'Could not sign in.');
        return;
      }

      if (activeBusinessId !== authData.businessId) {
        db.resetTenantCaches();
        clearCart();
        setActiveBranchId(null);
        setActiveShift(null);
      }
      setActiveBusinessId(authData.businessId || null);
      setActiveBranchId(authData.branchId || null);
      if (activeShift) {
        const shiftBusinessMatches = activeShift.businessId === authData.businessId;
        const shiftBranchMatches = activeShift.branchId === authData.branchId;
        const shiftUserMatches = !activeShift.cashierId || activeShift.cashierId === authData.user?.id;
        const shiftNameMatches = !activeShift.cashierName || activeShift.cashierName === authData.user?.name;
        if (activeShift.status !== 'OPEN' || !shiftBusinessMatches || !shiftBranchMatches || !shiftUserMatches || !shiftNameMatches) {
          setActiveShift(null);
        }
      }
      await new Promise(r => setTimeout(r, 0));
      login(authData.user, authData.token || null);
      setPassword('');
      success(`Welcome back, ${authData.user?.name || 'there'}!`);
    } catch (err: any) {
      db.resetTenantCaches();
      setActiveBusinessId(null);
      setActiveBranchId(null);
      setActiveShift(null);
      setLoginError(err?.message || "Connection failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to logout?")) {
      fetch('/api/auth', { method: 'DELETE', cache: 'no-store', credentials: 'same-origin' }).catch(() => {});
      db.resetTenantCaches();
      logout();
      setActiveBusinessId(null);
      setActiveBranchId(null);
      navigateToTab('REGISTER');
    }
  };

  const scrollAdminPanelToTopOnDesktop = () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (!window.matchMedia('(min-width: 768px)').matches) return;

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const appScroller = document.querySelector<HTMLElement>('.main-scroll');
        if (appScroller) {
          appScroller.scrollTo({ top: 0, left: 0 });
        } else {
          window.scrollTo({ top: 0, left: 0 });
        }
      });
    });
  };

  const navigateToTab = (tab: any) => {
    const nextTab = tab as typeof activeTab;
    if (!isOnline && nextTab !== 'REGISTER') {
      error("Offline mode only opens the register. Other pages will work after internet returns.");
      return;
    }
    const role = currentUser?.role;
    if (nextTab === 'ADMIN_PANEL' && role !== 'ADMIN') {
      error("Only administrators can open admin controls.");
      return;
    }
    if ((nextTab === 'REPORTS' || nextTab === 'SUPPLIERS' || nextTab === 'HR') && role !== 'ADMIN' && role !== 'MANAGER') {
      error("You do not have permission to open that section.");
      return;
    }
    if (typeof window !== 'undefined' && activeTabRef.current !== nextTab) {
      window.history.pushState({ ...(window.history.state || {}), mtaaniTab: true, tab: nextTab }, '');
    }
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    setSidebarOpen(false);
    setIsMoreMenuOpen(false);
    if (nextTab === 'ADMIN_PANEL') scrollAdminPanelToTopOnDesktop();
  };

  useEffect(() => {
    if (isOnline || activeTabRef.current === 'REGISTER') return;
    setActiveTab('REGISTER');
    activeTabRef.current = 'REGISTER';
    setSidebarOpen(false);
    setIsMoreMenuOpen(false);
    error("Internet is off, so the app moved back to the register.");
  }, [isOnline, error]);

  const handleSync = async () => {
    setIsSyncing(true);
    try { 
      await flushOutboxNow();
      await db.sync(); 
      success("Synced successfully."); 
    } catch (err: any) {
      console.error('[POS Sync]', err);
      error(err?.message ? `Sync failed: ${err.message}` : "Sync failed.");
    } finally { 
      setIsSyncing(false); 
    }
  };

  const handleBranchChange = (branchId: string | null) => {
    if (branchId === activeBranchId) return;
    clearCart();
    setSelectedCustomerId(null);
    setActiveShift(null);
    setActiveBranchId(branchId);
  };

  const handleCheckout = async (status: 'PAID' | 'UNPAID', method: string, mpesaRef?: string, customerName?: string, splitData?: any) => {
    if (cart.length === 0) {
      error("Add at least one item before completing the sale.");
      return null;
    }
    if (!activeBranchId) {
      error("Select or assign a branch before completing the sale.");
      return null;
    }

    const isOfflineSale = typeof navigator !== 'undefined' && !navigator.onLine;
    if (isOfflineSale && !(status === 'PAID' && method === 'CASH')) {
      error("Offline mode only allows cash sales in the register.");
      return null;
    }
    
    try {
      const cartProductIds = cart.map(item => item.id);
      const products = await db.products.bulkGet(cartProductIds);
      const productsById = new Map(products.filter(Boolean).map(product => [product!.id, product!]));
      const hasBundle = cart.some(item => {
        const product = productsById.get(item.id);
        return !!product && isBundleProduct(product);
      });
      const productIngredients = hasBundle && activeBusinessId
        ? await db.productIngredients.where('businessId').equals(activeBusinessId).toArray()
        : [];
      const ingredientIds = hasBundle
        ? Array.from(new Set(productIngredients.map(row => row.ingredientProductId).filter(Boolean)))
        : [];
      const ingredientProducts = ingredientIds.length ? await db.products.bulkGet(ingredientIds) : [];
      const ingredientProductsById = new Map(ingredientProducts.filter(Boolean).map(product => [product!.id, product!]));

      for (const item of cart) {
        const prod = productsById.get(item.id);
        if (!prod) continue;
        const saleQty = Number(item.cartQuantity) || 0;
        if (isBundleProduct(prod)) {
          const ingredients = getProductIngredients(prod, productIngredients);
          if (ingredients.length === 0) {
            error(`${item.name} has no ingredients configured.`);
            return null;
          }
          for (const row of ingredients) {
            const ingredient = ingredientProductsById.get(row.ingredientProductId);
            const requiredQty = row.quantity * saleQty;
            if (!ingredient || (ingredient.stockQuantity || 0) < requiredQty) {
              error(`Insufficient ingredient stock for ${item.name}.`);
              return null;
            }
          }
        } else if ((prod.stockQuantity || 0) < saleQty) {
          error(`Insufficient stock for ${item.name}.`);
          return null;
        }
      }

      const checkoutData = splitData || {};
      const subtotal = Number(checkoutData.subtotal ?? currentSaleTotal) || 0;
      const discountAmount = Math.min(subtotal, Math.max(Number(checkoutData.discountAmount) || 0, 0));
      const finalTotal = Math.max(0, Number(checkoutData.total ?? (subtotal - discountAmount)) || 0);
      const splitPayments = checkoutData.splitPayments;
      const amountTendered = checkoutData.amountTendered !== undefined ? Number(checkoutData.amountTendered) : undefined;
      const changeGiven = checkoutData.changeGiven !== undefined ? Number(checkoutData.changeGiven) : undefined;
      const effectiveCustomerId = checkoutData.customerId || selectedCustomerId || undefined;
      const effectiveCustomerName = checkoutData.customerName || customerName;
      const paymentReference = mpesaRef || checkoutData.mpesaRef || checkoutData.pdqRef || checkoutData.paymentReference;
      const mpesaPaymentCode = method === 'MPESA' || splitPayments?.secondaryMethod === 'MPESA' ? paymentReference : undefined;
      const transactionId = crypto.randomUUID();
      const shiftId = getCurrentShiftId(activeShift, activeBranchId, currentUser!.id);
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
        subtotal,
        tax: 0,
        discountAmount,
        total: finalTotal,
        paymentMethod: method as any,
        mpesaReference: paymentReference,
        mpesaCode: mpesaPaymentCode,
        mpesaCustomer: checkoutData.mpesaCustomer,
        mpesaCheckoutRequestId: checkoutData.mpesaCheckoutRequestId,
        amountTendered,
        changeGiven,
        splitPayments,
        status,
        timestamp: Date.now(),
        businessId: activeBusinessId!,
        branchId: activeBranchId!,
        cashierId: currentUser!.id,
        cashierName: currentUser!.name,
        shiftId,
        customerId: effectiveCustomerId,
        customerName: effectiveCustomerName,
        discount: discountAmount,
        discountType: checkoutData.discountType || discountType,
        isSynced: 0,
        updated_at: Date.now(),
        splitData: Object.keys(checkoutData).length ? checkoutData : undefined
      };

      if (isOfflineSale) {
        // Intentional Dexie write: CloudTable queues offline cash sales into the sync outbox.
        await db.transactions.add(newTransaction);
        clearCart();
        setSelectedCustomerId(null);
        setDiscountValue(0);
        success("Sale saved offline. It will sync when internet returns.");
        return newTransaction;
      }

      const checkout = await SalesService.checkout(newTransaction, { idempotencyKey: transactionId });
      const completedTransaction = checkout.transaction || newTransaction;

      clearCart();
      setSelectedCustomerId(null);
      setDiscountValue(0);
      success("Transaction completed successfully.");

      void Promise.allSettled([
        db.transactions.reload(),
        db.products.reload(),
        db.stockMovements.reload(),
        db.customers.reload(),
      ]);
      
      if (isOnline) {
        flushOutboxNow().then(() => db.sync()).catch(() => {});
      }
      return completedTransaction;
    } catch (err: any) {
      console.error("Checkout failed:", err);
      error(err?.message || "Transaction failed. Please try again.");
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
    activeBusinessId, activeBranchId, setActiveBranchId, handleBranchChange,
    handleCheckout,
    selectedCustomerId, setSelectedCustomerId,
    updateServiceWorker, needRefresh
  };
}
