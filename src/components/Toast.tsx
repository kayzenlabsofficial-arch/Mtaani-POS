import React from 'react';
import { CheckCircle2, AlertCircle, Info, XCircle, X } from 'lucide-react';

interface ToastProps {
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  onClose: () => void;
}

export default function Toast({ type, message, onClose }: ToastProps) {
  const configs = {
    success: {
      icon: CheckCircle2,
      bg: 'bg-green-500',
      border: 'border-green-600',
    },
    error: {
      icon: XCircle,
      bg: 'bg-red-500',
      border: 'border-red-600',
    },
    warning: {
      icon: AlertCircle,
      bg: 'bg-orange-500',
      border: 'border-orange-600',
    },
    info: {
      icon: Info,
      bg: 'bg-blue-500',
      border: 'border-blue-600',
    },
  };

  const { icon: Icon, bg, border } = configs[type];

  return (
    <div className={`flex items-center gap-3 p-4 rounded-2xl shadow-xl border ${bg} ${border} text-white animate-in slide-in-from-bottom-full pointer-events-auto`}>
      <Icon size={20} className="shrink-0" />
      <p className="text-sm font-bold flex-1">{message}</p>
      <button 
        onClick={onClose} 
        className="p-1 hover:bg-white/20 rounded-lg transition-colors"
      >
        <X size={16} />
      </button>
    </div>
  );
}
