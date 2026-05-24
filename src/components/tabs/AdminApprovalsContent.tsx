import React from 'react';
import { useLiveQuery } from '../../clouddb';
import { db, type CashPick, type Expense, type PurchaseOrder, type StockAdjustmentRequest, type Supplier, type Transaction } from '../../db';
import { useToast } from '../../context/ToastContext';
import { useStore } from '../../store';
import { AlertCircle, Banknote, Check, ChevronRight, Clock, Eye, FileMinus, Package, PackagePlus, RotateCcw, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { approveExpenseRequest, approveRefundTransaction } from '../../utils/approvalWorkflows';
import { belongsToActiveShop } from '../../utils/shopScope';
import { StockService } from '../../services/stock';
import { PurchaseService } from '../../services/purchases';
import { ExpenseService } from '../../services/expenses';
import { SalesService } from '../../services/sales';
import { CashService } from '../../services/operations';

type ApprovalTabId = 'EXPENSES' | 'REFUNDS' | 'PURCHASES' | 'STOCK' | 'CASH_PICKS';
type ApprovalMode = 'desktop' | 'mobile';

interface DocumentDetailsModalProps {
  selectedRecord: any | null;
  setSelectedRecord: React.Dispatch<React.SetStateAction<any | null>>;
  handleRefund: (transaction: Transaction, itemsToReturn?: { productId: string; quantity: number }[]) => Promise<void>;
  onApprove?: (record: any) => Promise<void>;
  onReject?: (record: any) => Promise<void>;
}

interface ApprovalTab {
  id: ApprovalTabId;
  label: string;
  count: number;
  icon: LucideIcon;
}

interface AdminApprovalsContentProps {
  DocumentDetailsModal: React.ComponentType<DocumentDetailsModalProps>;
  mode: ApprovalMode;
}

const moneyText = (value: unknown) => `Ksh ${(Number(value) || 0).toLocaleString()}`;

const formatDate = (timestamp?: number) => timestamp ? new Date(timestamp).toLocaleDateString() : 'Unknown date';
const formatDateTime = (timestamp?: number) => timestamp ? new Date(timestamp).toLocaleString() : 'Unknown time';

const firstReceiptPart = (id?: string) => id ? id.split('-')[0].toUpperCase() : 'Unknown';

export default function AdminApprovalsContent({ DocumentDetailsModal, mode }: AdminApprovalsContentProps) {
  const currentUser = useStore(state => state.currentUser);
  const activeShopId = useStore(state => state.activeShopId);
  const activeBusinessId = useStore(state => state.activeBusinessId);

  const pendingAdjustments = useLiveQuery(() => activeBusinessId && activeShopId ? db.stockAdjustmentRequests.where('shopId').equals(activeShopId).and(x => x.businessId === activeBusinessId && x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const pendingPicks = useLiveQuery(() => activeBusinessId && activeShopId ? db.cashPicks.where('shopId').equals(activeShopId).and(x => x.businessId === activeBusinessId && x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const pendingExpenses = useLiveQuery(() => activeBusinessId && activeShopId ? db.expenses.where('shopId').equals(activeShopId).and(x => x.businessId === activeBusinessId && x.status === 'PENDING').toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const pendingRefunds = useLiveQuery(() => activeBusinessId && activeShopId ? db.transactions.where('shopId').equals(activeShopId).and(x => x.businessId === activeBusinessId && x.status === 'PENDING_REFUND').toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const pendingPOs = useLiveQuery(() => activeBusinessId && activeShopId ? db.purchaseOrders.where('shopId').equals(activeShopId).and(x => x.businessId === activeBusinessId && x.approvalStatus === 'PENDING').toArray() : Promise.resolve([]), [activeBusinessId, activeShopId], []);
  const allSuppliers = useLiveQuery(
    () => activeBusinessId ? db.suppliers.where('businessId').equals(activeBusinessId).filter(s => belongsToActiveShop(s, activeShopId)).toArray() : Promise.resolve([]),
    [activeBusinessId, activeShopId],
    []
  );

  const [selectedRecordForDetails, setSelectedRecordForDetails] = React.useState<any | null>(null);
  const [activeTab, setActiveTab] = React.useState<ApprovalTabId>('EXPENSES');
  const userSelectedTabRef = React.useRef(false);

  const { success, error } = useToast();

  const tabs = React.useMemo<ApprovalTab[]>(() => [
    { id: 'EXPENSES', label: 'Expenses', count: pendingExpenses.length, icon: FileMinus },
    { id: 'REFUNDS', label: 'Refunds', count: pendingRefunds.length, icon: RotateCcw },
    { id: 'PURCHASES', label: 'Purchases', count: pendingPOs.length, icon: PackagePlus },
    { id: 'STOCK', label: 'Stock', count: pendingAdjustments.length, icon: Package },
    { id: 'CASH_PICKS', label: 'Cash picks', count: pendingPicks.length, icon: Banknote },
  ], [pendingAdjustments.length, pendingExpenses.length, pendingPicks.length, pendingPOs.length, pendingRefunds.length]);

  React.useEffect(() => {
    if (userSelectedTabRef.current) return;
    setActiveTab(tabs.find(tab => tab.count > 0)?.id || 'EXPENSES');
  }, [tabs]);

  const supplierById = React.useMemo(() => {
    const map = new Map<string, Supplier>();
    (allSuppliers || []).forEach(supplier => map.set(supplier.id, supplier));
    return map;
  }, [allSuppliers]);

  const activeTabConfig = tabs.find(tab => tab.id === activeTab) || tabs[0];
  const ActiveIcon = activeTabConfig.icon;
  const totalPending = tabs.reduce((sum, tab) => sum + tab.count, 0);
  const isMobile = mode === 'mobile';

  const selectTab = (tabId: ApprovalTabId) => {
    userSelectedTabRef.current = true;
    setActiveTab(tabId);
  };

  const handleApproveAdjustment = async (req: StockAdjustmentRequest) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await StockService.approveAdjustment({
        requestId: req.id,
        shopId: activeShopId,
        businessId: activeBusinessId,
        approvedBy: currentUser?.name || 'Administrator',
      });
      await Promise.allSettled([
        db.products.reload(),
        db.stockMovements.reload(),
        db.stockAdjustmentRequests.reload(),
      ]);
      success('Stock adjustment approved.');
    } catch (err: any) {
      error(err.message || 'Stock adjustment approval failed.');
    }
  };

  const handleApproveExpense = async (expense: Expense) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await approveExpenseRequest(expense, {
        approvedBy: currentUser?.name || 'Administrator',
        activeShopId,
        activeBusinessId
      });
      success('Expense approved.');
    } catch (err: any) {
      error(err.message || 'Expense approval failed.');
    }
  };

  const handleApprovePO = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await PurchaseService.setApproval({
        purchaseOrderId: id,
        action: 'APPROVE',
        approvedBy: currentUser?.name || 'Administrator',
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.purchaseOrders.reload();
      success('Purchase Order approved for receiving.');
    } catch (err: any) {
      error(err.message || 'Purchase order approval failed.');
    }
  };

  const handleRejectExpense = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await ExpenseService.reject({
        expenseId: id,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.expenses.reload();
      success('Expense request rejected.');
    } catch (err: any) {
      error(err.message || 'Expense rejection failed.');
    }
  };

  const handleRejectPO = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await PurchaseService.setApproval({
        purchaseOrderId: id,
        action: 'REJECT',
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.purchaseOrders.reload();
      success('Purchase Order rejected.');
    } catch (err: any) {
      error(err.message || 'Purchase order rejection failed.');
    }
  };

  const handleApproveRefund = async (transaction: Transaction) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await approveRefundTransaction(transaction, undefined, {
        approvedBy: currentUser?.name || 'Administrator',
        activeShopId,
        activeBusinessId
      });
      success('Refund approved and stock returned.');
    } catch (err: any) {
      error(err.message || 'Refund approval failed.');
    }
  };

  const handleRejectAdjustment = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await StockService.rejectAdjustment({
        requestId: id,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.stockAdjustmentRequests.reload();
      success('Adjustment request rejected.');
    } catch (err: any) {
      error(err.message || 'Adjustment rejection failed.');
    }
  };

  const handleRejectRefund = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await SalesService.rejectRefund({
        transactionId: id,
        shopId: activeShopId,
        businessId: activeBusinessId,
      });
      await db.transactions.reload();
      success('Refund request rejected.');
    } catch (err: any) {
      error(err.message || 'Refund rejection failed.');
    }
  };

  const handleConfirmBanking = async (id: string) => {
    if (!activeShopId || !activeBusinessId) return;
    try {
      await CashService.approvePick({ cashPickId: id, businessId: activeBusinessId, shopId: activeShopId });
      await Promise.allSettled([db.cashPicks.reload(), db.financialAccounts.reload()]);
      success('Cash deposit confirmed.');
    } catch (err: any) {
      error(err.message || 'Cash deposit confirmation failed.');
    }
  };

  const emptyState = (title: string, detail: string) => (
    <div className="rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">
        <AlertCircle size={18} />
      </div>
      <p className="text-sm font-black text-slate-900">{title}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{detail}</p>
    </div>
  );

  const renderExpenses = () => {
    if (pendingExpenses.length === 0) return emptyState('No pending expenses', 'New expense requests will appear here.');

    return (
      <div className="space-y-3">
        {pendingExpenses.map((expense: Expense) => (
          <button
            type="button"
            key={expense.id}
            onClick={() => setSelectedRecordForDetails({ ...expense, recordType: 'EXPENSE' })}
            className="group flex w-full items-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-black text-slate-950">{expense.category || 'Expense'}</p>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-600">@{expense.userName || expense.preparedBy || 'System'}</span>
                <Eye size={13} className="text-slate-300 group-hover:text-blue-500" />
              </div>
              <p className="mt-1 truncate text-xs font-semibold text-slate-500">{expense.description || 'No description'}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-black text-slate-950">{moneyText(expense.amount)}</p>
              <p className="mt-1 text-[10px] font-bold text-slate-500">{formatDate(expense.timestamp)}</p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-slate-400 group-hover:text-blue-600" />
          </button>
        ))}
      </div>
    );
  };

  const renderRefunds = () => {
    if (pendingRefunds.length === 0) return emptyState('No pending refunds', 'Refund requests will appear here.');

    return (
      <div className="space-y-3">
        {pendingRefunds.map((transaction: Transaction) => (
          <button
            type="button"
            key={transaction.id}
            onClick={() => setSelectedRecordForDetails({ ...transaction, recordType: 'SALE' })}
            className="group flex w-full items-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
          >
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-black text-slate-950">Receipt #{firstReceiptPart(transaction.id)}</p>
                <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-600">@{transaction.cashierName || 'System'}</span>
                <Eye size={13} className="text-slate-300 group-hover:text-blue-500" />
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">Items: {transaction.items?.length || 0} / {formatDate(transaction.timestamp)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-base font-black text-slate-950">{moneyText(transaction.total)}</p>
              <p className="mt-1 text-[10px] font-bold text-slate-500">Pending refund</p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-slate-400 group-hover:text-blue-600" />
          </button>
        ))}
      </div>
    );
  };

  const renderPurchases = () => {
    if (pendingPOs.length === 0) return emptyState('No pending purchases', 'Purchase orders waiting for approval will appear here.');

    return (
      <div className="space-y-3">
        {pendingPOs.map((order: PurchaseOrder) => {
          const supplier = supplierById.get(order.supplierId);
          const displayId = order.poNumber || (order.id?.startsWith('PO-') ? order.id : firstReceiptPart(order.id));
          return (
            <button
              type="button"
              key={order.id}
              onClick={() => setSelectedRecordForDetails({ ...order, recordType: 'PURCHASE_ORDER' })}
              className="group flex w-full items-center gap-3 rounded-lg border-2 border-slate-200 bg-white p-4 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/30"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-black text-slate-950">{supplier?.company || supplier?.name || 'Unknown supplier'}</p>
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-600">PO #{displayId}</span>
                  <Eye size={13} className="text-slate-300 group-hover:text-blue-500" />
                </div>
                <p className="mt-1 text-xs font-semibold text-slate-500">Items: {order.items?.length || 0} / {formatDate(order.orderDate)}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-base font-black text-slate-950">{moneyText(order.totalAmount)}</p>
                <p className="mt-1 text-[10px] font-bold text-slate-500">Pending review</p>
              </div>
              <ChevronRight size={18} className="shrink-0 text-slate-400 group-hover:text-blue-600" />
            </button>
          );
        })}
      </div>
    );
  };

  const renderStockAdjustments = () => {
    if (pendingAdjustments.length === 0) return emptyState('No pending stock changes', 'Stock adjustment requests will appear here.');

    return (
      <div className="space-y-3">
        {pendingAdjustments.map((request: StockAdjustmentRequest) => (
          <div key={request.id} className="rounded-lg border-2 border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-slate-950">{request.productName || 'Unknown product'}</p>
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-slate-500"><Clock size={13} /> {formatDate(request.timestamp)}</p>
              </div>
              {request.preparedBy && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-black text-slate-600">By {request.preparedBy}</span>}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[10px] font-black uppercase text-slate-500">Current</p>
                <p className="mt-1 text-lg font-black text-slate-700">{request.oldQty}</p>
              </div>
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-[10px] font-black uppercase text-blue-700">Requested</p>
                <p className="mt-1 text-lg font-black text-blue-700">{request.newQty}</p>
              </div>
            </div>

            <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">{request.reason || 'No reason provided'}</p>
            <div className="mt-4 flex gap-2">
              <button onClick={() => handleApproveAdjustment(request)} className="flex-1 rounded-lg bg-blue-600 px-3 py-2.5 text-xs font-black text-white transition-colors hover:bg-blue-700">
                <Check size={14} className="mr-1 inline" /> Approve
              </button>
              <button onClick={() => handleRejectAdjustment(request.id)} className="flex-1 rounded-lg border-2 border-slate-200 bg-white px-3 py-2.5 text-xs font-black text-slate-700 transition-colors hover:border-red-200 hover:text-red-600">
                <X size={14} className="mr-1 inline" /> Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderCashPicks = () => {
    if (pendingPicks.length === 0) return emptyState('No pending cash picks', 'Cash pick confirmations will appear here.');

    return (
      <div className="space-y-3">
        {pendingPicks.map((pick: CashPick) => (
          <div key={pick.id} className="flex flex-col gap-4 rounded-lg border-2 border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-black text-slate-950">Cash pickup</p>
                {pick.userName && <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-black text-slate-600">@{pick.userName}</span>}
              </div>
              <p className="mt-1 text-xs font-semibold text-slate-500">{formatDateTime(pick.timestamp)}</p>
              <p className="mt-2 text-lg font-black text-slate-950">{moneyText(pick.amount)}</p>
            </div>
            <button
              onClick={() => handleConfirmBanking(pick.id)}
              className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-black text-white transition-colors hover:bg-blue-700"
            >
              <Check size={15} className="mr-1 inline" /> Confirm banked
            </button>
          </div>
        ))}
      </div>
    );
  };

  const renderActiveTab = () => {
    if (activeTab === 'EXPENSES') return renderExpenses();
    if (activeTab === 'REFUNDS') return renderRefunds();
    if (activeTab === 'PURCHASES') return renderPurchases();
    if (activeTab === 'STOCK') return renderStockAdjustments();
    return renderCashPicks();
  };

  return (
    <div className={`${isMobile ? 'p-3 pb-6' : 'p-5 pb-8'} mx-auto h-full w-full max-w-5xl animate-in fade-in overflow-y-auto no-scrollbar`}>
      <div className="mb-4 rounded-lg border-2 border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-black text-slate-950">Approvals</h2>
            <p className="mt-1 text-sm font-semibold text-slate-500">Choose a request type and review what needs action.</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700">
            {totalPending} pending
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-lg border-2 border-slate-200 bg-white p-2">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={`flex min-w-max items-center gap-2 rounded-lg border-2 px-3 py-2 text-sm font-black transition-colors ${
                  isActive
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50'
                }`}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
                {tab.count > 0 && (
                  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${
                    isActive ? 'bg-white text-blue-700' : 'bg-blue-600 text-white'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border-2 border-slate-200 bg-white p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-blue-700">
              <ActiveIcon size={18} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-950">{activeTabConfig.label}</h3>
              <p className="text-xs font-semibold text-slate-500">{activeTabConfig.count} request{activeTabConfig.count === 1 ? '' : 's'} waiting</p>
            </div>
          </div>
        </div>

        {renderActiveTab()}
      </div>

      <DocumentDetailsModal
        selectedRecord={selectedRecordForDetails}
        setSelectedRecord={setSelectedRecordForDetails}
        handleRefund={async transaction => handleApproveRefund(transaction)}
        onApprove={async record => {
          if (record.recordType === 'EXPENSE') await handleApproveExpense(record);
          if (record.recordType === 'PURCHASE_ORDER') await handleApprovePO(record.id);
          if (record.recordType === 'SALE') await handleApproveRefund(record);
        }}
        onReject={async record => {
          if (record.recordType === 'EXPENSE') await handleRejectExpense(record.id);
          if (record.recordType === 'PURCHASE_ORDER') await handleRejectPO(record.id);
          if (record.recordType === 'SALE') await handleRejectRefund(record.id);
        }}
      />
    </div>
  );
}
