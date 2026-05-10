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
    <div className="min-h-screen bg-slate-950 flex font-hanken">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-primary via-blue-600 to-indigo-700 relative overflow-hidden flex-col items-center justify-center p-16">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />
        <div className="relative text-center">
          <div className="w-24 h-24 bg-white/20 backdrop-blur-sm rounded-3xl flex items-center justify-center mb-8 mx-auto shadow-2xl border border-white/20">
            <MaterialIcon name="point_of_sale" className="text-white text-5xl" />
          </div>
          <h1 className="text-5xl font-black text-white mb-4 tracking-tight">Mtaani POS</h1>
          <p className="text-blue-100 text-lg font-medium max-w-xs mx-auto leading-relaxed">
            Enterprise-grade point of sale for modern Kenyan businesses.
          </p>
          <div className="mt-12 grid grid-cols-3 gap-6 text-center">
            {[
              { icon: 'cloud_sync', label: 'Cloud Sync' },
              { icon: 'offline_bolt', label: 'Works Offline' },
              { icon: 'shield_lock', label: 'Secure' },
            ].map(f => (
              <div key={f.label} className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 bg-white/15 rounded-2xl flex items-center justify-center border border-white/20">
                  <MaterialIcon name={f.icon} className="text-white" />
                </div>
                <p className="text-[10px] font-bold text-blue-200 uppercase tracking-widest">{f.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: Login form */}
      <div className="flex-1 flex items-center justify-center p-8 lg:p-16">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center shadow-lg shadow-primary/30">
              <MaterialIcon name="point_of_sale" className="text-white" />
            </div>
            <span className="text-xl font-black text-white">Mtaani POS</span>
          </div>

          <div className="mb-10">
            <h2 className="text-3xl font-black text-white mb-2">Welcome back</h2>
            <p className="text-slate-400 font-medium">Sign in to access your business dashboard.</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Business Code</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                  <MaterialIcon name="business" className="text-xl" />
                </div>
                <input 
                  type="text" 
                  placeholder="e.g. MTAANI01" 
                  className="w-full bg-slate-900 border border-slate-800 focus:border-primary rounded-2xl pl-12 pr-5 py-4 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:ring-2 focus:ring-primary/20" 
                  value={businessCode} 
                  onChange={(e) => setBusinessCode(e.target.value.toUpperCase())} 
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Username</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                  <MaterialIcon name="person" className="text-xl" />
                </div>
                <input 
                  type="text" 
                  placeholder="Enter your username" 
                  className="w-full bg-slate-900 border border-slate-800 focus:border-primary rounded-2xl pl-12 pr-5 py-4 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:ring-2 focus:ring-primary/20" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Password</label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">
                  <MaterialIcon name="lock" className="text-xl" />
                </div>
                <input 
                  type="password" 
                  placeholder="Enter your password" 
                  className="w-full bg-slate-900 border border-slate-800 focus:border-primary rounded-2xl pl-12 pr-5 py-4 text-sm font-bold text-white outline-none transition-all placeholder:text-slate-600 focus:ring-2 focus:ring-primary/20" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                />
              </div>
            </div>

            {loginError && (
              <div className="flex items-start gap-3 p-4 bg-rose-950/50 border border-rose-900/50 rounded-2xl text-rose-400">
                <MaterialIcon name="error" className="text-rose-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-medium">{loginError}</p>
              </div>
            )}

            <button 
              type="submit" 
              disabled={isLoggingIn} 
              className="w-full py-4 bg-primary text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg shadow-primary/30 hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {isLoggingIn ? (
                <>
                  <MaterialIcon name="sync" className="animate-spin" />
                  Signing in...
                </>
              ) : (
                <>
                  <MaterialIcon name="login" />
                  Sign In
                </>
              )}
            </button>
          </form>

          <div className="mt-8 flex items-center justify-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
            <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
              {isOnline ? 'Cloud Connected' : 'Offline Mode — Data saved locally'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
