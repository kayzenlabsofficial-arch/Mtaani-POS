import React, { useState } from 'react';
import { useLiveQuery } from './clouddb';
import { db } from './db';
import { useMtaaniPOS } from './hooks/useMtaaniPOS';

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

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
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
    activeBusinessId, activeBranchId,
    updateServiceWorker, needRefresh
  } = useMtaaniPOS();

  const branches = useLiveQuery(() => activeBusinessId ? db.branches.where('businessId').equals(activeBusinessId).toArray() : [], [activeBusinessId]);
  const activeBranch = branches?.find(b => b.id === activeBranchId);

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
    <div className="flex h-screen bg-background overflow-hidden font-hanken">
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
          activeBranch={activeBranch}
          isSyncing={isSyncing}
          onSync={handleSync}
          isOnline={isOnline}
          onOpenProfile={() => setIsProfileModalOpen(true)}
        />

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
        handleSaveExpense={() => {}} 
        actualCashDrawer={0} 
        accounts={expenseAccounts || []} 
        financialAccounts={financialAccounts || []} 
        products={products || []} 
      />
    </div>
  );
}
