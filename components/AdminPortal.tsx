import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  IndianRupee,
  KeyRound,
  LogOut,
  Package,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { LIMITS } from '../src/constants';
import { OrderRecord, StoreConfig, VaultItem } from '../src/types';
import { UpiQrBox } from './UpiQrBox';

interface AdminPortalProps {
  storeConfig: StoreConfig;
  onConfigUpdated: (newConfig: StoreConfig) => void;
  onBackToStore: () => void;
}

type AdminTab = 'orders' | 'qr_settings' | 'site_settings' | 'inventory' | 'security';

export const AdminPortal: React.FC<AdminPortalProps> = ({
  storeConfig,
  onConfigUpdated,
  onBackToStore,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | OrderRecord['status']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [credDrafts, setCredDrafts] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);

  const [newVaultText, setNewVaultText] = useState('');
  const [newVaultNote, setNewVaultNote] = useState('');
  const [newVaultPool, setNewVaultPool] = useState<'permanent' | 'rental_24h'>('rental_24h');
  const [addingVault, setAddingVault] = useState(false);

  const [formConfig, setFormConfig] = useState<StoreConfig>(storeConfig);
  const previousStoreConfig = useRef(storeConfig);
  const [savingSettings, setSavingSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState('');
  const [saveError, setSaveError] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [passwordConfigured, setPasswordConfigured] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'recover'>('login');
  const [authPassword, setAuthPassword] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('');
  const [currentAdminPassword, setCurrentAdminPassword] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [newAdminPasswordConfirm, setNewAdminPasswordConfirm] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [securityMessage, setSecurityMessage] = useState('');

  useEffect(() => {
    const previousConfig = previousStoreConfig.current;
    const nextFormConfig = { ...formConfig };
    let formChanged = false;

    for (const key of Object.keys(storeConfig) as (keyof StoreConfig)[]) {
      if (Object.is(formConfig[key], previousConfig[key])) {
        Object.assign(nextFormConfig, { [key]: storeConfig[key] });
        formChanged ||= !Object.is(formConfig[key], storeConfig[key]);
      }
    }

    previousStoreConfig.current = storeConfig;
    if (formChanged) {
      setFormConfig(nextFormConfig);
    }
  }, [storeConfig]);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/admin/auth/status');
        const data = await res.json();
        setPasswordConfigured(Boolean(data.configured));
        setRecoveryAvailable(Boolean(data.recoveryAvailable));
        setIsAuthenticated(Boolean(data.authenticated));
      } catch {
        setAuthError('Unable to connect to the server. Please try again.');
      } finally {
        setAuthChecked(true);
      }
    };
    checkAuth();
  }, []);

  const fetchAdminState = async () => {
    try {
      const res = await fetch('/api/admin/state');
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders || []);
      setVault(data.vault || []);
      if (data.storeConfig) {
        onConfigUpdated(data.storeConfig);
      }
    } catch {
      // ignore transient errors
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchAdminState();
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      fetchAdminState();
    };
    const timer = setInterval(fetchAdminState, 1000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  const handleCopyUtr = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(utr);
    setTimeout(() => setCopiedUtr(null), 1800);
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setSavingSettings(true);
    setSaveSuccess('');
    setSaveError('');

    try {
      const res = await fetch('/api/store', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Failed to update settings');
      } else {
        setFormConfig(data.storeConfig);
        onConfigUpdated(data.storeConfig);
        setSaveSuccess(
          `Settings saved. 7 Days: ${data.storeConfig.stock7DayGuaranteeAvailable} IDs · 1 Month: ${data.storeConfig.stock1MonthGuaranteeAvailable} IDs.`
        );
        setTimeout(() => setSaveSuccess(''), 3500);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAutoFillFromVault = (order: OrderRecord) => {
    const targetPool = order.isRental24h ? 'rental_24h' : 'permanent';
    const available = vault.filter(
      (v) => !v.isAssigned && (v.poolType === targetPool || !v.poolType)
    );
    const fallbackAvailable = available.length > 0 ? available : vault.filter((v) => !v.isAssigned);
    if (fallbackAvailable.length === 0) return;

    const lines = fallbackAvailable
      .slice(0, order.quantity)
      .map(
        (v) =>
          `Username: ${v.irctcUsername} | Password: ${v.irctcPassword}${
            v.accountNote ? ` | Note: ${v.accountNote}` : ''
          }`
      )
      .join('\n');

    setCredDrafts((prev) => ({ ...prev, [order.orderId]: lines }));
  };

  const handleVerifyOrder = async (order: OrderRecord) => {
    const fallbackPreset = order.isRental24h
      ? storeConfig.presetRentalCredentials || ''
      : storeConfig.presetPermanentCredentials || '';
    const credentials = (
      credDrafts[order.orderId] ??
      order.deliveredCredentials ??
      fallbackPreset
    ).trim();

    setBusyOrderId(order.orderId);
    try {
      const res = await fetch(`/api/admin/orders/${order.orderId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveredCredentials: credentials }),
      });
      if (res.ok) {
        await fetchAdminState();
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleRejectOrder = async (order: OrderRecord) => {
    setBusyOrderId(order.orderId);
    try {
      const res = await fetch(`/api/admin/orders/${order.orderId}/reject`, {
        method: 'POST',
      });
      if (res.ok) {
        await fetchAdminState();
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAdminState();
      }
    } catch {
      // ignore
    }
  };

  const handleAddVaultIds = async (e: React.FormEvent) => {
    e.preventDefault();
    const lines = newVaultText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    setAddingVault(true);
    try {
      const res = await fetch('/api/admin/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lines,
          accountNote: newVaultNote.trim(),
          poolType: newVaultPool,
        }),
      });
      if (res.ok) {
        setNewVaultText('');
        setNewVaultNote('');
        await fetchAdminState();
      }
    } finally {
      setAddingVault(false);
    }
  };

  const handleDeleteVaultItem = async (vaultId: string) => {
    try {
      const res = await fetch(`/api/admin/vault/${vaultId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAdminState();
      }
    } catch {
      // ignore
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthError('');
    setAuthMessage('');
    try {
      const res = await fetch('/api/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: authPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Admin login failed.');
      setIsAuthenticated(true);
      setAuthPassword('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Admin login failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handlePasswordRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthMessage('');
    if (recoveryPassword.length < 10) {
      setAuthError('New password must be at least 10 characters.');
      return;
    }
    if (recoveryPassword !== recoveryPasswordConfirm) {
      setAuthError('The new passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/auth/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recoveryKey, newPassword: recoveryPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Password recovery failed.');
      setAuthMode('login');
      setPasswordConfigured(true);
      setAuthMessage('Password reset. Sign in with your new password.');
      setRecoveryKey('');
      setRecoveryPassword('');
      setRecoveryPasswordConfirm('');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Password recovery failed.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleChangeAdminPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSecurityMessage('');
    setSaveError('');
    if (newAdminPassword.length < 10) {
      setSaveError('New password must be at least 10 characters.');
      return;
    }
    if (newAdminPassword !== newAdminPasswordConfirm) {
      setSaveError('The new passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await fetch('/api/admin/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: currentAdminPassword,
          newPassword: newAdminPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not change password.');
      setCurrentAdminPassword('');
      setNewAdminPassword('');
      setNewAdminPasswordConfirm('');
      setSecurityMessage('Admin password changed successfully.');
      setSaveError('');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not change password.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleAdminLogout = async () => {
    await fetch('/api/admin/auth/logout', { method: 'POST' });
    setIsAuthenticated(false);
    setActiveTab('orders');
  };

  const pendingCount = orders.filter((o) => o.status === 'pending_verification').length;
  const deliveredCount = orders.filter((o) => o.status === 'verified_delivered').length;
  const verifiedRevenue = orders
    .filter((o) => o.status === 'verified_delivered')
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);
  const readyVaultCount = vault.filter((v) => !v.isAssigned).length;

  const filteredOrders = orders.filter((o) => {
    if (statusFilter !== 'all' && o.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      o.orderId.toLowerCase().includes(q) ||
      o.utrNumber.toLowerCase().includes(q) ||
      o.customerReference.toLowerCase().includes(q) ||
      o.packLabel.toLowerCase().includes(q)
    );
  });

  const navItems: {
    id: AdminTab;
    label: string;
    subtitle: string;
    icon: React.ReactNode;
    badge?: number;
  }[] = [
    {
      id: 'orders',
      label: 'Orders & UTR Verify',
      subtitle: 'Verify UTR & dispatch IDs',
      icon: <Send className="w-4 h-4" />,
      badge: pendingCount,
    },
    {
      id: 'qr_settings',
      label: 'QR Code & UPI Setup',
      subtitle: 'Fixed UPI ID & manual payment review',
      icon: <QrCode className="w-4 h-4" />,
    },
    {
      id: 'site_settings',
      label: 'Prices & Site Control',
      subtitle: 'Rental, ID packs, Bulk & Guarantee rates',
      icon: <Settings className="w-4 h-4" />,
    },
    {
      id: 'inventory',
      label: 'Ready ID Vault',
      subtitle: 'Pre-load Rental & Permanent IDs',
      icon: <Package className="w-4 h-4" />,
      badge: readyVaultCount,
    },
    {
      id: 'security',
      label: 'Password & Security',
      subtitle: 'Change admin password',
      icon: <KeyRound className="w-4 h-4" />,
    },
  ];

  if (!authChecked) {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center text-slate-100">
        <p className="text-sm text-cyan-200">Checking admin session...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-shell min-h-screen flex items-center justify-center px-4 py-10 text-slate-100">
        <div className="w-full max-w-md neon-card-3d border-cyan-400/40 p-6 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-black text-white">Admin Sign In</h1>
              <p className="text-xs text-slate-400">Roshanbrand secure access</p>
            </div>
          </div>

          {!passwordConfigured && (
            <div className="mb-4 rounded-lg border border-amber-400/30 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-100">
              Admin password is not configured. Set <code>ADMIN_PASSWORD</code> and
              <code> ADMIN_RECOVERY_KEY</code> in the backend environment (Render dashboard for hosted
              deployments, or the server's <code>.env</code> file locally), then restart the backend.
            </div>
          )}
          {authMessage && (
            <p className="mb-3 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-3 text-xs text-emerald-200">
              {authMessage}
            </p>
          )}
          {authError && (
            <p className="mb-3 rounded-lg border border-red-400/30 bg-red-950/30 p-3 text-xs text-red-200">
              {authError}
            </p>
          )}

          {authMode === 'login' ? (
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                Admin password
                <input
                  required
                  autoComplete="current-password"
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                />
              </label>
              <button
                type="submit"
                disabled={authBusy || !passwordConfigured}
                className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {authBusy ? 'Please wait...' : 'Sign In'}
              </button>
              {recoveryAvailable && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('recover');
                    setAuthError('');
                    setAuthMessage('');
                  }}
                  className="w-full py-1 text-xs font-bold text-cyan-300 hover:text-white"
                >
                  Forgot password?
                </button>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordRecovery} className="space-y-3.5">
              <p className="text-xs leading-relaxed text-slate-300">
                Enter the recovery key configured on the server and choose a new password.
              </p>
              <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                Recovery key
                <input
                  required
                  autoComplete="off"
                  type="password"
                  value={recoveryKey}
                  onChange={(e) => setRecoveryKey(e.target.value)}
                  className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                New password
                <input
                  required
                  minLength={10}
                  autoComplete="new-password"
                  type="password"
                  value={recoveryPassword}
                  onChange={(e) => setRecoveryPassword(e.target.value)}
                  className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                />
              </label>
              <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                Confirm new password
                <input
                  required
                  minLength={10}
                  autoComplete="new-password"
                  type="password"
                  value={recoveryPasswordConfirm}
                  onChange={(e) => setRecoveryPasswordConfirm(e.target.value)}
                  className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                />
              </label>
              <button
                type="submit"
                disabled={authBusy}
                className="w-full rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {authBusy ? 'Resetting...' : 'Reset Password'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                }}
                className="w-full py-1 text-xs font-bold text-slate-300 hover:text-white"
              >
                Back to sign in
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={onBackToStore}
            className="mt-5 flex w-full items-center justify-center gap-2 border-t border-cyan-500/20 pt-4 text-xs font-bold text-slate-400 hover:text-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to store
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen text-slate-100 flex flex-col lg:flex-row relative">
      <div className="app-scene" aria-hidden="true">
        <div className="app-scene-blob app-scene-blob--cyan" />
        <div className="app-scene-blob app-scene-blob--violet" />
        <div className="app-scene-blob app-scene-blob--indigo" />
      </div>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-72 lg:flex-col lg:fixed lg:inset-y-0 bg-slate-950/95 backdrop-blur-xl border-r border-cyan-500/30 text-white z-30 shadow-[8px_0_32px_rgba(0,0,0,0.75)]">
        <div className="p-5 border-b border-cyan-500/25 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 flex items-center justify-center shadow-[inset_0_1.5px_0_rgba(255,255,255,0.4),0_4px_0_#0f296b] border border-cyan-300/40 font-display font-black text-white text-sm shrink-0">
            RB
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-black text-white text-sm tracking-wider truncate">
              {storeConfig.siteTitle} Admin
            </h1>
            <p className="text-[11px] text-slate-400 truncate mt-0.5">IRCTC Command Center</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <p className="px-3 text-[10px] font-extrabold uppercase tracking-widest text-cyan-400/80 mb-2">
            Store Management
          </p>
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full text-left px-3.5 py-3 rounded-xl transition-all flex items-center justify-between gap-2.5 cursor-pointer ${
                  active
                    ? 'bg-gradient-to-r from-blue-600 via-indigo-600 to-cyan-500 text-white shadow-[inset_0_1.5px_0_rgba(255,255,255,0.35),0_4px_0_#0f296b,0_10px_24px_-4px_rgba(56,189,248,0.5)] border border-cyan-300/50'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900/90 border border-transparent hover:border-cyan-500/25'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      active
                        ? 'bg-white/20 text-white'
                        : 'bg-slate-900 text-cyan-400 border border-cyan-500/30'
                    }`}
                  >
                    {item.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold leading-tight truncate">{item.label}</p>
                    <p
                      className={`text-[10px] truncate mt-0.5 ${
                        active ? 'text-cyan-100' : 'text-slate-400'
                      }`}
                    >
                      {item.subtitle}
                    </p>
                  </div>
                </div>
                {typeof item.badge === 'number' && item.badge > 0 && (
                  <span
                    className={`px-2 py-0.5 text-[10px] font-black rounded-full shrink-0 ${
                      item.id === 'orders'
                        ? 'bg-amber-400 text-slate-950'
                        : active
                        ? 'bg-white/25 text-white'
                        : 'bg-blue-950 text-cyan-300 border border-cyan-400/30'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-cyan-500/25 space-y-2.5 bg-slate-950/90">
          <button
            type="button"
            onClick={onBackToStore}
            className="w-full py-2.5 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 hover:text-white border border-cyan-500/35 shadow-[0_3px_0_#040714] text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>View Live Customer Store</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 lg:pl-72 flex flex-col min-w-0 relative z-10">
        <header className="sticky top-0 z-20 glass-nav px-4 sm:px-6 py-3.5">
          <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="lg:hidden w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center font-display font-black text-xs shadow-[0_3px_0_#0f296b]">
                RB
              </div>
              <div>
                <h2 className="font-display text-sm sm:text-base font-black text-white leading-tight">
                  {navItems.find((n) => n.id === activeTab)?.label}
                </h2>
                <p className="text-xs text-cyan-300/80 hidden sm:block">
                  {navItems.find((n) => n.id === activeTab)?.subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleAdminLogout}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-rose-300 text-xs font-bold border border-rose-500/35 flex items-center gap-1.5 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
              <button
                type="button"
                onClick={onBackToStore}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 text-xs font-bold border border-cyan-500/35 shadow-[0_3px_0_#040714] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Live Store</span>
              </button>
            </div>
          </div>

          {/* Mobile Tab Bar */}
          <div className="lg:hidden flex items-center gap-1.5 overflow-x-auto pt-3 pb-0.5 mt-2 border-t border-cyan-500/20">
            {navItems.map((item) => {
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 transition-all cursor-pointer ${
                    active
                      ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-[0_3px_0_#0f296b]'
                      : 'bg-slate-900/90 text-slate-300 border border-cyan-500/25'
                  }`}
                >
                  {item.icon}
                  <span>{item.label}</span>
                  {typeof item.badge === 'number' && item.badge > 0 && (
                    <span className="px-1.5 py-0.5 text-[10px] font-black rounded-full bg-amber-400 text-slate-950">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </header>

        <main className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 flex-1">
          {/* Top Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 sm:gap-4">
            <div className="neon-card-3d p-4 sm:p-5 flex items-start justify-between gap-3 border-amber-400/40">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-300 block">
                  Pending UTR Verify
                </span>
                <p className="text-2xl sm:text-3xl font-black text-white mt-1 tabular-nums">
                  {pendingCount}
                </p>
                <span className="text-[11px] text-amber-300/90 font-semibold mt-1 inline-block">
                  Awaiting ID dispatch
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-300 flex items-center justify-center shrink-0">
                <Clock className="w-5 h-5" />
              </div>
            </div>

            <div className="neon-card-3d p-4 sm:p-5 flex items-start justify-between gap-3 border-emerald-400/40">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300 block">
                  Delivered Orders
                </span>
                <p className="text-2xl sm:text-3xl font-black text-white mt-1 tabular-nums">
                  {deliveredCount}
                </p>
                <span className="text-[11px] text-emerald-300/90 font-semibold mt-1 inline-block">
                  IDs sent to customers
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="neon-card-3d p-4 sm:p-5 flex items-start justify-between gap-3 border-cyan-400/40">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300 block">
                  Verified Revenue
                </span>
                <p className="text-2xl sm:text-3xl font-black text-white mt-1 tabular-nums flex items-center">
                  <IndianRupee className="w-5 h-5 text-cyan-400 -mr-0.5" />
                  {verifiedRevenue.toLocaleString('en-IN')}
                </p>
                <span className="text-[11px] text-cyan-300/90 font-semibold mt-1 inline-block">
                  Total UPI collected
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-cyan-300 flex items-center justify-center shrink-0">
                <Zap className="w-5 h-5" />
              </div>
            </div>

            <div className="neon-card-3d p-4 sm:p-5 flex items-start justify-between gap-3 border-indigo-400/40">
              <div>
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-300 block">
                  Ready Vault Stock
                </span>
                <p className="text-2xl sm:text-3xl font-black text-white mt-1 tabular-nums">
                  {readyVaultCount}
                </p>
                <span className="text-[11px] text-indigo-300/90 font-semibold mt-1 inline-block">
                  Manual payment review only
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-400/40 text-indigo-300 flex items-center justify-center shrink-0">
                <Package className="w-5 h-5" />
              </div>
            </div>
          </div>

          {activeTab === 'security' && (
            <section className="neon-card-3d max-w-2xl p-5 sm:p-7 border-cyan-400/35">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-cyan-950/60 text-cyan-300">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-white">Change admin password</h3>
                  <p className="text-xs text-slate-400">Use at least 10 characters.</p>
                </div>
              </div>
              {securityMessage && (
                <p className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-950/30 p-3 text-xs text-emerald-200">
                  {securityMessage}
                </p>
              )}
              {saveError && (
                <p className="mb-4 rounded-lg border border-red-400/30 bg-red-950/30 p-3 text-xs text-red-200">
                  {saveError}
                </p>
              )}
              <form onSubmit={handleChangeAdminPassword} className="space-y-4">
                <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                  Current password
                  <input
                    required
                    autoComplete="current-password"
                    type="password"
                    value={currentAdminPassword}
                    onChange={(e) => setCurrentAdminPassword(e.target.value)}
                    className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                  New password
                  <input
                    required
                    minLength={10}
                    autoComplete="new-password"
                    type="password"
                    value={newAdminPassword}
                    onChange={(e) => setNewAdminPassword(e.target.value)}
                    className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                  />
                </label>
                <label className="block space-y-1.5 text-xs font-bold text-slate-300">
                  Confirm new password
                  <input
                    required
                    minLength={10}
                    autoComplete="new-password"
                    type="password"
                    value={newAdminPasswordConfirm}
                    onChange={(e) => setNewAdminPasswordConfirm(e.target.value)}
                    className="w-full rounded-lg border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-300"
                  />
                </label>
                <button
                  type="submit"
                  disabled={authBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-cyan-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-cyan-500 disabled:opacity-50"
                >
                  <KeyRound className="h-4 w-4" />
                  {authBusy ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </section>
          )}

          {/* TAB 1: ORDERS & UTR VERIFY */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="neon-card-3d p-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {(
                    [
                      { id: 'all', label: `All (${orders.length})` },
                      { id: 'pending_verification', label: `Pending (${pendingCount})` },
                      { id: 'verified_delivered', label: `Delivered (${deliveredCount})` },
                      { id: 'rejected', label: 'Rejected' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setStatusFilter(tab.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                        statusFilter === tab.id
                          ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-[0_2px_0_#0f296b]'
                          : 'bg-slate-950/80 text-slate-300 hover:text-white border border-cyan-500/25'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 text-cyan-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search UTR, Order ID, Mobile..."
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-cyan-500/35 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-cyan-400"
                  />
                </div>
              </div>

              {filteredOrders.length === 0 ? (
                <div className="neon-card-3d p-10 text-center space-y-2">
                  <QrCode className="w-8 h-8 text-cyan-400 mx-auto opacity-80" />
                  <h3 className="text-sm font-extrabold text-white">No matching orders found</h3>
                  <p className="text-xs text-slate-400">
                    Submitted UTRs appear here as pending. Confirm the exact UTR and amount in the
                    {storeConfig.upiId} account before you release any credentials.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredOrders.map((order) => {
                    const fallbackPreset = order.isRental24h
                      ? storeConfig.presetRentalCredentials || ''
                      : storeConfig.presetPermanentCredentials || '';
                    const draftText =
                      credDrafts[order.orderId] === undefined
                        ? order.deliveredCredentials || fallbackPreset
                        : credDrafts[order.orderId];

                    return (
                      <div
                        key={order.orderId}
                        className={`neon-card-3d p-5 transition-all ${
                          order.status === 'pending_verification'
                            ? 'border-amber-400/60'
                            : order.status === 'verified_delivered'
                            ? 'border-emerald-400/50'
                            : 'border-rose-500/50'
                        }`}
                      >
                        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
                          <div className="space-y-3 flex-1">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-mono font-extrabold text-cyan-300">
                                {order.orderId}
                              </span>
                              <span>·</span>
                              {order.status === 'pending_verification' && (
                                <span className="text-amber-300 font-extrabold flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5" />
                                  Pending UTR Verification
                                </span>
                              )}
                              {order.status === 'verified_delivered' && (
                                <span className="text-emerald-300 font-extrabold flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Verified &amp; Delivered
                                </span>
                              )}
                              {order.status === 'rejected' && (
                                <span className="text-rose-300 font-extrabold flex items-center gap-1">
                                  <XCircle className="w-3.5 h-3.5" />
                                  Rejected
                                </span>
                              )}
                              <span>·</span>
                              <span className="font-extrabold text-white">
                                {order.packLabel} ({order.quantity} ID
                                {order.quantity > 1 ? 's' : ''})
                              </span>
                              <span>·</span>
                              <span className="font-mono font-black text-sky-400">
                                ₹{order.totalAmount}
                              </span>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                              <div className="p-3 rounded-xl bg-slate-950/90 border border-cyan-500/35 flex items-center justify-between gap-2">
                                <div>
                                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 block">
                                    Customer UTR / Ref No.
                                  </span>
                                  <span className="font-mono font-black text-sm text-white tracking-wider">
                                    {order.utrNumber}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleCopyUtr(order.utrNumber)}
                                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-cyan-400/40 text-xs font-bold text-cyan-300 flex items-center gap-1 shadow-[0_2px_0_#040714] cursor-pointer"
                                >
                                  {copiedUtr === order.utrNumber ? (
                                    <>
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                      <span>Copied</span>
                                    </>
                                  ) : (
                                    <>
                                      <Copy className="w-3.5 h-3.5" />
                                      <span>Copy UTR</span>
                                    </>
                                  )}
                                </button>
                              </div>

                              <div className="p-3 rounded-xl bg-slate-950/90 border border-cyan-500/30">
                                <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 block">
                                  Customer Mobile / UPI App
                                </span>
                                <span className="text-xs font-bold text-white">
                                  {order.customerReference || 'Direct Buyer'}
                                  {order.upiAppUsed ? ` · ${order.upiAppUsed}` : ''}
                                </span>
                              </div>
                            </div>

                            {order.customSpec && (
                              <div className="p-3 rounded-xl bg-amber-950/50 border border-amber-400/40 text-xs text-amber-200">
                                <span className="font-extrabold uppercase tracking-wider text-[10px] text-amber-400 block mb-0.5">
                                  Customer Custom Order Requirement:
                                </span>
                                {order.customSpec}
                              </div>
                            )}
                          </div>

                          <div className="w-full lg:w-[26rem] space-y-2.5 bg-slate-950/90 p-4 rounded-2xl border border-cyan-500/35">
                            <div className="flex items-center justify-between gap-2">
                              <label className="text-xs font-extrabold text-white flex items-center gap-1.5">
                                <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
                                IRCTC ID &amp; Password ({order.quantity} ID
                                {order.quantity > 1 ? 's' : ''})
                              </label>
                              {readyVaultCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleAutoFillFromVault(order)}
                                  className="text-[11px] font-bold text-cyan-300 hover:text-white bg-blue-950/90 px-2.5 py-1 rounded-lg border border-cyan-400/40 flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Sparkles className="w-3 h-3 text-cyan-400" />
                                  <span>Auto-Fill from Vault</span>
                                </button>
                              )}
                            </div>

                            <textarea
                              rows={3}
                              value={draftText}
                              onChange={(e) =>
                                setCredDrafts((prev) => ({
                                  ...prev,
                                  [order.orderId]: e.target.value,
                                }))
                              }
                              placeholder="Enter IRCTC ID & Password for customer (1 per line)&#10;Example: user_irctc01 | Pass@123"
                              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-cyan-500/35 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
                            />

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={busyOrderId === order.orderId}
                                onClick={() => handleVerifyOrder(order)}
                                className="flex-1 py-2.5 px-3 rounded-xl text-white font-extrabold text-xs store-pay-pill disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {order.status === 'verified_delivered'
                                  ? 'Update Delivered Vault ID'
                                  : 'Confirm Received Payment & Deliver ID'}
                              </button>

                              {order.status !== 'rejected' && (
                                <button
                                  type="button"
                                  disabled={busyOrderId === order.orderId}
                                  onClick={() => handleRejectOrder(order)}
                                  className="py-2.5 px-3 rounded-xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-500/40 font-bold text-xs transition-colors cursor-pointer"
                                >
                                  Reject
                                </button>
                              )}

                              <button
                                type="button"
                                onClick={() => handleDeleteOrder(order.orderId)}
                                className="p-2.5 rounded-xl bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 transition-colors cursor-pointer"
                                title="Delete Order"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: QR CODE & UPI SETUP */}
          {activeTab === 'qr_settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleSaveSettings}
                className="lg:col-span-7 neon-card-3d p-6 space-y-5"
              >
                <div className="border-b border-cyan-500/25 pb-4">
                  <h2 className="font-display text-base font-black text-white flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-cyan-400" />
                    Payment QR Code &amp; Manual UPI Verification
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    UPI QR payments are sent to {formConfig.upiId}. Orders stay pending until you
                    confirm the matching payment in that account.
                  </p>
                </div>

                {saveSuccess && (
                  <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-400/50 text-xs text-emerald-300 font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>{saveSuccess}</span>
                  </div>
                )}
                {saveError && (
                  <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-xs text-rose-300 font-bold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>{saveError}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-extrabold text-cyan-300">
                      Merchant UPI ID
                    </label>
                    <input
                      type="text"
                      value={formConfig.upiId}
                      required
                      minLength={LIMITS.UPI_ID_MIN}
                      maxLength={LIMITS.UPI_ID_MAX}
                      pattern={LIMITS.UPI_ID_REGEX.source}
                      onChange={(e) =>
                        setFormConfig({ ...formConfig, upiId: e.target.value.trim() })
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-cyan-200 font-mono"
                    />
                    <p className="text-[11px] text-slate-400">
                      Enter the UPI ID where customer payments should be received.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-extrabold text-cyan-300">
                      Merchant / Payee Display Name
                    </label>
                    <input
                      type="text"
                      value={formConfig.payeeName}
                      onChange={(e) => setFormConfig({ ...formConfig, payeeName: e.target.value })}
                      placeholder="Roshanbrand Official"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
                    />
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-amber-950/35 border border-amber-400/40 flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2 text-xs font-extrabold text-amber-200">
                      <ShieldCheck className="w-4 h-4 text-amber-300" />
                      <span>Manual payment confirmation only</span>
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      Match the exact UTR and amount against a successful credit received at{' '}
                      {formConfig.upiId} before verifying. A submitted UTR alone is not payment proof.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Customer Verification Instruction Note
                  </label>
                  <textarea
                    rows={2}
                    value={formConfig.instantDeliveryNote}
                    readOnly
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-xs text-white focus:outline-none focus:border-cyan-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="w-full py-3.5 rounded-xl text-white font-extrabold text-sm store-pay-pill flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`w-4 h-4 ${savingSettings ? 'animate-spin' : ''}`} />
                  <span>
                    {savingSettings ? 'Saving UPI Settings...' : 'Save UPI Configuration'}
                  </span>
                </button>
              </form>

              <div className="lg:col-span-5 space-y-3">
                <p className="text-xs font-extrabold uppercase tracking-wider text-cyan-300 px-1">
                  Live Customer Checkout QR Preview (₹{formConfig.priceRental24h} 24H Rental)
                </p>
                <UpiQrBox
                  upiId={formConfig.upiId}
                  payeeName={formConfig.payeeName}
                  amount={formConfig.priceRental24h || 49}
                  orderNote="Roshanbrand 24H Rental ID"
                />
              </div>
            </div>
          )}

          {/* TAB 3: PRICES & SITE CONTROL */}
          {activeTab === 'site_settings' && (
            <form onSubmit={handleSaveSettings} className="neon-card-3d p-6 space-y-6">
              <div className="border-b border-cyan-500/25 pb-4">
                <h2 className="font-display text-base font-black text-white flex items-center gap-2">
                  <Settings className="w-5 h-5 text-cyan-400" />
                  Store Package Pricing &amp; Brand Configuration
                </h2>
                <p className="text-xs text-slate-300 mt-1">
                  Set one customer rate per ID; all standard and bulk package totals update
                  automatically from the ID quantity.
                </p>
              </div>

              {saveSuccess && (
                <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-400/50 text-xs text-emerald-300 font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                  <span>{saveSuccess}</span>
                </div>
              )}
              {saveError && (
                <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-xs text-rose-300 font-bold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{saveError}</span>
                </div>
              )}

              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-cyan-300 mb-3">
                  Package Rates (INR ₹)
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl bg-emerald-950/60 border border-emerald-400/50 space-y-1">
                    <label className="block text-[11px] font-bold text-emerald-300">
                      24H Rental (₹)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={formConfig.priceRental24h}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          priceRental24h: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-emerald-400/50 text-sm font-black text-white font-mono"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/35 space-y-1">
                    <label className="block text-[11px] font-bold text-cyan-300">1 ID Pack (₹)</label>
                    <p className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-sm font-black text-white font-mono">
                      ₹{formConfig.priceCustomPerId}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/35 space-y-1">
                    <label className="block text-[11px] font-bold text-cyan-300">2 IDs Pack (₹)</label>
                    <p className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-sm font-black text-white font-mono">
                      ₹{formConfig.priceCustomPerId * 2}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/35 space-y-1">
                    <label className="block text-[11px] font-bold text-cyan-300">5 IDs Pack (₹)</label>
                    <p className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-sm font-black text-white font-mono">
                      ₹{formConfig.priceCustomPerId * 5}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/35 space-y-1">
                    <label className="block text-[11px] font-bold text-cyan-300">
                      10 IDs Pack (₹)
                    </label>
                    <p className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-sm font-black text-white font-mono">
                      ₹{formConfig.priceCustomPerId * 10}
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-400/40 space-y-1">
                    <label className="block text-[11px] font-bold text-emerald-300">
                      7 Days Guarantee Per ID (₹)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={formConfig.price7DayGuaranteePerId}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          price7DayGuaranteePerId: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-emerald-400/40 text-sm font-black text-white font-mono"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-emerald-950/50 border border-emerald-400/40 space-y-1">
                    <label className="block text-[11px] font-bold text-emerald-300">
                      1 Month Guarantee Per ID (₹)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100000}
                      value={formConfig.price1MonthGuaranteePerId}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          price1MonthGuaranteePerId: Number(e.target.value),
                        })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-emerald-400/40 text-sm font-black text-white font-mono"
                    />
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-cyan-500/35 space-y-1">
                    <label className="block text-[11px] font-bold text-cyan-300">
                      Customer Per ID (₹)
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={formConfig.priceCustomPerId}
                      onChange={(e) =>
                        setFormConfig({ ...formConfig, priceCustomPerId: Number(e.target.value) })
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-cyan-500/35 text-sm font-black text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Website Brand Name
                  </label>
                  <input
                    type="text"
                    value={formConfig.siteTitle}
                    onChange={(e) => setFormConfig({ ...formConfig, siteTitle: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white font-bold"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Permanent IDs Display Counter
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formConfig.stockDisplayAvailable}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        stockDisplayAvailable: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability follows this value; verified sales reduce it automatically.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-emerald-300">
                    24H Rental IDs Display Counter
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formConfig.rentalStockDisplayAvailable}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        rentalStockDisplayAvailable: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability follows this value; verified sales reduce it automatically.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    7 Days Guarantee IDs Stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formConfig.stock7DayGuaranteeAvailable}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        stock7DayGuaranteeAvailable: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability follows this value; verified sales reduce it automatically.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-emerald-300">
                    1 Month Guarantee IDs Stock
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={formConfig.stock1MonthGuaranteeAvailable}
                    onChange={(e) =>
                      setFormConfig({
                        ...formConfig,
                        stock1MonthGuaranteeAvailable: Number(e.target.value),
                      })
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability follows this value; verified sales reduce it automatically.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Support Handle (WhatsApp / Telegram)
                  </label>
                  <input
                    type="text"
                    value={formConfig.supportHandle}
                    onChange={(e) =>
                      setFormConfig({ ...formConfig, supportHandle: e.target.value })
                    }
                    placeholder="@RoshanbrandSupport"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                </div>

                <div className="sm:col-span-2 lg:col-span-4 space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Top Announcement Banner Text
                  </label>
                  <input
                    type="text"
                    value={formConfig.announcementText}
                    onChange={(e) =>
                      setFormConfig({ ...formConfig, announcementText: e.target.value })
                    }
                    placeholder="Leave blank to hide the banner"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={savingSettings}
                className="w-full py-3.5 rounded-xl text-white font-extrabold text-sm store-pay-pill flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${savingSettings ? 'animate-spin' : ''}`} />
                <span>
                  {savingSettings
                    ? 'Saving All Store Settings...'
                    : 'Save All Pricing & Store Settings'}
                </span>
              </button>
            </form>
          )}

          {/* TAB 4: READY ID VAULT */}
          {activeTab === 'inventory' && (
            <div className="space-y-6">
              {/* One-Time Pre-Set Master Ready ID Card */}
              <form
                onSubmit={handleSaveSettings}
                className="neon-card-3d p-6 space-y-4 border-emerald-400/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/25 pb-3">
                  <div>
                    <h2 className="font-display text-base font-black text-white flex items-center gap-2">
                      <Zap className="w-5 h-5 text-emerald-400" />
                      Ek Baar Me Pre-Set Ready ID (Auto-Shows to Customer on UTR Verify)
                    </h2>
                    <p className="text-xs text-slate-300 mt-1">
                      Yahan apni Ready IRCTC ID &amp; Password ek baar set karke save kar dein. Jaise
                      hi customer ka UTR verify hoga, yahi pre-set ID turant customer ki screen par
                      show ho jayegi!
                    </p>
                  </div>
                </div>

                {saveSuccess && (
                  <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-400/50 text-xs text-emerald-300 font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
                    <span>{saveSuccess}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-extrabold text-emerald-300">
                      Pre-Set 24-Hour Rental IRCTC ID (₹49 Plan)
                    </label>
                    <textarea
                      rows={3}
                      value={formConfig.presetRentalCredentials || ''}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          presetRentalCredentials: e.target.value,
                        })
                      }
                      placeholder="Username: roshan_rent24_vip | Password: Tatkal@2499"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-400/40 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-extrabold text-cyan-300">
                      Pre-Set Permanent IRCTC ID (Standard / Bulk Plan)
                    </label>
                    <textarea
                      rows={3}
                      value={formConfig.presetPermanentCredentials || ''}
                      onChange={(e) =>
                        setFormConfig({
                          ...formConfig,
                          presetPermanentCredentials: e.target.value,
                        })
                      }
                      placeholder="Username: rb_irctc_vip801 | Password: RailPass@801"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-xs text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingSettings}
                  className="py-3 px-6 rounded-xl text-white font-extrabold text-xs sm:text-sm store-pay-pill flex items-center justify-center gap-2 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {savingSettings
                      ? 'Saving Pre-Set Ready IDs...'
                      : 'Save Pre-Set Ready IDs (Used Instantly on UTR Verify)'}
                  </span>
                </button>
              </form>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              <form
                onSubmit={handleAddVaultIds}
                className="lg:col-span-5 neon-card-3d p-6 space-y-4"
              >
                <div className="border-b border-cyan-500/25 pb-3">
                  <h2 className="font-display text-base font-black text-white flex items-center gap-2">
                    <Plus className="w-5 h-5 text-cyan-400" />
                    Add IRCTC IDs &amp; Passwords to Vault
                  </h2>
                  <p className="text-xs text-slate-300 mt-1">
                    Paste ready IRCTC IDs (one account per line:{' '}
                    <code className="text-cyan-300">username | password | pin</code>). Used for
                    instant UPI auto-dispatch!
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Select Vault Pool
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setNewVaultPool('rental_24h')}
                      className={`py-2 px-3 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
                        newVaultPool === 'rental_24h'
                          ? 'bg-emerald-600 text-white border-emerald-300'
                          : 'bg-slate-950 text-slate-300 border-cyan-500/30'
                      }`}
                    >
                      24H Rental ID Pool (₹49)
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewVaultPool('permanent')}
                      className={`py-2 px-3 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
                        newVaultPool === 'permanent'
                          ? 'bg-blue-600 text-white border-cyan-300'
                          : 'bg-slate-950 text-slate-300 border-cyan-500/30'
                      }`}
                    >
                      Permanent ID Pool
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    IRCTC Credentials (1 ID per line)
                  </label>
                  <textarea
                    rows={6}
                    value={newVaultText}
                    onChange={(e) => setNewVaultText(e.target.value)}
                    placeholder="roshan_rent24_01 | Pass@9911 | Pin: 1234&#10;roshan_rent24_02 | Pass@9912 | Pin: 5678"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Batch Tag / Note (Optional)
                  </label>
                  <input
                    type="text"
                    value={newVaultNote}
                    onChange={(e) => setNewVaultNote(e.target.value)}
                    placeholder="e.g., 24H Active Rental · Tatkal Ready"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-xs text-white"
                  />
                </div>

                <button
                  type="submit"
                  disabled={addingVault || !newVaultText.trim()}
                  className="w-full py-3.5 rounded-xl text-white font-extrabold text-sm store-pay-pill disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{addingVault ? 'Adding IDs to Vault...' : 'Save IDs to Ready Vault'}</span>
                </button>
              </form>

              <div className="lg:col-span-7 neon-card-3d p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-cyan-500/25 pb-3">
                  <h3 className="font-display text-sm font-black text-white">
                    Vault Stock ({readyVaultCount} Ready / {vault.length} Total)
                  </h3>
                </div>

                {vault.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-400">
                    No pre-loaded IDs in vault yet. Add IDs on the left for instant auto-delivery.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {vault.map((item) => (
                      <div
                        key={item.vaultId}
                        className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                          item.isAssigned
                            ? 'bg-slate-950/50 border-slate-800 opacity-60'
                            : 'bg-slate-950/90 border-cyan-500/35'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                item.isAssigned
                                  ? 'bg-slate-600'
                                  : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                              }`}
                            />
                            <p className="font-mono text-xs text-white font-bold truncate">
                              {item.irctcUsername} | {item.irctcPassword}
                            </p>
                            <span className="text-[10px] font-bold text-cyan-300">
                              · {item.poolType === 'rental_24h' ? '24H Rental' : 'Permanent'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            {item.accountNote && <span>{item.accountNote}</span>}
                            {item.isAssigned && (
                              <span className="text-cyan-400 font-mono font-semibold">
                                Delivered in Order: {item.assignedOrderId}
                              </span>
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeleteVaultItem(item.vaultId)}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 transition-colors cursor-pointer"
                          title="Remove from Vault"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
