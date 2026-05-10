import React from 'react';

const MaterialIcon = ({ name, className = "" }: { name: string, className?: string }) => (
  <span className={`material-symbols-outlined ${className}`}>{name}</span>
);

interface LoginScreenProps {
  businessCode: string;
  setBusinessCode: (val: string) => void;
  username: string;
  setUsername: (val: string) => void;
  password: string;
  setPassword: (val: string) => void;
  handleLogin: (e: React.FormEvent) => void;
  isLoggingIn: boolean;
  loginError: string;
  isOnline: boolean;
}

export function LoginScreen({
  businessCode, setBusinessCode,
  username, setUsername,
  password, setPassword,
  handleLogin, isLoggingIn,
  loginError, isOnline
}: LoginScreenProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 font-hanken">
      <div className="w-full max-w-md bg-white rounded-md border border-outline-variant p-10 shadow-lg animate-in slide-up">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 bg-primary rounded-xl flex items-center justify-center mb-4 shadow-blue">
             <MaterialIcon name="store" className="text-white text-3xl" />
          </div>
          <h1 className="text-2xl font-bold text-primary">Mtaani POS</h1>
          <p className="text-on-surface-variant font-mono text-[10px] uppercase tracking-widest mt-2">Log in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-1.5">
             <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Business Code</label>
             <input type="text" placeholder="Enter Business Code" className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-5 py-3 text-sm font-bold text-on-surface focus:border-primary outline-none transition-all" value={businessCode} onChange={(e) => setBusinessCode(e.target.value.toUpperCase())} />
          </div>
          <div className="space-y-1.5">
             <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Username</label>
             <input type="text" placeholder="Enter Username" className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-5 py-3 text-sm font-bold text-on-surface focus:border-primary outline-none transition-all" value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
          <div className="space-y-1.5">
             <label className="text-[10px] font-bold text-outline uppercase tracking-widest ml-2">Password</label>
             <input type="password" placeholder="Enter Password" className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-5 py-3 text-sm font-bold text-on-surface focus:border-primary outline-none transition-all" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>

          {loginError && (
            <div className="p-4 bg-error-container text-on-error-container rounded-md flex items-center gap-3 animate-in fade-in">
               <MaterialIcon name="error" className="text-error" />
               <p className="text-xs font-bold">{loginError}</p>
            </div>
          )}

          <button type="submit" disabled={isLoggingIn} className="w-full py-4 bg-primary text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-md hover:bg-primary-container active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50">
             {isLoggingIn ? <MaterialIcon name="sync" className="animate-spin text-sm" /> : <MaterialIcon name="login" className="text-sm" />}
             Log In
          </button>
        </form>

        <p className="mt-10 text-center text-[10px] font-bold text-outline uppercase tracking-tighter">
          Cloud Sync Status: {isOnline ? 'Online Ready' : 'Local Offline Mode'}
        </p>
      </div>
    </div>
  );
}
