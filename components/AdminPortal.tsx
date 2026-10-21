import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
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
import {
  GuaranteeClaim,
  GuaranteeClaimStatus,
  OrderRecord,
  StoreConfig,
  VaultItem,
  VaultPoolType,
} from '../src/types';
import { UpiQrBox } from './UpiQrBox';

interface AdminPortalProps {
  storeConfig: StoreConfig;
  onConfigUpdated: (newConfig: StoreConfig) => void;
  onBackToStore: () => void;
}

type AdminTab =
  | 'orders'
  | 'guarantee_claims'
  | 'qr_settings'
  | 'site_settings'
  | 'inventory'
  | 'security';

function getOrderVaultPool(order: OrderRecord): VaultPoolType {
  if (order.packType === 'rental_24h') return 'rental_24h';
  if (order.packType === 'guarantee_7days') return 'guarantee_7days';
  if (order.packType === 'guarantee_1month') return 'guarantee_1month';
  return 'permanent';
}

function getVaultPoolLabel(poolType: VaultPoolType): string {
  switch (poolType) {
    case 'rental_24h':
      return '24H Rental';
    case 'guarantee_7days':
      return '7 Days Guarantee';
    case 'guarantee_1month':
      return '1 Month Guarantee';
    default:
      return 'Permanent';
  }
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  storeConfig,
  onConfigUpdated,
  onBackToStore,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('orders');
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [vault, setVault] = useState<VaultItem[]>([]);
  const [guaranteeClaims, setGuaranteeClaims] = useState<GuaranteeClaim[]>([]);
  const [ordersOffset, setOrdersOffset] = useState(0);
  const [claimsOffset, setClaimsOffset] = useState(0);
  const [ordersTotal, setOrdersTotal] = useState(0);
  const [claimsTotal, setClaimsTotal] = useState(0);
  const [adminSummary, setAdminSummary] = useState({
    ordersTotal: 0,
    pendingOrders: 0,
    deliveredOrders: 0,
    verifiedRevenue: 0,
  });
  const [replacementCounts, setReplacementCounts] = useState<Record<string, number>>({});
  const [claimStatusFilter, setClaimStatusFilter] = useState<'all' | GuaranteeClaimStatus>('all');
  const [claimSearchQuery, setClaimSearchQuery] = useState('');
  const [claimActionBusy, setClaimActionBusy] = useState<string | null>(null);
  const [claimWarning, setClaimWarning] = useState('');
  const [rejectClaim, setRejectClaim] = useState<GuaranteeClaim | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [claimScreenshot, setClaimScreenshot] = useState<{ title: string; dataUrl: string } | null>(
    null
  );
  const [statusFilter, setStatusFilter] = useState<'all' | OrderRecord['status']>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [credDrafts, setCredDrafts] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [copiedUtr, setCopiedUtr] = useState<string | null>(null);
  const adminFiltersRef = useRef({
    ordersOffset: 0,
    claimsOffset: 0,
    statusFilter: 'all' as 'all' | OrderRecord['status'],
    searchQuery: '',
    claimStatusFilter: 'all' as 'all' | GuaranteeClaimStatus,
    claimSearchQuery: '',
  });
  adminFiltersRef.current = {
    ordersOffset,
    claimsOffset,
    statusFilter,
    searchQuery,
    claimStatusFilter,
    claimSearchQuery,
  };

  const [newVaultText, setNewVaultText] = useState('');
  const [newVaultNote, setNewVaultNote] = useState('');
  const [newVaultPool, setNewVaultPool] = useState<VaultPoolType>('rental_24h');
  const [addingVault, setAddingVault] = useState(false);
  const [orderErrors, setOrderErrors] = useState<Record<string, string>>({});

  const [formConfig, setFormConfig] = useState<StoreConfig>(storeConfig);
  const [rentalPriceInput, setRentalPriceInput] = useState(
    String(storeConfig.priceRental24h)
  );
  const [stockInputs, setStockInputs] = useState({
    stockDisplayAvailable: String(storeConfig.stockDisplayAvailable),
    rentalStockDisplayAvailable: String(storeConfig.rentalStockDisplayAvailable),
    stock7DayGuaranteeAvailable: String(storeConfig.stock7DayGuaranteeAvailable),
    stock1MonthGuaranteeAvailable: String(storeConfig.stock1MonthGuaranteeAvailable),
  });
  const [dirtyStockInputs, setDirtyStockInputs] = useState<Record<string, boolean>>({});
  const [supportHandleDirty, setSupportHandleDirty] = useState(false);
  const [supportUrlDirty, setSupportUrlDirty] = useState(false);
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
      if (key === 'supportHandle' && supportHandleDirty) {
        continue;
      }
      if (key === 'supportUrl' && supportUrlDirty) {
        continue;
      }
      if (dirtyStockInputs[key] && key in stockInputs) {
        continue;
      }
      if (Object.is(formConfig[key], previousConfig[key])) {
        Object.assign(nextFormConfig, { [key]: storeConfig[key] });
        formChanged ||= !Object.is(formConfig[key], storeConfig[key]);
        if (key === 'priceRental24h') {
          setRentalPriceInput(String(storeConfig.priceRental24h));
        }
        if (
          key === 'stockDisplayAvailable' ||
          key === 'rentalStockDisplayAvailable' ||
          key === 'stock7DayGuaranteeAvailable' ||
          key === 'stock1MonthGuaranteeAvailable'
        ) {
          setStockInputs((current) => ({
            ...current,
            [key]: String(storeConfig[key]),
          }));
        }
      }
    }

    previousStoreConfig.current = storeConfig;
    if (formChanged) {
      setFormConfig(nextFormConfig);
    }
  }, [storeConfig, dirtyStockInputs, supportHandleDirty, supportUrlDirty]);

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

  const fetchAdminState = async (
    syncConfig = false,
    resetOrders = false,
    resetClaims = false
  ) => {
    try {
      const filters = adminFiltersRef.current;
      const requestOrdersOffset = resetOrders ? 0 : filters.ordersOffset;
      const requestClaimsOffset = resetClaims ? 0 : filters.claimsOffset;
      const params = new URLSearchParams({
        ordersOffset: String(requestOrdersOffset),
        claimsOffset: String(requestClaimsOffset),
        ordersLimit: '50',
        claimsLimit: '50',
        orderStatus: filters.statusFilter,
        orderSearch: filters.searchQuery,
        claimStatus: filters.claimStatusFilter,
        claimSearch: filters.claimSearchQuery,
      });
      const res = await fetch(`/api/admin/state?${params.toString()}`);
      if (!res.ok) throw new Error(`Admin state returned HTTP ${res.status}.`);
      const data = await res.json();
      const mergePage = <T extends { orderId?: string; claimId?: string }>(
        previous: T[],
        page: T[],
        key: 'orderId' | 'claimId',
        offset: number
      ) => {
        if (offset === 0) return page;
        const combined = new Map(
          previous.map((item) => [item[key], item] as const)
        );
        for (const item of page) combined.set(item[key], item);
        return Array.from(combined.values());
      };
      setOrders((previous) =>
        mergePage(previous, data.orders || [], 'orderId', requestOrdersOffset)
      );
      setVault(data.vault || []);
      setGuaranteeClaims((previous) =>
        mergePage(previous, data.guaranteeClaims || [], 'claimId', requestClaimsOffset)
      );
      if (resetOrders) setOrdersOffset(0);
      if (resetClaims) setClaimsOffset(0);
      setOrdersTotal(Number(data.ordersTotal) || 0);
      setClaimsTotal(Number(data.guaranteeClaimsTotal) || 0);
      setAdminSummary(data.summary || {
        ordersTotal: 0,
        pendingOrders: 0,
        deliveredOrders: 0,
        verifiedRevenue: 0,
      });
      setReplacementCounts(data.replacementCounts || {});
      if (syncConfig && data.storeConfig) {
        onConfigUpdated(data.storeConfig);
      }
    } catch (error) {
      setClaimWarning(
        error instanceof Error ? error.message : 'Could not refresh admin data.'
      );
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchAdminState(true);
    const es = new EventSource('/api/events');
    es.onmessage = (event) => {
      let syncConfig = false;
      try {
        const message = JSON.parse(event.data) as { type?: string };
        syncConfig = message.type === 'config_updated';
      } catch {
        // Refresh orders and vault even if an event payload is malformed.
      }
      fetchAdminState(syncConfig);
    };
    const timer = setInterval(() => fetchAdminState(), 15000);
    return () => {
      es.close();
      clearInterval(timer);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = window.setTimeout(() => {
      void fetchAdminState();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    isAuthenticated,
    ordersOffset,
    claimsOffset,
    statusFilter,
    searchQuery,
    claimStatusFilter,
    claimSearchQuery,
  ]);

  const handleCopyUtr = (utr: string) => {
    navigator.clipboard.writeText(utr);
    setCopiedUtr(utr);
    setTimeout(() => setCopiedUtr(null), 1800);
  };

  const handleSaveSettings = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const rentalPrice = Number(rentalPriceInput);
    if (!Number.isInteger(rentalPrice) || rentalPrice < 1 || rentalPrice > 100000) {
      setSaveError('24H Rental price must be a whole number between ₹1 and ₹100,000.');
      setSaveSuccess('');
      return;
    }
    const stockValues = Object.fromEntries(
      Object.entries(stockInputs).map(([key, value]) => [key, Number(value)])
    ) as Record<keyof typeof stockInputs, number>;
    for (const [key, value] of Object.entries(stockValues)) {
      if (!/^\d+$/.test(stockInputs[key as keyof typeof stockInputs]) ||
          !Number.isInteger(value) || value < 0 || value > 100000) {
        setSaveError('All stock values must be whole numbers between 0 and 100,000.');
        setSaveSuccess('');
        return;
      }
    }

    setSavingSettings(true);
    setSaveSuccess('');
    setSaveError('');

    try {
      const res = await fetch('/api/store', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formConfig,
          ...stockValues,
          priceRental24h: rentalPrice,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Failed to update settings');
      } else {
        setFormConfig(data.storeConfig);
        setRentalPriceInput(String(data.storeConfig.priceRental24h));
        setStockInputs({
          stockDisplayAvailable: String(data.storeConfig.stockDisplayAvailable),
          rentalStockDisplayAvailable: String(data.storeConfig.rentalStockDisplayAvailable),
          stock7DayGuaranteeAvailable: String(data.storeConfig.stock7DayGuaranteeAvailable),
          stock1MonthGuaranteeAvailable: String(data.storeConfig.stock1MonthGuaranteeAvailable),
        });
        setDirtyStockInputs({});
        setSupportHandleDirty(false);
        setSupportUrlDirty(false);
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
    const targetPool = getOrderVaultPool(order);
    const available = vault.filter(
      (v) =>
        !v.isAssigned &&
        v.poolType === targetPool &&
        (!v.reservedOrderId || v.reservedOrderId === order.orderId)
    );
    if (available.length < order.quantity) {
      setOrderErrors((prev) => ({
        ...prev,
        [order.orderId]: `This order needs ${order.quantity} ID(s) from the ${getVaultPoolLabel(targetPool)} pool; ${available.length} available.`,
      }));
      return;
    }

    const lines = available
      .slice(0, order.quantity)
      .map(
        (v) =>
          `Username: ${v.irctcUsername} | Password: ${v.irctcPassword}${
            v.accountNote ? ` | Note: ${v.accountNote}` : ''
          }`
      )
      .join('\n');

    setOrderErrors((prev) => ({ ...prev, [order.orderId]: '' }));
    setCredDrafts((prev) => ({ ...prev, [order.orderId]: lines }));
  };

  const handleVerifyOrder = async (order: OrderRecord) => {
    const credentials = (
      credDrafts[order.orderId] ??
      order.deliveredCredentials ??
      ''
    ).trim();

    setBusyOrderId(order.orderId);
    try {
      const res = await fetch(`/api/admin/orders/${order.orderId}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveredCredentials: credentials }),
      });
      if (res.ok) {
        setOrderErrors((prev) => ({ ...prev, [order.orderId]: '' }));
        await fetchAdminState(false, true);
      } else {
        const data = await res.json();
        setOrderErrors((prev) => ({
          ...prev,
          [order.orderId]: data.error || 'Could not deliver credentials for this order.',
        }));
      }
    } catch {
      setOrderErrors((prev) => ({
        ...prev,
        [order.orderId]: 'Could not connect to the server. Please try again.',
      }));
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
        await fetchAdminState(false, true);
      }
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const res = await fetch(`/api/admin/orders/${orderId}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchAdminState(false, true);
      } else {
        const data = await res.json();
        setOrderErrors((previous) => ({
          ...previous,
          [orderId]: data.error || 'The order could not be deleted.',
        }));
      }
    } catch (error) {
      setOrderErrors((previous) => ({
        ...previous,
        [orderId]: error instanceof Error ? error.message : 'Could not connect to the server.',
      }));
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

  const pendingCount = adminSummary.pendingOrders;
  const deliveredCount = adminSummary.deliveredOrders;
  const verifiedRevenue = adminSummary.verifiedRevenue;
  const readyVaultCount = vault.filter((v) => !v.isAssigned && !v.reservedOrderId).length;

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

  const filteredGuaranteeClaims = guaranteeClaims.filter((claim) => {
    if (claimStatusFilter !== 'all' && claim.status !== claimStatusFilter) return false;
    const query = claimSearchQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      claim.claimId,
      claim.orderId,
      claim.utrNumber,
      claim.customerReference,
      claim.oldCredential,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query);
  });

  const getClaimReplacementCount = (claim: GuaranteeClaim) =>
    replacementCounts[claim.orderId] || 0;

  const getAvailableGuaranteeStock = (pool: 'guarantee_7days' | 'guarantee_1month') =>
    vault.filter(
      (item) => item.poolType === pool && !item.isAssigned && !item.reservedOrderId
    ).length;

  const handleClaimAction = async (
    claim: GuaranteeClaim,
    action: 'approve' | 'replace' | 'refund' | 'reject',
    reason?: string
  ) => {
    setClaimActionBusy(claim.claimId);
    setClaimWarning('');
    try {
      const response = await fetch(
        `/api/admin/guarantee-claims/${encodeURIComponent(claim.claimId)}/${action}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          ...(action === 'refund'
            ? { body: JSON.stringify({ refundConfirmed: true }) }
            : reason
              ? { body: JSON.stringify({ rejectionReason: reason }) }
              : {}),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        await fetchAdminState();
        setClaimWarning(data.error || 'The claim action could not be completed.');
        return;
      }
      setRejectClaim(null);
      setRejectionReason('');
      setClaimsOffset(0);
      await fetchAdminState(false, false, true);
    } catch (error) {
      setClaimWarning(
        error instanceof Error ? error.message : 'Could not connect to the claim service.'
      );
    } finally {
      setClaimActionBusy(null);
    }
  };

  const handleViewClaimScreenshot = async (claim: GuaranteeClaim) => {
    try {
      const response = await fetch(
        `/api/admin/guarantee-claims/${encodeURIComponent(claim.claimId)}/screenshot`
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not load the screenshot.');
      setClaimScreenshot({ title: claim.claimId, dataUrl: data.screenshotDataUrl });
    } catch (error) {
      setClaimWarning(
        error instanceof Error ? error.message : 'Could not load the screenshot.'
      );
    }
  };

  const formatClaimDate = (value: string) =>
    new Date(value).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
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
      id: 'guarantee_claims',
      label: 'Guarantee Claims',
      subtitle: 'Review claims & issue replacements',
      icon: <ShieldCheck className="w-4 h-4" />,
      badge: guaranteeClaims.filter(
        (claim) => claim.status === 'pending' || claim.status === 'approved'
      ).length,
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
                      { id: 'all', label: `All (${ordersTotal})` },
                      { id: 'pending_verification', label: `Pending (${pendingCount})` },
                      { id: 'verified_delivered', label: `Delivered (${deliveredCount})` },
                      { id: 'rejected', label: 'Rejected' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setStatusFilter(tab.id);
                        setOrdersOffset(0);
                        setOrders([]);
                      }}
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
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setOrdersOffset(0);
                      setOrders([]);
                    }}
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
                <>
                <div className="space-y-4">
                  {filteredOrders.map((order) => {
                    const orderPool = getOrderVaultPool(order);
                    const orderPoolAvailable = vault.filter(
                      (item) =>
                        !item.isAssigned &&
                        item.poolType === orderPool &&
                        (!item.reservedOrderId || item.reservedOrderId === order.orderId)
                    ).length;
                    const draftText =
                      credDrafts[order.orderId] === undefined
                        ? order.deliveredCredentials || ''
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
                              {order.refundedAt && (
                                <span className="text-amber-200 font-extrabold flex items-center gap-1">
                                  <IndianRupee className="w-3.5 h-3.5" />
                                  Refunded
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
                              {orderPoolAvailable > 0 && (
                                <button
                                  type="button"
                                  onClick={() => handleAutoFillFromVault(order)}
                                  className="text-[11px] font-bold text-cyan-300 hover:text-white bg-blue-950/90 px-2.5 py-1 rounded-lg border border-cyan-400/40 flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Sparkles className="w-3 h-3 text-cyan-400" />
                                  <span>Auto-Fill from Vault ({orderPoolAvailable})</span>
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
                              placeholder="Enter existing vault username | password (1 per line)&#10;Example: user_irctc01 | your-real-password"
                              className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-cyan-500/35 text-xs text-white font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
                            />
                            {orderErrors[order.orderId] && (
                              <p className="text-xs text-rose-300" role="alert">
                                {orderErrors[order.orderId]}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <button
                                type="button"
                                disabled={
                                  busyOrderId === order.orderId || order.status === 'rejected'
                                }
                                onClick={() => handleVerifyOrder(order)}
                                className="flex-1 py-2.5 px-3 rounded-xl text-white font-extrabold text-xs store-pay-pill disabled:opacity-50 flex items-center justify-center gap-1.5 cursor-pointer"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                {order.status === 'verified_delivered'
                                  ? 'Update Delivered Vault ID'
                                  : 'Confirm Received Payment & Deliver ID'}
                              </button>

                              {order.status === 'pending_verification' && (
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
                {orders.length < ordersTotal && (
                  <button
                    type="button"
                    onClick={() => setOrdersOffset(orders.length)}
                    className="w-full rounded-xl border border-cyan-400/30 bg-slate-950 px-4 py-2.5 text-xs font-bold text-cyan-200"
                  >
                    Load older orders ({orders.length} of {ordersTotal})
                  </button>
                )}
                </>
              )}
            </div>
          )}

          {activeTab === 'guarantee_claims' && (
            <div className="space-y-5">
              <section className="grid gap-3 sm:grid-cols-2">
                {(['guarantee_7days', 'guarantee_1month'] as const).map((pool) => {
                  const available = getAvailableGuaranteeStock(pool);
                  const low = available <= 2;
                  return (
                    <div
                      key={pool}
                      className={`rounded-2xl border p-4 ${
                        low
                          ? 'border-rose-400/40 bg-rose-950/35'
                          : 'border-emerald-400/30 bg-emerald-950/25'
                      }`}
                    >
                      <p className="text-xs font-extrabold uppercase tracking-wide text-slate-300">
                        {pool === 'guarantee_7days' ? '7-day replacement pool' : '1-month replacement pool'}
                      </p>
                      <p className={`mt-1 text-lg font-black ${low ? 'text-rose-200' : 'text-emerald-200'}`}>
                        {available} available · {available === 0 ? 'Out of stock' : low ? 'Low stock' : 'Stock healthy'}
                      </p>
                      {low && (
                        <p className="mt-1 text-xs text-rose-200/80">
                          Add matching pool IDs before resolving replacement claims.
                        </p>
                      )}
                    </div>
                  );
                })}
              </section>

              <section className="neon-card-3d min-w-0 overflow-hidden p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-base font-black text-white">Guarantee Claims</h2>
                    <p className="mt-1 text-xs text-slate-400">
                      Review customer evidence, approve claims, then replace, refund, or reject.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fetchAdminState()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-slate-900 px-3 py-2 text-xs font-bold text-cyan-100"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Refresh
                  </button>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
                  <label className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      type="search"
                      value={claimSearchQuery}
                      onChange={(event) => {
                        setClaimSearchQuery(event.target.value);
                        setClaimsOffset(0);
                        setGuaranteeClaims([]);
                      }}
                      placeholder="Search UTR, customer, order, or delivered ID"
                      className="w-full rounded-xl border border-cyan-500/30 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-500"
                    />
                  </label>
                  <select
                    value={claimStatusFilter}
                    onChange={(event) => {
                      setClaimStatusFilter(event.target.value as 'all' | GuaranteeClaimStatus);
                      setClaimsOffset(0);
                      setGuaranteeClaims([]);
                    }}
                    className="rounded-xl border border-cyan-500/30 bg-slate-950 px-3 py-2.5 text-sm text-white"
                    aria-label="Filter guarantee claims by status"
                  >
                    <option value="all">All statuses</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="resolved">Resolved</option>
                  </select>
                </div>

                {filteredGuaranteeClaims.length === 0 ? (
                  <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-8 text-center text-sm text-slate-400">
                    No guarantee claims match this filter.
                  </div>
                ) : (
                  <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700/80">
                    <table className="w-full min-w-[1500px] border-collapse text-left text-xs">
                      <thead className="bg-slate-950 text-[10px] uppercase tracking-wide text-cyan-200">
                        <tr>
                          <th className="p-3">Claim / Date</th>
                          <th className="p-3">Customer / Order</th>
                          <th className="p-3">Delivered ID (old)</th>
                          <th className="p-3">UTR / Guarantee</th>
                          <th className="p-3">Issue / Evidence</th>
                          <th className="p-3">Status / History</th>
                          <th className="p-3">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredGuaranteeClaims.map((claim) => {
                          const replacementCount = getClaimReplacementCount(claim);
                          const limitReached =
                            replacementCount >= formConfig.maxGuaranteeReplacementsPerOrder;
                          const pool =
                            claim.guaranteeType === 'guarantee_7days'
                              ? 'guarantee_7days'
                              : 'guarantee_1month';
                          const poolAvailable = getAvailableGuaranteeStock(pool);
                          const open = claim.status === 'pending' || claim.status === 'approved';
                          return (
                            <tr key={claim.claimId} className="border-t border-slate-700/70 align-top text-slate-200">
                              <td className="p-3">
                                <strong className="font-mono text-cyan-200">{claim.claimId}</strong>
                                <p className="mt-1 text-slate-400">{formatClaimDate(claim.createdAt)}</p>
                              </td>
                              <td className="p-3">
                                <strong>{claim.customerReference || 'Customer'}</strong>
                                <p className="mt-1 text-slate-400">Order {claim.orderId}</p>
                              </td>
                              <td className="max-w-[250px] break-words p-3 font-mono text-[11px] text-amber-100">
                                {claim.oldCredential}
                                <p className="mt-1 font-sans text-slate-400">
                                  Account {claim.credentialIndex + 1}
                                </p>
                              </td>
                              <td className="p-3">
                                <strong className="font-mono">{claim.utrNumber}</strong>
                                <p className="mt-1 text-emerald-200">
                                  {claim.guaranteeType === 'guarantee_7days' ? '7-day' : '1-month'} guarantee
                                </p>
                                <p className="mt-1 text-slate-400">Expires {formatClaimDate(claim.expiresAt)}</p>
                              </td>
                              <td className="max-w-[300px] whitespace-pre-wrap break-words p-3">
                                <p>{claim.issueDescription}</p>
                                {claim.hasScreenshot && (
                                  <button
                                    type="button"
                                    onClick={() => handleViewClaimScreenshot(claim)}
                                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-slate-950 px-2.5 py-1.5 font-bold text-cyan-200"
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                    View screenshot
                                  </button>
                                )}
                              </td>
                              <td className="min-w-[230px] p-3">
                                <span
                                  className={`inline-flex rounded-full px-2.5 py-1 font-extrabold capitalize ${
                                    claim.status === 'pending'
                                      ? 'bg-amber-400/15 text-amber-200'
                                      : claim.status === 'approved'
                                      ? 'bg-blue-400/15 text-blue-200'
                                      : claim.status === 'rejected'
                                      ? 'bg-rose-400/15 text-rose-200'
                                      : 'bg-emerald-400/15 text-emerald-200'
                                  }`}
                                >
                                  {claim.status}
                                  {claim.resolution ? ` · ${claim.resolution}` : ''}
                                </span>
                                {claim.rejectionReason && (
                                  <p className="mt-2 text-rose-200">Reason: {claim.rejectionReason}</p>
                                )}
                                {claim.replacementHistory.length > 0 && (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer font-bold text-cyan-200">
                                      Replacement history ({claim.replacementHistory.length})
                                    </summary>
                                    {claim.replacementHistory.map((entry, index) => (
                                      <div key={`${claim.claimId}-replacement-${index}`} className="mt-2 space-y-1 border-l border-cyan-400/30 pl-2">
                                        <p className="break-words text-rose-200">Old: {entry.oldCredential}</p>
                                        <p className="font-black text-cyan-200">→</p>
                                        <p className="break-words text-emerald-200">New: {entry.newCredential}</p>
                                        <p className="text-slate-400">
                                          {formatClaimDate(entry.replacedAt)} · {entry.adminName}
                                        </p>
                                      </div>
                                    ))}
                                  </details>
                                )}
                                <details className="mt-2">
                                  <summary className="cursor-pointer font-bold text-slate-300">
                                    Action log ({claim.actionLog.length})
                                  </summary>
                                  {claim.actionLog.map((action, index) => (
                                    <p key={`${claim.claimId}-action-${index}`} className="mt-1 text-slate-400">
                                      {action.action.replaceAll('_', ' ')} · {formatClaimDate(action.timestamp)} · {action.adminName}
                                      {action.note ? ` · ${action.note}` : ''}
                                    </p>
                                  ))}
                                </details>
                              </td>
                              <td className="min-w-[230px] space-y-2 p-3">
                                {claim.status === 'pending' && (
                                  <button
                                    type="button"
                                    disabled={claimActionBusy === claim.claimId}
                                    onClick={() => handleClaimAction(claim, 'approve')}
                                    className="w-full rounded-lg bg-blue-600 px-3 py-2 font-extrabold text-white disabled:opacity-50"
                                  >
                                    Approve claim
                                  </button>
                                )}
                                {claim.status === 'approved' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={
                                        claimActionBusy === claim.claimId ||
                                        limitReached
                                      }
                                      onClick={() => handleClaimAction(claim, 'replace')}
                                      title={
                                        limitReached
                                          ? 'Replacement limit reached'
                                          : poolAvailable === 0
                                            ? 'Click to see the stock warning'
                                          : ''
                                      }
                                      className="w-full rounded-lg bg-emerald-600 px-3 py-2 font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-45"
                                    >
                                      Resolve with Replacement
                                    </button>
                                    {limitReached && (
                                      <p className="text-center font-bold text-amber-200">
                                        Replacement limit reached
                                      </p>
                                    )}
                                    <button
                                      type="button"
                                      disabled={claimActionBusy === claim.claimId}
                                      onClick={() => {
                                        if (
                                          window.confirm(
                                            'Confirm that you have already sent the refund through your payment provider. This action only records the refund in the panel.'
                                          )
                                        ) {
                                          void handleClaimAction(claim, 'refund');
                                        }
                                      }}
                                      className="w-full rounded-lg border border-amber-300/30 bg-amber-600/15 px-3 py-2 font-extrabold text-amber-100 disabled:opacity-50"
                                    >
                                      Record sent refund
                                    </button>
                                    <p className="text-[10px] leading-relaxed text-slate-500">
                                      Send the money through your payment provider first. This button only records a refund you confirm was sent.
                                    </p>
                                  </>
                                )}
                                {open && (
                                  <button
                                    type="button"
                                    disabled={claimActionBusy === claim.claimId}
                                    onClick={() => {
                                      setRejectClaim(claim);
                                      setRejectionReason('');
                                    }}
                                    className="w-full rounded-lg border border-rose-400/30 bg-rose-950/70 px-3 py-2 font-bold text-rose-200 disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                )}
                                {!open && (
                                  <p className="text-center text-slate-500">No further actions</p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {guaranteeClaims.length < claimsTotal && (
                  <button
                    type="button"
                    onClick={() => setClaimsOffset(guaranteeClaims.length)}
                    className="mt-3 w-full rounded-xl border border-cyan-400/30 bg-slate-950 px-4 py-2.5 text-xs font-bold text-cyan-200"
                  >
                    Load older claims ({guaranteeClaims.length} of {claimsTotal})
                  </button>
                )}
                <p className="text-[11px] text-slate-500">
                  Low stock is 2 or fewer IDs. Replacements use the matching guarantee pool and keep the original expiry date.
                </p>
              </section>
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
                      type="text"
                      inputMode="numeric"
                      min={1}
                      max={100000}
                      value={rentalPriceInput}
                      onChange={(e) => {
                        const value = e.target.value;
                        setRentalPriceInput(value);
                        if (/^\d+$/.test(value)) {
                          const price = Number(value);
                          if (price >= 1 && price <= 100000) {
                            setFormConfig((current) => ({
                              ...current,
                              priceRental24h: price,
                            }));
                          }
                        }
                      }}
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
                    type="text"
                    inputMode="numeric"
                    min={0}
                    value={stockInputs.stockDisplayAvailable}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStockInputs((current) => ({
                        ...current,
                        stockDisplayAvailable: value,
                      }));
                      setDirtyStockInputs((current) => ({
                        ...current,
                        stockDisplayAvailable: true,
                      }));
                      if (/^\d+$/.test(value) && Number(value) <= 100000) {
                        setFormConfig((current) => ({
                          ...current,
                          stockDisplayAvailable: Number(value),
                        }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability is capped by unassigned IDs in the matching vault pool.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-emerald-300">
                    24H Rental IDs Display Counter
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    min={0}
                    value={stockInputs.rentalStockDisplayAvailable}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStockInputs((current) => ({
                        ...current,
                        rentalStockDisplayAvailable: value,
                      }));
                      setDirtyStockInputs((current) => ({
                        ...current,
                        rentalStockDisplayAvailable: true,
                      }));
                      if (/^\d+$/.test(value) && Number(value) <= 100000) {
                        setFormConfig((current) => ({
                          ...current,
                          rentalStockDisplayAvailable: Number(value),
                        }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability is capped by unassigned IDs in the matching vault pool.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    7 Days Guarantee IDs Stock
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    min={0}
                    value={stockInputs.stock7DayGuaranteeAvailable}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStockInputs((current) => ({
                        ...current,
                        stock7DayGuaranteeAvailable: value,
                      }));
                      setDirtyStockInputs((current) => ({
                        ...current,
                        stock7DayGuaranteeAvailable: true,
                      }));
                      if (/^\d+$/.test(value) && Number(value) <= 100000) {
                        setFormConfig((current) => ({
                          ...current,
                          stock7DayGuaranteeAvailable: Number(value),
                        }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability is capped by unassigned IDs in the matching vault pool.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-emerald-300">
                    1 Month Guarantee IDs Stock
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    min={0}
                    value={stockInputs.stock1MonthGuaranteeAvailable}
                    onChange={(e) => {
                      const value = e.target.value;
                      setStockInputs((current) => ({
                        ...current,
                        stock1MonthGuaranteeAvailable: value,
                      }));
                      setDirtyStockInputs((current) => ({
                        ...current,
                        stock1MonthGuaranteeAvailable: true,
                      }));
                      if (/^\d+$/.test(value) && Number(value) <= 100000) {
                        setFormConfig((current) => ({
                          ...current,
                          stock1MonthGuaranteeAvailable: Number(value),
                        }));
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-emerald-500/40 text-sm text-emerald-400 font-mono font-black"
                  />
                  <p className="text-[11px] text-slate-400">
                    Customer availability is capped by unassigned IDs in the matching vault pool.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Support Display Name
                  </label>
                  <input
                    type="text"
                    value={formConfig.supportHandle}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSupportHandleDirty(true);
                      setFormConfig((current) => ({
                        ...current,
                        supportHandle: value,
                      }));
                    }}
                    placeholder="WhatsApp Support"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Admin Name for Claim Audit Log
                  </label>
                  <input
                    type="text"
                    maxLength={80}
                    required
                    value={formConfig.adminDisplayName}
                    onChange={(e) =>
                      setFormConfig((current) => ({
                        ...current,
                        adminDisplayName: e.target.value,
                      }))
                    }
                    placeholder="Store Admin"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                  <p className="text-[11px] text-slate-400">
                    This name is attached to approvals, rejections, refunds, and replacements.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    WhatsApp Support Link
                  </label>
                  <input
                    type="url"
                    required
                    value={formConfig.supportUrl}
                    onChange={(e) => {
                      setSupportUrlDirty(true);
                      setFormConfig((current) => ({
                        ...current,
                        supportUrl: e.target.value,
                      }));
                    }}
                    placeholder="https://wa.me/1234567890"
                    pattern="https://wa\.me/[0-9]{8,15}"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                  <p className="text-[11px] text-slate-400">
                    Use the full international phone number with country code and no plus sign.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Maximum Guarantee Replacements per Order
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={20}
                    step={1}
                    required
                    value={formConfig.maxGuaranteeReplacementsPerOrder}
                    onChange={(e) =>
                      setFormConfig((current) => ({
                        ...current,
                        maxGuaranteeReplacementsPerOrder: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-cyan-500/35 text-sm text-white"
                  />
                  <p className="text-[11px] text-slate-400">
                    Applies across the original order guarantee. Set to 0 to disable replacements.
                  </p>
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
                    Add one account per line:{' '}
                    <code className="text-cyan-300">username | password</code>. IDs are assigned
                    from the selected pool after an order&apos;s payment is manually verified.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-extrabold text-cyan-300">
                    Select Vault Pool
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ['rental_24h', '24H Rental ID Pool'],
                        ['permanent', 'Permanent ID Pool'],
                        ['guarantee_7days', '7 Days Guarantee Pool'],
                        ['guarantee_1month', '1 Month Guarantee Pool'],
                      ] as const
                    ).map(([poolType, label]) => (
                      <button
                        key={poolType}
                        type="button"
                        onClick={() => setNewVaultPool(poolType)}
                        className={`py-2 px-3 rounded-xl text-xs font-extrabold border cursor-pointer transition-colors ${
                          newVaultPool === poolType
                            ? 'bg-blue-600 text-white border-cyan-300'
                            : 'bg-slate-950 text-slate-300 border-cyan-500/30'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
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
                    placeholder="roshan_rent24_01 | Pass@9911&#10;roshan_rent24_02 | Pass@9912"
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
                    No IDs are available in this pool yet. Add accounts on the left; they will be
                    assigned after payment is manually verified.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[500px] overflow-y-auto pr-1">
                    {vault.map((item) => (
                      <div
                        key={item.vaultId}
                        className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 ${
                          item.isAssigned
                            ? 'bg-slate-950/50 border-slate-800 opacity-60'
                            : item.reservedOrderId
                              ? 'bg-amber-950/30 border-amber-500/40'
                            : 'bg-slate-950/90 border-cyan-500/35'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                item.isAssigned
                                  ? 'bg-slate-600'
                                  : item.reservedOrderId
                                    ? 'bg-amber-400'
                                  : 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                              }`}
                            />
                            <p className="font-mono text-xs text-white font-bold truncate">
                              {item.irctcUsername} | {item.irctcPassword}
                            </p>
                            <span className="text-[10px] font-bold text-cyan-300">
                              · {getVaultPoolLabel(item.poolType)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                            {item.accountNote && <span>{item.accountNote}</span>}
                            {item.isAssigned && (
                              <span className="text-cyan-400 font-mono font-semibold">
                                Delivered in Order: {item.assignedOrderId}
                              </span>
                            )}
                            {!item.isAssigned && item.reservedOrderId && (
                              <span className="text-amber-300 font-mono font-semibold">
                                Reserved for Order: {item.reservedOrderId}
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

          {claimWarning && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="claim-warning-title"
            >
              <section className="w-full max-w-md rounded-2xl border border-amber-400/40 bg-slate-950 p-5 shadow-2xl">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                  <div>
                    <h2 id="claim-warning-title" className="font-extrabold text-amber-100">
                      Guarantee claim update
                    </h2>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
                      {claimWarning}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setClaimWarning('')}
                  className="mt-5 w-full rounded-xl bg-amber-500/20 px-4 py-2.5 text-sm font-bold text-amber-100 hover:bg-amber-500/30"
                >
                  Close
                </button>
              </section>
            </div>
          )}

          {rejectClaim && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  handleClaimAction(rejectClaim, 'reject', rejectionReason);
                }}
                className="w-full max-w-lg rounded-2xl border border-rose-400/40 bg-slate-950 p-5 shadow-2xl"
              >
                <h2 className="font-extrabold text-white">Reject guarantee claim</h2>
                <p className="mt-1 text-xs text-slate-400">
                  The customer will see this reason with their order.
                </p>
                <textarea
                  required
                  maxLength={500}
                  rows={4}
                  value={rejectionReason}
                  onChange={(event) => setRejectionReason(event.target.value)}
                  placeholder="Enter a clear reason for rejecting this claim"
                  className="mt-4 w-full rounded-xl border border-rose-400/25 bg-slate-900 p-3 text-sm text-white placeholder:text-slate-500"
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setRejectClaim(null)}
                    className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-bold text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!rejectionReason.trim() || claimActionBusy === rejectClaim.claimId}
                    className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-extrabold text-white disabled:opacity-50"
                  >
                    Confirm rejection
                  </button>
                </div>
              </form>
            </div>
          )}

          {claimScreenshot && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
              onClick={() => setClaimScreenshot(null)}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label={`Screenshot for ${claimScreenshot.title}`}
                className="w-full max-w-4xl rounded-2xl border border-cyan-400/30 bg-slate-950 p-4"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="font-mono text-sm font-bold text-cyan-100">
                    Claim screenshot · {claimScreenshot.title}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setClaimScreenshot(null)}
                    aria-label="Close screenshot"
                    className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"
                  >
                    <XCircle className="h-5 w-5" />
                  </button>
                </div>
                <img
                  src={claimScreenshot.dataUrl}
                  alt={`Customer evidence for claim ${claimScreenshot.title}`}
                  className="max-h-[75vh] w-full rounded-xl bg-black object-contain"
                />
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};
