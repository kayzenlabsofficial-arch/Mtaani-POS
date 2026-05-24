import { AlertCircle, Building2, LogIn, Lock, RefreshCw, ShoppingCart, User } from 'lucide-react';
import type { LoginScreenProps } from './LoginTypes';

export default function LoginScreenMobile({
  businessCode,
  setBusinessCode,
  username,
  setUsername,
  password,
  setPassword,
  handleLogin,
  isLoggingIn,
  loginError,
  isOnline,
}: LoginScreenProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-8 font-hanken">
      <div className="w-full max-w-md">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/30">
            <ShoppingCart className="h-5 w-5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-xl font-black text-white">Mtaani POS</span>
        </div>

        <div className="mb-10">
          <h2 className="mb-2 text-3xl font-black text-white">Welcome back</h2>
          <p className="font-medium text-slate-400">Sign in to access your business dashboard.</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Business code</label>
            <div className="relative">
              <Building2 className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
              <input
                type="text"
                placeholder="e.g. MTAANI01"
                className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={businessCode}
                onChange={(event) => setBusinessCode(event.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Username</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
              <input
                type="text"
                placeholder="Enter your username"
                className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="mb-2 ml-1 block text-[10px] font-black uppercase tracking-widest text-slate-400">Password</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" strokeWidth={2.2} />
              <input
                type="password"
                placeholder="Enter your password"
                className="w-full rounded-2xl border border-slate-800 bg-slate-900 py-4 pl-12 pr-5 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:border-primary focus:ring-2 focus:ring-primary/20"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>

          {loginError && (
            <div className="flex items-start gap-3 rounded-2xl border border-rose-900/50 bg-rose-950/50 p-4 text-rose-400">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-400" strokeWidth={2.2} />
              <p className="text-sm font-medium">{loginError}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoggingIn}
            className="mt-2 flex w-full items-center justify-center gap-3 rounded-2xl bg-primary py-4 text-sm font-black uppercase tracking-widest text-white shadow-lg shadow-primary/30 transition-all hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoggingIn ? (
              <>
                <RefreshCw className="h-5 w-5 animate-spin" strokeWidth={2.4} />
                Signing in...
              </>
            ) : (
              <>
                <LogIn className="h-5 w-5" strokeWidth={2.4} />
                Sign in
              </>
            )}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-center gap-2">
          <div className={`h-2 w-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'animate-pulse bg-amber-500'}`} />
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
            {isOnline ? 'Cloud connected' : 'Offline mode - data saved locally'}
          </p>
        </div>
      </div>
    </div>
  );
}
