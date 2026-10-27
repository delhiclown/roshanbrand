export interface DeliveryState {
  delivered: boolean;
  status: string;
}

export type DeliverySource = 'manual' | 'sms';
export type DeliveryResult = 'delivered' | 'already-delivered' | 'unavailable';

export interface ParsedSmsPayment {
  utr: string;
  amountPaise: number;
}

export type SmsParseResult =
  | { ok: true; payment: ParsedSmsPayment }
  | { ok: false; reason: string };

interface ReservableStockItem {
  poolType: string;
  isAssigned: boolean;
  reservedOrderId?: string;
}

export function submitUtr(state: DeliveryState): boolean {
  if (state.status !== 'draft' && state.status !== 'pending' && state.status !== 'utr_submitted') {
    return false;
  }
  state.status = 'utr_submitted';
  return true;
}

export function reserveStock(
  items: ReservableStockItem[],
  poolType: string,
  orderId: string,
  quantity: number
): boolean {
  const available = items.filter(
    (item) => item.poolType === poolType && !item.isAssigned && !item.reservedOrderId
  );
  if (!Number.isInteger(quantity) || quantity < 1 || available.length < quantity) return false;
  for (const item of available.slice(0, quantity)) item.reservedOrderId = orderId;
  return true;
}

export function releaseStock(items: ReservableStockItem[], orderId: string, updatedAt?: string): number {
  let released = 0;
  for (const item of items) {
    if (item.reservedOrderId === orderId) {
      delete item.reservedOrderId;
      if (updatedAt && 'updatedAt' in item) item.updatedAt = updatedAt;
      released += 1;
    }
  }
  return released;
}

export function isDraftExpired(expiresAt: Date | number, now = Date.now()): boolean {
  const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt;
  return expiryTime <= now;
}

export function isOrderExpired(
  expiresAt: Date | number | null | undefined,
  now = Date.now()
): boolean {
  if (expiresAt == null) return true;
  return isDraftExpired(expiresAt, now);
}

export function createSubmittedOrderUpdate(orderId: string, utr: string, submittedAt: Date) {
  return {
    text: `UPDATE orders SET status = 'utr_submitted', utr = $2, expires_at = $3
           WHERE id = $1 AND status IN ('draft', 'pending') AND delivered = 0
           RETURNING id`,
    values: [
      orderId,
      utr,
      new Date(submittedAt.getTime() + 30 * 60 * 1000),
    ] as const,
  };
}

export function matchesSmsPayment(
  order: { utr: string | null; amountPaise: number; createdAt: Date | number },
  payment: { utr: string; amountPaise: number; receivedAt: Date | number }
): boolean {
  const createdAt = order.createdAt instanceof Date ? order.createdAt.getTime() : order.createdAt;
  const receivedAt = payment.receivedAt instanceof Date
    ? payment.receivedAt.getTime()
    : payment.receivedAt;
  return (
    order.utr === payment.utr &&
    order.amountPaise === payment.amountPaise &&
    receivedAt > createdAt
  );
}

export function parseCreditedSms(
  sender: string,
  message: string,
  senderKeywords: string[]
): SmsParseResult {
  const normalizedSender = sender.toLocaleLowerCase();
  if (!sender || !senderKeywords.some((keyword) =>
    keyword && normalizedSender.includes(keyword.toLocaleLowerCase())
  )) {
    return { ok: false, reason: 'sender_not_allowed' };
  }
  if (/\b(?:otp|one[- ]time password|verification code)\b/i.test(message)) {
    return { ok: false, reason: 'otp_message' };
  }
  if (/\b(?:debit(?:ed)?|withdrawn|withdrawal|sent)\b/i.test(message)) {
    return { ok: false, reason: 'debit_message' };
  }
  if (!/\b(?:credited|received)\b/i.test(message)) {
    return { ok: false, reason: 'not_a_credit_message' };
  }

  const amountMatch = message.match(
    /(?:₹|INR|Rs\.?)\s*((?:\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3}|\d+)(?:\.\d{1,2})?)/i
  );
  const utrMatch = message.match(
    /(?:UTR|REF(?:ERENCE)?|RRN)\s*(?:NO\.?|NUMBER)?\s*[:#-]?\s*(?<!\d)(\d{12})(?!\d)/i
  );
  if (!amountMatch || !utrMatch) return { ok: false, reason: 'parse_failed' };

  const [rupeesText, fraction = ''] = amountMatch[1].replace(/,/g, '').split('.');
  try {
    const paise = BigInt(rupeesText) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
    if (paise <= 0n || paise > 2_147_483_647n) {
      return { ok: false, reason: 'invalid_amount' };
    }
    return {
      ok: true,
      payment: { utr: utrMatch[1], amountPaise: Number(paise) },
    };
  } catch {
    return { ok: false, reason: 'invalid_amount' };
  }
}

export function smsWebhookStatus(authorized: boolean): 200 | 401 {
  return authorized ? 200 : 401;
}

export function rejectOrderAndReleaseStock(
  order: { status: string; paymentStatus?: string; adminNote: string; updatedAt: string },
  items: ReservableStockItem[],
  orderId: string,
  updatedAt: string
): boolean {
  if (order.status !== 'pending_verification') return false;
  order.status = 'rejected';
  order.paymentStatus = 'rejected';
  order.adminNote = 'Payment UTR could not be verified. Please contact support with payment screenshot.';
  order.updatedAt = updatedAt;
  releaseStock(items, orderId, updatedAt);
  return true;
}

export function deliverOnce(
  state: DeliveryState,
  source: DeliverySource,
  deliverOrder: (source: DeliverySource) => boolean
): DeliveryResult {
  if (state.delivered) return 'already-delivered';
  if (state.status !== 'utr_submitted') return 'already-delivered';
  if (!deliverOrder(source)) return 'unavailable';

  state.delivered = true;
  state.status = 'paid';
  return 'delivered';
}
