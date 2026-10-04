export type PackType =
  | 'pack_1'
  | 'pack_2'
  | 'pack_5'
  | 'pack_10'
  | 'bulk'
  | 'custom'
  | 'rental_24h'
  | 'guarantee_7days'
  | 'guarantee_1month';

export type OrderStatus = 'pending_verification' | 'verified_delivered' | 'rejected';

export interface StoreConfig {
  siteTitle: string;
  announcementText: string;
  upiId: string;
  payeeName: string;
  qrCodeUrl: string;
  supportHandle: string;
  price1Id: number;
  price2Id: number;
  price5Id: number;
  price10Id: number;
  priceBulkPerId: number;
  priceCustomPerId: number;
  priceRental24h: number;
  price7DayGuaranteePerId: number;
  price1MonthGuaranteePerId: number;
  stockAvailable: number;
  rentalStockAvailable: number;
  stockDisplayAvailable: number;
  rentalStockDisplayAvailable: number;
  stock7DayGuaranteeAvailable: number;
  stock1MonthGuaranteeAvailable: number;
  instantAutoVerify: boolean;
  presetRentalCredentials?: string;
  presetPermanentCredentials?: string;
  instantDeliveryNote: string;
  updatedAt?: string;
}

export interface OrderRecord {
  orderId: string;
  packLabel: string;
  packType: PackType;
  isRental24h?: boolean;
  rentalDurationHours?: number;
  rentalExpiresAt?: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  paymentUpiId?: string;
  utrNumber: string;
  upiAppUsed?: string;
  customerReference: string;
  customSpec: string;
  status: OrderStatus;
  deliveredCredentials: string;
  adminNote: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItem {
  vaultId: string;
  irctcUsername: string;
  irctcPassword: string;
  accountNote: string;
  poolType: 'permanent' | 'rental_24h';
  isAssigned: boolean;
  assignedOrderId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CheckoutDraft {
  packType: PackType;
  packLabel: string;
  isRental24h?: boolean;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  initialCustomSpec: string;
}
