import React from 'react';
import {
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  Download,
  FileText,
  Package,
  Plus,
  ReceiptText,
  Search,
  Send,
  Trash2,
  User,
  WalletCards,
  X,
} from 'lucide-react';
import { useLiveQuery } from '../../clouddb';
import { db, type Customer, type Product, type SalesInvoice, type SalesInvoiceItem, type ServiceItem } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { SearchableSelect } from '../shared/SearchableSelect';
import { getBusinessSettings } from '../../utils/settings';

type DraftLine = SalesInvoiceItem & { id: string };
type ViewMode = 'INVOICES' | 'SERVICES';

const todayInput = () => new Date().toISOString().split('T')[0];
const plusDaysInput = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};
const money = (value: number) => `Ksh ${Math.round(Number(value) || 0).toLocaleString()}`;
const toDayStart = (value: string) => {
  const d = new Date(value || todayInput());
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const isVatLine = (line: Pick<SalesInvoiceItem, 'taxCategory'>) => line.taxCategory === 'A';
const lineAmount = (line: Pick<SalesInvoiceItem, 'quantity' | 'unitPrice'>) => (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
const lineVat = (line: Pick<SalesInvoiceItem, 'quantity' | 'unitPrice' | 'taxCategory'>) => isVatLine(line) ? lineAmount(line) * 0.16 : 0;
const invoiceTotals = (lines: SalesInvoiceItem[]) => {
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const tax = lines.reduce((sum, line) => sum + lineVat(line), 0);
  return { subtotal, tax, total: subtotal + tax };
};

export default function SalesInvoicesTab() {
  const { success, error } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeBranchId = useStore(state => state.activeBranchId);
  const currentUser = useStore(state => state.currentUser);

  const [mode, setMode] = React.useState<ViewMode>('INVOICES');
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<'ALL' | SalesInvoice['status']>('ALL');

  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = React.useState(false);
  const [invoiceForm, setInvoiceForm] = React.useState({ customerId: '', dueDate: plusDaysInput(14), notes: '' });
  const [lineInput, setLineInput] = React.useState({
    itemType: 'SERVICE' as SalesInvoiceItem['itemType'],
    itemId: '',
    name: '',
    quantity: '1',
    unitPrice: '',
    taxCategory: 'A' as 'A' | 'E',
  });
  const [lines, setLines] = React.useState<DraftLine[]>([]);

  const [isServiceModalOpen, setIsServiceModalOpen] = React.useState(false);
  const [editingService, setEditingService] = React.useState<ServiceItem | null>(null);
  const [serviceForm, setServiceForm] = React.useState({ name: '', category: 'General', description: '', price: '', taxCategory: 'A' as 'A' | 'E', isActive: true });

  const [selectedInvoice, setSelectedInvoice] = React.useState<SalesInvoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = React.useState<SalesInvoice | null>(null);
  const [paymentForm, setPaymentForm] = React.useState({ amount: '', method: 'CASH' as 'CASH' | 'MPESA' | 'BANK' | 'PDQ' | 'CHEQUE', reference: '' });
  const [isSaving, setIsSaving] = React.useState(false);

  const customers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const services = useLiveQuery(
    () => activeBusinessId ? db.serviceItems.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const invoices = useLiveQuery(
    () => activeBusinessId && activeBranchId
      ? db.salesInvoices.where('branchId').equals(activeBranchId).and(i => i.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeBranchId],
    []
  );
  const businessSettings = useLiveQuery(() => getBusinessSettings(activeBusinessId), [activeBusinessId]);

  const visibleProducts = (products || []).filter(product => !product.branchId || product.branchId === activeBranchId);
  const activeServices = (services || []).filter(service => Number(service.isActive) !== 0);

  const customerOptions = (customers || []).map(customer => ({
    value: customer.id,
    label: `${customer.name}${customer.phone ? ` - ${customer.phone}` : ''}`,
    keywords: `${customer.name} ${customer.phone || ''} ${customer.email || ''}`,
  }));
  const productOptions = visibleProducts.map(product => ({
    value: product.id,
    label: `${product.name} - ${money(product.sellingPrice)}`,
    keywords: `${product.name} ${product.category || ''} ${product.barcode || ''}`,
    disabled: Number(product.stockQuantity || 0) <= 0,
  }));
  const serviceOptions = activeServices.map(service => ({
    value: service.id,
    label: `${service.name} - ${money(service.price)}`,
    keywords: `${service.name} ${service.category || ''} ${service.description || ''}`,
  }));

  const totals = invoiceTotals(lines);
  const unpaidTotal = (invoices || []).filter(invoice => invoice.status !== 'CANCELLED').reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0);
  const paidThisMonth = (invoices || []).filter(invoice => {
    const d = new Date(invoice.issueDate);
    const now = new Date();
    return invoice.status === 'PAID' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0);

  const filteredInvoices = (invoices || [])
    .filter(invoice => {
      const hay = `${invoice.invoiceNumber} ${invoice.customerName} ${invoice.customerPhone || ''} ${invoice.status}`.toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
      if (statusFilter !== 'ALL' && invoice.status !== statusFilter) return false;
      return true;
    })
    .sort((a, b) => (b.issueDate || 0) - (a.issueDate || 0));

  const filteredServices = (services || [])
    .filter(service => `${service.name} ${service.category} ${service.description || ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const resetInvoiceForm = () => {
    setInvoiceForm({ customerId: '', dueDate: plusDaysInput(14), notes: '' });
    setLineInput({ itemType: 'SERVICE', itemId: '', name: '', quantity: '1', unitPrice: '', taxCategory: 'A' });
    setLines([]);
  };

  const nextInvoiceNumber = () => {
    const max = (invoices || []).reduce((highest, invoice) => {
      const match = String(invoice.invoiceNumber || '').match(/INV-(\d+)/i);
      const num = match ? Number(match[1]) : 0;
      return Number.isFinite(num) && num > highest ? num : highest;
    }, 0);
    return `INV-${String(max + 1).padStart(4, '0')}`;
  };

  const selectCatalogItem = (id: string) => {
    if (!id) {
      setLineInput(prev => ({ ...prev, itemId: '', name: '', unitPrice: '' }));
      return;
    }
    if (lineInput.itemType === 'PRODUCT') {
      const product = visibleProducts.find(p => p.id === id);
      if (!product) return;
      setLineInput(prev => ({
        ...prev,
        itemId: product.id,
        name: product.name,
        unitPrice: String(product.sellingPrice || 0),
        taxCategory: product.taxCategory === 'A' ? 'A' : 'E',
      }));
      return;
    }
    const service = activeServices.find(s => s.id === id);
    if (!service) return;
    setLineInput(prev => ({
      ...prev,
      itemId: service.id,
      name: service.name,
      unitPrice: String(service.price || 0),
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
    }));
  };

  const addLine = () => {
    const quantity = Number(lineInput.quantity);
    const unitPrice = Number(lineInput.unitPrice);
    const name = lineInput.name.trim();
    if (!name) return error('Enter the item or service name.');
    if (!quantity || quantity <= 0) return error('Quantity must be more than zero.');
    if (unitPrice < 0 || Number.isNaN(unitPrice)) return error('Enter a valid price.');
    setLines(prev => [...prev, {
      id: crypto.randomUUID(),
      itemType: lineInput.itemType,
      itemId: lineInput.itemId || undefined,
      name,
      quantity,
      unitPrice,
      taxCategory: lineInput.taxCategory,
    }]);
    setLineInput(prev => ({
      ...prev,
      itemId: '',
      name: '',
      quantity: '1',
      unitPrice: '',
    }));
  };

  const saveInvoice = async () => {
    if (isSaving) return;
    if (!activeBusinessId || !activeBranchId) return error('Please select a branch first.');
    const customer = (customers || []).find(c => c.id === invoiceForm.customerId);
    if (!customer) return error('Select the customer for this invoice.');
    if (lines.length === 0) return error('Add at least one item or service.');

    for (const line of lines) {
      if (line.itemType !== 'PRODUCT' || !line.itemId) continue;
      const product = visibleProducts.find(p => p.id === line.itemId);
      if (!product) return error(`${line.name} was not found in stock.`);
      if (Number(product.stockQuantity || 0) < Number(line.quantity || 0)) {
        return error(`${line.name} does not have enough stock.`);
      }
    }

    setIsSaving(true);
    try {
      const invoiceNumber = nextInvoiceNumber();
      const calculated = invoiceTotals(lines);
      const invoice: SalesInvoice = {
        id: `sales_invoice_${activeBusinessId}_${activeBranchId}_${crypto.randomUUID()}`,
        invoiceNumber,
        customerId: customer.id,
        customerName: customer.name,
        customerPhone: customer.phone,
        customerEmail: customer.email,
        items: lines.map(({ id, ...line }) => line),
        subtotal: calculated.subtotal,
        tax: calculated.tax,
        total: calculated.total,
        paidAmount: 0,
        balance: calculated.total,
        status: 'SENT',
        issueDate: Date.now(),
        dueDate: invoiceForm.dueDate ? toDayStart(invoiceForm.dueDate) : undefined,
        notes: invoiceForm.notes.trim() || undefined,
        preparedBy: currentUser?.name || 'Staff',
        branchId: activeBranchId,
        businessId: activeBusinessId,
      };

      await db.salesInvoices.add(invoice);

      for (const line of lines) {
        if (line.itemType !== 'PRODUCT' || !line.itemId) continue;
        const product = await db.products.get(line.itemId);
        if (!product) continue;
        await db.products.update(line.itemId, {
          stockQuantity: Math.max(0, Number(product.stockQuantity || 0) - Number(line.quantity || 0)),
          updated_at: Date.now(),
        });
        await db.stockMovements.add({
          id: crypto.randomUUID(),
          productId: line.itemId,
          type: 'OUT',
          quantity: -Number(line.quantity || 0),
          timestamp: Date.now(),
          reference: `Invoice ${invoiceNumber}`,
          branchId: activeBranchId,
          businessId: activeBusinessId,
        } as any);
      }

      await db.customers.update(customer.id, {
        totalSpent: Number(customer.totalSpent || 0) + calculated.total,
        balance: Number(customer.balance || 0) + calculated.total,
        updated_at: Date.now(),
      });

      setIsInvoiceModalOpen(false);
      resetInvoiceForm();
      setSelectedInvoice(invoice);
      success('Invoice created.');
    } catch (err: any) {
      error('Could not save invoice: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const openServiceModal = (service?: ServiceItem) => {
    setEditingService(service || null);
    setServiceForm(service ? {
      name: service.name,
      category: service.category || 'General',
      description: service.description || '',
      price: String(service.price || 0),
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
      isActive: Number(service.isActive) !== 0,
    } : { name: '', category: 'General', description: '', price: '', taxCategory: 'A', isActive: true });
    setIsServiceModalOpen(true);
  };

  const saveService = async () => {
    if (isSaving) return;
    if (!activeBusinessId) return error('Please log in again.');
    const price = Number(serviceForm.price);
    if (!serviceForm.name.trim()) return error('Enter the service name.');
    if (price < 0 || Number.isNaN(price)) return error('Enter a valid price.');
    setIsSaving(true);
    try {
      const payload = {
        name: serviceForm.name.trim(),
        category: serviceForm.category.trim() || 'General',
        description: serviceForm.description.trim() || undefined,
        price,
        taxCategory: serviceForm.taxCategory,
        isActive: serviceForm.isActive ? 1 : 0,
        businessId: activeBusinessId,
        updated_at: Date.now(),
      };
      if (editingService) {
        await db.serviceItems.update(editingService.id, payload);
        success('Service updated.');
      } else {
        await db.serviceItems.add({ id: `service_${activeBusinessId}_${crypto.randomUUID()}`, ...payload } as ServiceItem);
        success('Service added.');
      }
      setIsServiceModalOpen(false);
      setEditingService(null);
    } catch (err: any) {
      error('Could not save service: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const applyPayment = async () => {
    if (!paymentInvoice || isSaving) return;
    if (!activeBusinessId || !activeBranchId) return error('Please select a branch first.');
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) return error('Enter the amount paid.');
    if (amount > Number(paymentInvoice.balance || 0)) return error('Amount is more than the invoice balance.');
    setIsSaving(true);
    try {
      const customer = await db.customers.get(paymentInvoice.customerId);
      const paidAmount = Number(paymentInvoice.paidAmount || 0) + amount;
      const balance = Math.max(0, Number(paymentInvoice.total || 0) - paidAmount);
      const status = balance <= 0 ? 'PAID' : 'PARTIAL';
      await db.customerPayments.add({
        id: crypto.randomUUID(),
        customerId: paymentInvoice.customerId,
        amount,
        paymentMethod: paymentForm.method,
        transactionCode: paymentForm.reference.trim() || undefined,
        reference: `Invoice ${paymentInvoice.invoiceNumber}`,
        timestamp: Date.now(),
        preparedBy: currentUser?.name,
        branchId: activeBranchId,
        businessId: activeBusinessId,
      } as any);
      await db.salesInvoices.update(paymentInvoice.id, { paidAmount, balance, status, updated_at: Date.now() });
      if (customer) {
        await db.customers.update(customer.id, {
          balance: Math.max(0, Number(customer.balance || 0) - amount),
          updated_at: Date.now(),
        });
      }
      const updated = { ...paymentInvoice, paidAmount, balance, status } as SalesInvoice;
      setPaymentInvoice(null);
      setPaymentForm({ amount: '', method: 'CASH', reference: '' });
      setSelectedInvoice(updated);
      success(balance <= 0 ? 'Invoice fully paid.' : 'Payment recorded.');
    } catch (err: any) {
      error('Could not record payment: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelInvoice = async (invoice: SalesInvoice) => {
    if (invoice.status === 'PAID' || Number(invoice.paidAmount || 0) > 0) {
      return error('This invoice already has a payment. Record an adjustment instead.');
    }
    if (!confirm(`Cancel invoice ${invoice.invoiceNumber}?`)) return;
    setIsSaving(true);
    try {
      const customer = await db.customers.get(invoice.customerId);
      await db.salesInvoices.update(invoice.id, { status: 'CANCELLED', balance: 0, updated_at: Date.now() });
      if (customer) {
        await db.customers.update(customer.id, {
          totalSpent: Math.max(0, Number(customer.totalSpent || 0) - Number(invoice.total || 0)),
          balance: Math.max(0, Number(customer.balance || 0) - Number(invoice.balance || 0)),
          updated_at: Date.now(),
        });
      }
      for (const line of invoice.items || []) {
        if (line.itemType !== 'PRODUCT' || !line.itemId || !activeBusinessId || !activeBranchId) continue;
        const product = await db.products.get(line.itemId);
        if (!product) continue;
        await db.products.update(line.itemId, {
          stockQuantity: Number(product.stockQuantity || 0) + Number(line.quantity || 0),
          updated_at: Date.now(),
        });
        await db.stockMovements.add({
          id: crypto.randomUUID(),
          productId: line.itemId,
          type: 'RETURN',
          quantity: Number(line.quantity || 0),
          timestamp: Date.now(),
          reference: `Cancelled invoice ${invoice.invoiceNumber}`,
          branchId: activeBranchId,
          businessId: activeBusinessId,
        } as any);
      }
      setSelectedInvoice({ ...invoice, status: 'CANCELLED', balance: 0 });
      success('Invoice cancelled.');
    } catch (err: any) {
      error('Could not cancel invoice: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const downloadInvoice = async (invoice: SalesInvoice) => {
    try {
      const { generateAndDownloadSalesInvoice } = await import('../../utils/shareUtils');
      await generateAndDownloadSalesInvoice(invoice, businessSettings?.storeName, businessSettings?.location);
      success('Invoice PDF created.');
    } catch (err: any) {
      error('Could not create invoice PDF: ' + err.message);
    }
  };

  if (!customers || !products || !services || !invoices) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm">
          <FileText className="text-slate-300" size={34} />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Loading invoices...</p>
      </div>
    );
  }

  return (
    <div className="w-full animate-in fade-in pb-28 md:pb-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-xl font-black text-slate-900">Sales Invoices</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-[10px] font-bold text-slate-500">
            <span>{invoices.length} invoices</span>
            <span className="text-slate-300">|</span>
            <span className="text-rose-600">{money(unpaidTotal)} unpaid</span>
            <span className="text-slate-300">|</span>
            <span className="text-emerald-600">{services.length} services</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            onClick={() => openServiceModal()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 shadow-sm"
          >
            <BriefcaseBusiness size={16} /> Service
          </button>
          <button
            type="button"
            onClick={() => { resetInvoiceForm(); setIsInvoiceModalOpen(true); }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-xs font-black uppercase tracking-widest text-white shadow-blue"
          >
            <Plus size={16} /> Invoice
          </button>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Unpaid</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-rose-600">{money(unpaidTotal)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Paid This Month</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-emerald-600">{money(paidThisMonth)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ready Services</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-900">{activeServices.length}</p>
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex rounded-xl bg-slate-200 p-1">
          {([
            ['INVOICES', 'Invoices'],
            ['SERVICES', 'Services'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`h-10 rounded-lg px-4 text-xs font-black uppercase tracking-widest ${mode === id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {mode === 'INVOICES' && (
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-widest text-slate-600 outline-none"
            >
              <option value="ALL">All Status</option>
              <option value="SENT">Unpaid</option>
              <option value="PARTIAL">Part Paid</option>
              <option value="PAID">Paid</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          )}
          <div className="relative min-w-0 sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={mode === 'INVOICES' ? 'Search customer or invoice...' : 'Search services...'}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm font-bold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </div>
        </div>
      </div>

      {mode === 'INVOICES' ? (
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {filteredInvoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <ReceiptText size={44} className="mb-3 text-slate-200" />
              <p className="text-sm font-black text-slate-700">No invoices found.</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Create an invoice for products, services, or any custom charge.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredInvoices.map(invoice => (
                <button
                  key={invoice.id}
                  type="button"
                  onClick={() => setSelectedInvoice(invoice)}
                  className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:px-5"
                >
                  <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                      <FileText size={20} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-900">{invoice.customerName}</span>
                      <span className="mt-1 block truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {invoice.invoiceNumber} | {new Date(invoice.issueDate).toLocaleDateString()}
                      </span>
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black tabular-nums text-slate-900">{money(invoice.total)}</p>
                    <StatusPill status={invoice.status} />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : (
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredServices.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm md:col-span-2 xl:col-span-3">
              <BriefcaseBusiness size={44} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-black text-slate-700">No services yet.</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Add services like delivery, repair, installation, design, transport, or labour.</p>
            </div>
          ) : filteredServices.map(service => (
            <button
              key={service.id}
              type="button"
              onClick={() => openServiceModal(service)}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
                  <BriefcaseBusiness size={20} />
                </span>
                <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${Number(service.isActive) === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                  {Number(service.isActive) === 0 ? 'Hidden' : 'Active'}
                </span>
              </div>
              <h3 className="truncate text-sm font-black text-slate-900">{service.name}</h3>
              <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{service.category || 'General'}</p>
              {service.description && <p className="mt-3 line-clamp-2 text-xs font-semibold text-slate-500">{service.description}</p>}
              <p className="mt-4 text-xl font-black tabular-nums text-slate-950">{money(service.price)}</p>
            </button>
          ))}
        </section>
      )}

      {isInvoiceModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-black text-slate-900">New Invoice</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">For products, services, or custom work</p>
              </div>
              <button onClick={() => setIsInvoiceModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[calc(92vh-74px)] overflow-y-auto p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Customer</span>
                      <SearchableSelect
                        value={invoiceForm.customerId}
                        onChange={value => setInvoiceForm(prev => ({ ...prev, customerId: value }))}
                        options={customerOptions}
                        placeholder="Select customer"
                        searchPlaceholder="Search customers..."
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Due Date</span>
                      <input
                        type="date"
                        value={invoiceForm.dueDate}
                        onChange={e => setInvoiceForm(prev => ({ ...prev, dueDate: e.target.value }))}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary"
                      />
                    </label>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <select
                        value={lineInput.itemType}
                        onChange={e => setLineInput({ itemType: e.target.value as any, itemId: '', name: '', quantity: '1', unitPrice: '', taxCategory: 'A' })}
                        className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 outline-none"
                      >
                        <option value="SERVICE">Service</option>
                        <option value="PRODUCT">Product</option>
                        <option value="CUSTOM">Custom</option>
                      </select>
                      {lineInput.itemType === 'CUSTOM' ? (
                        <input
                          value={lineInput.name}
                          onChange={e => setLineInput(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Type the work or item name"
                          className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-primary"
                        />
                      ) : (
                        <SearchableSelect
                          value={lineInput.itemId}
                          onChange={selectCatalogItem}
                          options={lineInput.itemType === 'PRODUCT' ? productOptions : serviceOptions}
                          placeholder={lineInput.itemType === 'PRODUCT' ? 'Select product' : 'Select service'}
                          searchPlaceholder="Search..."
                        />
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-[1fr_1fr_9rem_auto]">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={lineInput.quantity}
                        onChange={e => setLineInput(prev => ({ ...prev, quantity: e.target.value }))}
                        placeholder="Qty"
                        className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-primary"
                      />
                      <input
                        type="number"
                        min="0"
                        value={lineInput.unitPrice}
                        onChange={e => setLineInput(prev => ({ ...prev, unitPrice: e.target.value }))}
                        placeholder="Price"
                        className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-primary"
                      />
                      <select
                        value={lineInput.taxCategory}
                        onChange={e => setLineInput(prev => ({ ...prev, taxCategory: e.target.value as 'A' | 'E' }))}
                        className="h-12 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black text-slate-700 outline-none"
                      >
                        <option value="A">VAT</option>
                        <option value="E">No VAT</option>
                      </select>
                      <button onClick={addLine} type="button" className="col-span-2 h-12 rounded-xl bg-slate-900 px-5 text-xs font-black uppercase tracking-widest text-white md:col-span-1">
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    {lines.length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm font-bold text-slate-400">No invoice lines yet.</div>
                    ) : lines.map(line => (
                      <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{line.name}</p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {line.itemType} | Qty {line.quantity} | {isVatLine(line) ? 'VAT' : 'No VAT'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-black tabular-nums text-slate-900">{money(lineAmount(line) + lineVat(line))}</p>
                          <button onClick={() => setLines(prev => prev.filter(row => row.id !== line.id))} className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <textarea
                    value={invoiceForm.notes}
                    onChange={e => setInvoiceForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Notes for the customer..."
                    className="min-h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:border-primary"
                  />
                </div>

                <aside className="h-fit rounded-2xl border border-slate-200 bg-slate-950 p-5 text-white">
                  <p className="text-[10px] font-black uppercase tracking-widest text-blue-200">Invoice Total</p>
                  <p className="mt-2 text-3xl font-black tabular-nums">{money(totals.total)}</p>
                  <div className="mt-5 space-y-2 text-sm font-bold">
                    <div className="flex justify-between"><span className="text-slate-400">Before VAT</span><span>{money(totals.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-400">VAT</span><span>{money(totals.tax)}</span></div>
                  </div>
                  <button
                    type="button"
                    onClick={saveInvoice}
                    disabled={isSaving}
                    className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-xs font-black uppercase tracking-widest text-white disabled:opacity-50"
                  >
                    <Send size={16} /> {isSaving ? 'Saving...' : 'Create Invoice'}
                  </button>
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}

      {isServiceModalOpen && (
        <div className="fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-lg rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-[2rem]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900">{editingService ? 'Edit Service' : 'Add Service'}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">For service provider invoices</p>
              </div>
              <button onClick={() => setIsServiceModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input value={serviceForm.name} onChange={e => setServiceForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Service name" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary" />
              <div className="grid grid-cols-2 gap-3">
                <input value={serviceForm.category} onChange={e => setServiceForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Category" className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary" />
                <input type="number" min="0" value={serviceForm.price} onChange={e => setServiceForm(prev => ({ ...prev, price: e.target.value }))} placeholder="Price" className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary" />
              </div>
              <textarea value={serviceForm.description} onChange={e => setServiceForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Short description" className="min-h-24 w-full rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-bold outline-none focus:border-primary" />
              <div className="grid grid-cols-2 gap-3">
                <select value={serviceForm.taxCategory} onChange={e => setServiceForm(prev => ({ ...prev, taxCategory: e.target.value as 'A' | 'E' }))} className="h-12 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-700 outline-none">
                  <option value="A">VAT</option>
                  <option value="E">No VAT</option>
                </select>
                <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-700">
                  <input type="checkbox" checked={serviceForm.isActive} onChange={e => setServiceForm(prev => ({ ...prev, isActive: e.target.checked }))} />
                  Active
                </label>
              </div>
              <button onClick={saveService} disabled={isSaving} className="h-12 w-full rounded-xl bg-primary text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                {isSaving ? 'Saving...' : 'Save Service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <div className="fixed inset-0 z-[105] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-[2rem] bg-white shadow-2xl sm:rounded-[2rem]">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-black text-slate-900">{selectedInvoice.invoiceNumber}</h3>
                <p className="truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{selectedInvoice.customerName}</p>
              </div>
              <button onClick={() => setSelectedInvoice(null)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[calc(92vh-74px)] overflow-y-auto p-5">
              <div className="mb-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Total</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{money(selectedInvoice.total)}</p>
                </div>
                <div className="rounded-2xl bg-rose-50 p-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-rose-500">Balance</p>
                  <p className="mt-1 text-xl font-black text-rose-700">{money(selectedInvoice.balance)}</p>
                </div>
              </div>
              <div className="mb-5 space-y-2">
                {(selectedInvoice.items || []).map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black text-slate-900">{item.name}</span>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{item.itemType} | Qty {item.quantity}</span>
                    </span>
                    <span className="text-sm font-black tabular-nums text-slate-900">{money(lineAmount(item) + lineVat(item))}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button onClick={() => downloadInvoice(selectedInvoice)} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-widest text-slate-700">
                  <Download size={16} /> PDF
                </button>
                <button
                  onClick={() => { setPaymentInvoice(selectedInvoice); setPaymentForm({ amount: String(selectedInvoice.balance || ''), method: 'CASH', reference: '' }); }}
                  disabled={selectedInvoice.status === 'PAID' || selectedInvoice.status === 'CANCELLED'}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40"
                >
                  <Banknote size={16} /> Pay
                </button>
                <button
                  onClick={() => cancelInvoice(selectedInvoice)}
                  disabled={selectedInvoice.status === 'PAID' || selectedInvoice.status === 'CANCELLED' || Number(selectedInvoice.paidAmount || 0) > 0}
                  className="flex h-12 items-center justify-center gap-2 rounded-xl bg-rose-50 text-xs font-black uppercase tracking-widest text-rose-600 disabled:opacity-40"
                >
                  <Trash2 size={16} /> Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paymentInvoice && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-[2rem] bg-white p-5 shadow-2xl sm:rounded-[2rem]">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900">Record Payment</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{paymentInvoice.invoiceNumber}</p>
              </div>
              <button onClick={() => setPaymentInvoice(null)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input type="number" min="0" value={paymentForm.amount} onChange={e => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))} placeholder="Amount paid" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary" />
              <select value={paymentForm.method} onChange={e => setPaymentForm(prev => ({ ...prev, method: e.target.value as any }))} className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-black text-slate-700 outline-none">
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank</option>
                <option value="PDQ">Card</option>
                <option value="CHEQUE">Cheque</option>
              </select>
              <input value={paymentForm.reference} onChange={e => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))} placeholder="Payment code or note" className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-primary" />
              <button onClick={applyPayment} disabled={isSaving} className="h-12 w-full rounded-xl bg-emerald-600 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50">
                {isSaving ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SalesInvoice['status'] }) {
  const styles: Record<SalesInvoice['status'], string> = {
    SENT: 'bg-rose-50 text-rose-600',
    PARTIAL: 'bg-amber-50 text-amber-700',
    PAID: 'bg-emerald-50 text-emerald-600',
    CANCELLED: 'bg-slate-100 text-slate-500',
  };
  const labels: Record<SalesInvoice['status'], string> = {
    SENT: 'Unpaid',
    PARTIAL: 'Part Paid',
    PAID: 'Paid',
    CANCELLED: 'Cancelled',
  };
  return (
    <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${styles[status]}`}>
      {status === 'PAID' ? <CheckCircle2 size={11} /> : status === 'SENT' ? <WalletCards size={11} /> : <ArrowRight size={11} />}
      {labels[status]}
    </span>
  );
}
