export interface DeliveryState {
  delivered: boolean;
  status: string;
}

export type DeliverySource = 'manual' | 'sms';
export type DeliveryResult = 'delivered' | 'already-delivered' | 'unavailable';

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
