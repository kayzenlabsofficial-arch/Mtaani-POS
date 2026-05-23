import React, { useState } from 'react';
import { Search, Plus, Users, Phone, Mail, ChevronRight, X, User, Trash2, Smartphone, Loader2, CheckCircle2, Save, ArrowLeft, ReceiptText, FileDown, WalletCards, Banknote, FileText, ExternalLink } from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Customer, type CustomerPayment, type SalesInvoice, type Transaction } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { MpesaService } from '../../services/mpesa';
import DocumentDetailsModal from '../modals/DocumentDetailsModal';
import { belongsToActiveShop } from '../../utils/shopScope';
import { CustomerService } from '../../services/customers';
import { getCurrentShiftId } from '../../utils/shiftSession';

type DebtSourceType = 'SALE' | 'INVOICE';
type DebtAllocation = { sourceType: DebtSourceType; sourceId: string; amount: number };
type CustomerDebtSource = {
  id: string;
  sourceType: DebtSourceType;
  recordType: 'SALE' | 'SALES_INVOICE';
  timestamp: number;
  title: string;
  detail: string;
  total: number;
  paid: number;
  remaining: number;
  record: Transaction | SalesInvoice;
};

const money = (value: number) => `Ksh ${Math.max(0, Number(value) || 0).toLocaleString()}`;

function sourceKey(sourceType: DebtSourceType, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

function getPaymentAllocations(payment: CustomerPayment): DebtAllocation[] {
  const raw = (payment as any).allocations;
  const rows = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })()
      : [];
  return rows
    .map((row: any) => ({
      sourceType: String(row?.sourceType || '').toUpperCase() as DebtSourceType,
      sourceId: String(row?.sourceId || '').trim(),
      amount: Number(row?.amount) || 0,
    }))
    .filter(row => (row.sourceType === 'SALE' || row.sourceType === 'INVOICE') && row.sourceId && row.amount > 0);
}

export default function CustomersTab() {
  const [customerSearch, setCustomerSearch] = useState("");
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '', email: '' });
  const [statementCustomerId, setStatementCustomerId] = useState<string | null>(null);
  const todayInput = new Date().toISOString().split('T')[0];
  const [statementDateMode, setStatementDateMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [statementStart, setStatementStart] = useState(todayInput);
  const [statementEnd, setStatementEnd] = useState(todayInput);
  const [statementPage, setStatementPage] = useState(1);
  const [selectedDebtRecord, setSelectedDebtRecord] = useState<any | null>(null);
  const statementPageSize = 50;
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    method: 'CASH' as CustomerPayment['paymentMethod'],
    reference: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const isAdmin = useStore(state => state.isAdmin);
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);
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
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).filter(c => belongsToActiveShop(c, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const statementSales = useLiveQuery(
    () => statementCustomerId && activeBusinessId && activeShopId
      ? db.transactions.where('shopId').equals(activeShopId).and(t => t.businessId === activeBusinessId && t.customerId === statementCustomerId).toArray()
      : Promise.resolve([]),
    [statementCustomerId, activeBusinessId, activeShopId],
    []
  );
  const statementPayments = useLiveQuery(
    () => statementCustomerId && activeBusinessId && activeShopId
      ? db.customerPayments.where('shopId').equals(activeShopId).and(p => p.businessId === activeBusinessId && p.customerId === statementCustomerId).toArray()
      : Promise.resolve([]),
    [statementCustomerId, activeBusinessId, activeShopId],
    []
  );
  const statementInvoices = useLiveQuery(
    () => statementCustomerId && activeBusinessId && activeShopId
      ? db.salesInvoices.where('shopId').equals(activeShopId).and(i => i.businessId === activeBusinessId && i.customerId === statementCustomerId && i.status !== 'CANCELLED').toArray()
      : Promise.resolve([]),
    [statementCustomerId, activeBusinessId, activeShopId],
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
      String(c.name || '').toLowerCase().includes(customerSearch.toLowerCase()) || 
      String(c.phone || '').includes(customerSearch)
  );

  const totalCredit = allCustomers.reduce((sum, c) => sum + Number(c.balance || 0), 0);
  const activeClients = allCustomers.length;
  const highValueClients = allCustomers.filter(c => Number(c.totalSpent || 0) > 10000).length;
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
  const debtBaseSources: Omit<CustomerDebtSource, 'paid' | 'remaining'>[] = [
    ...(statementInvoices || [])
      .filter(invoice => invoice.status !== 'CANCELLED' && Number(invoice.total || 0) > 0)
      .map((invoice: SalesInvoice) => ({
        id: invoice.id,
        sourceType: 'INVOICE' as const,
        recordType: 'SALES_INVOICE' as const,
        timestamp: invoice.issueDate,
        title: invoice.invoiceNumber,
        detail: invoice.items.map(item => `${item.name} x ${item.quantity}`).join(', '),
        total: Number(invoice.total || 0),
        record: invoice,
      })),
    ...creditSales.map((sale: Transaction) => ({
      id: sale.id,
      sourceType: 'SALE' as const,
      recordType: 'SALE' as const,
      timestamp: sale.timestamp,
      title: `Sale ${sale.id.split('-')[0].toUpperCase()}`,
      detail: sale.items.map(item => `${item.name} x ${item.quantity}`).join(', '),
      total: getCreditAmount(sale),
      record: sale,
    })),
  ];
  const sourceMap = new Map(debtBaseSources.map(source => [sourceKey(source.sourceType, source.id), source]));
  const paidBySource = new Map<string, number>();
  const addPaidToSource = (key: string, amount: number) => {
    if (!sourceMap.has(key) || amount <= 0) return 0;
    const source = sourceMap.get(key)!;
    const current = paidBySource.get(key) || 0;
    const applied = Math.min(amount, Math.max(0, source.total - current));
    if (applied > 0) paidBySource.set(key, current + applied);
    return applied;
  };
  const unallocatedPaymentAmounts: number[] = [];
  const paymentsOldestFirst = [...(statementPayments || [])].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (const payment of paymentsOldestFirst) {
    let remainingPayment = Number(payment.amount || 0);
    if (remainingPayment <= 0) continue;

    const allocations = getPaymentAllocations(payment);
    for (const allocation of allocations) {
      const applied = addPaidToSource(sourceKey(allocation.sourceType, allocation.sourceId), allocation.amount);
      remainingPayment = Math.max(0, remainingPayment - applied);
    }

    if (allocations.length === 0) {
      const reference = `${payment.reference || ''} ${payment.transactionCode || ''}`.toLowerCase();
      const matchedInvoice = debtBaseSources.find(source =>
        source.sourceType === 'INVOICE'
        && reference
        && (
          reference.includes(String((source.record as SalesInvoice).invoiceNumber || '').toLowerCase())
          || reference.includes(source.id.toLowerCase())
        )
      );
      if (matchedInvoice) {
        const applied = addPaidToSource(sourceKey('INVOICE', matchedInvoice.id), remainingPayment);
        remainingPayment = Math.max(0, remainingPayment - applied);
      }
    }

    if (remainingPayment > 0) unallocatedPaymentAmounts.push(remainingPayment);
  }

  for (const source of debtBaseSources) {
    if (source.sourceType !== 'INVOICE') continue;
    const key = sourceKey(source.sourceType, source.id);
    const invoicePaid = Number((source.record as SalesInvoice).paidAmount || 0);
    const recordedPaid = paidBySource.get(key) || 0;
    if (invoicePaid > recordedPaid) addPaidToSource(key, invoicePaid - recordedPaid);
  }

  const debtOldestFirst = [...debtBaseSources].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  for (let paymentAmount of unallocatedPaymentAmounts) {
    for (const source of debtOldestFirst) {
      if (paymentAmount <= 0) break;
      paymentAmount = Math.max(0, paymentAmount - addPaidToSource(sourceKey(source.sourceType, source.id), paymentAmount));
    }
  }

  const debtSources: CustomerDebtSource[] = debtBaseSources.map(source => {
    const paid = Math.min(source.total, paidBySource.get(sourceKey(source.sourceType, source.id)) || 0);
    return {
      ...source,
      paid,
      remaining: Math.max(0, source.total - paid),
    };
  }).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  const openDebtSources = debtSources.filter(source => source.remaining > 0.01);
  const openDebtTotal = openDebtSources.reduce((sum, source) => sum + source.remaining, 0);

  const buildPaymentAllocations = (amount: number): DebtAllocation[] => {
    const allocations: DebtAllocation[] = [];
    let remainingPayment = amount;
    for (const source of [...debtSources].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))) {
      if (remainingPayment <= 0) break;
      if (source.remaining <= 0) continue;
      const applied = Math.min(remainingPayment, source.remaining);
      allocations.push({ sourceType: source.sourceType, sourceId: source.id, amount: applied });
      remainingPayment -= applied;
    }
    return allocations;
  };

  const openDebtRecord = (source: CustomerDebtSource) => {
    if (source.sourceType === 'INVOICE') {
      setSelectedDebtRecord({
        ...source.record,
        recordType: 'SALES_INVOICE',
        paidAmount: source.paid,
        balance: source.remaining,
        status: source.remaining <= 0 ? 'PAID' : source.paid > 0 ? 'PARTIAL' : (source.record as SalesInvoice).status,
      });
      return;
    }
    setSelectedDebtRecord({
      ...source.record,
      recordType: 'SALE',
      debtPaidAmount: source.paid,
      debtBalance: source.remaining,
    });
  };
  const inStatementDateRange = (timestamp: number) => {
    if (statementDateMode === 'ALL') return true;
    const start = new Date(statementStart || todayInput);
    start.setHours(0, 0, 0, 0);
    const end = new Date(statementEnd || statementStart || todayInput);
    end.setHours(23, 59, 59, 999);
    return timestamp >= start.getTime() && timestamp <= end.getTime();
  };
  const filteredCreditSales = creditSales.filter(sale => inStatementDateRange(Number(sale.timestamp) || 0));
  const filteredStatementInvoices = (statementInvoices || []).filter(invoice => inStatementDateRange(Number(invoice.issueDate) || 0));
  const filteredStatementPayments = (statementPayments || []).filter(payment => inStatementDateRange(Number(payment.timestamp) || 0));
  const totalCreditSales = filteredCreditSales.reduce((sum, sale) => sum + getCreditAmount(sale), 0)
    + filteredStatementInvoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);
  const totalPayments = filteredStatementPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  const statementRows = [
    ...filteredStatementInvoices.map((invoice: SalesInvoice) => ({
      id: invoice.id,
      timestamp: invoice.issueDate,
      type: 'INVOICE' as const,
      title: invoice.invoiceNumber,
      detail: invoice.items.map(item => `${item.name} x ${item.quantity}`).join(', '),
      debit: Number(invoice.total || 0),
      credit: 0,
      method: invoice.status,
      record: { ...invoice, recordType: 'SALES_INVOICE' as const },
    })),
    ...filteredCreditSales.map(sale => ({
      id: sale.id,
      timestamp: sale.timestamp,
      type: 'SALE' as const,
      title: `Sale ${sale.id.split('-')[0].toUpperCase()}`,
      detail: sale.items.map(item => `${item.name} x ${item.quantity}`).join(', '),
      debit: getCreditAmount(sale),
      credit: 0,
      method: sale.paymentMethod || 'CREDIT',
      record: { ...sale, recordType: 'SALE' as const },
    })),
    ...filteredStatementPayments.map(payment => ({
      id: payment.id,
      timestamp: payment.timestamp,
      type: 'PAYMENT' as const,
      title: payment.reference || 'Customer payment',
      detail: payment.transactionCode || payment.paymentMethod,
      debit: 0,
      credit: Number(payment.amount || 0),
      method: payment.paymentMethod,
      record: null,
    })),
  ].sort((a, b) => b.timestamp - a.timestamp);
  const statementTotalPages = Math.max(1, Math.ceil(statementRows.length / statementPageSize));
  const currentStatementPage = Math.min(statementPage, statementTotalPages);
  const pagedStatementRows = statementRows.slice((currentStatementPage - 1) * statementPageSize, currentStatementPage * statementPageSize);

  React.useEffect(() => {
    setStatementPage(1);
  }, [statementCustomerId, statementDateMode, statementStart, statementEnd]);

  const openAddCustomer = () => {
      setEditingCustomer(null);
      setCustomerForm({ name: '', phone: '', email: '' });
      setIsCustomerModalOpen(true);
  }

  const openStatement = (customer: Customer) => {
      window.history.pushState({ ...(window.history.state || {}), mtaaniTab: true, tab: 'CUSTOMERS', customerStatementId: customer.id }, '');
      setStatementCustomerId(customer.id);
      setStatementDateMode('ALL');
      setStatementPage(1);
      setPaymentForm({ amount: Number(customer.balance || 0) > 0 ? String(customer.balance) : '', method: 'CASH', reference: '' });
  }

  const openEditCustomer = (c: Customer) => {
      setEditingCustomer(c);
      setCustomerForm({ name: c.name || '', phone: c.phone || '', email: c.email || '' });
      setIsCustomerModalOpen(true);
  }

  const handleSaveCustomer = async () => {
      if (isSaving) return;
      if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
      setIsSaving(true);
      try {
        await CustomerService.saveProfile({
            customerId: editingCustomer?.id,
            customer: customerForm,
            businessId: activeBusinessId,
            shopId: activeShopId,
        });
        await db.customers.reload();
        success(editingCustomer ? "Customer updated." : "Customer added.");
        setIsCustomerModalOpen(false);
      } catch (err: any) {
        error("Failed to save customer: " + err.message);
      } finally {
        setIsSaving(false);
      }
  }

  const handleDeleteCustomer = async () => {
    if (isSaving) return;
    if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
    if (editingCustomer && confirm(`Are you sure you want to delete ${editingCustomer.name}?`)) {
      setIsSaving(true);
      try {
        await CustomerService.deleteProfile({
          customerId: editingCustomer.id,
          businessId: activeBusinessId,
          shopId: activeShopId,
        });
        await db.customers.reload();
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

    const activeShopId = useStore.getState().activeShopId;

    setMpesaState('PUSHING');
    try {
      const res = await MpesaService.triggerStkPush(editingCustomer.phone, amount, `REPAY-${editingCustomer.name.substring(0,5)}`, activeBusinessId!, activeShopId!);
      if (res.success && res.checkoutRequestId) {
        setMpesaRequestId(res.checkoutRequestId);
        setMpesaState('POLLING');
        startPolling(res.checkoutRequestId, amount);
      } else {
        setMpesaState('FAILED');
        error(res.error || "Could not send M-Pesa request");
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
          try {
            const paymentResult = await CustomerService.recordPayment({
              customerId: editingCustomer.id,
              amount,
              paymentMethod: 'MPESA',
              transactionCode: res.receiptNumber || requestId,
              reference: `M-Pesa repayment from ${editingCustomer.name}`,
              allocations: statementCustomerId === editingCustomer.id ? buildPaymentAllocations(amount) : [],
              preparedBy: currentUser?.name,
              shiftId: currentShiftId,
              shopId: activeShopId!,
              businessId: activeBusinessId!,
            });
            await Promise.allSettled([
              db.customerPayments.reload(),
              db.customers.reload(),
              db.salesInvoices.reload(),
            ]);
            success(`Ksh ${amount} received! New balance: Ksh ${paymentResult.customerBalance.toLocaleString()}`);
          } catch (err: any) {
            setMpesaState('FAILED');
            error(err?.message || "Payment received but could not update the customer account.");
          }
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
    if (!activeBusinessId || !activeShopId) return error("The shop is still loading. Try again.");
    if (amount > (statementCustomer.balance || 0) + 0.01) return error("Payment cannot exceed the customer balance.");

    setIsSaving(true);
    try {
      const allocations = buildPaymentAllocations(amount);
      await CustomerService.recordPayment({
        customerId: statementCustomer.id,
        amount,
        paymentMethod: paymentForm.method,
        transactionCode: paymentForm.reference.trim() || undefined,
        reference: `${paymentForm.method} payment from ${statementCustomer.name}`,
        allocations,
        preparedBy: currentUser?.name,
        shiftId: currentShiftId,
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await Promise.allSettled([
        db.customerPayments.reload(),
        db.customers.reload(),
        db.salesInvoices.reload(),
      ]);
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
      await generateAndDownloadCustomerStatement(
        statementCustomer,
        [...filteredCreditSales, ...filteredStatementInvoices.map(invoice => ({ ...invoice, recordType: 'SALES_INVOICE' }))],
        filteredStatementPayments
      );
      success("Customer statement exported.");
    } catch (err) {
      console.error('Customer statement export failed', err);
      error("Failed to export customer statement.");
    }
  };

  if (statementCustomer) {
    return (
      <div className="pb-28 md:pb-8 animate-in fade-in w-full space-y-5">
        <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <button onClick={() => {
              if (window.history.state?.customerStatementId) window.history.back();
              else setStatementCustomerId(null);
            }} className="mb-4 inline-flex h-10 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 text-[11px] font-black uppercase tracking-widest text-slate-600 hover:border-blue-300 hover:text-blue-700">
              <ArrowLeft size={16} /> Customers
            </button>
            <h2 className="truncate text-2xl font-black text-slate-950">{statementCustomer.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] font-bold text-slate-500">
              <span className="flex items-center gap-1"><Phone size={12} /> {statementCustomer.phone || 'No phone'}</span>
              {statementCustomer.email && <span>{statementCustomer.email}</span>}
              <span className={statementCustomer.balance > 0 ? 'text-rose-600' : 'text-slate-600'}>
                Balance: Ksh {(statementCustomer.balance || 0).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => openEditCustomer(statementCustomer)} className="flex h-11 items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 text-[10px] font-black uppercase tracking-widest text-slate-700 hover:border-blue-300 hover:text-blue-700">
              <User size={15} /> Profile
            </button>
            <button onClick={handleExportStatement} className="flex h-11 items-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-800">
              <FileDown size={15} /> Statement
            </button>
          </div>
        </div>
        </section>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Invoices & credit sales</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">Ksh {totalCreditSales.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Payments</p>
            <p className="text-2xl font-black text-slate-900 tabular-nums">Ksh {totalPayments.toLocaleString()}</p>
          </div>
          <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Outstanding</p>
            <p className={`text-2xl font-black tabular-nums ${statementCustomer.balance > 0 ? 'text-rose-600' : 'text-slate-900'}`}>Ksh {(statementCustomer.balance || 0).toLocaleString()}</p>
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b-2 border-slate-100 px-5 py-4">
            <div>
              <h3 className="text-sm font-black text-slate-900">Outstanding documents</h3>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Open the exact sale or invoice behind each debt</p>
            </div>
            <span className="text-xs font-black text-rose-600 tabular-nums whitespace-nowrap">{money(openDebtTotal)}</span>
          </div>
          {openDebtSources.length === 0 ? (
            <div className="py-10 text-center text-slate-400">
              <CheckCircle2 size={34} className="mx-auto mb-3 text-emerald-500" />
              <p className="text-sm font-bold">No open debt documents.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {openDebtSources.map(source => (
                <button
                  key={`${source.sourceType}-${source.id}`}
                  type="button"
                  onClick={() => openDebtRecord(source)}
                  className="w-full px-4 sm:px-5 py-4 grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 items-center text-left hover:bg-slate-50 transition-colors group"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${source.sourceType === 'INVOICE' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                    {source.sourceType === 'INVOICE' ? <FileText size={18} /> : <ReceiptText size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{source.title}</p>
                      <ExternalLink size={13} className="text-slate-300 group-hover:text-primary shrink-0" />
                    </div>
                    <p className="text-[10px] font-bold text-slate-400 truncate">{new Date(source.timestamp).toLocaleString()} - {source.detail}</p>
                    <div className="mt-2 h-1.5 w-full max-w-xs rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, (source.paid / Math.max(1, source.total)) * 100)}%` }} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Remaining</p>
                    <p className="text-sm font-black text-rose-600 tabular-nums whitespace-nowrap">{money(source.remaining)}</p>
                    {source.paid > 0 && <p className="text-[9px] font-bold text-emerald-600 whitespace-nowrap">Paid {money(source.paid)}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white">
            <div className="flex flex-col justify-between gap-3 border-b-2 border-slate-100 px-5 py-4 sm:flex-row sm:items-center">
              <div>
                <h3 className="text-sm font-black text-slate-900">Customer statement</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invoices, credit sales, and payments</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStatementDateMode('ALL')}
                  className={`h-9 rounded-lg border-2 px-3 text-[9px] font-black uppercase tracking-widest ${statementDateMode === 'ALL' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  All dates
                </button>
                <button
                  type="button"
                  onClick={() => setStatementDateMode('CUSTOM')}
                  className={`h-9 rounded-lg border-2 px-3 text-[9px] font-black uppercase tracking-widest ${statementDateMode === 'CUSTOM' ? 'border-blue-700 bg-blue-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}
                >
                  Custom
                </button>
                {statementDateMode === 'CUSTOM' && (
                  <>
                    <input type="date" value={statementStart} onChange={e => setStatementStart(e.target.value)} className="h-9 rounded-lg border-2 border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-600" />
                    <input type="date" value={statementEnd} onChange={e => setStatementEnd(e.target.value)} className="h-9 rounded-lg border-2 border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 outline-none focus:border-blue-600" />
                  </>
                )}
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              {statementRows.length === 0 ? (
                <div className="py-20 text-center text-slate-400">
                  <WalletCards size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-bold">No credit activity for this customer.</p>
                </div>
              ) : pagedStatementRows.map(row => {
                const linkedDebt = row.type === 'SALE' || row.type === 'INVOICE'
                  ? debtSources.find(source => source.id === row.id && (row.type === 'SALE' ? source.sourceType === 'SALE' : source.sourceType === 'INVOICE'))
                  : undefined;
                const canOpen = !!row.record || !!linkedDebt;
                return (
                <button
                  key={`${row.type}-${row.id}`}
                  type="button"
                  onClick={() => linkedDebt ? openDebtRecord(linkedDebt) : row.record ? setSelectedDebtRecord(row.record) : undefined}
                  disabled={!canOpen}
                  className={`w-full text-left px-4 sm:px-5 py-4 grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 items-center ${canOpen ? 'hover:bg-slate-50 transition-colors group' : ''}`}
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${row.type === 'PAYMENT' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                    {row.type === 'PAYMENT' ? <Banknote size={18} /> : <ReceiptText size={18} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-black text-slate-900 truncate">{row.title}</p>
                      {canOpen && <ExternalLink size={13} className="text-slate-300 group-hover:text-primary shrink-0" />}
                    </div>
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
                </button>
              );
              })}
            </div>
            {statementRows.length > statementPageSize && (
              <div className="px-5 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between gap-3">
                <button onClick={() => setStatementPage(p => Math.max(1, p - 1))} disabled={currentStatementPage <= 1} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40">Previous 50</button>
                <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Page {currentStatementPage} of {statementTotalPages}</span>
                <button onClick={() => setStatementPage(p => Math.min(statementTotalPages, p + 1))} disabled={currentStatementPage >= statementTotalPages} className="rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-[9px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-40">Next 50</button>
              </div>
            )}
          </section>

          <aside className="h-fit rounded-lg border-2 border-slate-200 bg-white p-5">
            <h3 className="text-sm font-black text-slate-900 mb-1">Clear balance</h3>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-5">Record full or partial customer payment</p>
            <div className="space-y-3">
              <input
                type="number"
                value={paymentForm.amount}
                onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
                placeholder="Amount received"
                className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <select
                value={paymentForm.method}
                onChange={e => setPaymentForm({ ...paymentForm, method: e.target.value as CustomerPayment['paymentMethod'] })}
                className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              >
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
                <option value="PDQ">Card machine</option>
                <option value="BANK">Bank</option>
                <option value="CHEQUE">Cheque</option>
              </select>
              <input
                value={paymentForm.reference}
                onChange={e => setPaymentForm({ ...paymentForm, reference: e.target.value })}
                placeholder="Reference or transaction code"
                className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
              />
              <button
                onClick={handleRecordPayment}
                disabled={isSaving || !paymentForm.amount || statementCustomer.balance <= 0}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 hover:bg-blue-800"
              >
                {isSaving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {Number(paymentForm.amount) >= statementCustomer.balance ? 'Clear balance' : 'Record payment'}
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
        {selectedDebtRecord && (
          <DocumentDetailsModal
            selectedRecord={selectedDebtRecord}
            setSelectedRecord={setSelectedDebtRecord}
            handleRefund={async () => info('Open Documents to process a refund.')}
          />
        )}
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in space-y-5 pb-24">
      
      {/* Header */}
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Customers</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">Simple customer balances and payment history.</p>
          <div className="hidden">
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
          className="flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-sm font-black text-white hover:bg-blue-800"
        >
          <Plus size={18} /> Add customer
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Customers</p>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-950">{activeClients}</p>
        </div>
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Outstanding debt</p>
          <p className={`mt-1 text-xl font-black tabular-nums ${totalCredit > 0 ? 'text-rose-600' : 'text-slate-950'}`}>Ksh {totalCredit.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">High spenders</p>
          <p className="mt-1 text-xl font-black tabular-nums text-slate-950">{highValueClients}</p>
        </div>
      </div>
      </section>

      {/* Search Bar */}
      <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
      <div className="border-b-2 border-slate-100 p-4">
        <div className="relative group">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-primary transition-colors" size={16} />
          <input
            type="text"
            placeholder="Search by customer name or phone..."
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
            className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-9 text-sm font-bold outline-none transition-all focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
          />
          {customerSearch && (
            <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Client List */}
      <div>
         {filteredCustomers.length > 0 ? (
           <div className="divide-y divide-slate-100">
             {filteredCustomers.map(customer => (
               <button
                 key={customer.id}
                 type="button"
                 onClick={() => openStatement(customer)}
                 className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-blue-50/40 sm:px-5"
               >
                 <div className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3">
                   <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-sm font-black text-blue-700">
                     {customer.name.substring(0, 1).toUpperCase()}
                   </div>
                   <div className="stable-row-copy">
                     <h4 className="text-sm font-black text-slate-900 stable-title leading-tight">{customer.name}</h4>
                     <div className="flex items-center gap-2 mt-1 overflow-hidden">
                       <span className="text-[10px] font-bold text-slate-400 flex items-center gap-1 flex-shrink-0"><Phone size={11} /> {customer.phone || 'No phone'}</span>
                       {customer.email && <span className="text-[10px] font-bold text-slate-300 stable-meta">{customer.email}</span>}
                     </div>
                   </div>
                 </div>
                 <div className="stable-actions flex items-center gap-3">
                   <div className="hidden sm:block text-right">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Spent</p>
                     <p className="text-sm font-black text-slate-900 tabular-nums whitespace-nowrap">Ksh {Number(customer.totalSpent || 0).toLocaleString()}</p>
                   </div>
                   <div className="text-right min-w-[80px]">
                     <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Debt</p>
                     <p className={`text-sm font-black tabular-nums whitespace-nowrap ${Number(customer.balance || 0) > 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                       {Number(customer.balance || 0) > 0 ? `Ksh ${Number(customer.balance || 0).toLocaleString()}` : 'Clean'}
                     </p>
                   </div>
                   <ChevronRight size={18} className="hidden shrink-0 text-slate-300 transition-colors group-hover:text-blue-600 sm:block" />
                 </div>
               </button>
             ))}
           </div>
         ) : (
           <div className="py-20 text-center flex flex-col items-center">
             <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 text-slate-300">
               <Users size={36} />
             </div>
             <p className="text-base font-black text-slate-700">No customers found</p>
             <p className="mt-1 text-xs font-bold text-slate-400">Adjust the search or add a new customer.</p>
           </div>
         )}
      </div>
      </section>

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
    <div className="fixed inset-0 z-[90] flex items-end justify-center p-0 pb-safe sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/45" onClick={onClose} />
      <div className="relative z-10 flex max-h-[95vh] w-full max-w-md flex-col overflow-y-auto rounded-t-2xl border-2 border-slate-200 bg-white shadow-xl sm:rounded-lg">
        <div className="flex items-center justify-between border-b-2 border-slate-100 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
              <User size={21} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-950">{editingCustomer ? 'Customer profile' : 'New customer'}</h2>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Name and contact</p>
            </div>
          </div>
          {editingCustomer && isAdmin && (
            <button onClick={onDelete} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-rose-100 bg-rose-50 text-rose-600 hover:border-rose-200">
              <Trash2 size={18} />
            </button>
          )}
        </div>

        <div className="space-y-4 p-5">
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Full name</label>
            <input type="text" value={customerForm.name} onChange={e => setCustomerForm({...customerForm, name: e.target.value})} className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="e.g. Samuel Maina" />
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Phone</label>
            <div className="relative">
              <input type="text" value={customerForm.phone} onChange={e => setCustomerForm({...customerForm, phone: e.target.value})} className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-11 pr-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="0700 000 000" />
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-500">Email</label>
            <div className="relative">
              <input type="email" value={customerForm.email} onChange={e => setCustomerForm({...customerForm, email: e.target.value})} className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white pl-11 pr-4 text-sm font-black text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100" placeholder="customer@example.com" />
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
            </div>
          </div>

          {editingCustomer && Number(editingCustomer.balance || 0) > 0 && (
            <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h4 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-700">
                  <Smartphone size={14} /> M-Pesa repayment
                </h4>
                <span className="rounded-lg border border-rose-100 bg-white px-2 py-1 text-[10px] font-black text-rose-600">Ksh {Number(editingCustomer.balance || 0).toLocaleString()} owed</span>
              </div>

              {mpesaState === 'IDLE' || mpesaState === 'FAILED' ? (
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="relative">
                    <input
                      type="number"
                      value={repaymentAmount}
                      onChange={e => setRepaymentAmount(e.target.value)}
                      placeholder="Amount"
                      className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 pr-12 text-sm font-black text-slate-900 outline-none focus:border-blue-600"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">Ksh</span>
                  </div>
                  <button
                    onClick={onMpesaRepayment}
                    className="flex h-12 items-center justify-center rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-[10px] font-black uppercase tracking-widest text-white hover:bg-blue-800"
                  >
                    Send request
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-4">
                  {mpesaState === 'SUCCESS' ? (
                    <CheckCircle2 className="text-emerald-600" size={22} />
                  ) : (
                    <Loader2 className="animate-spin text-blue-700" size={22} />
                  )}
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">
                    {mpesaState === 'PUSHING' ? 'Sending M-Pesa request...' :
                      mpesaState === 'POLLING' ? 'Awaiting customer PIN...' :
                      mpesaState === 'SUCCESS' ? 'Payment received!' : 'Working...'}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-auto grid grid-cols-2 gap-3 border-t-2 border-slate-100 p-5">
          <button onClick={onClose} disabled={isSaving} className="h-12 rounded-lg border-2 border-slate-200 bg-white text-[10px] font-black uppercase tracking-widest text-slate-600 disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onSave} disabled={!customerForm.name || isSaving} className="flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 text-[10px] font-black uppercase tracking-widest text-white disabled:opacity-40 hover:bg-blue-800">
            {isSaving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
