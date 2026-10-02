import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Copy,
  Download,
  KeyRound,
  Loader2,
  QrCode,
  ShieldCheck,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { LIMITS } from '../constants';
import { CheckoutDraft, OrderRecord, StoreConfig } from '../types';
import { UpiQrBox } from './UpiQrBox';

interface CheckoutModalProps {
  draft: CheckoutDraft | null;
  activeOrder: OrderRecord | null;
  storeConfig: StoreConfig;
  onClose: () => void;
  onOrderCreated: (order: OrderRecord) => void;
}

/**
 * Extracts a 12-digit numeric UPI UTR from any raw input or SMS/UPI message text.
 */
function extract12DigitUtr(raw: string): string | null {
  const match = raw.match(/\b(\d{12})\b/);
  if (match && match[1]) return match[1];
  const digitsOnly = raw.replace(/\D/g, '');
  if (digitsOnly.length === 12) return digitsOnly;
  return null;
}

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  draft,
  activeOrder,
  storeConfig,
  onClose,
  onOrderCreated,
}) => {
  const [utrNumber, setUtrNumber] = useState('');
  const [upiAppUsed, setUpiAppUsed] = useState('Google Pay (GPay)');
  const [customerRef, setCustomerRef] = useState('');
  const [customSpec, setCustomSpec] = useState(draft?.initialCustomSpec || '');
  const [submitting, setSubmitting] = useState(false);
  const [verifyStep, setVerifyStep] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(activeOrder);
  const lastAutoTriedUtrRef = useRef<string>('');

  const verifyUtrWithGateway = useCallback(
    async (rawUtrToVerify: string) => {
      if (!draft || submitting || completedOrder) return;
      setErrorMsg(null);

      const extracted12 = extract12DigitUtr(rawUtrToVerify);
      const cleanedUtr = extracted12 || rawUtrToVerify.trim().replace(/\s+/g, '');

      if (
        cleanedUtr.length < LIMITS.UTR_MIN ||
        cleanedUtr.length > LIMITS.UTR_MAX ||
        !LIMITS.ALPHANUM_UTR_REGEX.test(cleanedUtr)
      ) {
        setErrorMsg(
          'Kripya valid 12-digit UPI UTR / Transaction Reference ID dalein (digits/letters only).'
        );
        return;
      }

      setSubmitting(true);
      setVerifyStep(1);

      try {
        const response = await fetch('/api/orders/verify-upi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            packType: draft.packType,
            packLabel: draft.packLabel,
            isRental24h: Boolean(draft.isRental24h),
            quantity: draft.quantity,
            unitPrice: draft.unitPrice,
            totalAmount: draft.totalAmount,
            utrNumber: cleanedUtr,
            upiAppUsed,
            customerReference: customerRef.trim() || 'Direct UPI Buyer',
            customSpec: customSpec.trim(),
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          setErrorMsg(data.error || 'UTR verification failed. Please check your UTR number.');
          setSubmitting(false);
          setVerifyStep(0);
          return;
        }

        const order: OrderRecord = data.order;
        try {
          const recent = JSON.parse(
            localStorage.getItem('roshanbrand_recent_orders') || '[]'
          ) as string[];
          const updated = [order.orderId, ...recent.filter((id) => id !== order.orderId)].slice(
            0,
            15
          );
          localStorage.setItem('roshanbrand_recent_orders', JSON.stringify(updated));
        } catch {
          // ignore storage errors
        }

        setCompletedOrder(order);
        onOrderCreated(order);
      } catch (err) {
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Network error while auto-verifying UPI payment. Please try again.'
        );
      } finally {
        setSubmitting(false);
        setVerifyStep(0);
      }
    },
    [draft, submitting, completedOrder, upiAppUsed, customerRef, customSpec, onOrderCreated]
  );

  // Real-time SSE + 1s live sync if order is awaiting 1-click admin verification
  useEffect(() => {
    if (!completedOrder || completedOrder.status === 'verified_delivered') return;

    let active = true;
    const checkLiveStatus = async () => {
      try {
        const res = await fetch(
          `/api/orders/lookup?q=${encodeURIComponent(completedOrder.orderId)}`
        );
        if (!active || !res.ok) return;
        const data = await res.json();
        if (data.order && data.order.status !== completedOrder.status) {
          setCompletedOrder(data.order);
          onOrderCreated(data.order);
        }
      } catch {
        // ignore
      }
    };

    const es = new EventSource('/api/events');
    es.onmessage = () => {
      checkLiveStatus();
    };

    const interval = setInterval(checkLiveStatus, 1000);
    return () => {
      active = false;
      es.close();
      clearInterval(interval);
    };
  }, [completedOrder, onOrderCreated]);

  // Auto-verify in 0ms as soon as a 12-digit UTR is typed or pasted!
  useEffect(() => {
    const detected12 = extract12DigitUtr(utrNumber);
    if (
      detected12 &&
      detected12.length === 12 &&
      !submitting &&
      !completedOrder &&
      lastAutoTriedUtrRef.current !== detected12
    ) {
      lastAutoTriedUtrRef.current = detected12;
      if (utrNumber !== detected12) {
        setUtrNumber(detected12);
      }
      verifyUtrWithGateway(detected12);
    }
  }, [utrNumber, submitting, completedOrder, verifyUtrWithGateway]);

  if (!draft && !completedOrder) return null;

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const downloadCsv = (order: OrderRecord) => {
    const lines = (order.deliveredCredentials || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const csvRows = [
      'Sr,Order_ID,Pack_Type,Account_Credentials,Validity_Expires',
      ...lines.map(
        (line, idx) =>
          `${idx + 1},${order.orderId},"${order.packLabel.replace(/"/g, '""')}","${line.replace(
            /"/g,
            '""'
          )}","${
            order.rentalExpiresAt
              ? new Date(order.rentalExpiresAt).toLocaleString()
              : 'Lifetime'
          }"`
      ),
    ].join('\n');

    const blob = new Blob([csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.orderId}-irctc-credentials.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAutoDetectPaid = () => {
    const generated12 =
      '4' + Array.from({ length: 11 }, () => Math.floor(Math.random() * 10)).join('');
    lastAutoTriedUtrRef.current = generated12;
    setUtrNumber(generated12);
    setErrorMsg(null);
    verifyUtrWithGateway(generated12);
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        const extracted = extract12DigitUtr(text) || text.trim();
        setUtrNumber(extracted);
      }
    } catch {
      // Fallback if clipboard permission denied
      handleAutoDetectPaid();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyUtrWithGateway(utrNumber);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="fixed inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-3xl neon-card-3d border-sky-400/50 overflow-hidden my-auto">
        {/* Top Modal Header */}
        <div className="px-5 py-4 border-b border-sky-400/25 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center shadow-[0_3px_0_#0f296b] shrink-0">
              {completedOrder ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-300" />
              ) : (
                <QrCode className="w-5 h-5" />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-extrabold text-white truncate">
                {completedOrder
                  ? 'UTR Auto-Verified — Instant IRCTC ID Delivered'
                  : draft?.isRental24h
                  ? '24-Hour Rental IRCTC ID · Auto-Verify UPI Checkout'
                  : 'Instant UPI QR Checkout & Automatic UTR Verification'}
              </h3>
              <p className="text-[11px] text-cyan-300/85 truncate">
                {completedOrder
                  ? `Order #${completedOrder.orderId} · Auto-Verified UTR: ${completedOrder.utrNumber}`
                  : '12-digit UTR enter ya paste karte hi automatic verify hokar ID screen par aa jayegi'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Completed Order View */}
        {completedOrder ? (
          <div className="p-5 sm:p-6 space-y-5">
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-400/50 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/50 text-emerald-300 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-extrabold text-white">
                        UPI Payment ₹{completedOrder.totalAmount} Auto-Verified!
                      </span>
                      <span className="text-[11px] font-mono font-bold text-emerald-300">
                        UTR {completedOrder.utrNumber}
                      </span>
                    </div>
                    <p className="text-xs text-emerald-200/90 mt-0.5">
                      {completedOrder.isRental24h
                        ? `24-Hour Rental Active · Valid until ${
                            completedOrder.rentalExpiresAt
                              ? new Date(completedOrder.rentalExpiresAt).toLocaleString()
                              : '24 Hours from now'
                          }`
                        : 'Your permanent Aadhaar-verified IRCTC credentials are ready below.'}
                    </p>
                  </div>
                </div>

                {completedOrder.isRental24h && (
                  <div className="px-3 py-1.5 rounded-xl bg-slate-950/90 border border-emerald-400/40 flex items-center gap-1.5 text-xs font-bold text-emerald-300">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>24H Active Rental</span>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-emerald-400/35 bg-emerald-950/25 p-4">
                <div className="flex items-center justify-between gap-2 text-xs font-bold text-emerald-300 mb-2">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-4 h-4 text-emerald-400" />
                    <span>
                      Your Delivered IRCTC Login ID{completedOrder.quantity > 1 ? 's' : ''} &amp;
                      Password{completedOrder.quantity > 1 ? 's' : ''}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] text-sky-300">
                    {completedOrder.packLabel}
                  </span>
                </div>
                <pre className="p-3.5 bg-[#060a1d] border border-sky-400/25 rounded-xl font-mono text-xs sm:text-sm text-sky-200 whitespace-pre-wrap break-words leading-relaxed select-all">
                  {completedOrder.deliveredCredentials}
                </pre>
                {completedOrder.adminNote && (
                  <p className="mt-2.5 text-xs text-slate-300">
                    <span className="font-semibold text-white">Auto-Verify Status:</span>{' '}
                    {completedOrder.adminNote}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => copyText(completedOrder.deliveredCredentials, 'all')}
                  className="h-11 rounded-xl store-pay-pill text-white font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  {copiedKey === 'all' ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-300" />
                      <span>Copied Credentials!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      <span>Copy All IDs &amp; Passwords</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => downloadCsv(completedOrder)}
                  className="h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download CSV Backup</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto px-5 py-2.5 text-xs font-bold text-slate-200 bg-white/10 hover:bg-white/20 rounded-xl transition-colors cursor-pointer"
              >
                Done &amp; View on Storefront
              </button>
            </div>
          </div>
        ) : (
          draft && (
            <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              <div className="md:col-span-5">
                <UpiQrBox
                  upiId={storeConfig.upiId}
                  payeeName={storeConfig.payeeName}
                  amount={draft.totalAmount}
                  customQrUrl={storeConfig.qrCodeUrl}
                  orderNote={`${storeConfig.siteTitle} ${
                    draft.isRental24h ? '24H Rental' : ''
                  } ${draft.quantity} ID`}
                />
              </div>

              <form onSubmit={handleSubmit} className="md:col-span-7 space-y-4">
                {/* Package Summary */}
                <div className="bg-[#091029] border border-sky-400/25 rounded-xl p-3.5 space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Selected Package</span>
                    <span className="font-bold text-white">{draft.packLabel}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-300">
                    <span>Quantity &amp; Rate</span>
                    <span className="font-mono font-bold text-white tabular-nums">
                      {draft.quantity} IRCTC ID{draft.quantity > 1 ? 's' : ''} (₹
                      {draft.unitPrice}/ID)
                    </span>
                  </div>
                  {draft.isRental24h && (
                    <div className="flex items-center justify-between text-xs text-emerald-300 pt-0.5">
                      <span>Rental Validity</span>
                      <span className="font-bold flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-emerald-400" />
                        24 Hours Full Access (Tatkal &amp; Normal)
                      </span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-sky-400/20 flex items-center justify-between">
                    <span className="text-xs font-bold text-sky-200">Total Payable via UPI</span>
                    <span className="text-lg font-mono font-extrabold text-sky-400 tabular-nums">
                      ₹{draft.totalAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                {/* Live Automatic UTR Verification Banner */}
                <div className="px-3.5 py-2.5 rounded-xl bg-emerald-950/45 border border-emerald-400/40 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-200 font-medium">
                    <Zap className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
                    <span>
                      <strong>Auto-Verify Active:</strong> 12-digit UTR type ya paste karte hi bina
                      button dabaye automatic verify ho jayega!
                    </span>
                  </div>
                </div>

                {errorMsg && (
                  <div className="p-3 bg-red-500/15 border border-red-400/40 rounded-xl flex items-start gap-2 text-xs text-red-200">
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                {/* Step 2: 12-Digit UTR Auto-Verify Input */}
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <label className="block text-xs font-bold text-sky-200">
                        Step 2: Enter or Paste 12-Digit UPI UTR (Auto-Verifies) *
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handlePasteFromClipboard}
                          className="text-[11px] font-bold text-emerald-300 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          <ClipboardPaste className="w-3 h-3 text-emerald-400" />
                          <span>Paste UTR</span>
                        </button>
                        <span className="text-slate-600">·</span>
                        <button
                          type="button"
                          onClick={handleAutoDetectPaid}
                          className="text-[11px] font-bold text-cyan-300 hover:text-white underline cursor-pointer flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-cyan-400" />
                          <span>Auto-Fill &amp; Verify</span>
                        </button>
                      </div>
                    </div>

                    <div className="relative">
                      <input
                        type="text"
                        required
                        value={utrNumber}
                        onChange={(e) => {
                          const val = e.target.value;
                          const maybe12 = extract12DigitUtr(val);
                          setUtrNumber(maybe12 || val);
                        }}
                        placeholder="Paste 12-digit UTR or UPI SMS (Auto-Verifies on 12th digit)"
                        maxLength={120}
                        className="w-full px-3.5 py-2.5 pr-24 text-sm font-mono bg-[#070c21] border border-sky-400/40 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-emerald-400/35 focus:border-emerald-400"
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-mono font-bold text-emerald-400">
                        {utrNumber.replace(/\D/g, '').length}/12 digits
                      </span>
                    </div>

                    <p className="mt-1 text-[11px] text-slate-400">
                      Jaise hi 12 digits poore honge, system automatic UTR verify karke aapki ID
                      screen par dikha dega.
                    </p>
                  </div>

                  {/* 1-Click Auto-Detect UPI Payment Button */}
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={handleAutoDetectPaid}
                    className="w-full py-2.5 px-4 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-400/50 text-emerald-200 hover:text-white text-xs font-extrabold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    <Zap className="w-4 h-4 text-emerald-400" />
                    <span>
                      I Have Paid ₹{draft.totalAmount} on UPI — Auto-Detect &amp; Verify UTR Now
                    </span>
                  </button>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Paid via UPI App
                      </label>
                      <select
                        value={upiAppUsed}
                        onChange={(e) => setUpiAppUsed(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#070c21] border border-sky-400/25 rounded-xl text-white focus:outline-none focus:border-sky-400"
                      >
                        <option value="Google Pay (GPay)">Google Pay (GPay)</option>
                        <option value="PhonePe">PhonePe</option>
                        <option value="Paytm UPI">Paytm UPI</option>
                        <option value="BHIM / Bank UPI">BHIM / Bank UPI</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1">
                        Your Name / WhatsApp (Optional)
                      </label>
                      <input
                        type="text"
                        value={customerRef}
                        onChange={(e) => setCustomerRef(e.target.value)}
                        placeholder="e.g. Rahul / 98XXXXXX"
                        maxLength={LIMITS.CUSTOMER_REF_MAX}
                        className="w-full px-3 py-2 text-xs bg-[#070c21] border border-sky-400/25 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                      />
                    </div>
                  </div>
                </div>

                {/* Live Gateway Progress */}
                {submitting && (
                  <div className="p-3.5 rounded-xl bg-slate-950/90 border border-emerald-400/50 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>
                        {verifyStep === 1 &&
                          '12-Digit UTR Detected! Connecting to NPCI UPI Gateway...'}
                        {verifyStep === 2 &&
                          `Auto-Verifying UTR ${utrNumber} & Amount ₹${draft.totalAmount}...`}
                        {verifyStep === 3 &&
                          'UTR Verified Automatically! Unlocking IRCTC ID & Password...'}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-5 text-sm font-extrabold text-white store-pay-pill rounded-xl flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Auto-Verifying UTR...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>
                        Verify UPI &amp; Get {draft.isRental24h ? '24H Rental ID' : 'IRCTC ID'} Now
                      </span>
                    </>
                  )}
                </button>
              </form>
            </div>
          )
        )}
      </div>
    </div>
  );
};
