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
export type GuaranteeType = 'guarantee_7days' | 'guarantee_1month';
export type GuaranteeClaimStatus = 'pending' | 'approved' | 'rejected' | 'resolved';

export interface GuaranteeClaimAction {
  action: 'claim_created' | 'approved' | 'rejected' | 'replaced' | 'refunded';
  timestamp: string;
  adminName: string;
  note?: string;
}

export interface GuaranteeReplacement {
  oldCredential: string;
  newCredential: string;
  replacedAt: string;
  adminName: string;
}

export interface GuaranteeClaim {
  claimId: string;
  orderId: string;
  customerReference: string;
  utrNumber: string;
  credentialIndex: number;
  oldCredential: string;
  guaranteeType: GuaranteeType;
  originalPurchaseDate: string;
  expiresAt: string;
  issueDescription: string;
  screenshotDataUrl?: string;
  hasScreenshot?: boolean;
  status: GuaranteeClaimStatus;
  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  resolution?: 'replacement' | 'refund';
  replacementHistory: GuaranteeReplacement[];
  actionLog: GuaranteeClaimAction[];
}

export interface CustomerGuaranteeClaim {
  claimId: string;
  orderId: string;
  credentialIndex: number;
  guaranteeType: GuaranteeType;
  expiresAt: string;
  status: GuaranteeClaimStatus;
  createdAt: string;
  rejectionReason?: string;
  resolution?: 'replacement' | 'refund';
}

export type VaultPoolType =
  | 'permanent'
  | 'rental_24h'
  | 'guarantee_7days'
  | 'guarantee_1month';

export interface StoreConfig {
  siteTitle: string;
  announcementText: string;
  upiId: string;
  payeeName: string;
  qrCodeUrl: string;
  supportHandle: string;
  supportUrl: string;
  adminDisplayName: string;
  maxGuaranteeReplacementsPerOrder: number;
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
  credentialsExpired?: boolean;
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
  refundedAt?: string;
  refundReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultItem {
  vaultId: string;
  irctcUsername: string;
  irctcPassword: string;
  accountNote: string;
  poolType: VaultPoolType;
  isAssigned: boolean;
  assignedOrderId: string;
  reservedOrderId?: string;
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
