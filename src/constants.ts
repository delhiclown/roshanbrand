import { StoreConfig } from './types';

export const LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  UTR_REGEX: /^[0-9]{12}$/,
  ORDER_ID_MIN: 4,
  ORDER_ID_MAX: 64,
  SITE_TITLE_MIN: 2,
  SITE_TITLE_MAX: 80,
  ANNOUNCEMENT_MIN: 2,
  ANNOUNCEMENT_MAX: 200,
  UPI_ID_REGEX: /^[A-Za-z0-9][A-Za-z0-9._+-]*@[A-Za-z0-9][A-Za-z0-9.-]*$/,
  PAYEE_NAME_MIN: 2,
  PAYEE_NAME_MAX: 80,
  QR_URL_MAX: 2000000,
  SUPPORT_HANDLE_MIN: 2,
  SUPPORT_HANDLE_MAX: 100,
  DELIVERY_NOTE_MIN: 2,
  DELIVERY_NOTE_MAX: 180,
  CUSTOMER_REF_MIN: 1,
  CUSTOMER_REF_MAX: 80,
  CUSTOM_SPEC_MAX: 240,
  CREDENTIALS_MAX: 10000,
  ADMIN_NOTE_MAX: 300,
  QUANTITY_MIN: 1,
  QUANTITY_MAX: 500,
};

export const TRACK_ORDER_MESSAGES: Record<string, string> = {
  'Paid - Stock Pending':
    'Payment received. Your ID will be delivered as soon as stock is added. No need to check again and again.',
  'UTR not found':
    'We could not find this UTR yet. Please check the 12-digit number, or wait a few minutes and try again.',
  'Waiting for SMS':
    'We are waiting for your payment confirmation. Please wait a few minutes and check again.',
  Rejected: 'This payment could not be matched with an order. Please contact support.',
  'Order expired': 'This payment could not be matched with an order. Please contact support.',
  'Waiting for payment':
    'We are waiting for your payment confirmation. Please wait a few minutes and check again.',
  Delivered: 'Delivered',
};

export function getTrackOrderMessage(status: string): string {
  return TRACK_ORDER_MESSAGES[status] || status;
}

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  siteTitle: 'Roshanbrand',
  announcementText: '',
  upiId: '',
  payeeName: 'Roshanbrand Official',
  qrCodeUrl: '',
  supportHandle: 'WhatsApp Support',
  supportUrl: 'https://wa.me/14086439496',
  adminDisplayName: 'Store Admin',
  maxGuaranteeReplacementsPerOrder: 2,
  price1Id: 340,
  price2Id: 680,
  price5Id: 1700,
  price10Id: 3400,
  priceBulkPerId: 340,
  priceCustomPerId: 340,
  priceRental24h: 49,
  price7DayGuaranteePerId: 155,
  price1MonthGuaranteePerId: 185,
  stockAvailable: 0,
  rentalStockAvailable: 0,
  stockDisplayAvailable: 0,
  rentalStockDisplayAvailable: 0,
  stock7DayGuaranteeAvailable: 0,
  stock1MonthGuaranteeAvailable: 0,
  instantAutoVerify: false,
  instantDeliveryNote:
    'UPI payment karein aur apna 12-digit UTR submit karein. Payment account me receive hone aur manually verify hone ke baad hi order deliver hoga.',
};
