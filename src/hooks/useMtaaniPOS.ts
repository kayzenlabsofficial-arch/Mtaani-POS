import { useState, useEffect, type FormEvent } from 'react';
import { useStore } from '../store';
import { useToast } from '../context/ToastContext';
import { db, type Transaction } from '../db';
import { verifyPassword, isLockedOut, recordFailedAttempt, resetAttempts } from '../security';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { getProductIngredients, isBundleProduct } from '../utils/bundleInventory';

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
    cart, clearCart,
    currentUser, login, logout, isSystemAdmin,
    activeBusinessId, setActiveBusinessId,
    activeBranchId, setActiveBranchId
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
    const handleOnline = () => setIsOnline(true);
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
      const productIngredients = await db.productIngredients.toArray();
      for (const item of cart) {
        const prod = await db.products.get(item.id);
        if (!prod) continue;
        const saleQty = Number(item.cartQuantity) || 0;
        if (isBundleProduct(prod)) {
          const ingredients = getProductIngredients(prod, productIngredients);
          if (ingredients.length === 0) {
            error(`${item.name} has no ingredients configured.`);
            return null;
          }
          for (const row of ingredients) {
            const ingredient = await db.products.get(row.ingredientProductId);
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
      const creditAmount = method === 'CREDIT'
        ? finalTotal
        : method === 'SPLIT' && splitPayments?.secondaryMethod === 'CREDIT'
          ? Number(splitPayments.secondaryAmount) || 0
          : 0;

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
        subtotal,
        tax: 0,
        discountAmount,
        total: finalTotal,
        paymentMethod: method as any,
        mpesaReference: paymentReference,
        mpesaCode: method === 'MPESA' || splitPayments?.secondaryMethod === 'MPESA' ? paymentReference : undefined,
        amountTendered,
        changeGiven,
        splitPayments,
        status,
        timestamp: Date.now(),
        businessId: activeBusinessId!,
        branchId: activeBranchId!,
        cashierId: currentUser!.id,
        cashierName: currentUser!.name,
        customerId: effectiveCustomerId,
        customerName: effectiveCustomerName,
        discount: discountAmount,
        discountType: checkoutData.discountType || discountType,
        isSynced: 0,
        updated_at: Date.now(),
        splitData: Object.keys(checkoutData).length ? checkoutData : undefined
      };

      await db.transactions.add(newTransaction);

      if (effectiveCustomerId) {
        const customer = await db.customers.get(effectiveCustomerId);
        if (customer) {
          await db.customers.update(effectiveCustomerId, {
            totalSpent: (Number(customer.totalSpent) || 0) + finalTotal,
            balance: (Number(customer.balance) || 0) + creditAmount,
            updated_at: Date.now()
          });
        }
      }
      
      for (const item of cart) {
        const prod = await db.products.get(item.id);
        if (prod) {
          const saleQty = Number(item.cartQuantity) || 0;
          if (isBundleProduct(prod)) {
            const ingredients = getProductIngredients(prod, productIngredients);
            for (const row of ingredients) {
              const ingredient = await db.products.get(row.ingredientProductId);
              if (!ingredient) continue;
              const deductQty = row.quantity * saleQty;
              await db.products.update(ingredient.id, {
                stockQuantity: Math.max(0, (ingredient.stockQuantity || 0) - deductQty),
                updated_at: Date.now()
              });
              await db.stockMovements.add({
                id: crypto.randomUUID(),
                productId: ingredient.id,
                type: 'OUT',
                quantity: -deductQty,
                timestamp: Date.now(),
                reference: `Bundle Sale #${transactionId.split('-')[0].toUpperCase()} (${item.name})`,
                branchId: activeBranchId!,
                businessId: activeBusinessId!,
              });
            }
          } else {
            await db.products.update(item.id, {
              stockQuantity: Math.max(0, (prod.stockQuantity || 0) - saleQty),
              updated_at: Date.now()
            });
          }
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
