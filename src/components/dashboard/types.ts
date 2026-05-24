export type DashboardQuickAction = {
  label: string;
  icon: string;
  busy?: boolean;
  onClick: () => void;
};

export type DashboardMetric = {
  label: string;
  value: string | number;
  sub: string;
  trend?: number;
  icon: string;
  locked?: boolean;
};

export type DashboardShiftRow = {
  id: string;
  label: string;
  status: string;
  tillId?: string;
  tillName?: string;
  cashierName: string;
  startTime?: number;
  endTime?: number;
  totalSales: number;
  cashSales: number;
  pdqSales?: number;
  mpesaSales: number;
  totalExpenses: number;
  supplierPaymentsTotal: number;
  totalRefunds: number;
  totalPicks: number;
  expectedCash?: number;
  actualCashDrawer: number;
  difference: number;
};

export type DashboardTrend = {
  time: string;
  sales: number;
};

export type DashboardMoneyBreakdown = {
  label: string;
  value: string;
  detail: string;
  icon: string;
  tone: string;
  locked?: boolean;
};

export type DashboardShiftClosePreviewPublic = {
  since: number;
  until: number;
  shiftId: string;
};

export type DashboardModel = {
  currentUser: any;
  activeShop: any;
  canSeeSalesData: boolean;
  isCashier: boolean;
  ownerModeActive: boolean;
  pendingApprovalCount: number;
  actualCashDrawer: number;
  cashDrawerLimit: number;
  shouldSweepCash: boolean;
  sweepAmount: number;
  isBankingExcess: boolean;
  openOwnerSettings: () => void;
  handleBankExcessCash: () => void;
  adminShiftRows: DashboardShiftRow[];
  adminShiftTotals: Record<string, number>;
  metrics: DashboardMetric[];
  moneyBreakdown: DashboardMoneyBreakdown[];
  salesTrendData: DashboardTrend[];
  trendView: 'DAY' | 'WEEK';
  setTrendView: (view: 'DAY' | 'WEEK') => void;
  quickActions: DashboardQuickAction[];
};

export type DashboardModalsProps = {
  isOpenShiftModalOpen: boolean;
  setIsOpenShiftModalOpen: (open: boolean) => void;
  configuredTills: Array<{ id: string; name: string; isActive?: boolean }>;
  availableTills: Array<{ id: string; name: string; isActive?: boolean }>;
  selectedTillId: string;
  setSelectedTillId: (id: string) => void;
  openingCashAmount: string;
  setOpeningCashAmount: (value: string) => void;
  isOpeningShift: boolean;
  confirmOpenShift: () => void;
  isCashPickModalOpen: boolean;
  isPickingCash: boolean;
  setIsCashPickModalOpen: (open: boolean) => void;
  cashPickAmount: string;
  setCashPickAmount: (value: string) => void;
  cashPickValue: number;
  canOperateOwnShift: boolean;
  handleCreateCashPick: () => void;
  shiftClosePreview: DashboardShiftClosePreviewPublic | null;
  shiftClosingCash: string;
  setShiftClosingCash: (value: string) => void;
  isClosingShift: boolean;
  setShiftClosePreview: (preview: any) => void;
  confirmCloseShift: () => void;
};
