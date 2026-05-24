import type React from 'react';
import { useVisualViewport } from '../../hooks/useVisualViewport';

type MobileModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
type MobileModalPlacement = 'bottom' | 'center' | 'top';

type MobileModalProps = {
  children: React.ReactNode;
  footer?: React.ReactNode;
  header?: React.ReactNode;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  placement?: MobileModalPlacement;
  size?: MobileModalSize;
  zIndexClassName?: string;
  overlayClassName?: string;
  backdropClassName?: string;
  panelClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  animateFrom?: 'bottom' | 'zoom' | 'right' | 'none';
  dataTestId?: string;
};

const sizeClass: Record<MobileModalSize, string> = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  full: 'max-w-none',
};

const placementClass: Record<MobileModalPlacement, string> = {
  bottom: 'items-end justify-center p-0 sm:items-center sm:p-4',
  center: 'items-center justify-center p-4',
  top: 'items-start justify-center p-3 sm:p-4',
};

const animationClass: Record<NonNullable<MobileModalProps['animateFrom']>, string> = {
  bottom: 'animate-in slide-in-from-bottom duration-300',
  zoom: 'animate-in zoom-in-95 duration-200',
  right: 'animate-in slide-in-from-right duration-300',
  none: '',
};

export default function MobileModal({
  children,
  footer,
  header,
  onClose,
  closeOnBackdrop = true,
  placement = 'bottom',
  size = 'md',
  zIndexClassName = 'z-50',
  overlayClassName = '',
  backdropClassName = 'bg-slate-950/60 backdrop-blur-sm',
  panelClassName = '',
  bodyClassName = '',
  footerClassName = '',
  animateFrom = placement === 'bottom' ? 'bottom' : 'zoom',
  dataTestId,
}: MobileModalProps) {
  const viewport = useVisualViewport();
  const visibleHeight = viewport.height || 0;

  return (
    <div
      className={`fixed left-0 right-0 ${zIndexClassName} flex min-h-0 ${placementClass[placement]} ${overlayClassName}`}
      data-keyboard-open={viewport.isKeyboardOpen ? 'true' : undefined}
      data-testid={dataTestId}
      style={{
        top: viewport.offsetTop,
        height: visibleHeight ? `${visibleHeight}px` : '100dvh',
      }}
    >
      <div className={`absolute inset-0 ${backdropClassName}`} onClick={() => closeOnBackdrop && onClose?.()} />
      <div
        className={`relative z-10 flex min-h-0 w-full ${sizeClass[size]} flex-col overflow-hidden rounded-t-2xl border-2 border-slate-200 bg-white shadow-2xl sm:rounded-lg ${animationClass[animateFrom]} ${panelClassName}`}
        style={{ maxHeight: placement === 'center' ? 'calc(100% - 2rem)' : '100%' }}
      >
        {header}
        <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain no-scrollbar ${bodyClassName}`}>
          {children}
        </div>
        {footer && (
          <div className={`shrink-0 border-t border-slate-100 bg-white pb-[calc(1rem+env(safe-area-inset-bottom))] ${footerClassName}`}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
