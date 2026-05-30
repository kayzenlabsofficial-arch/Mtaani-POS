import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingStateProps {
  title?: string;
  detail?: string;
  progress?: number;
  className?: string;
  icon?: React.ReactNode;
}

export default function LoadingState({
  title = 'Loading...',
  detail,
  progress = 12,
  className = '',
  icon,
}: LoadingStateProps) {
  const safeProgress = Math.min(98, Math.max(8, Math.round(progress)));

  return (
    <div className={`flex min-h-[55vh] flex-col items-center justify-center gap-4 p-4 text-center ${className}`}>
      <div className="flex h-16 w-16 items-center justify-center rounded-lg border-2 border-slate-200 bg-slate-50">
        {icon || <Loader2 size={30} className="animate-spin text-blue-700" />}
      </div>
      <div className="w-full max-w-xs space-y-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</p>
        {detail && <p className="text-sm font-semibold leading-5 text-slate-500">{detail}</p>}
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-700 transition-all duration-500"
            style={{ width: `${safeProgress}%` }}
          />
        </div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{safeProgress}%</p>
      </div>
    </div>
  );
}
