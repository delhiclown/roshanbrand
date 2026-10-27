import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Copy,
  Download,
  Loader2,
  X,
} from 'lucide-react';
import { LIMITS } from '../src/constants';
import { CheckoutDraft, OrderRecord, StoreConfig } from '../src/types';
import { UpiQrBox } from './UpiQrBox';

interface CheckoutModalProps {
  draft: CheckoutDraft | null;
  activeOrder: OrderRecord | null;
  storeConfig: StoreConfig;
  onClose: () => void;
  onOrderCreated: (order: OrderRecord, accessToken?: string) => void;
}

interface CreatedPaymentOrder {
  orderId: string;
  amount: number;
  upiLink: string;
  upiId: string;
  payeeName: string;
  accessToken: string;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export const CheckoutModal: React.FC<CheckoutModalProps> = ({
  draft,
  storeConfig,
  onClose,
  onOrderCreated,
}) => {
  const [paymentOrder, setPaymentOrder] = useState<CreatedPaymentOrder | null>(null);
  const [utr, setUtr] = useState('');
  const [creatingOrder, setCreatingOrder] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<OrderRecord | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const verificationRun = useRef(0);

  useEffect(() => {
    let active = true;
    if (!draft) return () => { active = false; };

    const createOrder = async () => {
      try {
        const response = await fetch('/api/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            product: draft.packType,
            quantity: draft.quantity,
            packLabel: draft.packLabel,
            customSpec: draft.initialCustomSpec,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Order create nahi ho saka. Dobara try karein.');
        }
        if (active) {
          const createdOrder = data as CreatedPaymentOrder;
          setPaymentOrder(createdOrder);
          try {
            const recent = JSON.parse(localStorage.getItem('roshanbrand_recent_orders') || '[]');
            const recentIds = Array.isArray(recent)
              ? recent.filter((id) => typeof id === 'string')
              : [];
            localStorage.setItem(
              'roshanbrand_recent_orders',
              JSON.stringify(
                [
                  createdOrder.orderId,
                  ...recentIds.filter((id) => id !== createdOrder.orderId),
                ].slice(0, 10)
              )
            );
          } catch (storageError) {
            console.error('Could not save recent payment order ID:', storageError);
          }
        }
      } catch (requestError) {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError.message
              : 'Order create nahi ho saka. Dobara try karein.'
          );
        }
      } finally {
        if (active) setCreatingOrder(false);
      }
    };

    void createOrder();
    return () => {
      active = false;
      verificationRun.current += 1;
    };
  }, [draft]);

  const checkUtr = async (order: CreatedPaymentOrder, submittedUtr: string) => {
    const response = await fetch('/api/verify-utr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.orderId,
        utr: submittedUtr,
        accessToken: order.accessToken,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'UTR verify nahi ho saka.');
    return data as { status: string };
  };

  const fetchPaidOrder = async (order: CreatedPaymentOrder) => {
    const response = await fetch('/api/orders/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.orderId, accessToken: order.accessToken }),
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok || data.order?.paymentStatus !== 'paid' || !data.order.deliveredCredentials) {
      throw new Error(data.error || 'Payment approved, but order details are not available yet.');
    }
    return data.order as OrderRecord;
  };

  const finishAsPaid = (verifiedOrder: OrderRecord, accessToken: string) => {
    setCompletedOrder(verifiedOrder);
    setMessage('');
    onOrderCreated(verifiedOrder, accessToken);
  };

  const pasteUtr = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const extracted = text.match(/(?:UTR|REF(?:ERENCE)?|RRN)\D*(\d{12})/i)?.[1] ||
        text.match(/\b\d{12}\b/)?.[0];
      if (!extracted) {
        setError('Clipboard me 12-digit UTR nahi mila.');
        return;
      }
      setUtr(extracted);
      setError('');
    } catch {
      setError('Clipboard access nahi mila. UTR manually paste ya type karein.');
    }
  };

  const copyCredentials = async () => {
    if (!completedOrder?.deliveredCredentials) return;
    try {
      await navigator.clipboard.writeText(completedOrder.deliveredCredentials);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Clipboard access nahi mila. ID details manually copy karein.');
    }
  };

  const downloadCredentials = () => {
    if (!completedOrder) return;
    const lines = completedOrder.deliveredCredentials.split('\n').filter(Boolean);
    const csvRows = [
      'Sr,Order_ID,Pack_Type,Account_Credentials,Validity_Expires',
      ...lines.map(
        (line, index) =>
          `${index + 1},${completedOrder.orderId},"${completedOrder.packLabel.replace(/"/g, '""')}","${line.replace(/"/g, '""')}","${completedOrder.rentalExpiresAt || ''}"`
      ),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${completedOrder.orderId}-credentials.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleVerify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!paymentOrder || verifying || completedOrder) return;
    const submittedUtr = utr.trim();
    if (!LIMITS.UTR_REGEX.test(submittedUtr)) {
      setError('Kripya apna valid 12-digit numeric UTR dalein.');
      return;
    }

    setError('');
    setMessage('Verification ho rahi hai');
    setVerifying(true);
    const run = ++verificationRun.current;
    const isCurrentRun = () => verificationRun.current === run;

    try {
      const firstCheck = await checkUtr(paymentOrder, submittedUtr);
      if (firstCheck.status === 'paid') {
        finishAsPaid(await fetchPaidOrder(paymentOrder), paymentOrder.accessToken);
        return;
      }
      if (firstCheck.status === 'expired') {
        setMessage('Order expire ho gaya. Naya order banane ke liye support se contact karein.');
        return;
      }

      setMessage('UTR submitted. Payment confirmation is in progress.');
      const deadline = Date.now() + 3 * 60 * 1000;
      while (Date.now() < deadline && isCurrentRun()) {
        await wait(Math.min(5000, deadline - Date.now()));
        if (!isCurrentRun()) return;

        const statusResponse = await fetch(
          `/api/order-status/${encodeURIComponent(paymentOrder.orderId)}`,
          { cache: 'no-store' }
        );
        const statusData = await statusResponse.json();
        if (!statusResponse.ok) {
          throw new Error(statusData.error || 'Order status check nahi ho saka.');
        }
        if (statusData.status === 'expired') {
          setMessage('Order expire ho gaya. Support se contact karein.');
          return;
        }
        if (statusData.status === 'rejected') {
          setMessage('Payment review complete nahi hua. Support se contact karein.');
          return;
        }
        if (statusData.status === 'paid') {
          finishAsPaid(await fetchPaidOrder(paymentOrder), paymentOrder.accessToken);
          return;
        }
      }

      if (isCurrentRun()) {
        setMessage('Payment abhi confirm nahi hua. Support se contact karein.');
      }
    } catch (requestError) {
      if (isCurrentRun()) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'UTR verify nahi ho saka. Dobara try karein.'
        );
        setMessage('');
      }
    } finally {
      if (isCurrentRun()) setVerifying(false);
    }
  };

  if (!draft) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <button
        type="button"
        aria-label="Close checkout"
        onClick={onClose}
        className="fixed inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-3xl neon-card-3d border-sky-400/50 overflow-hidden my-auto">
        <header className="px-5 py-4 border-b border-sky-400/25 flex items-center justify-between bg-slate-950/80">
          <div>
            <h2 className="text-lg font-extrabold text-white">
              {completedOrder ? 'Payment confirmed' : 'UPI Checkout'}
            </h2>
            <p className="text-xs text-slate-300 mt-1">
              {paymentOrder ? `Order #${paymentOrder.orderId}` : 'Secure UPI payment'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="p-4 sm:p-6 max-h-[82vh] overflow-y-auto">
          {creatingOrder ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sky-200">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Order ban raha hai...</span>
            </div>
          ) : error && !paymentOrder ? (
            <div className="rounded-xl border border-red-400/40 bg-red-950/40 p-4 text-red-200">
              <AlertCircle className="inline w-4 h-4 mr-2" />
              {error}
            </div>
          ) : completedOrder ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-950/40 p-4 text-emerald-200">
                <CheckCircle2 className="inline w-5 h-5 mr-2" />
                Payment verify ho gaya. Aapki ID:
              </div>
              <pre className="whitespace-pre-wrap break-words rounded-xl bg-slate-950 border border-emerald-400/30 p-4 text-sm text-white">
                {completedOrder.deliveredCredentials}
              </pre>
              {completedOrder.rentalExpiresAt && (
                <p className="text-sm text-amber-200">
                  Rental expires: {new Date(completedOrder.rentalExpiresAt).toLocaleString()}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyCredentials()}
                  className="flex items-center gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-200"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy ID details'}
                </button>
                <button
                  type="button"
                  onClick={downloadCredentials}
                  className="flex items-center gap-2 rounded-lg border border-sky-400/40 px-3 py-2 text-sm text-sky-200"
                >
                  <Download className="w-4 h-4" />
                  Download CSV
                </button>
              </div>
              <p className="text-xs text-slate-300">
                Order #{completedOrder.orderId} · UTR {completedOrder.utrNumber}
              </p>
            </div>
          ) : paymentOrder ? (
            <div className="space-y-5">
              <div className="text-center rounded-xl border border-emerald-400/30 bg-emerald-950/30 p-3">
                <div className="text-xs uppercase tracking-wide text-emerald-200">
                  Exact amount to pay
                </div>
                <div className="text-3xl font-extrabold text-white">
                  ₹{paymentOrder.amount.toLocaleString('en-IN')}
                </div>
                <div className="text-xs text-slate-300">{draft.packLabel}</div>
              </div>

              <UpiQrBox
                upiId={paymentOrder.upiId}
                payeeName={paymentOrder.payeeName}
                amount={paymentOrder.amount}
                orderNote={paymentOrder.orderId}
                paymentLink={paymentOrder.upiLink}
              />

              <form onSubmit={handleVerify} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="payment-utr" className="text-sm font-bold text-white">
                    Payment receipt ka 12-digit UTR number
                  </label>
                  <button
                    type="button"
                    onClick={() => void pasteUtr()}
                    className="flex items-center gap-1 text-xs text-sky-300 hover:text-white"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    Paste UTR
                  </button>
                </div>
                <input
                  id="payment-utr"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={12}
                  value={utr}
                  onChange={(event) => {
                    setUtr(event.target.value.replace(/\D/g, '').slice(0, 12));
                    setError('');
                  }}
                  placeholder="12-digit UTR"
                  className="w-full rounded-xl border border-sky-400/40 bg-slate-950 px-4 py-3 font-mono text-lg tracking-widest text-white outline-none focus:border-sky-300"
                />
                <button
                  type="submit"
                  disabled={verifying || creatingOrder}
                  className="w-full rounded-xl bg-sky-500 px-4 py-3 font-extrabold text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {verifying ? 'Verification ho rahi hai...' : 'Verify'}
                </button>
              </form>

              {message && (
                <p className="rounded-lg bg-slate-950/70 p-3 text-center text-sm text-sky-200">
                  {verifying && <Loader2 className="inline w-4 h-4 mr-2 animate-spin" />}
                  {message}
                </p>
              )}
              {error && (
                <p className="rounded-lg border border-red-400/30 bg-red-950/30 p-3 text-sm text-red-200">
                  {error}
                </p>
              )}
              <p className="text-center text-xs text-slate-400">
                Payment sirf server par SMS se verify hone ke baad confirm hoga. Order 30 minute valid hai.
                {' '}
                <a
                  href={storeConfig.supportUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-300 underline"
                >
                  Support se contact karein
                </a>
              </p>
            </div>
          ) : (
            <div className="text-center text-sm text-red-200 py-8">
              {error || 'Order create nahi ho saka.'}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
