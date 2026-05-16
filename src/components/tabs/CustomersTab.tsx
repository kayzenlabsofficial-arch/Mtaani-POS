import React, { useState } from 'react';
import { Search, Plus, Users, Phone, Mail, ChevronRight, X, User, Trash2, Smartphone, Loader2, CheckCircle2, Save, ArrowLeft, ReceiptText, FileDown, WalletCards, Banknote } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Customer, type CustomerPayment, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { MpesaService } from '../../services/mpesa';


export default function CustomersTab() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' });
  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'CASH' as CustomerPayment['paymentMethod'],
    reference: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeBranchId = useStore(state => state.activeBranchId);
  const currentUser = useStore(state => state.currentUser);
  const { success, error, info } = useToast();

  const [mpesaState, setMpesaState] = useState<'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED'>('IDLE');
  const [mpesaRequestId, setMpesaRequestId] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');

  React.useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (statementCustomerId && !event.state?.customerStatementId) {
        setStatementCustomerId(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [statementCustomerId]);

  const allCustomers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const statementSales = useLiveQuery(
    () => statementCustomerId && activeBranchId
      ? db.transactions.where('branchId').equals(activeBranchId).and(t => t.customerId === statementCustomerId).toArray()
      : Promise.resolve([]),
    [statementCustomerId, activeBranchId],
    []
  );
  const statementPayments = useLiveQuery(
    () => statementCustomerId && activeBranchId
      ? db.customerPayments.where('branchId').equals(activeBranchId).and(p => p.customerId === statementCustomerId).toArray()
      : Promise.resolve([]),
    [statementCustomerId, activeBranchId],
    []
  );

  if (!allCustomers) {
      return (
          <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4">
              <div className="w-16 h-16 bg-slate-100 rounded-3xl flex items-center justify-center animate-spin-slow">
                  <Users size={32} className="text-slate-300" />
              </div>
              <p className="text-slate-400 font-black text-[10px] uppercase tracking-widest">Loading CRM...</p>
          </div>
      );
  }

  const filteredCustomers = allCustomers.filter(c => 
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
      c.phone.includes(customerSearch)
  );

  const totalCredit = allCustomers.reduce((sum, c) => sum + (c.balance || 0), 0);
  const activeClients = allCustomers.length;
  const highValueClients = allCustomers.filter(c => c.totalSpent > 10000).length;
  const statementCustomer = statementCustomerId ? allCustomers.find(c => c.id === statementCustomerId) || null : null;

  const getCreditAmount = (sale: Transaction) => {
    if (sale.paymentMethod === 'CREDIT') return Number(sale.total || 0);
    if (sale.paymentMethod === 'SPLIT' && sale.splitPayments?.secondaryMethod === 'CREDIT') {
      return Number(sale.splitPayments.secondaryAmount || 0);
    }
    return 0;
  };

  const creditSales = (statementSales || [])
    .filter(sale => getCreditAmount(sale) > 0 && sale.status !== 'VOIDED')
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const totalCreditSales = creditSales.reduce((sum, sale) => sum + getCreditAmount(sale), 0);
  const totalPayments = (statementPayments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const statementRows = [
    ...creditSales.map(sale => ({
      id: sale.id,
      timestamp: sale.timestamp,
      type: 'SALE' as const,
      title: `Sale ${sale.id.split('-')[0].toUpperCase()}`,
      detail: sale.items.map(item => `${item.name} x ${item.quantity}`).join(', '),
      debit: getCreditAmount(sale),
      credit: 0,
      method: sale.paymentMethod || 'CREDIT',
    })),
    ...(statementPayments || []).map(payment => ({
      id: payment.id,
      timestamp: payment.timestamp,
      type: 'PAYMENT' as const,
      title: payment.reference || 'Customer payment',
      detail: payment.transactionCode || payment.paymentMethod,
      debit: 0,
      credit: Number(payment.amount || 0),
      method: payment.paymentMethod,
    })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  const openAddCustomer = () => {
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', email: '' });
      setIsCustomerModalOpen(true);
  }

  const openStatement = (customer: Customer) => {
      window.history.pushState({ ...(window.history.state || {}), mtaaniTab: true, tab: 'CUSTOMERS', customerStatementId: customer.id }, '');
      setStatementCustomerId(customer.id);
      setPaymentForm({ amount: customer.balance > 0 ? String(customer.balance) : '', method: 'CASH', reference: '' });
  }

  const openEditCustomer = (c: Customer) => {
      setEditingCustomer(c);
      setCustomerForm({ name: c.name, phone: c.phone, email: c.email });
      setIsCustomerModalOpen(true);
  }

  const handleSaveCustomer = async () => {
      if (isSaving) return;
      setIsSaving(true);
      try {
        if (editingCustomer) {
            await db.customers.update(editingCustomer.id, { ...customerForm });
            success("Customer updated.");
        } else {
            await db.customers.add({ id: crypto.randomUUID(), ...customerForm, totalSpent: 0, balance: 0, branchId: activeBranchId!, businessId: activeBusinessId! } as any);
            success("Customer added.");
        }
        setIsCustomerModalOpen(false);
      } catch (err: any) {
        error("Failed to save customer: " + err.message);
      } finally {
        setIsSaving(false);
      }
  }

  const handleDeleteCustomer = async () => {
    if (isSaving) return;
    if (editingCustomer && confirm(`Are you sure you want to delete ${editingCustomer.name}?`)) {
      setIsSaving(true);
      try {
        await db.customers.delete(editingCustomer.id);
        setIsCustomerModalOpen(false);
        success("Customer removed.");
      } catch (err: any) {
        error("Failed to delete customer: " + err.message);
      } finally {
        setIsSaving(false);
      }
    }
  }

  const handleMpesaRepayment = async () => {
    if (!editingCustomer || !repaymentAmount) return;
    const amount = Number(repaymentAmount);
    if (isNaN(amount) || amount <= 0) return error("Invalid amount");

    const activeBranchId = useStore.getState().activeBranchId;

    setMpesaState('PUSHING');
    try {
      const res = await MpesaService.triggerStkPush(editingCustomer.phone, amount, `REPAY-${editingCustomer.name.substring(0,5)}`, activeBusinessId!, activeBranchId!);
      if (res.success && res.checkoutRequestId) {
        setMpesaRequestId(res.checkoutRequestId);
        setMpesaState('POLLING');
        startPolling(res.checkoutRequestId, amount);
      } else {
        setMpesaState('FAILED');
        error(res.error || "STK Push failed");
      }
    } catch (err) {
      setMpesaState('FAILED');
      error("Connection failed");
    }
  }

  const startPolling = (requestId: string, amount: number) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      attempts++;
      if (attempts > 12) {
        clearInterval(interval);
        setMpesaState('FAILED');
        error("Payment timeout. Check M-Pesa message.");
        return;
      }

      const res = await MpesaService.checkStatus(requestId);
      if (res.found && res.resultCode === 0) {
        clearInterval(interval);
        setMpesaState('SUCCESS');
        
        if (editingCustomer) {
          const newBalance = Math.max(0, editingCustomer.balance - amount);
          await db.customerPayments.add({
            id: crypto.randomUUID(),
            customerId: editingCustomer.id,
            amount,
            paymentMethod: 'MPESA',
            transactionCode: res.receiptNumber || requestId,
            reference: `M-Pesa repayment from ${editingCustomer.name}`,
            timestamp: Date.now(),
            preparedBy: currentUser?.name,
            branchId: activeBranchId!,
            businessId: activeBusinessId!,
          });
          await db.customers.update(editingCustomer.id, { balance: newBalance });
          success(`Ksh ${amount} received! New balance: Ksh ${newBalance}`);
        }
        
        setTimeout(() => {
          setMpesaState('IDLE');
          setRepaymentAmount('');
        }, 3000);
      } else if (res.found && res.resultCode !== 0) {
        clearInterval(interval);
        setMpesaState('FAILED');
        error(res.resultDesc || "Payment failed");
      }
    }, 5000);
  }

  const handleRecordPayment = async () => {
    if (!statementCustomer || isSaving) return;
    const amount = Number(paymentForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) return error("Enter a valid payment amount.");
    if (!activeBusinessId || !activeBranchId) return error("Select a branch before recording payment.");
    if (amount > (statementCustomer.balance || 0) + 0.01) return error("Payment cannot exceed the customer balance.");

    setIsSaving(true);
    try {
      await db.customerPayments.add({
        id: crypto.randomUUID(),
        customerId: statementCustomer.id,
        amount,
        paymentMethod: paymentForm.method,
        transactionCode: paymentForm.reference.trim() || undefined,
        reference: `${paymentForm.method} payment from ${statementCustomer.name}`,
        timestamp: Date.now(),
        preparedBy: currentUser?.name,
        branchId: activeBranchId,
        businessId: activeBusinessId,
      });
      await db.customers.update(statementCustomer.id, {
        balance: Math.max(0, Number(statementCustomer.balance || 0) - amount),
        updated_at: Date.now(),
      });
      setPaymentForm({ amount: '', method: 'CASH', reference: '' });
      success(amount >= (statementCustomer.balance || 0) ? "Customer balance cleared." : "Payment recorded.");
    } catch (err: any) {
      error("Failed to record payment: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportStatement = async () => {
    if (!statementCustomer) return;
    try {
      const { generateAndDownloadCustomerStatement } = await import('../../utils/shareUtils');
      await generateAndDownloadCustomerStatement(statementCustomer, creditSales, statementPayments || []);
      success("Customer statement exported.");
    } catch (err) {
      console.error('Customer statement export failed', err);
      error("Failed to export customer statement.");
    }
  };

  if (statementCustomer) {
    return (
      <div className="pb-28 md:pb-8 animate-in fade-in w-full">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <button onClick={() => {
              if (window.history.state?.customerStatementId) window.history.back();
              else setStatementCustomerId(null);
            }} className="mb-4 inline-flex items-center gap-2 text-[11px] font-black text-slate-500 hover:text-primary uppercase tracking-widest">
              <ArrowLeft size={16} /> Customers
            </button>
            <h2 className="text-xl font-black text-slate-900 truncate">{statementCustomer.name}</h2>
            <div className="flex flex-wrap items-center gap-3 mt-1 text-[10px] font-bold text-slate-500">
              <span className="flex items-center gap-1"><Phone size={12} /> {statementCustomer.phone || 'No phone'}</span>
              {statementCustomer.email && <span>{statementCustomer.email}</span>}
              <span className={statementCustomer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}>
                Balance: Ksh {(statementCustomer.balance || 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openEditCustomer(statementCustomer)} className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-50 flex items-center gap-2">
              <User size={15} /> Profile
            </button>
            <button onClick={handleExportStatement} className="px-4 py-2.5 bg-primary text-white rounded-xl font-black text-[10px] uppercase tracking-widest shadow-blue flex items-center gap-2">
              <FileDown size={15} /> Statement
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Credit Sales</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">Ksh {totalCreditSales.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Payments</p>
            <p className="text-2xl font-black text-emerald-600 tabular-nums">Ksh {totalPayments.toLocaleString()}</p>
          </div>
          <div className="bg-white border border-slate-100 rounded-2xl p-5">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Outstanding</p>
            <p className={`text-2xl font-black tabular-nums ${statementCustomer.balance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Ksh {(statementCustomer.balance || 0).toLocaleString()}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <section className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-slate-900">Credit Statement</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sales on credit and customer payments</p>
              </div>
              <ReceiptText className="text-slate-300" size={22} />
            </div>
            <div className="divide-y divide-slate-100">
              {statementRows.length === 0 ? (
                <div className="py-20 text-center text-slate-400">
                  <WalletCards size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-bold">No credit activity for this customer.</p>
                </div>
              ) : statementRows.map(row => (
                <div key={`${row.type}-${row.id}`} className="px-4 sm:px-5 py-4 grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 items-center">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${row.type === 'PAYMENT' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {row.type === 'PAYMENT' ? <Banknote size={18} /> : <ReceiptText size={18} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900 truncate">{row.title}</p>
                    <p className="text-[10px] font-bold text-slate-400 truncate">
                      {new Date(row.timestamp).toLocaleString()} - {row.detail || row.method}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-black tabular-nums whitespace-nowrap ${row.type === 'PAYMENT' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {row.type === 'PAYMENT' ? '-' : '+'} Ksh {(row.credit || row.debit).toLocaleString()}
                    </p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{row.type}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="bg-white border border-slate-100 rounded-2xl p-5 h-fit">
            <h3 className="text-sm font-black text-slate-900 mb-1">Clear Balance</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">Record full or partial customer payment</p>
            <div className="space-y-3">
              <input
                type="number"
                value={paymentForm.amount}
                onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="Amount received"
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-black outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <select
                value={paymentForm.method}
                onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as CustomerPayment['paymentMethod'] })}
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-black text-slate-700 outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
                <option value="PDQ">PDQ</option>
                <option value="BANK">Bank</option>
                <option value="CHEQUE">Cheque</option>
              </select>
              <input
                value={paymentForm.reference}
                onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder="Reference or transaction code"
                className="w-full h-12 rounded-xl bg-slate-50 border border-slate-200 px-4 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <button
                onClick={handleRecordPayment}
                disabled={isSaving || !paymentForm.amount || statementCustomer.balance <= 0}
                className="w-full h-12 rounded-xl bg-emerald-600 text-white font-black text-[10px] uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2 shadow-green"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {Number(paymentForm.amount) >= statementCustomer.balance ? 'Clear Balance' : 'Record Payment'}
              </button>
            </div>
          </aside>
        </div>

        {isCustomerModalOpen && (
          <CustomerProfileModal
            editingCustomer={editingCustomer}
            isAdmin={isAdmin}
            isSaving={isSaving}
            customerForm={customerForm}
            setCustomerForm={setCustomerForm}
            onClose={() => setIsCustomerModalOpen(false)}
            onDelete={handleDeleteCustomer}
            onSave={handleSaveCustomer}
            repaymentAmount={repaymentAmount}
            setRepaymentAmount={setRepaymentAmount}
            mpesaState={mpesaState}
            onMpesaRepayment={handleMpesaRepayment}
          />
        )}
      </div>
    );
  }

  return (
    <div className="pb-24 animate-in fade-in w-full">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-black text-slate-900">Client Directory</h2>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] font-bold text-slate-500">{activeClients} clients</span>
            <span className="text-slate-300">·</span>
            <span className={`text-[10px] font-bold ${totalCredit > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
              Ksh {totalCredit.toLocaleString()} debt
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-[10px] font-bold text-amber-600">
              {highValueClients} High-Value
            </span>
          </div>
        </div>
        <button
          onClick={openAddCustomer}
          className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:bg-blue-700 active:scale-[0.98] transition-all self-start"
        >
          <Plus size={18} /> Add New Client
        </button>
      </div>

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by client name or mobile number..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary/15 focus:border-primary outline-none shadow-sm transition-all"
          />
          {customerSearch && (
            <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Client List */}
      <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
         {filteredCustomers.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {filteredCustomers.map(customer => (
               <button
                 key={customer.id}
                 type="button"
                 onClick={() => openStatement(customer)}
                 className="w-full text-left px-3 sm:px-5 py-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 hover:bg-indigo-50/40 transition-colors group"
               >
                 <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                   <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 font-black text-sm">
                     {customer.name.substring(0, 1).toUpperCase()}
                   </div>
                   <div className="stable-row-copy">
                     <h4 className="text-sm font-black text-slate-900 stable-title leading-tight">{customer.name}</h4>
                     <div className="flex items-center gap-2 mt-1 overflow-hidden">
                       <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 flex-shrink-0"><Phone size={11} /> {customer.phone}</span>
                       {customer.email && <span className="text-[10px] font-bold text-slate-300 stable-meta">{customer.email}</span>}
                     </div>
                   </div>
                 </div>
                 <div className="stable-actions flex items-center gap-3">
                   <div className="hidden sm:block text-right">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Spent</p>
                     <p className="text-sm font-black text-indigo-600 tabular-nums whitespace-nowrap">Ksh {customer.totalSpent.toLocaleString()}</p>
                   </div>
                   <div className="text-right min-w-[80px]">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Debt</p>
                     <p className={`text-sm font-black tabular-nums whitespace-nowrap ${customer.balance > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                       {customer.balance > 0 ? `Ksh ${customer.balance.toLocaleString()}` : 'Clean'}
                     </p>
                   </div>
                   <ChevronRight size={18} className="hidden sm:block text-slate-300 group-hover:text-indigo-500 transition-colors shrink-0" />
                 </div>
               </button>
             ))}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="w-20 h-20 bg-slate-50 rounded-3xl flex items-center justify-center mb-4 shadow-inner text-slate-200">
               <Users size={36} />
             </div>
             <p className="text-slate-500 font-black text-base">No client records found</p>
             <p className="text-slate-400 text-[10px] mt-1 font-bold uppercase tracking-widest">Adjust filters or add a new relationship</p>
           </div>
         )}
      </div>

      {/* Customer Modal */}
      {isCustomerModalOpen && (
        <CustomerProfileModal
          editingCustomer={editingCustomer}
          isAdmin={isAdmin}
          isSaving={isSaving}
          customerForm={customerForm}
          setCustomerForm={setCustomerForm}
          onClose={() => setIsCustomerModalOpen(false)}
          onDelete={handleDeleteCustomer}
          onSave={handleSaveCustomer}
          repaymentAmount={repaymentAmount}
          setRepaymentAmount={setRepaymentAmount}
          mpesaState={mpesaState}
          onMpesaRepayment={handleMpesaRepayment}
        />
      )}
    </div>
  );
}

function CustomerProfileModal({
  editingCustomer,
  isAdmin,
  isSaving,
  customerForm,
  setCustomerForm,
  onClose,
  onDelete,
  onSave,
  repaymentAmount,
  setRepaymentAmount,
  mpesaState,
  onMpesaRepayment,
}: {
  editingCustomer: Customer | null;
  isAdmin: boolean;
  isSaving: boolean;
  customerForm: { name: string; phone: string; email: string };
  setCustomerForm: React.Dispatch<React.SetStateAction<{ name: string; phone: string; email: string }>>;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  repaymentAmount: string;
  setRepaymentAmount: React.Dispatch<React.SetStateAction<string>>;
  mpesaState: 'IDLE' | 'PUSHING' | 'POLLING' | 'SUCCESS' | 'FAILED';
  onMpesaRepayment: () => void;
}) {
  return (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4 pb-safe">
           <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
           <div className="bg-white w-full max-w-md rounded-t-[40px] sm:rounded-[2.5rem] shadow-elevated relative z-10 flex flex-col p-8 animate-in slide-in-from-bottom-full sm:zoom-in-95 duration-300 max-h-[95vh] overflow-y-auto no-scrollbar">
              <div className="w-12 h-1.5 bg-slate-100 rounded-full mx-auto mb-8 sm:hidden shrink-0" />
              
              <div className="flex items-center justify-between mb-8 shrink-0">
                 <div className="flex items-center gap-4">
                   <div className="w-12 h-12 grad-blue rounded-2xl flex items-center justify-center text-white shadow-blue">
                     <User size={24} />
                   </div>
                   <div>
                     <h2 className="text-xl font-black text-slate-900 tracking-tight">{editingCustomer ? 'Client Profile' : 'New Client'}</h2>
                     <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">CRM Record Management</p>
                   </div>
                 </div>
                 {editingCustomer && isAdmin && (
                    <button onClick={onDelete} className="w-10 h-10 flex items-center justify-center rounded-xl bg-rose-50 text-rose-500 hover:bg-rose-500 hover:text-white transition-all press">
                      <Trash2 size={20} />
                    </button>
                  )}
              </div>

              <div className="space-y-6 mb-10">
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Legal Full Name</label>
                    <input type="text" value={customerForm.name} onChange={e => setCustomerForm({...customerForm, name: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl px-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="e.g. Samuel Maina" />
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Mobile Contact</label>
                    <div className="relative">
                       <input type="text" value={customerForm.phone} onChange={e => setCustomerForm({...customerForm, phone: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="0700 000 000" />
                       <Phone className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    </div>
                 </div>
                 <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 ml-2">Email Address</label>
                    <div className="relative">
                       <input type="email" value={customerForm.email} onChange={e => setCustomerForm({...customerForm, email: e.target.value})} className="w-full bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-2xl pl-14 pr-6 py-4.5 text-sm font-black text-slate-900 outline-none transition-all shadow-sm" placeholder="client@example.com" />
                       <Mail className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    </div>
                 </div>

                  {editingCustomer && editingCustomer.balance > 0 && (
                    <div className="pt-8 mt-4 border-t-2 border-slate-50">
                       <div className="flex items-center justify-between mb-4">
                          <h4 className="text-[11px] font-black text-indigo-600 uppercase tracking-[0.1em] flex items-center gap-2">
                             <Smartphone size={14} /> Repay Debt via M-Pesa
                          </h4>
                          <span className="text-[10px] font-black text-rose-500 bg-rose-50 px-3 py-1 rounded-full">Ksh {editingCustomer.balance.toLocaleString()} Owed</span>
                       </div>
                       
                       {mpesaState === 'IDLE' || mpesaState === 'FAILED' ? (
                         <div className="flex gap-3">
                            <div className="relative flex-1">
                               <input 
                                type="number" 
                                value={repaymentAmount}
                                onChange={e => setRepaymentAmount(e.target.value)}
                                placeholder="Amount to pay..."
                                className="w-full bg-slate-50 border-2 border-transparent focus:border-emerald-500 focus:bg-white rounded-2xl px-5 py-4 text-sm font-black text-slate-900 outline-none transition-all shadow-sm"
                               />
                               <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-300">KSH</span>
                            </div>
                            <button 
                              onClick={onMpesaRepayment}
                              className="px-6 py-4 bg-emerald-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest shadow-emerald active:scale-95 transition-all flex items-center gap-2"
                            >
                              Push
                            </button>
                         </div>
                       ) : (
                         <div className="bg-slate-50/50 p-6 rounded-[1.5rem] border-2 border-indigo-50 flex items-center justify-center gap-4">
                            {mpesaState === 'SUCCESS' ? (
                               <CheckCircle2 className="text-emerald-500 animate-bounce-in" size={24} />
                            ) : (
                               <Loader2 className="text-indigo-600 animate-spin" size={24} />
                            )}
                            <span className="text-[10px] font-black text-slate-600 uppercase tracking-widest">
                               {mpesaState === 'PUSHING' ? 'Sending STK Prompt...' : 
                                mpesaState === 'POLLING' ? 'Awaiting Customer PIN...' : 
                                mpesaState === 'SUCCESS' ? 'Repayment Confirmed!' : 'Processing...'}
                            </span>
                         </div>
                       )}
                    </div>
                  )}
               </div>

              <div className="flex gap-4 mt-auto">
                 <button onClick={onClose} disabled={isSaving} className="flex-1 px-8 py-5 bg-slate-100 text-slate-500 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl transition-all press disabled:opacity-50">
                   Dismiss
                 </button>
                 <button onClick={onSave} disabled={!customerForm.name || isSaving} className="flex-[2] grad-blue text-white px-8 py-5 font-black text-[10px] uppercase tracking-[0.15em] rounded-2xl disabled:opacity-40 transition-all shadow-blue press flex items-center justify-center gap-3">
                   {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                   {isSaving ? 'Processing...' : 'Save Record'}
                 </button>
              </div>
           </div>
        </div>
  );
}
