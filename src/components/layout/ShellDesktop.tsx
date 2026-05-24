import React from 'react';
import {
  MoreHorizontal,
  RefreshCw,
  Store,
} from 'lucide-react';

const MaterialIcon = ({ name, className = '', style = {} }: { name: string; className?: string; style?: any }) => {
  const icons: Record<string, React.ElementType> = {
    storefront: Store,
    sync: RefreshCw,
  };
  const Icon = icons[name] || MoreHorizontal;
  const { fontSize, ...rest } = style || {};
  const size = typeof fontSize === 'number' ? fontSize : Number.parseInt(String(fontSize || 20), 10);
  return <Icon className={className} style={rest} size={Number.isFinite(size) ? size : 20} strokeWidth={2.4} />;
};

export function TopHeaderDesktop({
  activeBusiness,
  activeShop,
  isSyncing,
  onSync,
  isOnline,
  onOpenProfile,
  currentUser,
}: any) {
  const shopName = String(activeShop?.name || 'Main shop');

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <div className="flex h-16 w-full items-center justify-between gap-3 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-800 bg-slate-950 text-white shadow-sm">
            <MaterialIcon name="storefront" style={{ fontSize: '20px' }} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-xs font-black uppercase leading-none tracking-widest text-slate-900">
              {activeBusiness?.name || 'Mtaani POS'}
            </span>
            <span className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
              {shopName}
            </span>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${isOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
            <div className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
            {isOnline ? 'Online' : 'Offline'}
          </div>

          <button
            onClick={onSync}
            className={`flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary active:scale-95 ${isSyncing ? 'animate-pulse border-primary/30 bg-primary/5 text-primary' : ''}`}
            title="Sync data"
          >
            <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} style={{ fontSize: '20px' }} />
          </button>

          <button
            onClick={onOpenProfile}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 py-1.5 pl-2 pr-3 text-left transition-all hover:border-primary/30 hover:bg-white"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-[10px] font-black text-white">
              {currentUser?.name?.charAt(0)?.toUpperCase()}
            </div>
            <div className="flex min-w-0 flex-col leading-none">
              <span className="stable-title max-w-32 text-[11px] font-bold text-slate-800">{currentUser?.name}</span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
                {currentUser?.role === 'ADMIN' ? 'Admin' : currentUser?.role === 'CASHIER' ? 'Cashier' : currentUser?.role}
              </span>
            </div>
          </button>
        </div>
      </div>
    </header>
  );
}
