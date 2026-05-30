import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useStore } from '../store';
import { useToast } from '../context/ToastContext';
import { db, type Transaction } from '../db';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getProductIngredients, isBundleProduct } from '../utils/bundleInventory';
import { SalesService } from '../services/sales';
import { isDesktopRuntime, resolveApiUrl } from '../desktop/runtime';
import { isNativeMobileRuntime } from '../mobile/runtime';
import { cacheTableRows, readCachedTableRows } from '../offline/localdb';
import { getCurrentShiftId } from '../utils/shiftSession';
import { calculateCartTotals, productUnitDiscount } from '../utils/productPricing';

const shiftBelongsToUser = (shift: any, user: any) => {
  const shiftId = String(shift?.id || '');
  return shift?.cashierId === user?.id || shift?.cashierName === user?.name || (user?.id && shiftId.includes(`_${user.id}_`));
};
const SINGLE_SHOP_ID = 'single-shop';

const flushOfflineOutbox = async () => {
  const { flushOutboxNow } = await import('../offline/offlineSync');
  return flushOutboxNow();
};

export function useMtaaniPOS() {
  const [activeTab, setActiveTab] = useState<'REGISTER' | 'DASHBOARD' | 'TILLS' | 'INVENTORY' | 'CUSTOMERS' | 'SUPPLIERS' | 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'INVOICES' | 'SUPPLIER_PAYMENTS' | 'DOCUMENTS' | 'HR' | 'REPORTS' | 'SETTINGS' | 'ADMIN_PANEL'>('DASHBOARD');
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
    activeShopId, setActiveShopId,
    activeShift,
    setActiveShift
  } = useStore();

  const { success, error } = useToast();
  const currentSaleTotal = calculateCartTotals(cart).total;
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
  const ensuredShiftKeyRef = useRef<string | null>(null);
  const tabSyncInFlightRef = useRef<Promise<void> | null>(null);
  const lastTabSyncAtRef = useRef(0);

  const refreshDataForNavigation = () => {
    if (!currentUser || !activeBusinessId) return;
    if (!isOnline || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

    const now = Date.now();
    if (tabSyncInFlightRef.current || now - lastTabSyncAtRef.current < 10_000) return;

    lastTabSyncAtRef.current = now;
    tabSyncInFlightRef.current = flushOfflineOutbox()
      .catch(() => undefined)
      .then(() => db.sync())
      .catch((err) => console.warn('[POS Tab Sync]', err))
      .finally(() => {
        tabSyncInFlightRef.current = null;
      });
  };

  const findOpenShiftForUser = async (user: any, businessId?: string | null) => {
    if (!user || !businessId) return null;

    const openShifts = await db.shifts
      .where('businessId')
      .equals(businessId)
      .and(shift => shift.status === 'OPEN' && shiftBelongsToUser(shift, user))
      .toArray();
    const existingShift = openShifts.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0))[0];
    if (existingShift) {
      return { ...existingShift, cashierId: user.id };
    }
    return null;
  };

  useEffect(() => {
    if (!currentUser || !activeBusinessId) return;
    if (currentUser.role === 'CASHIER') return;
    const key = `${activeBusinessId}:${currentUser.id}`;
    if (ensuredShiftKeyRef.current === key) return;
    ensuredShiftKeyRef.current = key;
    findOpenShiftForUser(currentUser, activeBusinessId)
      .then(shift => {
        if (shift) setActiveShift(shift);
      })
      .catch((err) => console.warn('Could not find open shift', err));
  }, [currentUser?.id, currentUser?.role, currentUser?.name, activeBusinessId, activeShopId]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'REGISTER') return;
    refreshDataForNavigation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentUser?.id, activeBusinessId, activeShopId, isOnline]);

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
      flushOfflineOutbox()
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
      const authRes = await fetch(resolveApiUrl('/api/auth'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(isDesktopRuntime() ? { 'X-Mtaani-Desktop': '1' } : {}),
          ...(isNativeMobileRuntime() ? { 'X-Mtaani-Native': '1' } : {}),
        },
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
        setActiveShopId(SINGLE_SHOP_ID);
        setActiveShift(null);
      }
      setActiveBusinessId(authData.businessId || null);
      setActiveShopId(authData.businessId ? SINGLE_SHOP_ID : null);
      if (activeShift) {
        const shiftBusinessMatches = activeShift.businessId === authData.businessId;
        const shiftUserMatches = !activeShift.cashierId || activeShift.cashierId === authData.user?.id;
        const shiftNameMatches = !activeShift.cashierName || activeShift.cashierName === authData.user?.name;
        if (activeShift.status !== 'OPEN' || !shiftBusinessMatches || !shiftUserMatches || !shiftNameMatches) {
          setActiveShift(null);
        }
      }
      await new Promise(r => setTimeout(r, 0));
      login(authData.user, authData.token || null);
      if (typeof navigator === 'undefined' || navigator.onLine) {
        void flushOfflineOutbox()
          .catch(() => undefined)
          .then(() => db.sync())
          .catch((err) => console.warn('[POS Login Sync]', err));
      }
      const loginShift = authData.user?.role === 'CASHIER'
        ? null
        : await findOpenShiftForUser(authData.user, authData.businessId).catch((err) => {
            console.warn('Could not find open shift', err);
            return null;
          });
      if (loginShift) setActiveShift(loginShift);
      activeTabRef.current = 'DASHBOARD';
      setActiveTab('DASHBOARD');
      if (typeof window !== 'undefined') {
        window.history.replaceState({ ...(window.history.state || {}), mtaaniTab: true, tab: 'DASHBOARD' }, '');
      }
      setPassword('');
      success(`Welcome back, ${authData.user?.name || 'there'}!`);
    } catch (err: any) {
      db.resetTenantCaches();
      setActiveBusinessId(null);
      setActiveShopId(null);
      setActiveShift(null);
      setLoginError(err?.message || "Connection failed. Please try again.");
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = () => {
    if (confirm("Are you sure you want to logout?")) {
      fetch(resolveApiUrl('/api/auth'), { method: 'DELETE', cache: 'no-store', credentials: 'same-origin' }).catch(() => {});
      db.resetTenantCaches();
      logout();
      setActiveBusinessId(null);
      setActiveShopId(null);
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
    const changedTab = activeTabRef.current !== nextTab;
    if (!isOnline && nextTab !== 'REGISTER') {
      error("Offline mode only opens the register. Other pages will work after internet returns.");
      return;
    }
    const role = currentUser?.role;
    if ((nextTab === 'ADMIN_PANEL' || nextTab === 'SETTINGS') && role !== 'ADMIN') {
      error("Only administrators can open admin controls.");
      return;
    }
    if (typeof window !== 'undefined' && changedTab) {
      window.history.pushState({ ...(window.history.state || {}), mtaaniTab: true, tab: nextTab }, '');
    }
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    setSidebarOpen(false);
    setIsMoreMenuOpen(false);
    if (changedTab) refreshDataForNavigation();
    if (nextTab === 'ADMIN_PANEL' || nextTab === 'SETTINGS') scrollAdminPanelToTopOnDesktop();
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
      await flushOfflineOutbox();
      await db.sync(); 
      success("Synced successfully."); 
    } catch (err: any) {
      console.error('[POS Sync]', err);
      error(err?.message ? `Sync failed: ${err.message}` : "Sync failed.");
    } finally { 
      setIsSyncing(false); 
    }
  };

  const handleCheckout = async (status: 'PAID' | 'UNPAID', method: string, mpesaRef?: string, customerName?: string, splitData?: any) => {
    if (cart.length === 0) {
      error("Add at least one item before completing the sale.");
      return null;
    }
    const shopId = activeShopId || SINGLE_SHOP_ID;

    const isOfflineSale = typeof navigator !== 'undefined' && !navigator.onLine;
    const isNativeCashSale = (isDesktopRuntime() || isNativeMobileRuntime()) && status === 'PAID' && method === 'CASH';
    const useLocalFirstSale = isOfflineSale || isNativeCashSale;
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
      const cartTotals = calculateCartTotals(cart);
      const subtotal = cartTotals.subtotal;
      const discountAmount = cartTotals.discountAmount;
      const finalTotal = cartTotals.total;
      const splitPayments = checkoutData.splitPayments;
      const amountTendered = checkoutData.amountTendered !== undefined ? Number(checkoutData.amountTendered) : undefined;
      const changeGiven = checkoutData.changeGiven !== undefined ? Number(checkoutData.changeGiven) : undefined;
      const effectiveCustomerId = checkoutData.customerId || selectedCustomerId || undefined;
      const effectiveCustomerName = checkoutData.customerName || customerName;
      const paymentReference = mpesaRef || checkoutData.mpesaRef || checkoutData.pdqRef || checkoutData.paymentReference;
      const mpesaPaymentCode = method === 'MPESA' || splitPayments?.secondaryMethod === 'MPESA' ? paymentReference : undefined;
      const transactionId = crypto.randomUUID();
      const checkoutShift = activeShift || await findOpenShiftForUser(currentUser, activeBusinessId).catch(() => null);
      if (!checkoutShift || String(checkoutShift.status || '').toUpperCase() !== 'OPEN') {
        error('Open a till shift from Dashboard before completing a sale.');
        return null;
      }
      if (checkoutShift && checkoutShift.id !== activeShift?.id) setActiveShift(checkoutShift);
      const shiftId = getCurrentShiftId(checkoutShift || activeShift, shopId, currentUser!.id);
      const newTransaction: Transaction = {
        id: transactionId,
        items: cart.map(item => ({
          productId: item.id,
          name: item.name,
          quantity: item.cartQuantity,
          snapshotPrice: item.sellingPrice,
          snapshotCost: item.costPrice || 0,
          category: item.category,
          discountAmount: productUnitDiscount(item),
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
        shopId: shopId,
        cashierId: currentUser!.id,
        cashierName: currentUser!.name,
        shiftId,
        customerId: effectiveCustomerId,
        customerName: effectiveCustomerName,
        discount: discountAmount,
        discountType: discountAmount > 0 ? 'PRODUCT' : discountType,
        isSynced: 0,
        updated_at: Date.now(),
        splitData: Object.keys(checkoutData).length ? checkoutData : undefined
      };

      if (useLocalFirstSale) {
        // Native desktop/mobile stores cash sales locally and queues them for server sync.
        await db.transactions.add(newTransaction);
        try {
          const deductions = new Map<string, number>();
          const addDeduction = (productId: string, quantity: number) => {
            if (!productId || quantity <= 0) return;
            deductions.set(productId, (deductions.get(productId) || 0) + quantity);
          };

          for (const item of cart) {
            const prod = productsById.get(item.id);
            const saleQty = Number(item.cartQuantity) || 0;
            if (!prod || saleQty <= 0) continue;
            if (isBundleProduct(prod)) {
              getProductIngredients(prod, productIngredients).forEach(row => {
                addDeduction(row.ingredientProductId, row.quantity * saleQty);
              });
            } else {
              addDeduction(item.id, saleQty);
            }
          }

          const updatedProducts: any[] = [];
          for (const [productId, quantity] of deductions.entries()) {
            const prod = productsById.get(productId) || ingredientProductsById.get(productId);
            if (!prod) continue;
            const updated = {
              ...prod,
              stockQuantity: Math.max(0, Number(prod.stockQuantity || 0) - quantity),
              updated_at: Date.now(),
            };
            updatedProducts.push(updated);
            await db.products.cacheLocal(updated);
          }

          if (activeBusinessId && updatedProducts.length > 0) {
            const updatesById = new Map(updatedProducts.map(product => [product.id, product]));
            const cachedRows = await readCachedTableRows({ table: 'products', businessId: activeBusinessId, shopId });
            const baseRows = cachedRows.length > 0 ? cachedRows : await db.products.toArray().catch(() => []);
            const seen = new Set<string>();
            const nextRows = baseRows.map((row: any) => {
              const replacement = updatesById.get(row.id);
              if (replacement) {
                seen.add(row.id);
                return replacement;
              }
              return row;
            });
            updatedProducts.forEach(product => {
              if (!seen.has(product.id)) nextRows.push(product);
            });
            await cacheTableRows({ table: 'products', businessId: activeBusinessId, shopId, rows: nextRows });
          }
        } catch (reserveErr) {
          console.warn('[POS Offline] Sale saved, but local stock reservation failed:', reserveErr);
        }
        clearCart();
        setSelectedCustomerId(null);
        setDiscountValue(0);
        if (isOnline) flushOfflineOutbox().catch(() => {});
        success(isNativeCashSale && isOnline ? "Sale saved locally and queued for sync." : "Sale saved offline. It will sync when internet returns.");
        return newTransaction;
      }

      const checkout = await SalesService.checkout(newTransaction, { idempotencyKey: transactionId });
      const completedTransaction = checkout.transaction || newTransaction;

      clearCart();
      setSelectedCustomerId(null);
      setDiscountValue(0);
      success("Transaction completed successfully.");

      const canSyncSalesData = currentUser?.role === 'ROOT' || currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER';
      void Promise.allSettled([
        ...(canSyncSalesData ? [db.transactions.reload()] : []),
        db.products.reload(),
        db.stockMovements.reload(),
        db.customers.reload(),
      ]);
      
      if (isOnline) {
        flushOfflineOutbox().catch(() => {});
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
    activeBusinessId, activeShopId, setActiveShopId,
    handleCheckout,
    selectedCustomerId, setSelectedCustomerId,
    updateServiceWorker, needRefresh
  };
}
