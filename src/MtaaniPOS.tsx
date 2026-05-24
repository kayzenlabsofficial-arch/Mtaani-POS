import React, { useState } from 'react';
import { useLiveQuery } from './clouddb';
import { db } from './db';
import { useMtaaniPOS } from './hooks/useMtaaniPOS';
import { usePhoneUi } from './hooks/usePhoneUi';
import { useVisualViewport } from './hooks/useVisualViewport';
import { useToast } from './context/ToastContext';
import { canOpenTab, canPerform, shouldBlurFeature } from './utils/accessControl';
import { recordAuditEvent } from './utils/auditLog';
import { submitExpenseRecord } from './utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from './utils/ownerMode';
import { calculateShiftCashFromSales, getTodayStartMs } from './utils/cashDrawer';
import { getBusinessSettings } from './utils/settings';
import { pickedCashAccountId, singleFinanceAccount } from './utils/financeAccount';
import { useStore } from './store';
import { getCurrentShiftId, getCurrentShiftStart } from './utils/shiftSession';

// Modular Components
import RegisterTab from './components/tabs/RegisterTab';
import DashboardTab from './components/tabs/DashboardTab';
import InventoryTab from './components/tabs/InventoryTab';
import CustomersTab from './components/tabs/CustomersTab';
import SuppliersTab from './components/tabs/SuppliersTab';
import ExpensesTab from './components/tabs/ExpensesTab';
import MainAccountTab from './components/tabs/MainAccountTab';
import RefundsTab from './components/tabs/RefundsTab';
import PurchasesTab from './components/tabs/PurchasesTab';
import SalesInvoicesTab from './components/tabs/SalesInvoicesTab';
import SupplierPaymentsTab from './components/tabs/SupplierPaymentsTab';
import DocumentsTab from './components/tabs/DocumentsTab';
import ReportsTab from './components/tabs/ReportsTab';
import HRTab from './components/tabs/HRTab';
import AdminPanel from './components/tabs/AdminPanel';
import TillsTab from './components/tabs/TillsTab';
import SettingsTab from './components/tabs/SettingsTab';

// Layout & Shell
import Sidebar from './components/shared/Sidebar';
import { MobileNav, MobileRegisterFab, MoreOptionsMenu, TopHeaderDesktop, TopHeaderMobile } from './components/layout/Shell';
import { LoginScreen } from './components/auth/LoginScreen';
import SystemManagerDashboard from './components/admin/SystemManager';

// Modals
import ProfileModal from './components/modals/ProfileModal';
import ExpenseModal from './components/modals/ExpenseModal';

const SINGLE_SHOP_ID = 'single-shop';

export default function MtaaniPOS() {
  const isPhoneUi = usePhoneUi();
  const visualViewport = useVisualViewport();
  const {
    activeTab, navigateToTab,
    isMoreMenuOpen, setIsMoreMenuOpen,
    toggleCart,
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
    updateServiceWorker, needRefresh
  } = useMtaaniPOS();
  const { success, error } = useToast();

  const activeBusiness = useLiveQuery(() => activeBusinessId ? db.businesses.get(activeBusinessId) : Promise.resolve(undefined), [activeBusinessId]);
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);
  const activeShop = React.useMemo(() => ({
    id: SINGLE_SHOP_ID,
    name: businessSettings?.storeName || activeBusiness?.name || 'Main shop',
    location: businessSettings?.location || 'Nairobi, Kenya',
    tillNumber: businessSettings?.tillNumber,
    kraPin: businessSettings?.kraPin,
  }), [activeBusiness?.name, businessSettings]);
  const activeShift = useStore(state => state.activeShift);
  const isRegisterTab = activeTab === 'REGISTER';
  const canSeeSalesData = currentUser?.role === 'ADMIN' || currentUser?.role === 'ROOT'
    || (canOpenTab(currentUser, businessSettings, 'DASHBOARD') && !shouldBlurFeature(currentUser, businessSettings, 'dashboard.moneyBreakdown'));

  const openAllowedTab = React.useCallback((tab: any) => {
    if (!canOpenTab(currentUser, businessSettings, String(tab))) {
      error('This window is locked for this account.');
      return;
    }
    navigateToTab(tab);
  }, [businessSettings, currentUser, error, navigateToTab]);
  const activeTabLocked = !!currentUser && !canOpenTab(currentUser, businessSettings, activeTab);

  React.useEffect(() => {
    if (activeBusinessId && !activeShopId) setActiveShopId(SINGLE_SHOP_ID);
  }, [activeBusinessId, activeShopId, setActiveShopId]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.toggleAttribute('data-keyboard-open', isPhoneUi && visualViewport.isKeyboardOpen);
    root.style.setProperty('--visual-viewport-height', visualViewport.height ? `${visualViewport.height}px` : '100dvh');
    root.style.setProperty('--visual-viewport-offset-top', `${visualViewport.offsetTop || 0}px`);
    root.style.setProperty('--visual-keyboard-inset', `${visualViewport.keyboardInset || 0}px`);
    return () => {
      root.removeAttribute('data-keyboard-open');
      root.style.removeProperty('--visual-viewport-height');
      root.style.removeProperty('--visual-viewport-offset-top');
      root.style.removeProperty('--visual-keyboard-inset');
    };
  }, [isPhoneUi, visualViewport.height, visualViewport.isKeyboardOpen, visualViewport.keyboardInset, visualViewport.offsetTop]);

  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'General',
    source: 'TILL' as 'TILL' | 'ACCOUNT',
    accountId: '',
  });
  const [isSavingExpense, setIsSavingExpense] = useState(false);

  React.useEffect(() => {
    const busyText = /\b(saving|loading|working|printing|exporting|generating|waiting|sending|syncing|processing|logging)\b/i;
    const updateBusyButtons = () => {
      document.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
        const autoBusy = button.dataset.autoBusy === 'true';
        const inferredBusy = button.disabled && busyText.test(button.textContent || '');
        const manuallyBusy = !autoBusy && (button.dataset.busy === 'true' || button.getAttribute('aria-busy') === 'true');

        if (autoBusy && !inferredBusy) {
          delete button.dataset.autoBusy;
          if (button.dataset.busy === 'true') delete button.dataset.busy;
          if (button.getAttribute('aria-busy') === 'true') button.removeAttribute('aria-busy');
          return;
        }
        if (manuallyBusy || autoBusy || !inferredBusy) return;

        button.dataset.autoBusy = 'true';
        button.dataset.busy = 'true';
        button.setAttribute('aria-busy', 'true');
      });
    };

    updateBusyButtons();
    const observer = new MutationObserver(updateBusyButtons);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['disabled', 'data-busy', 'aria-busy'],
    });
    return () => observer.disconnect();
  }, []);

  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const rawFinancialAccounts = useLiveQuery(() => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const financialAccounts = React.useMemo(
    () => singleFinanceAccount(rawFinancialAccounts || [], activeBusinessId),
    [rawFinancialAccounts, activeBusinessId]
  );
  const transactions = useLiveQuery(() => canSeeSalesData && activeShopId ? db.transactions.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const expenses = useLiveQuery(() => canSeeSalesData && activeShopId ? db.expenses.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const cashPicks = useLiveQuery(() => canSeeSalesData && activeShopId ? db.cashPicks.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const refunds = useLiveQuery(() => canSeeSalesData && activeShopId ? db.refunds.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const supplierPayments = useLiveQuery(() => canSeeSalesData && activeShopId ? db.supplierPayments.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const customerPayments = useLiveQuery(() => canSeeSalesData && activeShopId ? db.customerPayments.where('shopId').equals(activeShopId).toArray() : [], [activeShopId, canSeeSalesData]);
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);
  const shiftCashAvailable = canSeeSalesData ? calculateShiftCashFromSales({
    transactions: transactions || [],
    expenses: expenses || [],
    cashPicks: cashPicks || [],
    refunds: refunds || [],
    supplierPayments: supplierPayments || [],
    customerPayments: customerPayments || [],
    since: getCurrentShiftStart(activeShift, getTodayStartMs()),
    shiftId: currentShiftId,
  }).availableCashSales : 0;

  const handleSaveExpense = async () => {
    if (isSavingExpense) return;
    if (!currentUser || !activeBusinessId) return;
    const expenseSource = expenseForm.source === 'ACCOUNT' ? 'ACCOUNT' : 'TILL';
    const amount = Number(expenseForm.amount);
    if (amount <= 0) return error("Invalid amount.");
    if (!canPerform(currentUser, 'expense.create', businessSettings)) return error("You do not have permission to create expenses.");
    if (expenseSource === 'TILL' && !currentShiftId) return error("Open a till shift before paying expenses from the till.");
    if (expenseSource === 'TILL' && canSeeSalesData && amount > shiftCashAvailable) return error("Insufficient cash sales in this shift.");
    if (expenseSource === 'ACCOUNT' && amount > Number(financialAccounts[0]?.balance || 0)) return error("Insufficient balance in the Main account.");

    setIsSavingExpense(true);
    try {
      const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
      const accountId = expenseSource === 'ACCOUNT' ? pickedCashAccountId(activeBusinessId) : undefined;
      const expenseRecord = {
        id: crypto.randomUUID(),
        amount,
        category: expenseForm.category || 'General',
        description: expenseForm.description,
        timestamp: Date.now(),
        userName: currentUser.name,
        preparedBy: currentUser.name,
        status: autoApprove ? 'APPROVED' : 'PENDING',
        approvedBy: autoApprove ? currentUser.name : undefined,
        source: expenseSource,
        accountId,
        shiftId: currentShiftId,
        shopId: activeShopId || SINGLE_SHOP_ID,
        businessId: activeBusinessId
      } as any;

      await submitExpenseRecord(expenseRecord);

      recordAuditEvent({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'expense.create',
        entity: 'expense',
        severity: autoApprove ? 'INFO' : 'WARN',
        details: `${autoApprove ? 'Auto-approved' : 'Created pending'} expense for Ksh ${amount.toLocaleString()} (${expenseForm.category || 'General'})`,
      });
      setIsExpenseModalOpen(false);
      setExpenseForm({ description: '', amount: '', category: 'General', source: 'TILL', accountId: '' });
      success(autoApprove ? "Expense logged and approved." : "Expense logged successfully.");
    } catch (err: any) {
      error("Failed to log expense: " + err.message);
    } finally {
      setIsSavingExpense(false);
    }
  };

  if (isSystemAdmin) {
    return <SystemManagerDashboard onLogout={handleLogout} />;
  }

  if (!currentUser) {
    return (
      <LoginScreen 
        businessCode={businessCode} setBusinessCode={setBusinessCode}
        username={username} setUsername={setUsername}
        password={password} setPassword={setPassword}
        handleLogin={handleLogin} isLoggingIn={isLoggingIn}
        loginError={loginError} isOnline={isOnline}
      />
    );
  }

  return (
    <div className={`flex h-[100dvh] overflow-hidden font-hanken ${isPhoneUi ? 'bg-slate-100' : 'bg-slate-50'}`}>
      {!isPhoneUi && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={openAllowedTab}
          onLogout={handleLogout}
          onSync={handleSync}
          isSyncing={isSyncing}
          currentUser={currentUser}
          businessSettings={businessSettings}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />
      )}
      
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        {isPhoneUi ? (
          <TopHeaderMobile
            activeBusiness={activeBusiness}
            activeShop={activeShop}
            isSyncing={isSyncing}
            onSync={handleSync}
            isOnline={isOnline}
            onOpenProfile={() => setIsProfileModalOpen(true)}
            currentUser={currentUser}
          />
        ) : (
          <TopHeaderDesktop
            activeBusiness={activeBusiness}
            activeShop={activeShop}
            isSyncing={isSyncing}
            onSync={handleSync}
            isOnline={isOnline}
            onOpenProfile={() => setIsProfileModalOpen(true)}
            currentUser={currentUser}
          />
        )}

        <main className={`flex-1 main-scroll app-safe-scroll relative ${isPhoneUi ? 'bg-slate-100' : 'bg-transparent'} ${isRegisterTab ? 'overflow-y-auto p-0' : isPhoneUi ? 'overflow-y-auto p-3 pb-28 sm:p-4 sm:pb-28' : 'overflow-y-auto p-8 pb-6'}`}>
          <div className={isRegisterTab ? 'h-full min-h-0' : 'max-w-[1440px] mx-auto min-h-full'}>
            {activeTabLocked ? (
              <div className="flex min-h-[60vh] items-center justify-center p-4 text-center">
                <div className="max-w-sm rounded-lg border-2 border-slate-200 bg-white p-6 shadow-sm">
                  <p className="text-[11px] font-black uppercase tracking-widest text-rose-600">Window locked</p>
                  <h2 className="mt-2 text-xl font-black text-slate-950">Admin has locked this window</h2>
                  <p className="mt-2 text-sm font-semibold text-slate-500">Ask an admin to open Access controls if this account needs it.</p>
                </div>
              </div>
            ) : (
              <>
                {activeTab === 'REGISTER' && <RegisterTab toggleCart={toggleCart} handleCheckout={handleCheckout} setActiveTab={openAllowedTab} />}
                {activeTab === 'DASHBOARD' && <DashboardTab setActiveTab={openAllowedTab} openExpenseModal={() => setIsExpenseModalOpen(true)} />}
                {activeTab === 'TILLS' && <TillsTab />}
                {activeTab === 'INVENTORY' && <InventoryTab />}
                {activeTab === 'CUSTOMERS' && <CustomersTab />}
                {activeTab === 'SUPPLIERS' && <SuppliersTab setActiveTab={openAllowedTab} />}
                {activeTab === 'PURCHASES' && <PurchasesTab />}
                {activeTab === 'INVOICES' && <SalesInvoicesTab />}
                {activeTab === 'EXPENSES' && <ExpensesTab />}
                {activeTab === 'MAIN_ACCOUNT' && <MainAccountTab />}
                {activeTab === 'SUPPLIER_PAYMENTS' && <SupplierPaymentsTab financialAccounts={financialAccounts || []} />}
                {activeTab === 'REFUNDS' && <RefundsTab setActiveTab={openAllowedTab} />}
                {activeTab === 'DOCUMENTS' && <DocumentsTab />}
                {activeTab === 'HR' && <HRTab />}
                {activeTab === 'REPORTS' && <ReportsTab />}
                {activeTab === 'SETTINGS' && <SettingsTab updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
                {activeTab === 'ADMIN_PANEL' && <AdminPanel />}
              </>
            )}
          </div>
        </main>

        {isPhoneUi && (
          <MobileNav
            activeTab={activeTab}
            onTabChange={openAllowedTab}
            onToggleMore={setIsMoreMenuOpen}
            isMoreMenuOpen={isMoreMenuOpen}
            currentUser={currentUser}
            businessSettings={businessSettings}
          />
        )}

        {isPhoneUi && activeTab !== 'REGISTER' && canOpenTab(currentUser, businessSettings, 'REGISTER') && (
          <MobileRegisterFab onClick={() => openAllowedTab('REGISTER')} />
        )}

      </div>

      {isPhoneUi && isMoreMenuOpen && (
        <MoreOptionsMenu 
          onTabChange={openAllowedTab}
          onLogout={handleLogout}
          onClose={() => setIsMoreMenuOpen(false)}
          currentUser={currentUser}
          businessSettings={businessSettings}
        />
      )}

      <ProfileModal isOpen={isProfileModalOpen} onClose={() => setIsProfileModalOpen(false)} currentUser={currentUser} />
      <ExpenseModal 
        isOpen={isExpenseModalOpen} 
        onClose={() => setIsExpenseModalOpen(false)} 
        expenseForm={expenseForm} 
        setExpenseForm={setExpenseForm} 
        handleSaveExpense={handleSaveExpense}
        isSaving={isSavingExpense}
        actualCashDrawer={shiftCashAvailable}
        accounts={expenseAccounts || []} 
        financialAccounts={financialAccounts || []} 
      />
    </div>
  );
}
