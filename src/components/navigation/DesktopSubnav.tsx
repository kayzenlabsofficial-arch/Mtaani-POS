import React from 'react';
import {
  Archive,
  BarChart3,
  CalendarDays,
  ClipboardList,
  Download,
  FileDown,
  FileText,
  Filter,
  Landmark,
  Package,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Truck,
  UserPlus,
  Users,
  WalletCards,
  X,
} from 'lucide-react';
import { desktopNavLabel } from './desktopNavItems';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll';

type IconLike = React.ElementType | string;

export type DesktopSubnavItem = {
  id: string;
  label: string;
  count?: number | string;
  active?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  onClick?: () => void;
  icon?: IconLike;
};

export type DesktopSubnavAction = {
  id: string;
  label: string;
  disabled?: boolean;
  hidden?: boolean;
  busy?: boolean;
  onClick: () => void;
  icon?: IconLike;
  tone?: 'primary' | 'neutral' | 'danger';
};

export type DesktopSubnavSearch = {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  onEnter?: (value: string) => void;
};

export type DesktopSubnavSummary = {
  label: string;
  value: string | number;
};

export type DesktopSubnavConfig = {
  id: string;
  label?: string;
  tabs?: DesktopSubnavItem[];
  filters?: DesktopSubnavItem[];
  search?: DesktopSubnavSearch;
  controls?: React.ReactNode;
  summary?: DesktopSubnavSummary[];
  actions?: DesktopSubnavAction[];
};

type DesktopSubnavContextValue = {
  setConfig: (config: DesktopSubnavConfig) => void;
  clearConfig: (id?: string) => void;
};

const iconMap: Record<string, React.ElementType> = {
  add: Plus,
  analytics: BarChart3,
  archive: Archive,
  assignment_turned_in: ClipboardList,
  calendar: CalendarDays,
  categories: Package,
  credit_card: WalletCards,
  download: Download,
  export: FileDown,
  file: FileText,
  filter: Filter,
  inventory: Package,
  inventory_2: Package,
  payments: WalletCards,
  point_of_sale: Store,
  receipt_long: FileText,
  refresh: RefreshCw,
  scan: ScanLine,
  search: Search,
  settings: Settings,
  shopping_bag: ShoppingBag,
  sliders: SlidersHorizontal,
  store: Store,
  suppliers: Truck,
  users: Users,
  user_add: UserPlus,
  wallet: Landmark,
};

const DesktopSubnavContext = React.createContext<DesktopSubnavContextValue | null>(null);
const DesktopSubnavStateContext = React.createContext<DesktopSubnavConfig | null>(null);

function iconFor(icon?: IconLike) {
  if (!icon) return null;
  if (typeof icon === 'string') return iconMap[icon] || Plus;
  return icon;
}

export function DesktopSubnavProvider({ activeKey, children }: { activeKey: string; children: React.ReactNode }) {
  const [config, setConfigState] = React.useState<DesktopSubnavConfig | null>(null);
  const activeConfigId = React.useRef<string | null>(null);

  React.useEffect(() => {
    activeConfigId.current = null;
    setConfigState(null);
  }, [activeKey]);

  const setConfig = React.useCallback((nextConfig: DesktopSubnavConfig) => {
    activeConfigId.current = nextConfig.id;
    setConfigState(nextConfig);
  }, []);

  const clearConfig = React.useCallback((id?: string) => {
    if (id && activeConfigId.current && activeConfigId.current !== id) return;
    activeConfigId.current = null;
    setConfigState(null);
  }, []);

  const value = React.useMemo(() => ({ setConfig, clearConfig }), [clearConfig, setConfig]);

  return (
    <DesktopSubnavContext.Provider value={value}>
      <DesktopSubnavStateContext.Provider value={config}>
        {children}
      </DesktopSubnavStateContext.Provider>
    </DesktopSubnavContext.Provider>
  );
}

export function useDesktopSubnav(config: DesktopSubnavConfig | null) {
  const context = React.useContext(DesktopSubnavContext);
  const setConfig = context?.setConfig;
  const clearConfig = context?.clearConfig;

  React.useEffect(() => {
    if (!setConfig || !clearConfig || !config) return;
    setConfig(config);
    return () => clearConfig(config.id);
  }, [clearConfig, config, setConfig]);
}

function ControlButton({ item }: { item: DesktopSubnavItem }) {
  const Icon = iconFor(item.icon);
  return (
    <button
      type="button"
      onClick={item.onClick}
      disabled={item.disabled}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        item.active
          ? 'bg-blue-700 text-white shadow-sm shadow-blue-900/10'
          : 'text-blue-950 hover:bg-white/75 hover:text-blue-800'
      }`}
    >
      {Icon && <Icon size={15} strokeWidth={2.4} />}
      <span className="whitespace-nowrap">{item.label}</span>
      {item.count !== undefined && (
        <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-[10px] font-black ${item.active ? 'bg-white/20 text-white' : 'bg-white text-slate-500'}`}>
          {item.count}
        </span>
      )}
    </button>
  );
}

function ActionButton({ action }: { action: DesktopSubnavAction }) {
  const Icon = iconFor(action.icon);
  const tone = action.tone || 'neutral';
  const className = tone === 'primary'
    ? 'border-blue-700 bg-blue-700 text-white hover:bg-blue-800'
    : tone === 'danger'
      ? 'border-rose-200 bg-white text-rose-700 hover:bg-rose-50'
      : 'border-slate-200 bg-white text-slate-800 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800';

  return (
    <button
      type="button"
      onClick={action.onClick}
      disabled={action.disabled || action.busy}
      className={`inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {Icon && <Icon size={15} strokeWidth={2.4} className={action.busy ? 'animate-spin' : ''} />}
      <span className="whitespace-nowrap">{action.busy ? 'Working' : action.label}</span>
    </button>
  );
}

function SearchField({ search }: { search: DesktopSubnavSearch }) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} strokeWidth={2.4} />
      <input
        type="text"
        value={search.value}
        onChange={event => search.onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter') return;
          search.onEnter?.(search.value);
        }}
        placeholder={search.placeholder}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 text-sm font-semibold text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100"
      />
      {search.value && (
        <button
          type="button"
          onClick={search.onClear || (() => search.onChange(''))}
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Clear search"
        >
          <X size={14} strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

export function DesktopSubnavBar({ activeTab, config }: { activeTab: string; config?: DesktopSubnavConfig | null }) {
  const tabStripRef = useHorizontalWheelScroll<HTMLDivElement>();
  const actionStripRef = useHorizontalWheelScroll<HTMLDivElement>();
  const filterStripRef = useHorizontalWheelScroll<HTMLDivElement>();
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [isToolsOpen, setIsToolsOpen] = React.useState(false);
  const visibleTabs = (config?.tabs || []).filter(item => !item.hidden);
  const visibleFilters = (config?.filters || []).filter(item => !item.hidden);
  const visibleActions = (config?.actions || []).filter(item => !item.hidden);
  const summary = config?.summary || [];
  const hasControls = visibleTabs.length || visibleFilters.length || visibleActions.length || config?.search || config?.controls || summary.length;
  const hasPopoverControls = Boolean(config?.search || visibleFilters.length || config?.controls);
  const toolsLabel = config?.search
    ? visibleFilters.length || config?.controls
      ? 'Search & filters'
      : 'Search'
    : visibleFilters.length
      ? 'Filters'
      : 'Options';
  const fallbackLabel = config?.label || desktopNavLabel(activeTab);

  React.useEffect(() => {
    setIsToolsOpen(false);
  }, [activeTab, config?.id]);

  React.useEffect(() => {
    if (!isToolsOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!popoverRef.current || popoverRef.current.contains(event.target as Node)) return;
      setIsToolsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsToolsOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isToolsOpen]);

  return (
    <div className="sticky top-16 z-40 border-b border-blue-200 bg-sky-100/95 shadow-lg shadow-blue-950/10 backdrop-blur-xl">
      <div className="mx-auto flex min-h-14 w-full max-w-[1600px] items-center gap-3 px-4 py-2 lg:px-6">
        <div ref={tabStripRef} className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scroll-smooth overscroll-x-contain no-scrollbar">
          {visibleTabs.length ? visibleTabs.map(item => (
            <div key={item.id} className="contents">
              <ControlButton item={item} />
            </div>
          )) : (
            <span className="inline-flex h-9 shrink-0 items-center rounded-full bg-blue-700 px-4 text-sm font-bold text-white shadow-sm shadow-blue-900/10">
              {fallbackLabel}
            </span>
          )}
        </div>

        {summary.length > 0 && (
          <div className="hidden shrink-0 items-center gap-2 xl:flex">
            {summary.map(item => (
              <span key={item.label} className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-white/75 px-3 text-xs font-bold text-slate-600">
                <span>{item.label}</span>
                <span className="text-slate-950">{item.value}</span>
              </span>
            ))}
          </div>
        )}

        {hasPopoverControls && (
          <div ref={popoverRef} className="relative shrink-0">
            <button
              type="button"
              onClick={() => setIsToolsOpen(open => !open)}
              className={`inline-flex h-9 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors ${
                isToolsOpen
                  ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
                  : 'border-blue-200 bg-white/75 text-blue-950 hover:border-blue-300 hover:bg-white hover:text-blue-800'
              }`}
              aria-expanded={isToolsOpen}
            >
              <SlidersHorizontal size={15} strokeWidth={2.4} />
              <span className="hidden whitespace-nowrap sm:inline">{toolsLabel}</span>
            </button>

            {isToolsOpen && (
              <div className="absolute right-0 top-full z-50 mt-2 w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-blue-100 bg-white p-4 shadow-2xl shadow-blue-950/15">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wide text-blue-700">{fallbackLabel}</p>
                    <h2 className="text-sm font-black text-slate-950">{toolsLabel}</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsToolsOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                    aria-label="Close search and filters"
                  >
                    <X size={16} strokeWidth={2.4} />
                  </button>
                </div>

                <div className="space-y-4">
                  {config?.search && <SearchField search={config.search} />}

                  {visibleFilters.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Filters</p>
                      <div ref={filterStripRef} className="flex max-h-28 flex-wrap items-center gap-2 overflow-y-auto scroll-smooth pr-1">
                        {visibleFilters.map(item => (
                          <div key={item.id} className="contents">
                            <ControlButton item={item} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {config?.controls && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-black uppercase tracking-wide text-slate-500">Options</p>
                      <div className="flex max-h-52 min-w-0 flex-wrap items-center gap-2 overflow-y-auto pr-1">
                        {config.controls}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {visibleActions.length > 0 && (
          <div ref={actionStripRef} className="flex shrink-0 items-center gap-2 overflow-x-auto scroll-smooth overscroll-x-contain no-scrollbar">
            {visibleActions.map(action => (
              <div key={action.id} className="contents">
                <ActionButton action={action} />
              </div>
            ))}
          </div>
        )}

        {!hasControls && (
          <span className="text-xs font-semibold text-slate-400">Ready</span>
        )}
      </div>
    </div>
  );
}

export function DesktopSubnavHost({ activeTab }: { activeTab: string }) {
  const config = React.useContext(DesktopSubnavStateContext);
  return <DesktopSubnavBar activeTab={activeTab} config={config} />;
}

export { DesktopSubnavContext };
