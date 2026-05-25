import React from 'react';
import {
  ArrowRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
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
import { db, type SalesInvoice, type SalesInvoiceItem, type ServiceItem } from '../../db';
import { useStore } from '../../store';
import { useToast } from '../../context/ToastContext';
import { SearchableSelect } from '../shared/SearchableSelectMobile';
import DocumentDetailsModal from '../modals/DocumentDetailsModalMobile';
import { belongsToActiveShop } from '../../utils/shopScope';
import { SalesInvoiceService } from '../../services/salesInvoices';
import { CustomerService } from '../../services/customers';
import { ServiceItemService } from '../../services/catalog';
import { getCurrentShiftId } from '../../utils/shiftSession';

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
const itemTypeLabel = (value: SalesInvoiceItem['itemType']) => value.charAt(0) + value.slice(1).toLowerCase();
const invoiceTotals = (lines: SalesInvoiceItem[]) => {
  const subtotal = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  const tax = lines.reduce((sum, line) => sum + lineVat(line), 0);
  return { subtotal, tax, total: subtotal + tax };
};

export default function SalesInvoicesTabMobile() {
  const { success, error } = useToast();
  const activeBusinessId = useStore(state => state.activeBusinessId);
  const activeShopId = useStore(state => state.activeShopId);
  const currentUser = useStore(state => state.currentUser);
  const activeShift = useStore(state => state.activeShift);
  const currentShiftId = getCurrentShiftId(activeShift, activeShopId, currentUser?.id);

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
  const [serviceForm, setServiceForm] = React.useState({ name: '', category: 'General', description: '', taxCategory: 'A' as 'A' | 'E', isActive: true });

  const [selectedInvoice, setSelectedInvoice] = React.useState<SalesInvoice | null>(null);
  const [paymentInvoice, setPaymentInvoice] = React.useState<SalesInvoice | null>(null);
  const [paymentForm, setPaymentForm] = React.useState({ amount: '', method: 'CASH' as 'CASH' | 'MPESA' | 'BANK' | 'PDQ' | 'CHEQUE', reference: '' });
  const [isSaving, setIsSaving] = React.useState(false);

  const customers = useLiveQuery(
    () => activeBusinessId ? db.customers.where('businessId').equals(activeBusinessId).filter(c => belongsToActiveShop(c, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const products = useLiveQuery(
    () => activeBusinessId ? db.products.where('businessId').equals(activeBusinessId).filter(product => belongsToActiveShop(product, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const services = useLiveQuery(
    () => activeBusinessId ? db.serviceItems.where('businessId').equals(activeBusinessId).toArray() : Promise.resolve([]),
    [activeBusinessId],
    []
  );
  const invoices = useLiveQuery(
    () => activeBusinessId && activeShopId
      ? db.salesInvoices.where('shopId').equals(activeShopId).and(i => i.businessId === activeBusinessId).toArray()
      : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );
  const visibleProducts = products || [];
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
    label: service.name,
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
      unitPrice: '',
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
    }));
  };

  const addLine = () => {
    const quantity = Number(lineInput.quantity);
    const unitPrice = Number(lineInput.unitPrice);
    const name = lineInput.name.trim();
    if (!name) return error('Enter the item or service name.');
    if (!quantity || quantity <= 0) return error('Quantity must be more than zero.');
    if (unitPrice < 0 || Number.isNaN(unitPrice)) return error('Enter a valid amount.');
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
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
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
      const result = await SalesInvoiceService.create({
        customerId: customer.id,
        items: lines.map(({ id, ...line }) => line),
        dueDate: invoiceForm.dueDate ? toDayStart(invoiceForm.dueDate) : undefined,
        notes: invoiceForm.notes.trim() || undefined,
        preparedBy: currentUser?.name || 'Staff',
        shopId: activeShopId,
        businessId: activeBusinessId,
      });

      await Promise.allSettled([
        db.salesInvoices.reload(),
        db.customers.reload(),
        db.products.reload(),
        db.stockMovements.reload(),
      ]);
      setIsInvoiceModalOpen(false);
      resetInvoiceForm();
      setSelectedInvoice(result.invoice);
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
      taxCategory: service.taxCategory === 'A' ? 'A' : 'E',
      isActive: Number(service.isActive) !== 0,
    } : { name: '', category: 'General', description: '', taxCategory: 'A', isActive: true });
    setIsServiceModalOpen(true);
  };

  const saveService = async () => {
    if (isSaving) return;
    if (!activeBusinessId) return error('Please log in again.');
    if (!serviceForm.name.trim()) return error('Enter the service name.');
    setIsSaving(true);
    try {
      const payload = {
        id: editingService?.id,
        name: serviceForm.name.trim(),
        category: serviceForm.category.trim() || 'General',
        description: serviceForm.description.trim() || undefined,
        price: 0,
        taxCategory: serviceForm.taxCategory,
        isActive: serviceForm.isActive ? 1 : 0,
      };
      await ServiceItemService.save({ service: payload, businessId: activeBusinessId });
      await db.serviceItems.reload();
      success(editingService ? 'Service updated.' : 'Service added.');
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
    if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
    const amount = Number(paymentForm.amount);
    if (!amount || amount <= 0) return error('Enter the amount to clear.');
    if (amount > Number(paymentInvoice.balance || 0)) return error('Amount is more than the invoice balance.');
    if (['CASH', 'MPESA', 'PDQ'].includes(String(paymentForm.method).toUpperCase()) && !currentShiftId) {
      return error('Open a till shift before recording this invoice payment.');
    }
    setIsSaving(true);
    try {
      await CustomerService.recordPayment({
        customerId: paymentInvoice.customerId,
        amount,
        paymentMethod: paymentForm.method,
        transactionCode: paymentForm.reference.trim() || undefined,
        reference: `Invoice ${paymentInvoice.invoiceNumber}`,
        allocations: [{ sourceType: 'INVOICE', sourceId: paymentInvoice.id, amount }],
        preparedBy: currentUser?.name,
        shiftId: currentShiftId,
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await Promise.allSettled([
        db.customerPayments.reload(),
        db.salesInvoices.reload(),
        db.customers.reload(),
      ]);
      const updated = await db.salesInvoices.get(paymentInvoice.id);
      setPaymentInvoice(null);
      setPaymentForm({ amount: '', method: 'CASH', reference: '' });
      setSelectedInvoice(updated || paymentInvoice);
      success((updated?.balance || 0) <= 0 ? 'Invoice cleared.' : 'Balance reduced.');
    } catch (err: any) {
      error('Could not clear balance: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const cancelInvoice = async (invoice: SalesInvoice) => {
    if (invoice.status === 'PAID' || Number(invoice.paidAmount || 0) > 0) {
      return error('This invoice already has an amount cleared. Record an adjustment instead.');
    }
    if (!confirm(`Cancel invoice ${invoice.invoiceNumber}?`)) return;
    setIsSaving(true);
    try {
      if (!activeBusinessId || !activeShopId) return error('The shop is still loading. Try again.');
      const result = await SalesInvoiceService.cancel({
        invoiceId: invoice.id,
        businessId: activeBusinessId,
        shopId: activeShopId,
      });
      await Promise.allSettled([
        db.salesInvoices.reload(),
        db.customers.reload(),
        db.products.reload(),
        db.stockMovements.reload(),
      ]);
      setSelectedInvoice(result.invoice);
      success('Invoice cancelled.');
    } catch (err: any) {
      error('Could not cancel invoice: ' + err.message);
    } finally {
      setIsSaving(false);
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
    <div className="w-full animate-in fade-in space-y-5 pb-28 md:pb-8">
      <section className="rounded-lg border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-black text-slate-950">Invoices</h2>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs font-bold text-slate-500">
            <span>{invoices.length} invoices</span>
            <span className="text-slate-300">/</span>
            <span className="text-rose-600">{money(unpaidTotal)} not cleared</span>
            <span className="text-slate-300">/</span>
            <span>{services.length} services</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <button
            type="button"
            onClick={() => openServiceModal()}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-slate-700 hover:border-blue-300 hover:text-blue-700"
          >
            <BriefcaseBusiness size={16} /> Service
          </button>
          <button
            type="button"
            onClick={() => { resetInvoiceForm(); setIsInvoiceModalOpen(true); }}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 px-4 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-800"
          >
            <Plus size={16} /> Invoice
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Not cleared</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-rose-600">{money(unpaidTotal)}</p>
        </div>
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Cleared this month</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{money(paidThisMonth)}</p>
        </div>
        <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-3">
          <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Ready services</p>
          <p className="mt-1 text-2xl font-black tabular-nums text-slate-950">{activeServices.length}</p>
        </div>
      </div>
      </section>

      <div className="flex flex-col gap-3 rounded-lg border-2 border-slate-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex rounded-lg border-2 border-slate-200 bg-slate-50 p-1">
          {([
            ['INVOICES', 'Invoices'],
            ['SERVICES', 'Services'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`h-10 rounded-md px-4 text-xs font-black uppercase tracking-widest ${mode === id ? 'bg-blue-700 text-white' : 'text-slate-600'}`}
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
              className="h-11 rounded-lg border-2 border-slate-200 bg-white px-3 text-xs font-black uppercase tracking-widest text-slate-600 outline-none focus:border-blue-600"
            >
              <option value="ALL">All status</option>
              <option value="SENT">Not cleared</option>
              <option value="PARTIAL">Part cleared</option>
              <option value="PAID">Cleared</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          )}
          <div className="relative min-w-0 sm:w-80">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={mode === 'INVOICES' ? 'Search customer or invoice...' : 'Search services...'}
              className="h-11 w-full rounded-lg border-2 border-slate-200 bg-white pl-10 pr-4 text-sm font-bold outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
            />
          </div>
        </div>
      </div>

      {mode === 'INVOICES' ? (
        <section className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm">
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
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
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
            <div className="rounded-lg border-2 border-slate-200 bg-white p-10 text-center shadow-sm md:col-span-2 xl:col-span-3">
              <BriefcaseBusiness size={44} className="mx-auto mb-3 text-slate-200" />
              <p className="text-sm font-black text-slate-700">No services yet.</p>
              <p className="mt-1 text-xs font-bold text-slate-400">Add services like delivery, repair, installation, design, transport, or labour.</p>
            </div>
          ) : filteredServices.map(service => (
            <button
              key={service.id}
              type="button"
              onClick={() => openServiceModal(service)}
              className="rounded-lg border-2 border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-blue-300"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50 text-blue-700">
                  <BriefcaseBusiness size={20} />
                </span>
                <span className={`rounded-full px-3 py-1 text-[9px] font-black uppercase tracking-widest ${Number(service.isActive) === 0 ? 'bg-slate-100 text-slate-500' : 'bg-emerald-50 text-emerald-600'}`}>
                  {Number(service.isActive) === 0 ? 'Hidden' : 'Active'}
                </span>
              </div>
              <h3 className="truncate text-sm font-black text-slate-900">{service.name}</h3>
              <p className="mt-1 truncate text-[10px] font-bold uppercase tracking-widest text-slate-400">{service.category || 'General'}</p>
              {service.description && <p className="mt-3 line-clamp-2 text-xs font-semibold text-slate-500">{service.description}</p>}
              <p className="mt-4 text-xs font-black uppercase tracking-widest text-slate-400">Set amount when billing</p>
            </button>
          ))}
        </section>
      )}

      {isInvoiceModalOpen && (
        <div className="mobile-vv-overlay fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4">
          <div className="mobile-vv-panel max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-xl sm:rounded-lg">
            <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-base font-black text-slate-900">New invoice</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">For products, services, or custom work</p>
              </div>
              <button onClick={() => setIsInvoiceModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500">
                <X size={18} />
              </button>
            </div>

            <div className="modal-scroll-padding max-h-[calc(92vh-74px)] overflow-y-auto p-5">
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
                      <span className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">Due date</span>
                      <input
                        type="date"
                        value={invoiceForm.dueDate}
                        onChange={e => setInvoiceForm(prev => ({ ...prev, dueDate: e.target.value }))}
                        className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600"
                      />
                    </label>
                  </div>

                  <div className="rounded-lg border-2 border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
                      <select
                        value={lineInput.itemType}
                        onChange={e => setLineInput({ itemType: e.target.value as any, itemId: '', name: '', quantity: '1', unitPrice: '', taxCategory: 'A' })}
                        className="h-12 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-black text-slate-700 outline-none focus:border-blue-600"
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
                          className="h-12 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600"
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
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_7rem]">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={lineInput.quantity}
                        onChange={e => setLineInput(prev => ({ ...prev, quantity: e.target.value }))}
                        placeholder="Qty"
                        className="h-12 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600"
                      />
                      <input
                        type="number"
                        min="0"
                        value={lineInput.unitPrice}
                        onChange={e => setLineInput(prev => ({ ...prev, unitPrice: e.target.value }))}
                        placeholder="Amount"
                        className="h-12 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600"
                      />
                      <select
                        value={lineInput.taxCategory}
                        onChange={e => setLineInput(prev => ({ ...prev, taxCategory: e.target.value as 'A' | 'E' }))}
                        className="h-12 rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-black text-slate-700 outline-none focus:border-blue-600"
                      >
                        <option value="A">VAT</option>
                        <option value="E">No VAT</option>
                      </select>
                      <button onClick={addLine} type="button" className="col-span-2 h-12 rounded-lg border-2 border-blue-700 bg-blue-700 px-5 text-xs font-black uppercase tracking-widest text-white hover:bg-blue-800 md:col-span-1 md:w-full">
                        Add
                      </button>
                    </div>
                  </div>

                  <div className="overflow-hidden rounded-lg border-2 border-slate-200 bg-white">
                    {lines.length === 0 ? (
                      <div className="px-4 py-10 text-center text-sm font-bold text-slate-400">No invoice lines yet.</div>
                    ) : lines.map(line => (
                      <div key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-black text-slate-900">{line.name}</p>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            {itemTypeLabel(line.itemType)} | Qty {line.quantity} | {isVatLine(line) ? 'VAT' : 'No VAT'}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <p className="text-sm font-black tabular-nums text-slate-900">{money(lineAmount(line) + lineVat(line))}</p>
                          <button onClick={() => setLines(prev => prev.filter(row => row.id !== line.id))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600">
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
                    className="min-h-24 w-full rounded-lg border-2 border-slate-200 bg-white p-4 text-sm font-bold outline-none focus:border-blue-600"
                  />
                </div>

                <aside className="h-fit rounded-lg border-2 border-slate-200 bg-white p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Invoice total</p>
                  <p className="mt-2 text-3xl font-black tabular-nums text-slate-950">{money(totals.total)}</p>
                  <div className="mt-5 space-y-2 rounded-lg border-2 border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700">
                    <div className="flex justify-between"><span className="text-slate-500">Before VAT</span><span>{money(totals.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">VAT</span><span>{money(totals.tax)}</span></div>
                  </div>
                  <button
                    type="button"
                    onClick={saveInvoice}
                    disabled={isSaving}
                    className="mobile-popup-sticky-action mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-blue-700 bg-blue-700 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-blue-800"
                  >
                    <Send size={16} /> {isSaving ? 'Saving...' : 'Create invoice'}
                  </button>
                </aside>
              </div>
            </div>
          </div>
        </div>
      )}

      {isServiceModalOpen && (
        <div className="mobile-vv-overlay fixed inset-0 z-[110] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4">
          <div className="mobile-vv-panel modal-scroll-padding w-full max-w-lg overflow-y-auto rounded-t-2xl border-2 border-slate-200 bg-white p-5 shadow-xl sm:rounded-lg">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900">{editingService ? 'Edit service' : 'Add service'}</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">For service provider invoices</p>
              </div>
              <button onClick={() => setIsServiceModalOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input value={serviceForm.name} onChange={e => setServiceForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Service name" className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input value={serviceForm.category} onChange={e => setServiceForm(prev => ({ ...prev, category: e.target.value }))} placeholder="Category" className="h-12 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600" />
                <div className="flex h-12 items-center rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 text-xs font-black uppercase tracking-widest text-slate-400">
                  Amount is added on the invoice
                </div>
              </div>
              <textarea value={serviceForm.description} onChange={e => setServiceForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Short description" className="min-h-24 w-full rounded-lg border-2 border-slate-200 bg-white p-4 text-sm font-bold outline-none focus:border-blue-600" />
              <div className="grid grid-cols-2 gap-3">
                <select value={serviceForm.taxCategory} onChange={e => setServiceForm(prev => ({ ...prev, taxCategory: e.target.value as 'A' | 'E' }))} className="h-12 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-600">
                  <option value="A">VAT</option>
                  <option value="E">No VAT</option>
                </select>
                <label className="flex h-12 items-center gap-3 rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700">
                  <input type="checkbox" checked={serviceForm.isActive} onChange={e => setServiceForm(prev => ({ ...prev, isActive: e.target.checked }))} />
                  Active
                </label>
              </div>
              <button onClick={saveService} disabled={isSaving} className="mobile-popup-sticky-action h-12 w-full rounded-lg border-2 border-blue-700 bg-blue-700 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-blue-800">
                {isSaving ? 'Saving...' : 'Save service'}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedInvoice && (
        <DocumentDetailsModal
          selectedRecord={selectedInvoice}
          setSelectedRecord={record => setSelectedInvoice(record as SalesInvoice | null)}
          handleRefund={async () => {}}
          extraActions={(
            <>
              <button
                type="button"
                onClick={() => {
                  setPaymentInvoice(selectedInvoice);
                  setPaymentForm({ amount: String(selectedInvoice.balance || ''), method: 'CASH', reference: '' });
                  setSelectedInvoice(null);
                }}
                disabled={selectedInvoice.status === 'PAID' || selectedInvoice.status === 'CANCELLED'}
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-black uppercase tracking-widest text-white disabled:opacity-40 hover:bg-blue-800"
              >
                <Banknote size={16} /> Clear
              </button>
              <button
                type="button"
                onClick={() => cancelInvoice(selectedInvoice)}
                disabled={isSaving || selectedInvoice.status === 'PAID' || selectedInvoice.status === 'CANCELLED' || Number(selectedInvoice.paidAmount || 0) > 0}
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-xs font-black uppercase tracking-widest text-rose-700 disabled:opacity-40"
              >
                <Trash2 size={16} /> Cancel
              </button>
            </>
          )}
        />
      )}

      {paymentInvoice && (
        <div className="mobile-vv-overlay fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4">
          <div className="mobile-vv-panel modal-scroll-padding w-full max-w-md overflow-y-auto rounded-t-2xl border-2 border-slate-200 bg-white p-5 shadow-xl sm:rounded-lg">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-slate-900">Clear invoice balance</h3>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{paymentInvoice.invoiceNumber}</p>
              </div>
              <button onClick={() => setPaymentInvoice(null)} className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-slate-200 bg-white text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input type="number" min="0" value={paymentForm.amount} onChange={e => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))} placeholder="Amount to clear" className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600" />
              <select value={paymentForm.method} onChange={e => setPaymentForm(prev => ({ ...prev, method: e.target.value as any }))} className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-black text-slate-700 outline-none focus:border-blue-600">
                <option value="CASH">Cash</option>
                <option value="MPESA">M-Pesa</option>
                <option value="BANK">Bank</option>
                <option value="PDQ">Card</option>
                <option value="CHEQUE">Cheque</option>
              </select>
              <input value={paymentForm.reference} onChange={e => setPaymentForm(prev => ({ ...prev, reference: e.target.value }))} placeholder="Code or note" className="h-12 w-full rounded-lg border-2 border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-600" />
              <button onClick={applyPayment} disabled={isSaving} className="mobile-popup-sticky-action h-12 w-full rounded-lg border-2 border-blue-700 bg-blue-700 text-xs font-black uppercase tracking-widest text-white disabled:opacity-50 hover:bg-blue-800">
                {isSaving ? 'Saving...' : 'Clear balance'}
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
    SENT: 'border-rose-100 bg-rose-50 text-rose-600',
    PARTIAL: 'border-amber-100 bg-amber-50 text-amber-700',
    PAID: 'border-emerald-100 bg-emerald-50 text-emerald-600',
    CANCELLED: 'border-slate-200 bg-slate-100 text-slate-500',
  };
  const labels: Record<SalesInvoice['status'], string> = {
    SENT: 'Not cleared',
    PARTIAL: 'Part cleared',
    PAID: 'Cleared',
    CANCELLED: 'Cancelled',
  };
  return (
    <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-widest ${styles[status]}`}>
      {status === 'PAID' ? <CheckCircle2 size={11} /> : status === 'SENT' ? <WalletCards size={11} /> : <ArrowRight size={11} />}
      {labels[status]}
    </span>
  );
}
