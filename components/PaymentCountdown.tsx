import React, { useEffect, useMemo, useState } from 'react';
import { Clock } from 'lucide-react';

interface PaymentCountdownProps {
  paymentExpiresAt: string;
  serverNow: string;
  onExpire: () => void;
}

export const PaymentCountdown: React.FC<PaymentCountdownProps> = ({
  paymentExpiresAt,
  serverNow,
  onExpire,
}) => {
  const duration = useMemo(
    () => Math.max(0, Date.parse(paymentExpiresAt) - Date.parse(serverNow)),
    [paymentExpiresAt, serverNow]
  );
  const [remaining, setRemaining] = useState(duration);

  useEffect(() => {
    const deadline = performance.now() + duration;
    const update = () => {
      const nextRemaining = Math.max(0, deadline - performance.now());
      setRemaining(nextRemaining);
      if (nextRemaining === 0) onExpire();
    };
    update();
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [duration, onExpire]);

  const seconds = Math.ceil(remaining / 1000);
  const display = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60
  ).padStart(2, '0')}`;
  const urgent = remaining <= 2 * 60 * 1000;

  return (
    <div className="rounded-xl border border-sky-400/25 bg-slate-950/70 px-4 py-3 text-center">
      <div
        className={`flex items-center justify-center gap-2 text-3xl font-black tabular-nums ${
          urgent ? 'text-rose-500' : 'text-sky-300'
        }`}
        aria-live="polite"
      >
        <Clock className="h-5 w-5" />
        {display}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-400">
        Time left to pay — order fails automatically after 10 minutes if UTR is not submitted
      </p>
    </div>
  );
};
