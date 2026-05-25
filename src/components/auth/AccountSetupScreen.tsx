import React, { useMemo, useState } from 'react';
import { AlertCircle, Lock, LogOut, RefreshCw, ShieldCheck, User } from 'lucide-react';
import type { User as POSUser } from '../../db';
import { AccountService, type SafeUser } from '../../services/account';

type AccountSetupScreenProps = {
  currentUser: Omit<POSUser, 'password'> & { password?: string };
  isOnline: boolean;
  onComplete: (user: SafeUser) => void;
  onLogout: () => void;
};

function isFlagEnabled(value: unknown) {
  return Number(value || 0) === 1;
}

export default function AccountSetupScreen({ currentUser, isOnline, onComplete, onLogout }: AccountSetupScreenProps) {
  const isBootstrapAdmin = isFlagEnabled(currentUser?.isBootstrapAdmin);
  const [name, setName] = useState(isBootstrapAdmin ? '' : currentUser?.name || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const title = isBootstrapAdmin ? 'Create your admin account' : 'Create a new password';
  const subtitle = isBootstrapAdmin
    ? 'This temporary login can only be used to set up the real administrator account.'
    : 'This account was reset by system admin and needs a fresh password before continuing.';
  const canSubmit = useMemo(() => {
    return name.trim().length > 0 && password.length >= 4 && confirmPassword.length >= 4 && !isSaving;
  }, [confirmPassword.length, isSaving, name, password.length]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    const trimmedName = name.trim();
    if (!trimmedName) return setError('Enter the account name.');
    if (isBootstrapAdmin && trimmedName.toLowerCase() === 'admin') {
      return setError('Choose your own admin username instead of admin.');
    }
    if (password.length < 4) return setError('Password must be at least 4 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setError('');
    setIsSaving(true);
    try {
      const result = await AccountService.completeSetup({ name: trimmedName, password });
      onComplete(result.user);
    } catch (err: any) {
      setError(err?.message || 'Could not complete account setup.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-[var(--visual-viewport-height,100dvh)] overflow-y-auto bg-slate-950 px-5 py-6 font-hanken text-white sm:px-8">
      <div className="mx-auto flex min-h-[calc(var(--visual-viewport-height,100dvh)-3rem)] w-full max-w-lg flex-col justify-center py-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30">
              <ShieldCheck className="h-5 w-5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-lg font-black leading-tight">Smart POS</p>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Account setup</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-800 bg-slate-900 text-slate-400 transition hover:border-slate-700 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut className="h-5 w-5" strokeWidth={2.3} />
          </button>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:p-7">
          <div className="mb-6">
            <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-400">{subtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                {isBootstrapAdmin ? 'Admin username' : 'Username'}
              </label>
              <div className="relative">
                <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
                <input
                  type="text"
                  autoComplete="username"
                  placeholder={isBootstrapAdmin ? 'e.g. mary-admin' : 'Enter your username'}
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">New password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Minimum 4 characters"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Confirm password</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder="Re-type new password"
                  className="w-full rounded-xl border border-slate-800 bg-slate-950 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 rounded-xl border border-rose-900/50 bg-rose-950/50 p-4 text-rose-300">
                <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0" strokeWidth={2.2} />
                <p className="text-sm font-semibold">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="flex w-full items-center justify-center gap-3 rounded-xl bg-primary py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-primary/30 transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                  Saving...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
                  Finish setup
                </>
              )}
            </button>
          </form>
        </div>

        <div className="mt-6 flex items-center justify-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            {isOnline ? 'Cloud connected' : 'Connect to finish setup'}
          </p>
        </div>
      </div>
    </div>
  );
}
