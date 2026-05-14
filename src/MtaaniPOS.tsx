import React, { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import { useLiveQuery } from './clouddb';
import { db } from './db';
import { useMtaaniPOS } from './hooks/useMtaaniPOS';
import { useToast } from './context/ToastContext';
import { canPerform } from './utils/accessControl';
import { recordAuditEvent } from './utils/auditLog';
import { applyApprovedExpenseEffects, ensureExpenseCanBeApproved } from './utils/approvalWorkflows';
import { shouldAutoApproveOwnerAction } from './utils/ownerMode';

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

// Layout & Shell
import Sidebar from './components/shared/Sidebar';
import { TopHeader, MobileNav, MoreOptionsMenu } from './components/layout/Shell';
import { LoginScreen } from './components/auth/LoginScreen';
import SystemManagerDashboard from './components/admin/SystemManager';

// Modals
import ProfileModal from './components/modals/ProfileModal';
import ExpenseModal from './components/modals/ExpenseModal';

const MaterialIcon = ({ name, className = "", style }: { name: string, className?: string, style?: React.CSSProperties }) => (
  <ShoppingCart className={className} style={style} size={28} strokeWidth={2.4} aria-label={name} />
);

export default function MtaaniPOS() {
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
    activeBusinessId, activeBranchId, setActiveBranchId,
    handleCheckout,
    updateServiceWorker, needRefresh
  } = useMtaaniPOS();
  const { success, error } = useToast();

  const branches = useLiveQuery(() => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const activeBranch = branches?.find(b => b.id === activeBranchId);
  const activeBusiness = useLiveQuery(() => activeBusinessId ? db.businesses.get(activeBusinessId) : Promise.resolve(undefined), [activeBusinessId]);
  const businessSettings = useLiveQuery(() => activeBusinessId ? db.settings.get('core') : Promise.resolve(undefined), [activeBusinessId]);

  const [expenseForm, setExpenseForm] = useState({
    description: '',
    amount: '',
    category: 'General',
    source: 'TILL' as 'TILL' | 'ACCOUNT' | 'SHOP',
    accountId: '',
    financialAccountId: '',
    productId: '',
    quantity: '1'
  });
  const [isSavingExpense, setIsSavingExpense] = useState(false);

  const expenseAccounts = useLiveQuery(() => activeBusinessId ? db.expenseAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const financialAccounts = useLiveQuery(() => activeBusinessId ? db.financialAccounts.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const products = useLiveQuery(() => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const transactions = useLiveQuery(() => activeBranchId ? db.transactions.where('branchId').equals(activeBranchId).toArray() : [], [activeBranchId]);
  const expenses = useLiveQuery(() => activeBranchId ? db.expenses.where('branchId').equals(activeBranchId).toArray() : [], [activeBranchId]);
  const cashPicks = useLiveQuery(() => activeBranchId ? db.cashPicks.where('branchId').equals(activeBranchId).toArray() : [], [activeBranchId]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cashSalesToday = (transactions || [])
    .filter(t => (t.timestamp || 0) >= todayStart.getTime() && t.status === 'PAID' && t.paymentMethod === 'CASH')
    .reduce((sum, t) => sum + (t.total || 0), 0);
  const tillExpensesToday = (expenses || [])
    .filter(e => (e.timestamp || 0) >= todayStart.getTime() && e.source === 'TILL')
    .reduce((sum, e) => sum + (e.amount || 0), 0);
  const cashPicksToday = (cashPicks || [])
    .filter(p => (p.timestamp || 0) >= todayStart.getTime())
    .reduce((sum, p) => sum + (p.amount || 0), 0);
  const actualCashDrawer = cashSalesToday - tillExpensesToday - cashPicksToday;

  const handleSaveExpense = async () => {
    if (isSavingExpense) return;
    const amount = Number(expenseForm.amount);
    if (!currentUser || !activeBusinessId || !activeBranchId) return;
    if (amount <= 0) return error("Invalid amount.");
    if (!canPerform(currentUser, 'expense.create')) return error("You do not have permission to create expenses.");
    if (expenseForm.source === 'TILL' && amount > actualCashDrawer) return error("Insufficient cash in drawer.");
    if (expenseForm.source === 'ACCOUNT' && !expenseForm.accountId) return error("Select the account paying this expense.");
    if (expenseForm.source === 'SHOP' && !expenseForm.productId) return error("Select the stock item being expensed.");

    setIsSavingExpense(true);
    try {
      const autoApprove = shouldAutoApproveOwnerAction(businessSettings, currentUser);
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
        source: expenseForm.source,
        accountId: expenseForm.source === 'ACCOUNT' ? expenseForm.accountId : undefined,
        productId: expenseForm.source === 'SHOP' ? expenseForm.productId : undefined,
        quantity: expenseForm.source === 'SHOP' ? Number(expenseForm.quantity || 1) : undefined,
        branchId: activeBranchId,
        businessId: activeBusinessId
      } as any;

      if (autoApprove) {
        await ensureExpenseCanBeApproved(expenseRecord);
      }

      await db.expenses.add(expenseRecord);

      if (autoApprove) {
        try {
          await applyApprovedExpenseEffects(expenseRecord, {
            approvedBy: currentUser.name,
            activeBranchId,
            activeBusinessId
          });
        } catch (err) {
          await db.expenses.update(expenseRecord.id, { status: 'PENDING', approvedBy: undefined });
          throw err;
        }
      }

      recordAuditEvent({
        userId: currentUser.id,
        userName: currentUser.name,
        action: 'expense.create',
        entity: 'expense',
        severity: autoApprove ? 'INFO' : 'WARN',
        details: `${autoApprove ? 'Auto-approved' : 'Created pending'} expense for Ksh ${amount.toLocaleString()} (${expenseForm.category || 'General'})`,
      });
      setIsExpenseModalOpen(false);
      setExpenseForm({ description: '', amount: '', category: 'General', source: 'TILL', accountId: '', financialAccountId: '', productId: '', quantity: '1' });
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
    <div className="flex h-[100dvh] bg-slate-50 overflow-hidden font-hanken">
      <Sidebar 
        activeTab={activeTab} 
        onTabChange={navigateToTab} 
        onLogout={handleLogout}
        onSync={handleSync}
        isSyncing={isSyncing}
        currentUser={currentUser}
        onOpenProfile={() => setIsProfileModalOpen(true)}
      />
      
      <div className="flex-1 flex flex-col min-w-0 relative h-full">
        <TopHeader 
          activeBusiness={activeBusiness}
          activeBranch={activeBranch}
          branches={branches}
          onBranchChange={setActiveBranchId}
          isSyncing={isSyncing}
          onSync={handleSync}
          isOnline={isOnline}
          onOpenProfile={() => setIsProfileModalOpen(true)}
          currentUser={currentUser}
        />

        <main className="flex-1 overflow-y-auto main-scroll app-safe-scroll relative p-3 sm:p-4 md:p-6 lg:p-8">
          <div className="max-w-[1440px] mx-auto min-h-full">
            {activeTab === 'REGISTER' && <RegisterTab toggleCart={toggleCart} handleCheckout={handleCheckout} />}
            {activeTab === 'DASHBOARD' && <DashboardTab setActiveTab={navigateToTab} openExpenseModal={() => setIsExpenseModalOpen(true)} />}
            {activeTab === 'INVENTORY' && <InventoryTab />}
            {activeTab === 'CUSTOMERS' && <CustomersTab />}
            {activeTab === 'SUPPLIERS' && <SuppliersTab setActiveTab={navigateToTab} financialAccounts={financialAccounts || []} />}
            {activeTab === 'PURCHASES' && <PurchasesTab />}
            {activeTab === 'EXPENSES' && <ExpensesTab />}
            {activeTab === 'SUPPLIER_PAYMENTS' && <SupplierPaymentsTab financialAccounts={financialAccounts || []} />}
            {activeTab === 'REFUNDS' && <RefundsTab setActiveTab={navigateToTab} />}
            {activeTab === 'DOCUMENTS' && <DocumentsTab />}
            {activeTab === 'REPORTS' && <ReportsTab />}
            {activeTab === 'ADMIN_PANEL' && <AdminPanel updateServiceWorker={updateServiceWorker} needRefresh={needRefresh} />}
          </div>
        </main>

        <MobileNav 
          activeTab={activeTab}
          onTabChange={navigateToTab}
          onToggleMore={setIsMoreMenuOpen}
          isMoreMenuOpen={isMoreMenuOpen}
        />

        {activeTab !== 'REGISTER' && (
          <button 
            onClick={() => navigateToTab('REGISTER')}
            className="fixed right-6 bottom-24 w-14 h-14 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center active:scale-90 transition-transform md:hidden z-40"
          >
            <MaterialIcon name="add_shopping_cart" style={{ fontSize: '28px' }} />
          </button>
        )}
      </div>

      {isMoreMenuOpen && (
        <MoreOptionsMenu 
          onTabChange={navigateToTab}
          onLogout={handleLogout}
          onClose={() => setIsMoreMenuOpen(false)}
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
        actualCashDrawer={actualCashDrawer}
        accounts={expenseAccounts || []} 
        financialAccounts={financialAccounts || []} 
        products={products || []} 
      />
    </div>
  );
}
