import React from 'react';
import { ChevronRight } from 'lucide-react';

interface NestedControlPanelProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  isOpen: boolean;
  onToggle: () => void;
  level?: number;
  children: React.ReactNode;
}

export default function NestedControlPanel({
  title,
  subtitle,
  icon,
  badge,
  isOpen,
  onToggle,
  level = 0,
  children,
}: NestedControlPanelProps) {
  const indentClass = level > 0 ? 'ml-2 border-l border-slate-200 pl-3' : '';
  return (
    <div className={indentClass}>
      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        <button
          onClick={onToggle}
          className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex items-center gap-3 min-w-0">
            {icon ? (
              <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900 truncate">{title}</p>
              {subtitle ? <p className="text-[10px] font-bold text-slate-400 truncate">{subtitle}</p> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge}
            <ChevronRight size={14} className={`text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
          </div>
        </button>
        {isOpen ? <div className="border-t border-slate-100 bg-slate-50 p-3">{children}</div> : null}
      </div>
    </div>
  );
}

