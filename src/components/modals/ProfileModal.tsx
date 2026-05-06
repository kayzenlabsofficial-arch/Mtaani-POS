import React, { useState } from 'react';
import { User, KeyRound, Save, X, ShieldCheck, LogOut } from 'lucide-react';
import { db } from '../../db';
import { verifyPassword, hashPassword } from '../../security';
import { useToast } from '../../context/ToastContext';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: any;
}

export default function ProfileModal({ isOpen, onClose, currentUser }: ProfileModalProps) {
  const { success, error, warning } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentPassword || !newPassword || !confirmPassword) {
      warning("Please fill in all password fields.");
      return;
    }

    if (newPassword !== confirmPassword) {
      error("New passwords do not match.");
      return;
    }

    if (newPassword.length < 4) {
      error("New password must be at least 4 characters.");
      return;
    }

    setIsSaving(true);
    try {
      // 1. Verify current password
      const isCorrect = await verifyPassword(currentPassword, currentUser.password);
      if (!isCorrect) {
        error("Incorrect current password.");
        setIsSaving(false);
        return;
      }

      // 2. Hash and update
      const hashed = await hashPassword(newPassword);
      await db.users.update(currentUser.id, { 
        password: hashed,
        updated_at: Date.now() 
      });

      // 3. Sync to cloud
      await db.sync();
      
      success("Password updated successfully.");
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onClose();
    } catch (err: any) {
      error("Failed to update password: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      
      <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl relative z-10 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center border border-slate-200 text-blue-600 shadow-sm">
              <User size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">My profile</h2>
              <p className="text-[10px] font-bold text-slate-400 mt-0.5 capitalize">{currentUser?.role?.toLowerCase()}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-200 text-slate-400 transition-colors">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleUpdatePassword} className="p-6 space-y-5">
          <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 flex items-center gap-3">
            <ShieldCheck size={18} className="text-blue-600 shrink-0" />
            <p className="text-[11px] font-bold text-blue-700 leading-tight">
              To change your password, please verify your identity by entering your current password.
            </p>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-1">Current password</label>
            <div className="relative">
              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="password" 
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-all" 
                placeholder="••••••••"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="h-px bg-slate-100 mx-2" />

          <div className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-1">New password</label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="password" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-all" 
                  placeholder="At least 4 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 mb-2 ml-1">Confirm new password</label>
              <div className="relative">
                <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input 
                  type="password" 
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-4 py-3 text-sm font-bold text-slate-900 focus:outline-none focus:border-blue-500 transition-all" 
                  placeholder="Re-type new password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button 
              type="submit" 
              disabled={isSaving}
              className="w-full bg-blue-600 text-white font-bold text-sm py-4 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 transition-all disabled:opacity-50"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <Save size={18} />
                  Change password
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
