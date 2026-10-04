import { StoreConfig } from './types';

export const PAYMENT_UPI_ID = 'rodex@airtel';

export const LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  UTR_REGEX: /^[0-9]{12}$/,
  ORDER_ID_MIN: 4,
  ORDER_ID_MAX: 64,
  SITE_TITLE_MIN: 2,
  SITE_TITLE_MAX: 80,
  ANNOUNCEMENT_MIN: 2,
  ANNOUNCEMENT_MAX: 200,
  UPI_ID_MIN: 3,
  UPI_ID_MAX: 100,
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

export const DEFAULT_STORE_CONFIG: StoreConfig = {
  siteTitle: 'Roshanbrand',
  announcementText: '',
  upiId: PAYMENT_UPI_ID,
  payeeName: 'Roshanbrand Official',
  qrCodeUrl: '',
  supportHandle: '@RoshanbrandSupport · 24×7 Instant Help',
  price1Id: 340,
  price2Id: 680,
  price5Id: 1700,
  price10Id: 3400,
  priceBulkPerId: 340,
  priceCustomPerId: 340,
  priceRental24h: 49,
  price7DayGuaranteePerId: 155,
  price1MonthGuaranteePerId: 185,
  stockAvailable: 145,
  rentalStockAvailable: 68,
  stockDisplayAvailable: 145,
  rentalStockDisplayAvailable: 68,
  instantAutoVerify: false,
  presetRentalCredentials:
    'Username: roshan_rent24_vip | Password: Tatkal@2499 | 24-Hour Active Rental',
  presetPermanentCredentials:
    'Username: rb_irctc_vip801 | Password: RailPass@801 | Permanent Aadhaar Verified',
  instantDeliveryNote:
    'UPI payment karein aur apna 12-digit UTR submit karein. Payment account me receive hone aur manually verify hone ke baad hi order deliver hoga.',
};
