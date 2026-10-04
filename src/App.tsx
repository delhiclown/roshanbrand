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
  Mail,
  MessageCircle,
  Minus,
  Plus,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  SlidersVertical,
  Sparkles,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import { AdminPortal } from '../components/AdminPortal';
import { CheckoutModal } from '../components/CheckoutModal';
import { Dashboard } from '../components/Dashboard';
import { DeliveredOrderDetails } from '../components/DeliveredOrderDetails';
import { buildDynamicUpiUri } from '../components/UpiQrBox';
import { DEFAULT_STORE_CONFIG, LIMITS } from './constants';
import { CheckoutDraft, OrderRecord, PackType, StoreConfig } from './types';

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
  const [viewMode, setViewMode] = useState<'store' | 'admin' | 'dashboard'>(() =>
    window.location.pathname.startsWith('/dashboard') ? 'dashboard' : 'store'
  );
  const [storeConfig, setStoreConfig] = useState<StoreConfig>(DEFAULT_STORE_CONFIG);
  const [storeConfigLoaded, setStoreConfigLoaded] = useState(false);

  // Open a product by default so checkout options are immediately visible.
  const [openCardId, setOpenCardId] = useState<string>('irctc-rental-24h');
  const [selectedTier, setSelectedTier] = useState<string>('1');
  const [quantity, setQuantity] = useState<number>(1);
  const [customNote, setCustomNote] = useState<string>('');
  const [checkoutDraft, setCheckoutDraft] = useState<CheckoutDraft | null>(null);

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
  const [trackedOrder, setTrackedOrder] = useState<OrderRecord | null>(null);
  const [trackDropdownOpen, setTrackDropdownOpen] = useState<boolean>(false);
  const [trackError, setTrackError] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [supportOpen, setSupportOpen] = useState<boolean>(false);
  const [inlineQrDataUrl, setInlineQrDataUrl] = useState<string>('');
  const displayedPermanentStock = storeConfig.stockDisplayAvailable;
  const displayedRentalStock = storeConfig.rentalStockDisplayAvailable;
  const totalDisplayedStock =
    displayedPermanentStock +
    displayedRentalStock +
    storeConfig.stock7DayGuaranteeAvailable +
    storeConfig.stock1MonthGuaranteeAvailable;

  useEffect(() => {
    if (trackedOrder?.status !== 'verified_delivered') return;
    const previousTitle = document.title;
    document.title = 'SkyVPS - Order Details';
    return () => {
      document.title = previousTitle;
    };
  }, [trackedOrder?.status]);

  // Keep storefront stock and settings in sync with admin changes.
  useEffect(() => {
    const loadStore = async () => {
      try {
        const res = await fetch('/api/store');
        if (!res.ok) return;
        const data = await res.json();
        if (data.storeConfig) {
          setStoreConfig({ ...DEFAULT_STORE_CONFIG, ...data.storeConfig });
          setStoreConfigLoaded(true);
        }
      } catch {
        // fallback to default config
      }
    };
    loadStore();

    const events = new EventSource('/api/events');
    events.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as { type?: string };
        if (message.type === 'config_updated') {
          loadStore();
        }
      } catch {
        // Ignore malformed event payloads and keep the last loaded configuration.
      }
    };

    return () => events.close();
  }, []);

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
          const data = await res.json();
          setTrackedOrder(data.order);
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
    const timer = setInterval(fetchOrder, 1000);
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
      subtitle: '100% Working · Fast Tatkal & Normal Booking Ready',
      tag: 'Best Seller',
      unitPriceKey: 'priceCustomPerId',
      defaultQty: 1,
      packType: 'pack_1',
    },
    {
      id: 'irctc-7day-guarantee',
      title: 'IRCTC ID — 7 Days Guarantee',
      subtitle: 'IRCTC ID with a 7 Days Guarantee',
      tag: '7 Days Guarantee',
      unitPriceKey: 'price7DayGuaranteePerId',
      defaultQty: 1,
      packType: 'guarantee_7days',
      isSevenDayGuarantee: true,
    },
    {
      id: 'irctc-1month-guarantee',
      title: 'IRCTC ID — 1 Month Guarantee',
      subtitle: 'IRCTC ID with a 1 Month Guarantee',
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
      tag: '24H Rental · ₹49',
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
  const safeQty = Math.max(
    LIMITS.QUANTITY_MIN,
    Math.min(LIMITS.QUANTITY_MAX, Number(quantity) || 1)
  );
  const totalPayable = calculateTotal(
    safeQty,
    selectedTier,
    activeProduct.isRental24h,
    activeProduct.isSevenDayGuarantee,
    activeProduct.isOneMonthGuarantee
  );
  const effectiveUnitPrice = Math.max(1, Math.round(totalPayable / safeQty));

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
  }, [dynamicInlineUpiUri]);

  const handleSelectTier = (tier: string, qty: number) => {
    setSelectedTier(tier);
    setQuantity(qty);
  };

  const handleStepQty = (delta: number) => {
    const next = Math.max(
      LIMITS.QUANTITY_MIN,
      Math.min(LIMITS.QUANTITY_MAX, safeQty + delta)
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

  const handleOrderCreated = (order: OrderRecord) => {
    setTrackedOrderId(order.orderId);
    setSearchInput(order.orderId);
    setTrackedOrder(order);
  };

  const handleTrackSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) return;
    setTrackError('');
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

  if (viewMode === 'dashboard') {
    return <Dashboard />;
  }

  if (trackedOrder?.status === 'verified_delivered') {
    return (
      <div className="delivered-order-shell">
        <header className="delivered-order-topbar">
          <a className="delivered-order-brand" href="/dashboard">
            <span>SV</span>
            <strong>SkyVPS</strong>
          </a>
          <span className="delivered-order-topbar-status">
            <CheckCircle2 /> Order delivered
          </span>
        </header>
        <main className="delivered-order-main">
          <DeliveredOrderDetails
            order={trackedOrder}
            copiedKey={copiedKey}
            onCopy={copyToClipboard}
            onDownload={downloadOrderCsv}
            onBack={() => {
              setTrackedOrder(null);
              setTrackedOrderId('');
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
                  totalDisplayedStock > 0
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : 'bg-amber-400'
                }`}
              />
              <span className="font-bold text-white">
                {!storeConfigLoaded
                  ? '…'
                  : totalDisplayedStock > 0
                    ? <span className="tabular-nums">{totalDisplayedStock}</span>
                    : 'Out of stock'}
              </span>
              {storeConfigLoaded && totalDisplayedStock > 0 && (
                <span className="text-slate-400 font-normal hidden sm:inline">in stock</span>
              )}
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
                        : 'bg-rose-400'
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
                    check live status &amp; view your IRCTC ID and Password.
                  </p>
                  <form onSubmit={handleTrackSearch} className="space-y-2.5">
                    <input
                      type="text"
                      value={searchInput}
                      onChange={(e) => setSearchInput(e.target.value)}
                      placeholder="Enter 12-digit UTR or Order ID"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-cyan-500/40 bg-slate-950/90 text-white font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400/30 focus:border-cyan-400"
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
        <div className="max-w-4xl mx-auto w-full px-3 sm:px-5 pt-4 sm:pt-6 pb-32 flex-1 flex flex-col">
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
                          UTR{' '}
                          <span className="font-mono font-bold text-cyan-300">
                            {trackedOrder.utrNumber}
                          </span>{' '}
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
              ) : (
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

          {/* Product Options List (including the new 3rd option below: Buy Rental IRCTC ID for 24 Hours at ₹49) */}
          <div className="flex-1 min-h-0">
            <ul className="grid grid-cols-1 gap-4 list-none p-0 m-0">
              {productOptions.map((option) => {
                const isOpen = openCardId === option.id;
                const unitPrice = Number(storeConfig[option.unitPriceKey]) || 49;
                const stockCount = option.isRental24h
                  ? displayedRentalStock
                  : option.isSevenDayGuarantee
                    ? storeConfig.stock7DayGuaranteeAvailable
                    : option.isOneMonthGuarantee
                      ? storeConfig.stock1MonthGuaranteeAvailable
                      : displayedPermanentStock;
                const isOutOfStock = stockCount <= 0;

                return (
                  <li
                    key={option.id}
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
                        }
                      }}
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
                              ? 'Loading stock…'
                              : isOutOfStock
                                ? 'Out of stock'
                                : `${stockCount} ID${stockCount === 1 ? '' : 's'} in stock`}
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
                          <span>{isOpen ? 'Close' : 'Buy'}</span>
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
                                  <span>Select 24-Hour Rental IRCTC ID Quantity</span>
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
                                    className={`qty-chip-card cursor-pointer ${
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
                                  }`}
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
                                  Select {option.isOneMonthGuarantee ? '1 Month' : '7 Days'} Guarantee ID Quantity
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
                                    className={`qty-chip-card cursor-pointer ${
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
                                  }`}
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
                                  How many IDs do you need?
                                </p>
                                <span className="text-[11px] text-slate-300 font-medium">
                                  Instant QR · No login needed
                                </span>
                              </div>
                              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('1', 1)}
                                  className={`qty-chip-card cursor-pointer ${
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
                                  className={`qty-chip-card cursor-pointer ${
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
                                  className={`qty-chip-card cursor-pointer ${
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
                                  className={`qty-chip-card cursor-pointer ${
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
                                  onClick={() => handleSelectTier('bulk', 20)}
                                  className={`qty-chip-card cursor-pointer ${
                                    selectedTier === 'bulk' ? 'qty-chip-card--selected' : ''
                                  }`}
                                >
                                  <span className="text-xs font-extrabold">Bulk IDs</span>
                                  <span
                                    className={`text-[10px] font-bold tabular-nums ${
                                      selectedTier === 'bulk'
                                        ? 'text-cyan-100'
                                        : 'text-cyan-400'
                                    }`}
                                  >
                                    ₹{storeConfig.priceCustomPerId}/ID
                                  </span>
                                </button>

                                <button
                                  type="button"
                                  onClick={() => handleSelectTier('custom', 3)}
                                  className={`qty-chip-card cursor-pointer ${
                                    selectedTier === 'custom' ? 'qty-chip-card--selected' : ''
                                  }`}
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
                                  disabled={safeQty <= 1}
                                  className="w-8 h-8 rounded-lg border border-cyan-500/40 bg-slate-900 text-cyan-300 font-bold text-sm flex items-center justify-center hover:bg-slate-800 disabled:opacity-40 shadow-[0_2px_0_#040714] cursor-pointer"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <input
                                  type="number"
                                  min={LIMITS.QUANTITY_MIN}
                                  max={LIMITS.QUANTITY_MAX}
                                  value={quantity}
                                  onChange={(e) => {
                                    const parsed = parseInt(e.target.value, 10);
                                    if (isNaN(parsed)) {
                                      setQuantity(1);
                                    } else {
                                      const clamped = Math.max(
                                        LIMITS.QUANTITY_MIN,
                                        Math.min(LIMITS.QUANTITY_MAX, parsed)
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
                                  disabled={safeQty >= LIMITS.QUANTITY_MAX}
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
                              {inlineQrDataUrl && (
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
                                <p className="text-[11px] text-emerald-300 font-medium mt-0.5">
                                  Dynamic QR Auto-Generated for{' '}
                                  <strong className="font-mono">
                                    ₹{totalPayable.toFixed(2)}
                                  </strong>{' '}
                                  ({storeConfig.upiId})
                                </p>
                              </div>
                            </div>

                            <button
                              type="button"
                              disabled={isOutOfStock}
                              onClick={handleOpenCheckout}
                              className="store-pay-pill py-3 px-6 rounded-xl font-extrabold text-white text-xs sm:text-sm disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                            >
                              <QrCode className="w-4 h-4" />
                              <span>
                                Pay ₹{totalPayable} via UPI QR
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

      {/* Support Launcher */}
      <div className="fixed z-40 right-0 bottom-24 sm:bottom-8 flex flex-col items-end">
        <button
          type="button"
          onClick={() => setSupportOpen(true)}
          className="support-launcher cursor-pointer"
          aria-label="Open support desk"
        >
          <span className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center shrink-0">
            <MessageCircle className="w-4 h-4" />
          </span>
          <span className="pr-1 text-left">
            <span className="block text-[11px] font-extrabold leading-tight tracking-tight">
              Help
            </span>
            <span className="block text-[9px] text-cyan-100 leading-tight hidden sm:block">
              Support desk
            </span>
          </span>
        </button>
      </div>

      {/* Support Modal */}
      {supportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
          <div className="fixed inset-0" onClick={() => setSupportOpen(false)} />
          <div className="relative z-10 w-full max-w-md neon-card-3d border-cyan-400/50 overflow-hidden">
            <div className="px-5 py-4 border-b border-cyan-500/25 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-[0_3px_0_#0f296b]">
                  <Headphones className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-white">
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
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3.5 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-cyan-500/30 space-y-1">
                <p className="font-bold text-white">How fast is UPI UTR verification?</p>
                <p className="text-slate-300 leading-relaxed">
                  {storeConfig.instantDeliveryNote}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-400/35 space-y-1">
                <p className="font-bold text-emerald-300">
                  How does the ₹49 24-Hour Rental IRCTC ID work?
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Pay ₹{storeConfig.priceRental24h} via UPI QR and submit your 12-digit UTR.
                  Credentials are delivered after payment is confirmed by an admin.
                </p>
              </div>

              {storeConfig.supportHandle && (
                <div className="p-3.5 rounded-xl bg-blue-950/50 border border-cyan-400/40 flex items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-cyan-400 block">
                      Direct Support Contact
                    </span>
                    <p className="font-mono font-bold text-white text-sm">
                      {storeConfig.supportHandle}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(storeConfig.supportHandle, 'support-handle')}
                    className="px-3 py-1.5 rounded-lg bg-slate-900 border border-cyan-400/40 text-cyan-300 font-bold text-xs shadow-[0_2px_0_#040714] cursor-pointer"
                  >
                    {copiedKey === 'support-handle' ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <a
                  href="https://wa.link/m97wgo"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-emerald-400/40 bg-emerald-950/40 p-3 text-left hover:bg-emerald-900/50"
                >
                  <MessageCircle className="h-5 w-5 shrink-0 text-emerald-300" />
                  <span className="min-w-0">
                    <span className="block font-bold text-white">WhatsApp Support</span>
                    <span className="block truncate text-[11px] text-emerald-200">Chat with us</span>
                  </span>
                </a>
                <a
                  href="https://t.me/Roshanadminn"
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-3 rounded-xl border border-sky-400/40 bg-sky-950/40 p-3 text-left hover:bg-sky-900/50"
                >
                  <Send className="h-5 w-5 shrink-0 text-sky-300" />
                  <span className="min-w-0">
                    <span className="block font-bold text-white">Telegram Support</span>
                    <span className="block truncate text-[11px] text-sky-200">@Roshanadminn · Message us</span>
                  </span>
                </a>
                <a
                  href="mailto:delhiclown@gmail.com"
                  className="flex items-center gap-3 rounded-xl border border-cyan-400/40 bg-cyan-950/40 p-3 text-left hover:bg-cyan-900/50"
                >
                  <Mail className="h-5 w-5 shrink-0 text-cyan-300" />
                  <span className="min-w-0">
                    <span className="block font-bold text-white">Email Support</span>
                    <span className="block truncate text-[11px] text-cyan-200">delhiclown@gmail.com</span>
                  </span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom Floating How It Works Bar */}
      <aside
        className="fixed bottom-0 left-0 right-0 z-30 pointer-events-none px-3 sm:px-5 pb-2.5 pt-1"
        aria-label="How ordering works and store highlights"
      >
        <div className="max-w-4xl mx-auto pointer-events-auto">
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
                        ₹49 Rental, 1, 2, 5 or Bulk
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
                  <div className="text-center sm:text-left">
                    <p className="text-xs font-extrabold text-white tabular-nums leading-none">
                      10K+
                    </p>
                    <p className="text-[9px] text-cyan-300/80 font-medium mt-0.5">Delivered</p>
                  </div>
                  <div className="w-px h-6 bg-cyan-500/25" />
                  <div className="text-center sm:text-left">
                    <p className="text-xs font-extrabold text-white tabular-nums leading-none">
                      4.9★
                    </p>
                    <p className="text-[9px] text-cyan-300/80 font-medium mt-0.5">Rating</p>
                  </div>
                  <div className="w-px h-6 bg-cyan-500/25" />
                  <div className="text-center sm:text-left">
                    <p className="text-xs font-extrabold text-emerald-400 leading-none flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>24/7</span>
                    </p>
                    <p className="text-[9px] text-cyan-300/80 font-medium mt-0.5">
                      Rodex UPI
                    </p>
                  </div>
                </div>
              </div>
            </div>
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
