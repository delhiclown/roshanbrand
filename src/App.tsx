import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Headphones,
  Layers,
  Lock,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  Search,
  SlidersVertical,
  Sparkles,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { AdminPortal } from '../components/AdminPortal';
import { CheckoutModal } from '../components/CheckoutModal';
import { DeliveredOrderDetails } from '../components/DeliveredOrderDetails';
import { buildDynamicUpiUri } from '../components/UpiQrBox';
import { DEFAULT_STORE_CONFIG, LIMITS } from './constants';
import {
  CheckoutDraft,
  CustomerGuaranteeClaim,
  OrderRecord,
  PackType,
  StoreConfig,
  VaultPoolType,
} from './types';

const orderAccessStorageKey = (orderId: string) => `roshanbrand_order_access_${orderId}`;
const cookieAuthenticatedOrder = 'http-only-cookie';

const removeRecentOrder = (orderId: string) => {
  try {
    const recentOrders: unknown = JSON.parse(
      localStorage.getItem('roshanbrand_recent_orders') || '[]'
    );
    if (!Array.isArray(recentOrders)) return;
    localStorage.setItem(
      'roshanbrand_recent_orders',
      JSON.stringify(recentOrders.filter((id) => id !== orderId))
    );
  } catch {
    // Browser storage may be unavailable.
  }
};

interface ProductOption {
  id: string;
  title: string;
  subtitle: string;
  tag: string;
  unitPriceKey: keyof StoreConfig;
  defaultQty: number;
  packType: PackType;
  isRental24h?: boolean;
  isSevenDayGuarantee?: boolean;
  isOneMonthGuarantee?: boolean;
}

export default function App() {
  const [viewMode, setViewMode] = useState<'store' | 'admin'>('store');
  const [storeConfig, setStoreConfig] = useState<StoreConfig>(DEFAULT_STORE_CONFIG);
  const [vaultStock, setVaultStock] = useState<Record<VaultPoolType, number>>({
    permanent: 0,
    rental_24h: 0,
    guarantee_7days: 0,
    guarantee_1month: 0,
  });
  const [storeConfigLoaded, setStoreConfigLoaded] = useState(false);
  const [storeLoadError, setStoreLoadError] = useState('');
  const [storeRetryCount, setStoreRetryCount] = useState(0);

  // Open a product by default so checkout options are immediately visible.
  const [openCardId, setOpenCardId] = useState<string>('irctc-rental-24h');
  const [selectedTier, setSelectedTier] = useState<string>('1');
  const [quantity, setQuantity] = useState<number>(1);
  const [outOfStockQuantity, setOutOfStockQuantity] = useState<number | null>(null);
  const [customNote, setCustomNote] = useState<string>('');
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft | null>(null);
  const [rentalStockNoticeOpen, setRentalStockNoticeOpen] = useState(false);

  const [trackedOrderId, setTrackedOrderId] = useState<string>(() => {
    try {
      return (
        JSON.parse(localStorage.getItem('roshanbrand_recent_orders') || '[]')[0] || ''
      );
    } catch {
      return '';
    }
  });
  const [searchInput, setSearchInput] = useState<string>('');
  const [orderAccessInput, setOrderAccessInput] = useState<string>('');
  const [trackedOrder, setTrackedOrder] = useState<OrderRecord | null>(null);
  const [trackedOrderAccessToken, setTrackedOrderAccessToken] = useState('');
  const [guaranteeClaims, setGuaranteeClaims] = useState<CustomerGuaranteeClaim[]>([]);
  const [trackDropdownOpen, setTrackDropdownOpen] = useState<boolean>(false);
  const [trackError, setTrackError] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState<boolean>(false);
  const [inlineQrDataUrl, setInlineQrDataUrl] = useState<string>('');
  const displayedPermanentStock = storeConfig.stockDisplayAvailable;
  const availableRentalStock = vaultStock.rental_24h;
  const totalAvailableStock =
    Math.min(displayedPermanentStock, vaultStock.permanent) +
    availableRentalStock +
    Math.min(storeConfig.stock7DayGuaranteeAvailable, vaultStock.guarantee_7days) +
    Math.min(storeConfig.stock1MonthGuaranteeAvailable, vaultStock.guarantee_1month);

  useEffect(() => {
    if (
      trackedOrder?.status !== 'verified_delivered' ||
      !trackedOrder.deliveredCredentials
    ) {
      return;
    }
    const previousTitle = document.title;
    document.title = 'Roshanbrand — Order Details';
    return () => {
      document.title = previousTitle;
    };
  }, [trackedOrder?.status]);

  useEffect(() => {
    if (trackedOrder?.status === 'verified_delivered') {
      removeRecentOrder(trackedOrder.orderId);
    }
  }, [trackedOrder?.orderId, trackedOrder?.status]);

  // Keep storefront stock and settings in sync with admin changes.
  useEffect(() => {
    const loadStore = async () => {
      try {
        const res = await fetch('/api/store', { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`Store service returned HTTP ${res.status}.`);
        }
        const data = await res.json();
        if (!data.storeConfig || !data.vaultStock) {
          throw new Error('Store service returned incomplete inventory data.');
        }
        const normalizeVaultStock = (value: unknown) =>
          typeof value === 'number' && Number.isFinite(value)
            ? Math.max(0, Math.floor(value))
            : 0;
        setStoreConfig({ ...DEFAULT_STORE_CONFIG, ...data.storeConfig });
        setVaultStock({
          permanent: normalizeVaultStock(data.vaultStock.permanent),
          rental_24h: normalizeVaultStock(data.vaultStock.rental_24h),
          guarantee_7days: normalizeVaultStock(data.vaultStock.guarantee_7days),
          guarantee_1month: normalizeVaultStock(data.vaultStock.guarantee_1month),
        });
        setStoreConfigLoaded(true);
        setStoreLoadError('');
      } catch {
        setStoreLoadError(
          storeConfigLoaded
            ? 'Stock information could not be refreshed. Showing the last loaded stock.'
            : 'Store inventory is temporarily unavailable. Please retry in a moment.'
        );
      }
    };
    loadStore();
    const refreshTimer = window.setInterval(loadStore, 5000);

    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string };
        if (
          [
            'config_updated',
            'order_created',
            'order_rejected',
            'order_deleted',
            'order_verified',
            'vault_updated',
            'guarantee_claim_replaced',
          ].includes(message.type || '')
        ) {
          loadStore();
        }
      } catch {
        // Ignore malformed event payloads and keep the last loaded configuration.
      }
    };

    return () => {
      window.clearInterval(refreshTimer);
      events.close();
    };
  }, [storeRetryCount, storeConfigLoaded]);

  useEffect(() => {
    if (!storeConfigLoaded) return;

    try {
      if (sessionStorage.getItem('roshanbrand_rental_stock_notice_seen') === '1') return;
      sessionStorage.setItem('roshanbrand_rental_stock_notice_seen', '1');
    } catch {
      // Keep the notice available when browser storage is disabled.
    }
    setRentalStockNoticeOpen(true);
  }, [storeConfigLoaded]);

  // Poll tracked order if present
  useEffect(() => {
    const q = trackedOrderId.trim();
    if (!q) {
      setTrackedOrder(null);
      return;
    }

    let active = true;
    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/orders/lookup?q=${encodeURIComponent(q)}`);
        if (!active) return;
        if (res.ok) {
          const lookupData = await res.json();
          let order: OrderRecord = lookupData.order;
          let accessToken = '';
          try {
            accessToken = localStorage.getItem(orderAccessStorageKey(order.orderId)) || '';
          } catch {
            accessToken = '';
          }
          const accessResponse = await fetch('/api/orders/access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              orderId: order.orderId,
              ...(accessToken ? { accessToken } : {}),
            }),
          });
          try {
            localStorage.removeItem(orderAccessStorageKey(order.orderId));
          } catch {
            // The access key is no longer written to browser storage.
          }
          if (accessResponse.ok) {
            const accessData = await accessResponse.json();
            order = accessData.order;
            setTrackedOrderAccessToken(accessToken || cookieAuthenticatedOrder);
            setGuaranteeClaims(accessData.guaranteeClaims || []);
          } else {
            setTrackedOrderAccessToken('');
            setGuaranteeClaims([]);
          }
          if (!active) return;
          setTrackedOrder(order);
          setTrackError('');
        } else {
          setTrackedOrder(null);
          setTrackError('No order found with this UTR or Order ID.');
        }
      } catch {
        // ignore transient network error
      }
    };

    fetchOrder();
    const es = new EventSource('/api/events');
    es.onmessage = () => {
      fetchOrder();
    };
    const timer = setInterval(fetchOrder, 10000);
    return () => {
      active = false;
      es.close();
      clearInterval(timer);
    };
  }, [trackedOrderId]);

  const productOptions: ProductOption[] = [
    {
      id: 'irctc-verified',
      title: 'IRCTC ID — Aadhaar Verified',
      subtitle: 'Account credentials · Check booking and product terms before purchase',
      tag: 'Standard',
      unitPriceKey: 'priceCustomPerId',
      defaultQty: 1,
      packType: 'pack_1',
    },
    {
      id: 'irctc-7day-guarantee',
      title: 'IRCTC ID — 7 Days Guarantee',
      subtitle: '7-day coverage from delivery · free replacement or full refund for eligible issues',
      tag: '7 Days Guarantee',
      unitPriceKey: 'price7DayGuaranteePerId',
      defaultQty: 1,
      packType: 'guarantee_7days',
      isSevenDayGuarantee: true,
    },
    {
      id: 'irctc-1month-guarantee',
      title: 'IRCTC ID — 1 Month Guarantee',
      subtitle: '1-month coverage from delivery · free replacement or full refund for eligible issues',
      tag: '1 Month Guarantee',
      unitPriceKey: 'price1MonthGuaranteePerId',
      defaultQty: 1,
      packType: 'guarantee_1month',
      isOneMonthGuarantee: true,
    },
    {
      id: 'irctc-rental-24h',
      title: 'Buy Rental IRCTC ID for 24 Hours',
      subtitle:
        '24-Hour Active Rental Access · Payment Confirmation Required · Tatkal & Emergency Booking Ready',
      tag: '24H Rental',
      unitPriceKey: 'priceRental24h',
      defaultQty: 1,
      packType: 'rental_24h',
      isRental24h: true,
    },
  ];

  const calculateTotal = (
    qty: number,
    tier: string,
    isRental24h?: boolean,
    isSevenDayGuarantee?: boolean,
    isOneMonthGuarantee?: boolean
  ): number => {
    if (isRental24h) {
      return qty * (storeConfig.priceRental24h || 49);
    }
    if (isSevenDayGuarantee) {
      return qty * storeConfig.price7DayGuaranteePerId;
    }
    if (isOneMonthGuarantee) {
      return qty * storeConfig.price1MonthGuaranteePerId;
    }
    return qty * storeConfig.priceCustomPerId;
  };

  const activeProduct =
    productOptions.find((p) => p.id === openCardId) || productOptions[0];
  const getAvailableStock = (_option: ProductOption) => totalAvailableStock;
  const activeStockCount = getAvailableStock(activeProduct);
  const safeQty = Math.max(
    LIMITS.QUANTITY_MIN,
    Math.min(LIMITS.QUANTITY_MAX, Number(quantity) || 1)
  );
  const hasEnoughStock =
    storeConfigLoaded &&
    activeStockCount > 0 &&
    safeQty <= activeStockCount &&
    !(outOfStockQuantity !== null && outOfStockQuantity > activeStockCount);
  const totalPayable = calculateTotal(
    safeQty,
    selectedTier,
    activeProduct.isRental24h,
    activeProduct.isSevenDayGuarantee,
    activeProduct.isOneMonthGuarantee
  );
  const effectiveUnitPrice = Math.max(1, Math.round(totalPayable / safeQty));

  useEffect(() => {
    if (
      !storeConfigLoaded ||
      activeStockCount <= 0 ||
      quantity <= activeStockCount
    ) {
      return;
    }

    const clampedQty = Math.min(LIMITS.QUANTITY_MAX, activeStockCount);
    setQuantity(clampedQty);
    if (activeProduct.isRental24h) {
      setSelectedTier(String(clampedQty));
    } else if (
      !activeProduct.isSevenDayGuarantee &&
      !activeProduct.isOneMonthGuarantee &&
      selectedTier !== 'bulk' &&
      selectedTier !== 'custom'
    ) {
      setSelectedTier(
        [1, 2, 5, 10].includes(clampedQty) ? String(clampedQty) : 'custom'
      );
    }
  }, [
    storeConfigLoaded,
    activeStockCount,
    quantity,
    activeProduct,
    selectedTier,
  ]);

  const resolvedPackType: PackType = activeProduct.isRental24h
    ? 'rental_24h'
    : activeProduct.isSevenDayGuarantee
    ? 'guarantee_7days'
    : activeProduct.isOneMonthGuarantee
    ? 'guarantee_1month'
    : selectedTier === '1'
    ? 'pack_1'
    : selectedTier === '2'
    ? 'pack_2'
    : selectedTier === '5'
    ? 'pack_5'
    : selectedTier === '10'
    ? 'pack_10'
    : selectedTier === 'bulk'
    ? 'bulk'
    : 'custom';

  const resolvedPackLabel = activeProduct.isRental24h
    ? `24-Hour Rental IRCTC ID (${safeQty} ID${safeQty > 1 ? 's' : ''} · 24H Validity)`
    : activeProduct.isSevenDayGuarantee
    ? `IRCTC ID — 7 Days Guarantee (${safeQty} ID${safeQty > 1 ? 's' : ''})`
    : activeProduct.isOneMonthGuarantee
    ? `IRCTC ID — 1 Month Guarantee (${safeQty} ID${safeQty > 1 ? 's' : ''})`
    : selectedTier === '1'
    ? '1 IRCTC ID Pack'
    : selectedTier === '2'
    ? '2 IRCTC IDs Pack'
    : selectedTier === '5'
    ? '5 IRCTC IDs Pack'
    : selectedTier === '10'
    ? '10 IRCTC IDs Pack'
    : selectedTier === 'bulk'
    ? `Bulk Order (${safeQty} IRCTC IDs)`
    : `Custom Order (${safeQty} IRCTC IDs)`;

  const dynamicInlineUpiUri = useMemo(
    () =>
      buildDynamicUpiUri({
        upiId: storeConfig.upiId,
        payeeName: storeConfig.payeeName,
        amount: totalPayable,
        orderNote: `${storeConfig.siteTitle} ${
          activeProduct.isRental24h
            ? '24H Rental'
            : activeProduct.isSevenDayGuarantee
            ? '7 Days Guarantee'
            : activeProduct.isOneMonthGuarantee
            ? '1 Month Guarantee'
            : ''
        } ${safeQty} ID`,
      }),
    [
      storeConfig.upiId,
      storeConfig.payeeName,
      storeConfig.siteTitle,
      totalPayable,
      activeProduct.isRental24h,
      activeProduct.isSevenDayGuarantee,
      activeProduct.isOneMonthGuarantee,
      safeQty,
    ]
  );

  useEffect(() => {
    if (
      !storeConfigLoaded ||
      activeStockCount <= 0 ||
      safeQty > activeStockCount ||
      !hasEnoughStock
    ) {
      setInlineQrDataUrl('');
      return;
    }

    let active = true;
    QRCode.toDataURL(dynamicInlineUpiUri, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#050816',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setInlineQrDataUrl(url);
      })
      .catch(() => {
        if (active) setInlineQrDataUrl('');
      });
    return () => {
      active = false;
    };
  }, [
    dynamicInlineUpiUri,
    hasEnoughStock,
    storeConfigLoaded,
    activeStockCount,
    safeQty,
  ]);

  const handleSelectTier = (tier: string, qty: number) => {
    if (!storeConfigLoaded) return;
    if (qty > activeStockCount) {
      setOutOfStockQuantity(qty);
      return;
    }
    setOutOfStockQuantity(null);
    setSelectedTier(tier);
    setQuantity(
      Math.max(
        LIMITS.QUANTITY_MIN,
        Math.min(
          LIMITS.QUANTITY_MAX,
          activeStockCount > 0 ? activeStockCount : LIMITS.QUANTITY_MIN,
          qty
        )
      )
    );
  };

  const handleStepQty = (delta: number) => {
    setOutOfStockQuantity(null);
    const next = Math.max(
      LIMITS.QUANTITY_MIN,
      Math.min(
        LIMITS.QUANTITY_MAX,
        activeStockCount > 0 ? activeStockCount : LIMITS.QUANTITY_MIN,
        safeQty + delta
      )
    );
    setQuantity(next);
    if (activeProduct.isRental24h) {
      setSelectedTier(String(next));
    } else {
      setSelectedTier(
        next === 1
          ? '1'
          : next === 2
          ? '2'
          : next === 5
          ? '5'
          : next === 10
          ? '10'
          : next >= 20
          ? 'bulk'
          : 'custom'
      );
    }
  };

  const handleOpenCheckout = () => {
    if (!hasEnoughStock || safeQty > activeStockCount) return;

    setCheckoutDraft({
      packType: resolvedPackType,
      packLabel: resolvedPackLabel,
      isRental24h: Boolean(activeProduct.isRental24h),
      quantity: safeQty,
      unitPrice: effectiveUnitPrice,
      totalAmount: totalPayable,
      initialCustomSpec: customNote,
    });
  };

  const handleOrderCreated = (order: OrderRecord, accessToken = '') => {
    setTrackedOrderAccessToken(accessToken);
    setGuaranteeClaims([]);
    setTrackedOrderId(order.orderId);
    setSearchInput(order.orderId);
    setTrackedOrder(order);
  };

  const handleTrackSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setTrackError('');
    const accessToken = orderAccessInput.trim();
    if (accessToken) {
      try {
        const lookupResponse = await fetch(`/api/orders/lookup?q=${encodeURIComponent(q)}`);
        const lookupData = await lookupResponse.json();
        if (!lookupResponse.ok) {
          setTrackError(lookupData.error || 'No order found with this UTR or Order ID.');
          return;
        }
        const orderId = String(lookupData.order.orderId);
        const response = await fetch('/api/orders/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orderId, accessToken }),
        });
        const data = await response.json();
        if (!response.ok) {
          setTrackError(data.error || 'Order ID or access key is incorrect.');
          return;
        }
        try {
          localStorage.removeItem(orderAccessStorageKey(data.order.orderId));
        } catch {
          // The access key remains available in the field for this visit.
        }
        setTrackedOrder(data.order);
        setTrackedOrderAccessToken(accessToken);
        setGuaranteeClaims(data.guaranteeClaims || []);
        setTrackedOrderId(data.order.orderId);
        setSearchInput(data.order.orderId);
        setOrderAccessInput('');
        return;
      } catch {
        setTrackError('Unable to check this access key. Please try again.');
        return;
      }
    }
    setTrackedOrderId(q);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const splitLines = (creds: string) =>
    creds
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const downloadOrderCsv = (order: OrderRecord) => {
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        'Account_Index,Pack_Type,IRCTC_Credentials,Validity_Expires',
        ...splitLines(order.deliveredCredentials).map(
          (line, idx) =>
            `${idx + 1},"${order.packLabel.replace(/"/g, '""')}","${line.replace(
              /"/g,
              '""'
            )}","${
              order.rentalExpiresAt
                ? new Date(order.rentalExpiresAt).toLocaleString()
                : 'Lifetime'
            }"`
        ),
      ].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${order.orderId}-irctc-ids.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (viewMode === 'admin') {
    return (
      <AdminPortal
        storeConfig={storeConfig}
        onConfigUpdated={setStoreConfig}
        onBackToStore={() => setViewMode('store')}
      />
    );
  }

  if (
    trackedOrder?.status === 'verified_delivered' &&
    (trackedOrder.deliveredCredentials || trackedOrder.credentialsExpired)
  ) {
    return (
      <div className="delivered-order-shell">
        <header className="delivered-order-topbar">
          <a className="delivered-order-brand" href="/">
            <span>RB</span>
            <strong>Roshanbrand</strong>
          </a>
          <span className="delivered-order-topbar-status">
            <CheckCircle2 /> Order delivered
          </span>
        </header>
        <main className="delivered-order-main">
          <DeliveredOrderDetails
            order={trackedOrder}
            accessToken={trackedOrderAccessToken}
            guaranteeClaims={guaranteeClaims}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
            onDownload={downloadOrderCsv}
            onGuaranteeClaimsUpdated={setGuaranteeClaims}
            onBack={() => {
              removeRecentOrder(trackedOrder.orderId);
              setTrackedOrder(null);
              setTrackedOrderId('');
              setTrackedOrderAccessToken('');
              setGuaranteeClaims([]);
              setSearchInput('');
            }}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell relative min-h-dvh flex flex-col text-slate-100">
      <div className="app-scene" aria-hidden="true">
        <div className="app-scene-blob app-scene-blob--cyan" />
        <div className="app-scene-blob app-scene-blob--violet" />
        <div className="app-scene-blob app-scene-blob--indigo" />
      </div>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-30 glass-nav">
        <div className="max-w-4xl mx-auto px-3 sm:px-5 h-14 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-cyan-500 text-white flex items-center justify-center shadow-[inset_0_1.5px_0_rgba(255,255,255,0.4),0_4px_0_#0f296b,0_8px_20px_-2px_rgba(56,189,248,0.55)] border border-cyan-300/40 shrink-0 font-display font-black text-xs tracking-wider">
              RB
            </div>
            <div className="min-w-0">
              <p className="font-display font-black text-white text-sm tracking-wider leading-tight truncate drop-shadow-[0_2px_8px_rgba(56,189,248,0.4)]">
                {storeConfig.siteTitle || 'Roshanbrand'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <span
              className="inline-flex items-center gap-1.5 text-xs text-slate-200 font-semibold px-2.5 py-1 rounded-full bg-slate-900/90 border border-cyan-500/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_#040714]"
              title="Available IDs in stock"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  totalAvailableStock > 0
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-amber-400'
                }`}
              />
              <span className="font-bold text-white">
                {!storeConfigLoaded
                  ? '…'
                  : totalAvailableStock > 0
                    ? <span className="tabular-nums">{totalAvailableStock}</span>
                    : 'Out of stock'}
              </span>
            </span>

            {/* Track Order Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setTrackDropdownOpen((prev) => !prev);
                  if (trackedOrderId && !searchInput) {
                    setSearchInput(trackedOrderId);
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                  trackDropdownOpen || trackedOrder
                    ? 'bg-gradient-to-r from-blue-600 to-cyan-500 text-white border border-cyan-300/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_3px_0_#0f296b,0_6px_16px_rgba(56,189,248,0.45)]'
                    : 'bg-slate-900/90 text-cyan-200 border border-cyan-500/35 hover:border-cyan-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_#040714]'
                }`}
              >
                <Search className="w-3.5 h-3.5 text-cyan-300" />
                <span>Track order</span>
                {trackedOrder && (
                  <span
                    className={`w-2 h-2 rounded-full ${
                      trackedOrder.status === 'pending_verification'
                        ? 'bg-amber-400 animate-pulse'
                        : trackedOrder.status === 'rejected'
                          ? 'bg-rose-400'
                          : 'bg-emerald-400'
                    }`}
                  />
                )}
              </button>

              {trackDropdownOpen && (
                <div className="absolute right-0 mt-2.5 w-[min(22rem,calc(100vw-1.5rem))] neon-card-3d p-4 z-50 border-cyan-400/50">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-300">
                      Find your order
                    </span>
                    <button
                      type="button"
                      onClick={() => setTrackDropdownOpen(false)}
                      className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300 mb-3 leading-relaxed">
                    Enter your 12-digit{' '}
                    <span className="font-mono font-semibold text-cyan-300">UTR Number</span> or{' '}
                    <span className="font-mono font-semibold text-cyan-300">Order ID</span> to
                    check its status. Your private access key is required to view credentials.
                  </p>
                  <form onSubmit={handleTrackSearch} className="space-y-2.5">
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Enter 12-digit UTR or Order ID"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-cyan-500/40 bg-slate-950/90 text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
                    />
                    <input
                      type="password"
                      value={orderAccessInput}
                      onChange={(event) => setOrderAccessInput(event.target.value)}
                      placeholder="Private order access key (optional)"
                      autoComplete="off"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-cyan-500/40 bg-slate-950/90 text-white font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
                    />
                    {trackError && (
                      <p className="text-[11px] text-rose-400 font-semibold">{trackError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        className="flex-1 py-2 rounded-xl text-xs font-bold text-white store-pay-pill cursor-pointer"
                      >
                        Check Status
                      </button>
                      {trackedOrderId && (
                        <button
                          type="button"
                          onClick={() => {
                            setTrackedOrderId('');
                            setSearchInput('');
                            setOrderAccessInput('');
                            setTrackedOrder(null);
                          }}
                          className="px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800/90 border border-slate-700 cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setViewMode('admin')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900/95 hover:bg-slate-800 text-cyan-300 border border-cyan-500/35 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_3px_0_#040714] transition-all cursor-pointer whitespace-nowrap"
            >
              <Lock className="w-3 h-3 text-cyan-400" />
              <span>Admin</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Storefront Content */}
      <main className="relative z-10 flex-1 flex flex-col min-h-0">
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-5 pt-4 sm:pt-6 pb-6 flex-1 flex flex-col">
          {storeConfig.announcementText.trim() && (
            <div className="mb-5 flex justify-center">
              <div className="flex w-fit max-w-full items-center justify-center gap-2.5 rounded-2xl border border-cyan-400/35 bg-gradient-to-r from-cyan-950/70 via-blue-950/55 to-slate-950/80 px-4 py-3 text-center shadow-[0_8px_28px_rgba(8,145,178,0.12)]">
                <Sparkles className="h-4 w-4 shrink-0 text-cyan-300" />
                <p className="min-w-0 whitespace-normal break-words text-center text-xs font-extrabold uppercase tracking-wide text-cyan-100 sm:text-sm">
                  {storeConfig.announcementText}
                </p>
              </div>
            </div>
          )}

          {storeLoadError && (
            <div
              role="alert"
              className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-950/50 px-4 py-3 text-sm text-amber-100"
            >
              <span>{storeLoadError}</span>
              <button
                type="button"
                onClick={() => setStoreRetryCount((count) => count + 1)}
                className="rounded-lg border border-amber-300/35 px-3 py-1.5 text-xs font-bold text-amber-100 transition hover:bg-amber-400/10"
              >
                Retry
              </button>
            </div>
          )}

          {/* Active / Tracked Order Status Box */}
          {trackedOrder && (
            <div className="mb-6">
              {trackedOrder.status === 'pending_verification' ? (
                <div className="neon-card-3d border-amber-400/50 p-4 sm:p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/50 text-amber-300 flex items-center justify-center shrink-0">
                        <Clock className="w-5 h-5 animate-pulse" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-extrabold text-white">
                            UTR submitted — waiting for payment confirmation
                          </h3>
                          <span className="text-[11px] font-mono font-bold text-amber-300">
                            {trackedOrder.orderId}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5">
                          {trackedOrder.utrNumber ? (
                            <>
                              UTR{' '}
                              <span className="font-mono font-bold text-cyan-300">
                                {trackedOrder.utrNumber}
                              </span>{' '}
                            </>
                          ) : (
                            'Payment reference is private. '
                          )}
                          (₹{trackedOrder.totalAmount} for {trackedOrder.quantity} ID
                          {trackedOrder.quantity > 1 ? 's' : ''}) submitted. Credentials will be
                          released only after this payment is confirmed in{' '}
                          {trackedOrder.paymentUpiId || storeConfig.upiId}.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(trackedOrder.orderId, 'order-id')}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/35 flex items-center gap-1.5 shadow-[0_3px_0_#040714] cursor-pointer"
                    >
                      {copiedKey === 'order-id' ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Copied ID</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy Order ID</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : trackedOrder.status === 'rejected' ? (
                <div className="neon-card-3d border-rose-500/50 p-4 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-white">
                        Order {trackedOrder.orderId} — UTR Rejected
                      </p>
                      <p className="text-[11px] text-rose-300">
                        {trackedOrder.adminNote ||
                          'Invalid or mismatched UTR number. Please contact support.'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="neon-card-3d border-amber-400/50 p-4 space-y-2">
                  <h3 className="text-sm font-extrabold text-white">
                    Order delivered — private access key required
                  </h3>
                  <p className="text-xs text-slate-300">
                    Enter the private key saved when you placed this order to view your credentials.
                    If you no longer have it, contact support with your order ID and payment receipt.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Hero Section */}
          <header className="text-center max-w-lg mx-auto mb-5 sm:mb-7">
            <h1 className="font-display text-xl sm:text-3xl font-black text-white tracking-tight leading-snug drop-shadow-[0_4px_16px_rgba(0,0,0,0.8)]">
              Buy <span className="gradient-text">IRCTC ID</span> or{' '}
              <span className="text-emerald-400">24H Rental</span>
            </h1>
            <div className="store-intro-step">
              <span className="store-intro-step-pill">Step 1</span>
              <span className="text-xs font-bold text-slate-100">
                Tap <strong className="text-cyan-300">Buy</strong> on a card below to choose
                quantity &amp; open UPI QR
              </span>
            </div>
          </header>

          {/* Section Title */}
          <div className="flex items-center justify-between gap-2 mb-3 px-0.5">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-cyan-300/90 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              <span>Choose an ID type</span>
            </h2>
            <span className="text-[11px] text-slate-400 font-semibold">
              {productOptions.length} options available
            </span>
          </div>
          {/* Available product options */}
          <div className="flex-1 min-h-0">
            <ul className="grid grid-cols-1 gap-4 list-none p-0 m-0">
              {productOptions.map((option) => {
                const isOpen = openCardId === option.id;
                const unitPrice = Number(storeConfig[option.unitPriceKey]) || 49;
                const stockCount = getAvailableStock(option);
                const isOutOfStock = stockCount <= 0;
                const isOptionQtyAvailable = (qty: number) =>
                  storeConfigLoaded && stockCount > 0 && qty <= stockCount;

                return (
                  <li
                    key={option.id}
                    id={`product-${option.id}`}
                    className={`store-product-wrap ${
                      option.isRental24h ? 'store-product-wrap--rental' : ''
                    } ${isOpen ? 'store-product-wrap--open' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (isOpen) {
                          setOpenCardId('');
                        } else {
                          setOpenCardId(option.id);
                          setSelectedTier('1');
                          setQuantity(1);
                          setOutOfStockQuantity(null);
                        }
                      }}
                      aria-label={`${option.title}: ${
                        !storeConfigLoaded
                          ? 'stock loading'
                          : isOutOfStock
                            ? 'out of stock; open for product details'
                            : `${stockCount} available`
                      }`}
                      className="w-full text-left p-4 sm:p-5 flex items-center gap-3.5 sm:gap-4 transition-colors focus:outline-none cursor-pointer"
                    >
                      <div
                        className={`w-12 h-12 rounded-2xl text-white flex items-center justify-center shrink-0 font-display font-black text-xs sm:text-sm tracking-tight ${
                          option.isRental24h
                            ? 'store-product-icon--rental'
                            : 'store-product-icon'
                        }`}
                      >
                        {option.isRental24h
                          ? '24H'
                          : option.isSevenDayGuarantee
                          ? '7D'
                          : option.isOneMonthGuarantee
                          ? '1M'
                          : 'ID'}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-bold text-white text-sm sm:text-base leading-snug">
                            {option.title}
                          </h3>
                          <span
                            className={`text-[11px] font-bold ${
                              option.isRental24h ||
                              option.isSevenDayGuarantee ||
                              option.isOneMonthGuarantee
                                ? 'text-emerald-300'
                                : 'text-cyan-300'
                            }`}
                          >
                            · {option.tag}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 mt-0.5 line-clamp-1">
                          {option.subtitle}
                        </p>
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-2">
                          <span className="text-lg font-black text-white tabular-nums">
                            ₹{unitPrice}
                          </span>
                          <span
                            className={`text-[11px] font-semibold ${
                              option.isRental24h ||
                              option.isSevenDayGuarantee ||
                              option.isOneMonthGuarantee
                                ? 'text-emerald-300/90'
                                : 'text-cyan-300/80'
                            }`}
                          >
                            {option.isRental24h
                              ? 'for 24 Hours'
                              : option.isSevenDayGuarantee
                              ? 'per ID · 7 days guarantee'
                              : option.isOneMonthGuarantee
                              ? 'per ID · 1 month guarantee'
                              : 'per ID'}
                          </span>
                          <span className="text-slate-600">·</span>
                          <span
                            className={`text-xs font-bold tabular-nums ${
                              isOutOfStock ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            {!storeConfigLoaded
                              ? storeLoadError
                                ? 'Stock unavailable'
                                : 'Loading stock…'
                              : isOutOfStock
                                ? 'Out of Stock'
                                : `${stockCount} ID${stockCount === 1 ? '' : 's'} available across all types`}
                          </span>
                          {option.isRental24h && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="text-xs font-semibold text-sky-300 flex items-center gap-1">
                                <Zap className="w-3 h-3 text-emerald-400" />
                                Manual UPI Check
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 self-center">
                        <span
                          className={`store-product-cta inline-flex items-center gap-1 px-3.5 py-2 rounded-xl text-xs font-extrabold whitespace-nowrap ${
                            isOpen ? 'store-product-cta--active' : ''
                          }`}
                        >
                          <span>
                            {isOpen
                              ? 'Close'
                              : !storeConfigLoaded
                                ? 'Loading'
                                : isOutOfStock
                                  ? 'Out of Stock'
                                  : 'Buy'}
                          </span>
                          <ChevronRight
                            className={`w-3.5 h-3.5 transition-transform duration-200 ${
                              isOpen ? 'rotate-90' : ''
                            }`}
                          />
                        </span>
                      </div>
                    </button>

                    {/* Expanded Inline Checkout */}
                    {isOpen && (
                      <div className="store-inline-checkout">
                        <div className="space-y-4">
                          {option.isRental24h ? (
                            /* 24-Hour Rental Specific Quantity & Slot Picker */
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300 flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 text-emerald-400" />
                                  <span>Select 24-Hour Rental IRCTC ID Quantity ({activeStockCount} total IDs available)</span>
                                </p>
                                <span className="text-[11px] text-slate-300 font-medium">
                                  ₹{storeConfig.priceRental24h}/ID · 24 Hours Active Validity
                                </span>
                              </div>

                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                                {[1, 2, 3, 5, 10].map((num) => (
                                  <button
                                    key={num}
                                    type="button"
                                    onClick={() => handleSelectTier(String(num), num)}
                                    className={`qty-chip-card ${
                                      isOptionQtyAvailable(num)
                                        ? 'cursor-pointer'
                                        : 'cursor-pointer opacity-50'
                                    } ${
                                      safeQty === num ? 'qty-chip-card--selected' : ''
                                    }`}
                                  >
                                    <span className="text-xs font-extrabold tabular-nums">
                                      {num} {num === 1 ? 'Rental ID' : 'Rental IDs'}
                                    </span>
                                    <span
                                      className={`text-[10px] font-bold tabular-nums ${
                                        safeQty === num ? 'text-cyan-100' : 'text-emerald-400'
                                      }`}
                                    >
                                      ₹{num * (storeConfig.priceRental24h || 49)}
                                    </span>
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('custom', 4)}
                                  className={`qty-chip-card cursor-pointer ${
                                    ![1, 2, 3, 5, 10].includes(safeQty)
                                      ? 'qty-chip-card--selected'
                                      : ''
                                  } ${isOutOfStock || !storeConfigLoaded ? 'opacity-50' : ''}`}
                                >
                                  <span className="text-xs font-extrabold">Custom Qty</span>
                                  <span className="text-[10px] font-bold text-emerald-400">
                                    ₹{storeConfig.priceRental24h}/24H
                                  </span>
                                </button>
                              </div>
                            </div>
                          ) : option.isSevenDayGuarantee || option.isOneMonthGuarantee ? (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-300">
                                  Select {option.isOneMonthGuarantee ? '1 Month' : '7 Days'} Guarantee ID Quantity ({activeStockCount} total IDs available)
                                </p>
                                <span className="text-[11px] text-slate-300 font-medium">
                                  ₹{option.isOneMonthGuarantee
                                    ? storeConfig.price1MonthGuaranteePerId
                                    : storeConfig.price7DayGuaranteePerId}/ID · {option.isOneMonthGuarantee ? '1 month' : '7 days'} guarantee
                                </span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                                {[1, 2, 5, 10].map((num) => (
                                  <button
                                    key={num}
                                    type="button"
                                    onClick={() => handleSelectTier(String(num), num)}
                                    className={`qty-chip-card ${
                                      isOptionQtyAvailable(num)
                                        ? 'cursor-pointer'
                                        : 'cursor-pointer opacity-50'
                                    } ${
                                      selectedTier === String(num) && safeQty === num
                                        ? 'qty-chip-card--selected'
                                        : ''
                                    }`}
                                  >
                                    <span className="text-xs font-extrabold tabular-nums">
                                      {num} ID{num > 1 ? 's' : ''}
                                    </span>
                                    <span className="text-[10px] font-bold tabular-nums text-emerald-400">
                                      ₹{num * (option.isOneMonthGuarantee
                                            ? storeConfig.price1MonthGuaranteePerId
                                            : storeConfig.price7DayGuaranteePerId)}
                                    </span>
                                  </button>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('custom', 3)}
                                  className={`qty-chip-card cursor-pointer ${
                                    selectedTier === 'custom' ? 'qty-chip-card--selected' : ''
                                  } ${isOutOfStock || !storeConfigLoaded ? 'opacity-50' : ''}`}
                                >
                                  <span className="text-xs font-extrabold">Custom Qty</span>
                                  <span className="text-[10px] font-bold text-emerald-400">
                                    ₹{option.isOneMonthGuarantee
                                          ? storeConfig.price1MonthGuaranteePerId
                                          : storeConfig.price7DayGuaranteePerId}/ID
                                  </span>
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Standard / Bulk Quantity Picker */
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-300">
                                  How many IDs do you need? ({activeStockCount} total IDs available)
                                </p>
                                <span className="text-[11px] text-slate-300 font-medium">
                                  Instant QR · No login needed
                                </span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('1', 1)}
                                  className={`qty-chip-card ${
                                    isOptionQtyAvailable(1)
                                      ? 'cursor-pointer'
                                      : 'cursor-pointer opacity-50'
                                  } ${
                                    selectedTier === '1' && safeQty === 1
                                      ? 'qty-chip-card--selected'
                                      : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold tabular-nums">
                                    1 ID
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === '1' && safeQty === 1
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    ₹{storeConfig.priceCustomPerId}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('2', 2)}
                                  className={`qty-chip-card ${
                                    isOptionQtyAvailable(2)
                                      ? 'cursor-pointer'
                                      : 'cursor-pointer opacity-50'
                                  } ${
                                    selectedTier === '2' && safeQty === 2
                                      ? 'qty-chip-card--selected'
                                      : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold tabular-nums">
                                    2 IDs
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === '2' && safeQty === 2
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    ₹{2 * storeConfig.priceCustomPerId}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('5', 5)}
                                  className={`qty-chip-card ${
                                    isOptionQtyAvailable(5)
                                      ? 'cursor-pointer'
                                      : 'cursor-pointer opacity-50'
                                  } ${
                                    selectedTier === '5' && safeQty === 5
                                      ? 'qty-chip-card--selected'
                                      : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold tabular-nums">
                                    5 IDs
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === '5' && safeQty === 5
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    ₹{5 * storeConfig.priceCustomPerId}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('10', 10)}
                                  className={`qty-chip-card ${
                                    isOptionQtyAvailable(10)
                                      ? 'cursor-pointer'
                                      : 'cursor-pointer opacity-50'
                                  } ${
                                    selectedTier === '10' && safeQty === 10
                                      ? 'qty-chip-card--selected'
                                      : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold tabular-nums">
                                    10 IDs
                                  </span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === '10' && safeQty === 10
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    ₹{10 * storeConfig.priceCustomPerId}
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('custom', 3)}
                                  className={`qty-chip-card cursor-pointer ${
                                    selectedTier === 'custom' ? 'qty-chip-card--selected' : ''
                                  } ${isOutOfStock || !storeConfigLoaded ? 'opacity-50' : ''}`}
                                >
                                  <span className="text-xs font-extrabold">Custom Qty</span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === 'custom'
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    Any number
                                  </span>
                                </button>
                              </div>
                            </div>
                          )}

                          <p className="text-[11px] text-slate-400">
                            Stock is shared across all ID types. The selected product&apos;s price and terms apply to the order.
                          </p>

                          {/* Stepper + Custom Note */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                            <div className="flex items-center justify-between gap-2 bg-slate-950/90 rounded-xl border border-cyan-500/35 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                              <span className="text-xs text-slate-300 font-bold">
                                Enter Quantity
                              </span>
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleStepQty(-1)}
                                  disabled={!storeConfigLoaded || activeStockCount <= 0 || safeQty <= 1}
                                  className="w-8 h-8 rounded-lg border border-cyan-500/40 bg-slate-900 text-cyan-300 font-bold text-sm flex items-center justify-center hover:bg-slate-800 disabled:opacity-40 shadow-[0_2px_0_#040714] cursor-pointer"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={LIMITS.QUANTITY_MIN}
                                  max={Math.min(LIMITS.QUANTITY_MAX, activeStockCount)}
                                  value={safeQty}
                                  disabled={!storeConfigLoaded || activeStockCount <= 0}
                                  onChange={(e) => {
                                    const parsed = parseInt(e.target.value, 10);
                                    if (isNaN(parsed)) {
                                      setOutOfStockQuantity(null);
                                      setQuantity(1);
                                    } else {
                                      setOutOfStockQuantity(null);
                                      const clamped = Math.max(
                                        LIMITS.QUANTITY_MIN,
                                        Math.min(
                                          LIMITS.QUANTITY_MAX,
                                          activeStockCount,
                                          parsed
                                        )
                                      );
                                      setQuantity(clamped);
                                      if (!option.isRental24h) {
                                        if (clamped >= 20) setSelectedTier('bulk');
                                        else if (![1, 2, 5, 10].includes(clamped))
                                          setSelectedTier('custom');
                                      }
                                    }
                                  }}
                                  className="w-14 text-center font-bold text-sm text-white tabular-nums bg-slate-900 border border-cyan-500/30 rounded-lg py-1 focus:outline-none focus:ring-2 focus:ring-cyan-400/30"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleStepQty(1)}
                                  disabled={
                                    !storeConfigLoaded ||
                                    activeStockCount <= 0 ||
                                    safeQty >= Math.min(LIMITS.QUANTITY_MAX, activeStockCount)
                                  }
                                  className="w-8 h-8 rounded-lg border border-cyan-500/40 bg-slate-900 text-cyan-300 font-bold text-sm flex items-center justify-center hover:bg-slate-800 disabled:opacity-40 shadow-[0_2px_0_#040714] cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 bg-slate-950/90 rounded-xl border border-cyan-500/35 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                              <SlidersVertical className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                              <input
                                type="text"
                                value={customNote}
                                onChange={(e) =>
                                  setCustomNote(e.target.value.slice(0, LIMITS.CUSTOM_SPEC_MAX))
                                }
                                placeholder={
                                  option.isRental24h
                                    ? '24H Rental slot / Tatkal timing note (optional)'
                                    : 'Custom note / series choice (optional)'
                                }
                                className="w-full text-xs text-white placeholder:text-slate-500 bg-transparent focus:outline-none"
                              />
                            </div>
                          </div>

                          {/* Total & Dynamic Amount QR + Pay CTA */}
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3.5 pt-3 border-t border-cyan-500/25">
                            <div className="flex items-center gap-3">
                              {hasEnoughStock && inlineQrDataUrl && (
                                <button
                                  type="button"
                                  onClick={handleOpenCheckout}
                                  title={`Click to open full ₹${totalPayable} payment QR`}
                                  className="w-16 h-16 rounded-xl bg-white p-1 border-2 border-sky-400 shrink-0 shadow-[0_0_18px_rgba(56,189,248,0.35)] hover:scale-105 transition-transform cursor-pointer"
                                >
                                  <img
                                    src={inlineQrDataUrl}
                                    alt={`Dynamic UPI QR for ₹${totalPayable}`}
                                    referrerPolicy="no-referrer"
                                    className="w-full h-full object-contain rounded"
                                  />
                                </button>
                              )}
                              <div>
                                <div className="flex items-baseline gap-2 flex-wrap">
                                  <span className="text-xs text-slate-300 font-semibold">
                                    Total Payable:
                                  </span>
                                  <span className="text-xl font-black text-white tabular-nums drop-shadow-[0_2px_10px_rgba(56,189,248,0.35)]">
                                    ₹{totalPayable}
                                  </span>
                                  <span className="text-[11px] text-cyan-300 font-semibold">
                                    ({safeQty} {option.isRental24h ? '24H Rental ID' : 'ID'}
                                    {safeQty > 1 ? 's' : ''} · ₹{effectiveUnitPrice}/ID)
                                  </span>
                                </div>
                                {hasEnoughStock && (
                                  <p className="text-[11px] text-emerald-300 font-medium mt-0.5">
                                    Dynamic QR Auto-Generated for{' '}
                                    <strong className="font-mono">
                                      ₹{totalPayable.toFixed(2)}
                                    </strong>{' '}
                                    ({storeConfig.upiId})
                                  </p>
                                )}
                              </div>
                            </div>

                            {outOfStockQuantity !== null &&
                              outOfStockQuantity > activeStockCount &&
                              storeConfigLoaded && (
                              <p className="text-xs font-bold text-rose-400" role="alert">
                                Out of Stock — only {activeStockCount} ID
                                {activeStockCount === 1 ? '' : 's'} available
                              </p>
                            )}

                            <button
                              type="button"
                              disabled={!hasEnoughStock}
                              onClick={handleOpenCheckout}
                              className="store-pay-pill py-3 px-6 rounded-xl font-extrabold text-white text-xs sm:text-sm disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                            >
                              <QrCode className="w-4 h-4" />
                              <span>
                                {hasEnoughStock
                                  ? `Pay ₹${totalPayable} via UPI QR`
                                  : outOfStockQuantity !== null
                                    ? 'Out of Stock'
                                    : 'Select Quantity'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </main>

      {/* Rental stock notice */}
      {rentalStockNoticeOpen && (
        <div
          className="stock-notice-backdrop fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
          onClick={() => setRentalStockNoticeOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="rental-stock-notice-title"
            className="stock-notice-panel relative z-10 w-full max-w-sm overflow-hidden rounded-[28px] border border-cyan-300/25 bg-[#070c1d] text-white shadow-[0_24px_80px_rgba(0,0,0,0.45),0_0_45px_rgba(34,211,238,0.12)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(8,145,178,0.14),transparent_55%)]" />
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-400 to-emerald-400" />
            <button
              type="button"
              aria-label="Close stock notice"
              onClick={() => setRentalStockNoticeOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="relative p-6 sm:p-7">
              <div className="mb-5 text-center text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300/80">
                24-hour rental IDs
              </div>
              <div
                className={`mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border ${
                  availableRentalStock > 0
                    ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-300'
                    : 'border-rose-300/25 bg-rose-400/10 text-rose-300'
                }`}
              >
                {availableRentalStock > 0 ? (
                  <Clock className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </div>
              <h2
                id="rental-stock-notice-title"
                className={`mt-6 text-center text-3xl font-black tracking-tight ${
                  availableRentalStock > 0 ? 'text-white' : 'text-rose-200'
                }`}
              >
                {availableRentalStock > 0
                  ? `${availableRentalStock} ID${availableRentalStock === 1 ? '' : 's'} available`
                  : 'Out of Stock'}
              </h2>
              <div className="mx-auto mt-3 h-1 w-14 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-emerald-400" />

              {availableRentalStock > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setRentalStockNoticeOpen(false);
                    setOpenCardId('irctc-rental-24h');
                    document
                      .getElementById('product-irctc-rental-24h')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="mt-7 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-cyan-500 px-5 py-3.5 text-sm font-extrabold text-white shadow-[0_10px_28px_rgba(8,145,178,0.24)] transition hover:brightness-110"
                >
                  View IDs
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setRentalStockNoticeOpen(false)}
                className="mt-3 w-full rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-white/[0.04] hover:text-white"
              >
                Continue browsing
              </button>
            </div>
          </section>
        </div>
      )}

      {supportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="fixed inset-0" onClick={() => setSupportOpen(false)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="support-dialog-title"
            className="relative z-10 w-full max-w-md neon-card-3d border-cyan-400/50 overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-cyan-500/25 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-[0_3px_0_#0f296b]">
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <h3 id="support-dialog-title" className="text-sm font-extrabold text-white">
                    {storeConfig.siteTitle} Support Desk
                  </h3>
                  <p className="text-[11px] text-cyan-300/80">
                    Instant help with UPI UTR verification, 24H Rental &amp; bulk orders
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSupportOpen(false)}
                aria-label="Close support desk"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-cyan-500/30 space-y-1">
                <p className="font-bold text-white">Payment and delivery</p>
                <p className="text-slate-300 leading-relaxed">
                  {storeConfig.instantDeliveryNote}
                  {' '}If we cannot deliver your ID, a full refund is guaranteed in under one minute.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-400/35 space-y-1">
                <p className="font-bold text-emerald-300">
                  How does the 24-Hour Rental IRCTC ID work?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Pay ₹{storeConfig.priceRental24h} via UPI QR and submit your 12-digit UTR.
                  Credentials are delivered after payment is confirmed by an admin.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-blue-950/40 border border-blue-400/30 space-y-1">
                <p className="font-bold text-blue-200">7-day and 1-month guarantee</p>
                <p className="text-slate-300 leading-relaxed">
                  Coverage starts when the ID is delivered. If an issue is not caused by the
                  customer, we provide a free replacement or full refund. Submit a claim from the
                  delivered order page; WhatsApp support is available if you need help.
                </p>
              </div>

              {storeConfig.supportHandle && (
                <div className="p-3.5 rounded-xl bg-blue-950/50 border border-cyan-400/40 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 block">
                      Support
                    </span>
                    <p className="font-mono font-bold text-white text-sm">
                      {storeConfig.supportHandle}
                    </p>
                  </div>
                </div>
              )}

              <a
                href={storeConfig.supportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-300/35 bg-emerald-500/15 p-3.5 text-sm font-extrabold text-emerald-100 transition hover:bg-emerald-500/25"
              >
                <MessageCircle className="h-5 w-5" />
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Order steps and essential customer information */}
      <aside
        className="mt-auto px-3 sm:px-5 pb-4 pt-5"
        aria-label="How ordering works and store highlights"
      >
        <div className="max-w-4xl mx-auto">
          <div className="store-bottom-dock-float">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2.5 lg:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 mb-1">
                  How it works
                </p>
                <ol className="grid grid-cols-3 gap-1.5 sm:gap-2 list-none p-0 m-0">
                  <li className="flex items-center gap-1.5 min-w-0 rounded-lg bg-slate-950/80 border border-cyan-500/30 px-2 py-1">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                      1
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="text-[10px] font-bold text-white truncate">Choose plan</p>
                      <p className="text-[9px] text-slate-400 truncate hidden sm:block">
                        ₹{storeConfig.priceRental24h} rental, standard or bulk
                      </p>
                    </div>
                  </li>
                  <li className="flex items-center gap-1.5 min-w-0 rounded-lg bg-slate-950/80 border border-cyan-500/30 px-2 py-1">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                      2
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="text-[10px] font-bold text-white truncate">
                        Pay UPI QR &amp; UTR
                      </p>
                      <p className="text-[9px] text-slate-400 truncate hidden sm:block">
                        Manual payment confirmation
                      </p>
                    </div>
                  </li>
                  <li className="flex items-center gap-1.5 min-w-0 rounded-lg bg-slate-950/80 border border-cyan-500/30 px-2 py-1">
                    <span className="w-4 h-4 rounded-full bg-gradient-to-br from-blue-600 to-cyan-500 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                      3
                    </span>
                    <div className="min-w-0 leading-tight">
                      <p className="text-[10px] font-bold text-white truncate">
                        Get ID after payment review
                      </p>
                      <p className="text-[9px] text-slate-400 truncate hidden sm:block">
                        Copy or CSV download
                      </p>
                    </div>
                  </li>
                </ol>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 pt-1.5 lg:pt-0 border-t lg:border-t-0 lg:border-l border-cyan-500/25 lg:pl-4 shrink-0">
                <div className="flex items-center gap-3 sm:gap-4">
                  <span className="text-[10px] font-bold text-cyan-100">UPI payment</span>
                  <span className="text-[10px] font-bold text-cyan-100">Manual payment review</span>
                  <span className="text-[10px] font-bold text-cyan-100">Secure order access</span>
                </div>
              </div>
            </div>
          </div>
          <details className="mt-3 rounded-xl border border-cyan-500/25 bg-slate-950/80 px-4 py-3 text-[11px] text-slate-300">
            <summary className="cursor-pointer font-bold text-cyan-200">
              Payment, privacy and product information
            </summary>
            <ul className="mt-2 list-disc space-y-1.5 pl-4 leading-relaxed">
              <li>
                This is an independent seller and is not affiliated with or endorsed by IRCTC.
              </li>
              <li>
                Verify the recipient and amount in your UPI app. Submitting a UTR is not payment
                confirmation; orders are delivered only after the received payment is manually
                checked.
              </li>
              <li>
                If an ID cannot be delivered, a full refund is guaranteed in under one minute.
                7-day and 1-month coverage starts at delivery; submit a claim from the delivered
                order page for eligible issues. Rental credentials are hidden by this panel after
                24 hours, but this does not deactivate the account in IRCTC.
              </li>
              <li>
                Your UTR and optional contact details are used to identify and support your order.
                Keep your private order access key secret; it is required to view delivered
                credentials on another device.
              </li>
            </ul>
          </details>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => setSupportOpen(true)}
              className="inline-flex items-center gap-2 rounded-full border border-blue-300/50 bg-gradient-to-r from-blue-700 via-blue-600 to-cyan-500 py-1.5 pl-1.5 pr-4 text-left text-white shadow-[0_5px_18px_rgba(37,99,235,0.3)] transition hover:brightness-110"
              aria-label="Open support desk"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 ring-1 ring-white/20">
                <MessageCircle className="h-4 w-4" />
              </span>
              <span className="flex flex-col">
                <span className="text-xs font-extrabold leading-tight">Help</span>
                <span className="text-[10px] font-medium leading-tight text-blue-100">
                  Support desk
                </span>
              </span>
            </button>
          </div>
          <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-950/25 px-3.5 py-3 text-[11px] leading-relaxed text-emerald-100/90">
            <p>
              <strong className="text-emerald-200">No delivery?</strong> Full refund guaranteed
              in under one minute. 7-day and 1-month coverage starts at delivery; issues not
              caused by the customer qualify for a free replacement or full refund.
            </p>
            <p className="mt-1 text-emerald-100/70">
              Submit guarantee claims from the delivered order page using the “Claim Guarantee” button.
            </p>
          </div>
        </div>
      </aside>

      {/* UPI Checkout & Payment Review Modal */}
      {checkoutDraft && (
        <CheckoutModal
          draft={checkoutDraft}
          activeOrder={null}
          storeConfig={storeConfig}
          onClose={() => setCheckoutDraft(null)}
          onOrderCreated={handleOrderCreated}
        />
      )}
    </div>
  );
}
