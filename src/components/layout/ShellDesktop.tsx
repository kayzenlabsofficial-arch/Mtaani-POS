import React from 'react';
import {
  LogOut,
  MoreHorizontal,
  RefreshCw,
  Store,
} from 'lucide-react';
import { canOpenTab } from '../../utils/accessControl';
import { activeDesktopNavId, desktopNavItems } from '../navigation/desktopNavItems';
import { useHorizontalWheelScroll } from '../../hooks/useHorizontalWheelScroll';

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
  activeTab,
  onTabChange,
  onLogout,
  isSyncing,
  onSync,
  isOnline,
  currentUser,
  businessSettings,
}: any) {
  const shopName = String(activeShop?.name || 'Main shop');
  const isAdmin = currentUser?.role === 'ADMIN';
  const selectedNavId = activeDesktopNavId(activeTab);
  const navScrollRef = useHorizontalWheelScroll<HTMLElement>();
  const visibleItems = desktopNavItems.filter(item => {
    if (item.id === 'ADMIN_PANEL' || item.id === 'SETTINGS') return isAdmin;
    return canOpenTab(currentUser, businessSettings, item.id);
  });

  return (
    <>
    <header className="sticky top-0 z-50 w-full border-b border-blue-900/40 bg-blue-950 text-white shadow-lg shadow-blue-950/20 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1600px] flex-row items-center justify-between gap-3 px-4 lg:px-6">
        <nav ref={navScrollRef} className="min-w-0 flex-1 overflow-x-auto scroll-smooth overscroll-x-contain no-scrollbar" aria-label="Main navigation">
          <div className="flex flex-row items-center justify-start gap-1 xl:gap-2 2xl:gap-4">
            {visibleItems.map(item => {
              const Icon = item.icon;
              const isActive = selectedNavId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onTabChange?.(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`relative flex h-16 w-[72px] shrink-0 flex-col items-center justify-center space-y-1 rounded-lg text-xs font-black transition-colors ${
                    isActive
                      ? 'bg-white/10 text-white'
                      : 'text-blue-100/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon size={19} strokeWidth={2.3} />
                  <span className="stable-title max-w-full truncate text-[10px] leading-none">{item.label}</span>
                  <span className={`absolute bottom-0 h-1 w-6 rounded-full transition-opacity ${isActive ? 'bg-sky-300 opacity-100' : 'opacity-0'}`} />
                </button>
              );
            })}
          </div>
        </nav>

        <div className="flex shrink-0 items-center justify-end gap-2">
          <button
            onClick={onSync}
            className={`flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-blue-100 transition-all hover:border-sky-300/40 hover:bg-white/10 hover:text-white active:scale-95 ${isSyncing ? 'animate-pulse border-sky-300/50 bg-white/10 text-white' : ''}`}
            title="Sync data"
            aria-label="Sync data"
          >
            <MaterialIcon name="sync" className={isSyncing ? 'animate-spin' : ''} style={{ fontSize: '20px' }} />
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/15 text-blue-100 transition-colors hover:border-rose-300/50 hover:bg-rose-500/15 hover:text-white"
            title="Log out"
            aria-label="Log out"
          >
            <LogOut size={19} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    </header>
    <footer className="pointer-events-none fixed bottom-3 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-2 overflow-hidden rounded-full border border-blue-800/70 bg-blue-950/90 px-3 py-2 text-[11px] font-bold text-blue-100 shadow-lg shadow-blue-950/20 backdrop-blur-xl">
      <span className="truncate text-white">{activeBusiness?.name || 'Smart POS'}</span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-blue-500" />
      <span className="truncate">{shopName}</span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-blue-500" />
      <span className="truncate">{currentUser?.name || 'User'}</span>
      <span className="hidden shrink-0 text-blue-300 sm:inline">{currentUser?.role ? `(${String(currentUser.role).toLowerCase()})` : ''}</span>
      <span className="h-1 w-1 shrink-0 rounded-full bg-blue-500" />
      <span className={`inline-flex shrink-0 items-center gap-1.5 ${isOnline ? 'text-emerald-300' : 'text-amber-300'}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
        {isOnline ? 'Online' : 'Offline'}
      </span>
    </footer>
    </>
  );
}
