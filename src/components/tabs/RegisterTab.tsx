import React, { useState } from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { useHardwareBarcodeScanner } from '../../hooks/useHardwareBarcodeScanner';
import { usePhoneUi } from '../../hooks/usePhoneUi';
import { enrichProductsWithBundleStock, isBundleProduct } from '../../utils/bundleInventory';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { getAssignedHardware, getHardwareProfile, printReceiptViaAssignedPrinter } from '../../utils/hardware';
import { getBusinessSettings } from '../../utils/settings';
import { belongsToActiveShop } from '../../utils/shopScope';
import { calculateCartTotals } from '../../utils/productPricing';
import { canPerform } from '../../utils/accessControl';
import HeldOrdersModal from '../register/HeldOrdersModal';
import ProductSearchModal from '../register/ProductSearchModal';
import RegisterDesktop from '../register/RegisterDesktop';
import RegisterHeader from '../register/RegisterHeader';
import RegisterMobile from '../register/RegisterMobile';
import RegisterScannerPanel from '../register/RegisterScannerPanel';
import type { CheckoutOptions } from '../register/types';

type RegisterBackLayer = 'SCANNER' | 'MOBILE_CHECKOUT' | 'HELD_ORDERS' | 'PRODUCT_SEARCH';
const REGISTER_BACK_LAYER = 'registerBackLayer';
const SILENT_RECEIPT_TRANSPORTS = new Set(['WEBUSB', 'WEBSERIAL']);

export default function RegisterTab({
  toggleCart,
  handleCheckout,
  setActiveTab,
}: {
  toggleCart?: (value: boolean) => void;
  handleCheckout?: (status: 'PAID' | 'UNPAID', method: string, mpesaRef?: string, customerName?: string, splitData?: any) => Promise<any>;
  setActiveTab?: (tab: string) => void;
}) {
  const isPhoneUi = usePhoneUi();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentlyAdded, setRecentlyAdded] = useState<Set<string>>(new Set());
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [isMobileCheckoutOpen, setIsMobileCheckoutOpen] = useState(false);
  const [isHeldOrdersOpen, setIsHeldOrdersOpen] = useState(false);
  const [lastReceipt, setLastReceipt] = useState<(Transaction & { recordType: 'SALE' }) | null>(null);
  const { warning, error, success } = useToast();
  const {
    addToCart,
    removeFromCart,
    updateQuantity,
    setQuantity,
    clearCart,
    holdCurrentOrder,
    resumeHeldOrder,
    deleteHeldOrder,
    activeBusinessId,
    activeShopId,
    activeShift,
    currentUser,
    setActiveShift,
    cart,
    heldOrders,
  } = useStore();
  const canSeeShiftList = currentUser?.role === 'ADMIN' || currentUser?.role === 'MANAGER' || currentUser?.role === 'ROOT';

  const products = useLiveQuery(
    () => {
      const term = searchQuery.trim().toLowerCase();
      if (!activeBusinessId || !term) return Promise.resolve([]);
      return db.products.where('businessId').equals(activeBusinessId).filter(product =>
        belongsToActiveShop(product, activeShopId) &&
        (String(product.name || '').toLowerCase().includes(term) || String(product.barcode || '').toLowerCase().includes(term))
      ).toArray();
    },
    [searchQuery, activeBusinessId, activeShopId],
    []
  );
  const productIngredients = useLiveQuery(
    () => activeBusinessId ? db.productIngredients.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const scannerProductsRaw = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).filter(product => belongsToActiveShop(product, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId], null);
  const shopShifts = useLiveQuery(
    () => canSeeShiftList && activeBusinessId && activeShopId
      ? db.shifts.where('shopId').equals(activeShopId).and(row => row.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId, canSeeShiftList],
    []
  );
  const activeShop = {
    id: activeShopId,
    name: businessSettings?.storeName || 'Main shop',
    location: businessSettings?.location || '',
    tillNumber: businessSettings?.tillNumber || '',
  };

  const displayProducts = enrichProductsWithBundleStock(products || [], productIngredients || []);
  const scannerProducts = enrichProductsWithBundleStock(scannerProductsRaw || [], productIngredients || []);
  const sortedProducts = [...displayProducts].sort((a, b) => {
    const score = (product: any) => {
      const quantity = product.stockQuantity || 0;
      if (quantity <= 0) return 2;
      if (quantity <= (product.reorderPoint || 5)) return 1;
      return 0;
    };
    return score(a) - score(b);
  });
  const scopedHeldOrders = heldOrders.filter(order =>
    (!activeBusinessId || order.businessId === activeBusinessId) &&
    (!activeShopId || order.shopId === activeShopId)
  );
  const shiftBelongsToCurrentUser = React.useCallback((shift: any) => {
    if (!shift || !currentUser) return false;
    const userId = String(currentUser.id || '').trim();
    const userName = String(currentUser.name || '').trim().toLowerCase();
    const cashierId = String(shift.cashierId || '').trim();
    const cashierName = String(shift.cashierName || '').trim().toLowerCase();
    return (userId && cashierId === userId)
      || (userName && cashierName === userName)
      || (userId && String(shift.id || '').includes(`_${userId}`));
  }, [currentUser]);
  const shiftInActiveScope = React.useCallback((shift: any) => (
    shift
    && String(shift.shopId || activeShopId || '') === String(activeShopId || '')
    && String(shift.businessId || activeBusinessId || '') === String(activeBusinessId || '')
  ), [activeShopId, activeBusinessId]);
  const localOpenShift = String(activeShift?.status || '').toUpperCase() === 'OPEN'
    && shiftInActiveScope(activeShift)
    && shiftBelongsToCurrentUser(activeShift)
    ? activeShift
    : null;
  const sharedOwnOpenShift = (shopShifts || []).find(shift => String(shift.status || '').toUpperCase() === 'OPEN' && shiftBelongsToCurrentUser(shift));
  const ownOpenShift = localOpenShift || sharedOwnOpenShift || null;
  const canOperateOwnShift = !!ownOpenShift;

  const pushRegisterBackLayer = React.useCallback((layer: RegisterBackLayer) => {
    if (typeof window === 'undefined') return;
    if (window.history.state?.[REGISTER_BACK_LAYER] === layer) return;
    window.history.pushState({ ...(window.history.state || {}), mtaaniTab: true, tab: 'REGISTER', [REGISTER_BACK_LAYER]: layer }, '');
  }, []);

  const dismissRegisterBackLayer = React.useCallback((layer: RegisterBackLayer, close: () => void) => {
    close();
    if (typeof window !== 'undefined' && window.history.state?.[REGISTER_BACK_LAYER] === layer) {
      window.history.back();
    }
  }, []);

  const openScanner = React.useCallback(() => {
    pushRegisterBackLayer('SCANNER');
    setIsScannerOpen(true);
  }, [pushRegisterBackLayer]);

  const closeScanner = React.useCallback(() => {
    dismissRegisterBackLayer('SCANNER', () => setIsScannerOpen(false));
  }, [dismissRegisterBackLayer]);

  const toggleScanner = React.useCallback(() => {
    if (isScannerOpen) closeScanner();
    else openScanner();
  }, [closeScanner, isScannerOpen, openScanner]);

  const handleSearchQueryChange = React.useCallback((value: string) => {
    const hadQuery = searchQuery.trim().length > 0;
    const hasQuery = value.trim().length > 0;

    if (!hadQuery && hasQuery) pushRegisterBackLayer('PRODUCT_SEARCH');
    if (hadQuery && !hasQuery) {
      dismissRegisterBackLayer('PRODUCT_SEARCH', () => setSearchQuery(''));
      return;
    }

    setSearchQuery(value);
  }, [dismissRegisterBackLayer, pushRegisterBackLayer, searchQuery]);

  const closeProductSearch = React.useCallback(() => {
    dismissRegisterBackLayer('PRODUCT_SEARCH', () => setSearchQuery(''));
  }, [dismissRegisterBackLayer]);

  const openHeldOrders = React.useCallback(() => {
    pushRegisterBackLayer('HELD_ORDERS');
    setIsHeldOrdersOpen(true);
  }, [pushRegisterBackLayer]);

  const closeHeldOrders = React.useCallback(() => {
    dismissRegisterBackLayer('HELD_ORDERS', () => setIsHeldOrdersOpen(false));
  }, [dismissRegisterBackLayer]);

  const handleAddToCart = React.useCallback((product: any) => {
    if ((product.stockQuantity || 0) <= 0) {
      warning(isBundleProduct(product) ? 'This bulk item has no ingredient stock available.' : 'This item is out of stock.');
      return;
    }
    addToCart(product);
    closeProductSearch();
    toggleCart?.(true);
    setRecentlyAdded(prev => new Set([...prev, product.id]));
    window.setTimeout(() => setRecentlyAdded(prev => {
      const next = new Set(prev);
      next.delete(product.id);
      return next;
    }), 600);
  }, [addToCart, closeProductSearch, toggleCart, warning]);

  const handleHoldOrder = () => {
    if (cart.length === 0) {
      warning('Add products before holding an order.');
      return;
    }
    const held = holdCurrentOrder(`Held order ${scopedHeldOrders.length + 1}`);
    if (held) success(`${held.name} saved. You can resume it from Held Orders.`);
  };

  const handleResumeHeldOrder = (orderId: string) => {
    if (cart.length > 0) {
      warning('Hold or clear the current sale before resuming another order.');
      return;
    }
    const resumed = resumeHeldOrder(orderId);
    if (resumed) {
      closeHeldOrders();
      success(`${resumed.name} resumed.`);
    }
  };

  const handleDeleteHeldOrder = (orderId: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this held order?')) return;
    deleteHeldOrder(orderId);
  };

  const handleBarcodeScan = React.useCallback((barcode: string) => {
    const code = barcode.trim();
    if (!code) return;
    const product = scannerProducts.find(item => String(item.barcode || '').trim() === code);
    if (!product) {
      handleSearchQueryChange(code);
      warning(`No product found for barcode ${code}.`);
      return;
    }
    handleAddToCart(product);
    closeScanner();
  }, [closeScanner, handleAddToCart, handleSearchQueryChange, scannerProducts, warning]);

  useHardwareBarcodeScanner(handleBarcodeScan, {
    enabled: !!activeBusinessId && canOperateOwnShift,
    onError: warning,
  });

  React.useEffect(() => {
    if (sharedOwnOpenShift && !localOpenShift) setActiveShift(sharedOwnOpenShift);
  }, [localOpenShift, setActiveShift, sharedOwnOpenShift]);

  const maybeAutoPrintReceipt = React.useCallback(async (receipt: Transaction & { recordType?: 'SALE' }) => {
    const profile = getHardwareProfile();
    const assignedPrinter = getAssignedHardware('RECEIPT_PRINTER');
    if (!profile.autoPrintReceipt || !assignedPrinter) return false;
    if (!SILENT_RECEIPT_TRANSPORTS.has(assignedPrinter.transport)) {
      if (assignedPrinter.transport === 'BROWSER_PRINT') {
        warning('Silent receipt printing needs a USB or Serial thermal printer. Chrome printer would show a print prompt, so it was skipped.');
      } else {
        warning('This assigned receipt printer cannot print silently yet. Use USB thermal or Serial.');
      }
      return false;
    }
    const hasCashDrawerEvent = receipt.paymentMethod === 'CASH' || Number(receipt.splitPayments?.cashAmount || 0) > 0;
    const result = await printReceiptViaAssignedPrinter(receipt, {
      storeName: businessSettings?.storeName || 'Smart POS',
      location: businessSettings?.location || 'Nairobi, Kenya',
      openDrawer: profile.cashDrawerTrigger === 'RECEIPT_PRINT' && hasCashDrawerEvent,
    });
    if (!result.ok) warning(result.message);
    return result.ok;
  }, [businessSettings?.location, businessSettings?.storeName, warning]);

  const completeCheckout = async (status: 'PAID' | 'UNPAID', method: string, options?: CheckoutOptions) => {
    if (!handleCheckout || cart.length === 0 || isCheckingOut) return null;
    if (!canPerform(currentUser, 'sale.checkout', businessSettings)) {
      error('Completing sales is locked for this account.');
      return null;
    }
    setIsCheckingOut(true);
    try {
      const paymentReference = options?.mpesaRef || options?.pdqRef || options?.paymentReference;
      const result = await handleCheckout(status, method, paymentReference, options?.customerName, options);
      if (result) {
        setIsMobileCheckoutOpen(false);
        const receipt = {
          ...(result as any),
          recordType: 'SALE' as const,
          shopName: activeShop?.name || (result as any).shopName,
          tillNumber: activeShop?.tillNumber || businessSettings?.tillNumber || (result as any).tillNumber,
          businessAddress: activeShop?.location || businessSettings?.location || (result as any).businessAddress,
          receiptFooter: businessSettings?.receiptFooter || (result as any).receiptFooter,
        };
        const profile = getHardwareProfile();
        const assignedPrinter = getAssignedHardware('RECEIPT_PRINTER');
        const shouldUseSilentReceipt = !!profile.autoPrintReceipt && !!assignedPrinter && SILENT_RECEIPT_TRANSPORTS.has(assignedPrinter.transport);
        if (shouldUseSilentReceipt) {
          void maybeAutoPrintReceipt(receipt as any);
        } else {
          setLastReceipt(receipt as any);
          void maybeAutoPrintReceipt(receipt as any);
        }
      }
      return result;
    } catch (err: any) {
      error(err?.message || 'Checkout failed.');
      return null;
    } finally {
      setIsCheckingOut(false);
    }
  };

  const saleTotal = calculateCartTotals(cart).total;
  const saleItemCount = cart.reduce((sum, item) => sum + (Number(item.cartQuantity) || 0), 0);
  const selectedProductCount = cart.length;
  const isProductSearchOpen = searchQuery.trim().length > 0;
  const canCheckout = canPerform(currentUser, 'sale.checkout', businessSettings);

  React.useEffect(() => {
    if (cart.length === 0) setIsMobileCheckoutOpen(false);
  }, [cart.length]);

  React.useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const layer = event.state?.[REGISTER_BACK_LAYER] as RegisterBackLayer | undefined;
      if (isScannerOpen && layer !== 'SCANNER') setIsScannerOpen(false);
      if (isMobileCheckoutOpen && layer !== 'MOBILE_CHECKOUT') setIsMobileCheckoutOpen(false);
      if (isHeldOrdersOpen && layer !== 'HELD_ORDERS') setIsHeldOrdersOpen(false);
      if (isProductSearchOpen && layer !== 'PRODUCT_SEARCH') setSearchQuery('');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isHeldOrdersOpen, isMobileCheckoutOpen, isProductSearchOpen, isScannerOpen]);

  const openMobileCheckout = (event?: React.SyntheticEvent) => {
    event?.preventDefault();
    if (!isMobileCheckoutOpen) pushRegisterBackLayer('MOBILE_CHECKOUT');
    setIsMobileCheckoutOpen(true);
  };

  const closeMobileCheckout = () => {
    dismissRegisterBackLayer('MOBILE_CHECKOUT', () => setIsMobileCheckoutOpen(false));
  };

  const handleReceiptRefund = async () => {
    warning('Open Documents to refund a completed receipt.');
  };

  if (!canOperateOwnShift) {
    return (
      <div className="relative flex h-full min-h-0 flex-col items-center justify-center bg-slate-50 p-4 text-center">
        <div className="max-w-sm rounded-lg border-2 border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-[11px] font-black uppercase tracking-widest text-blue-700">Register locked</p>
          <h2 className="mt-2 text-2xl font-black text-slate-950">Open a shift first</h2>
          <p className="mt-2 text-sm font-semibold text-slate-600">
            Sales are attached to a till session. Open your shift from the Dashboard, then come back to Register.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab?.('DASHBOARD')}
            className="mt-5 h-11 w-full rounded-lg border-2 border-blue-700 bg-blue-700 text-sm font-black text-white transition hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-50 animate-in fade-in">
      <RegisterHeader
        searchQuery={searchQuery}
        setSearchQuery={handleSearchQueryChange}
        selectedProductCount={selectedProductCount}
        saleItemCount={saleItemCount}
        saleTotal={saleTotal}
        scannerProducts={scannerProducts}
        handleBarcodeScan={handleBarcodeScan}
        isScannerOpen={isScannerOpen}
        onToggleScanner={toggleScanner}
      />

      <RegisterScannerPanel
        open={isScannerOpen}
        onScan={handleBarcodeScan}
        onClose={closeScanner}
      />

      <ProductSearchModal
        open={!!activeBusinessId && isProductSearchOpen}
        query={searchQuery}
        products={sortedProducts}
        recentlyAdded={recentlyAdded}
        onAdd={handleAddToCart}
        onClose={closeProductSearch}
      />

      {isPhoneUi ? (
        <RegisterMobile
          cart={cart}
          saleItemCount={saleItemCount}
          saleTotal={saleTotal}
          isCheckingOut={isCheckingOut}
          canCheckout={canCheckout}
          isMobileCheckoutOpen={isMobileCheckoutOpen}
          onOpenMobileCheckout={openMobileCheckout}
          onCloseMobileCheckout={closeMobileCheckout}
          onCheckout={completeCheckout}
        />
      ) : (
        <RegisterDesktop
          activeBusinessId={activeBusinessId}
          cart={cart}
          selectedProductCount={selectedProductCount}
          saleItemCount={saleItemCount}
          saleTotal={saleTotal}
          heldOrders={scopedHeldOrders}
          isCheckingOut={isCheckingOut}
          canCheckout={canCheckout}
          onCheckout={completeCheckout}
          onHoldOrder={handleHoldOrder}
          onOpenHeldOrders={openHeldOrders}
          clearCart={clearCart}
          removeFromCart={removeFromCart}
          updateQuantity={updateQuantity}
          setQuantity={setQuantity}
        />
      )}

      <HeldOrdersModal
        open={isHeldOrdersOpen}
        orders={scopedHeldOrders}
        onClose={closeHeldOrders}
        onResume={handleResumeHeldOrder}
        onDelete={handleDeleteHeldOrder}
      />

      <DocumentDetailsModal
        selectedRecord={lastReceipt}
        setSelectedRecord={(record) => setLastReceipt(record as any)}
        handleRefund={handleReceiptRefund}
      />
    </div>
  );
}
