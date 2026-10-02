import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, QrCode, ShieldCheck, Smartphone } from 'lucide-react';

interface UpiQrBoxProps {
  upiId: string;
  payeeName: string;
  amount: number;
  customQrUrl?: string;
  orderNote?: string;
}

export function buildDynamicUpiUri({
  upiId,
  payeeName,
  amount,
  orderNote = 'Roshanbrand IRCTC ID Order',
}: {
  upiId: string;
  payeeName: string;
  amount: number;
  orderNote?: string;
}): string {
  const cleanUpi = (upiId || 'roshanbrand.pay@okaxis').trim();
  const cleanPayee = encodeURIComponent((payeeName || 'Roshanbrand Official').trim());
  const exactAmount = Math.max(1, Number(amount) || 49).toFixed(2);
  const cleanNote = encodeURIComponent(
    `${orderNote.trim()} - Rs ${exactAmount}`
  );
  // Standard NPCI UPI Deep Link with locked 'am' (Amount) and 'cu=INR'
  return `upi://pay?pa=${cleanUpi}&pn=${cleanPayee}&am=${exactAmount}&cu=INR&tn=${cleanNote}`;
}

export const UpiQrBox: React.FC<UpiQrBoxProps> = ({
  upiId,
  payeeName,
  amount,
  customQrUrl,
  orderNote = 'Roshanbrand IRCTC ID Order',
}) => {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [useStaticCustomQr, setUseStaticCustomQr] = useState(false);

  useEffect(() => {
    if (!customQrUrl || customQrUrl.trim().length === 0) {
      setUseStaticCustomQr(false);
    }
  }, [customQrUrl]);

  const exactAmountFormatted = useMemo(
    () => Math.max(1, Number(amount) || 49).toFixed(2),
    [amount]
  );

  const upiUri = useMemo(
    () =>
      buildDynamicUpiUri({
        upiId,
        payeeName,
        amount,
        orderNote,
      }),
    [upiId, payeeName, amount, orderNote]
  );

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(upiUri, {
      width: 360,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#050816',
        light: '#FFFFFF',
      },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    return () => {
      active = false;
    };
  }, [upiUri]);

  const handleCopyUpi = () => {
    navigator.clipboard.writeText(upiId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const showCustomStatic = Boolean(
    useStaticCustomQr && customQrUrl && customQrUrl.trim().length > 0
  );

  return (
    <div className="neon-card-3d p-4 sm:p-5 flex flex-col items-center">
      <div className="w-full flex items-center justify-between pb-3 mb-3 border-b border-sky-400/20 text-xs text-slate-300">
        <div className="flex items-center gap-1.5 min-w-0">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="font-bold text-white truncate">{payeeName}</span>
        </div>
        <span>·</span>
        <span className="font-mono tabular-nums font-extrabold text-emerald-400 text-sm">
          ₹{Number(amount).toLocaleString('en-IN')}
        </span>
      </div>

      {/* Dynamic Amount Locked Pill */}
      <div className="mb-2.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-400/40 text-[11px] font-mono font-bold text-emerald-300 flex items-center gap-1.5">
        <QrCode className="w-3.5 h-3.5 text-emerald-400" />
        <span>Auto-Generated QR for ₹{exactAmountFormatted}</span>
      </div>

      {/* Scannable QR Container */}
      <div className="relative w-52 h-52 sm:w-56 sm:h-56 bg-white border-2 border-sky-400 rounded-2xl p-3 flex items-center justify-center shadow-[0_0_30px_rgba(56,189,248,0.35),0_6px_0_#0f296b]">
        {showCustomStatic ? (
          <img
            src={customQrUrl}
            alt={`UPI payment QR for ${payeeName}`}
            referrerPolicy="no-referrer"
            onError={() => setUseStaticCustomQr(false)}
            className="w-full h-full object-contain rounded-lg"
          />
        ) : qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`Dynamic UPI QR Code for ₹${exactAmountFormatted}`}
            referrerPolicy="no-referrer"
            className="w-full h-full object-contain rounded-lg"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs font-bold text-slate-700">
            Generating ₹{exactAmountFormatted} QR...
          </div>
        )}

        <div className="absolute -bottom-2.5 px-2.5 py-0.5 rounded-full bg-slate-950 border border-emerald-400/60 text-[10px] font-mono font-bold text-emerald-300 shadow-md">
          Amount Locked: ₹{exactAmountFormatted}
        </div>
      </div>

      {customQrUrl && customQrUrl.trim().length > 0 && (
        <button
          type="button"
          onClick={() => setUseStaticCustomQr((prev) => !prev)}
          className="mt-3 text-[11px] font-bold text-cyan-300 hover:text-white underline cursor-pointer"
        >
          {useStaticCustomQr
            ? `Switch to Dynamic ₹${exactAmountFormatted} Auto-Amount QR`
            : 'Switch to Uploaded Static QR'}
        </button>
      )}

      <p className="mt-3.5 text-xs font-semibold text-sky-200/90 text-center">
        Scan karte hi UPI App me{' '}
        <strong className="text-emerald-300 font-mono">₹{exactAmountFormatted}</strong> automatic
        set ho jayega
      </p>

      <div className="mt-3 w-full flex items-center justify-between gap-2 bg-[#080d24] border border-sky-400/25 rounded-xl px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
            Merchant UPI ID
          </div>
          <div className="text-xs font-mono font-semibold text-white truncate">{upiId}</div>
        </div>
        <button
          type="button"
          onClick={handleCopyUpi}
          className="px-3 py-1.5 text-xs font-bold bg-[#13204c] border border-sky-400/40 rounded-lg text-sky-200 hover:bg-blue-600 hover:text-white transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span>Copied</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5 text-sky-300" />
              <span>Copy UPI</span>
            </>
          )}
        </button>
      </div>

      <div className="mt-3 w-full grid grid-cols-3 gap-1.5">
        <a
          href={upiUri}
          className="py-1.5 px-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-sky-400/30 text-[11px] font-bold text-slate-200 hover:text-white flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
        >
          <Smartphone className="w-3 h-3 text-sky-400 shrink-0" />
          <span>GPay ₹{amount}</span>
        </a>
        <a
          href={upiUri}
          className="py-1.5 px-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-sky-400/30 text-[11px] font-bold text-slate-200 hover:text-white flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
        >
          <Smartphone className="w-3 h-3 text-indigo-400 shrink-0" />
          <span>PhonePe ₹{amount}</span>
        </a>
        <a
          href={upiUri}
          className="py-1.5 px-2 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-sky-400/30 text-[11px] font-bold text-slate-200 hover:text-white flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
        >
          <Smartphone className="w-3 h-3 text-cyan-400 shrink-0" />
          <span>Paytm ₹{amount}</span>
        </a>
      </div>

      <a
        href={upiUri}
        className="mt-2.5 w-full py-2.5 px-4 text-xs font-extrabold text-center text-white store-pay-pill rounded-xl flex items-center justify-center gap-1.5 whitespace-nowrap"
      >
        <QrCode className="w-3.5 h-3.5" />
        <span>Pay ₹{Number(amount).toLocaleString('en-IN')} via UPI App</span>
        <ExternalLink className="w-3 h-3 opacity-85" />
      </a>
    </div>
  );
};
