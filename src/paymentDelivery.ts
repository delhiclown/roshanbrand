export interface DeliveryState {
  delivered: boolean;
  status: string;
}

export type DeliverySource = 'sms' | 'manual';
export type DeliveryResult = 'delivered' | 'already-delivered' | 'unavailable';

export function deliverOnce(
  state: DeliveryState,
  source: DeliverySource,
  deliverOrder: (source: DeliverySource) => boolean
): DeliveryResult {
  if (state.delivered) return 'already-delivered';
  if (!deliverOrder(source)) return 'unavailable';

  state.delivered = true;
  state.status = 'paid';
  return 'delivered';
}
