export type UserRole = 'OWNER' | 'MANAGER' | 'STOREKEEPER' | 'DEPARTMENT_STAFF';

export interface UserProfile {
  uid: string;
  name: string;
  email?: string;
  phone?: string;
  photoURL?: string;
  createdAt: string;
  lastLoginAt: string;
  accountStatus: 'active' | 'suspended';
  role?: UserRole;
  restaurantIds: string[];
}

export interface Restaurant {
  id: string;
  name: string;
  address?: string;
  country: string;
  currency: string;
  currencySymbol: string;
  timezone: string;
  taxSystem: string;
  numberOfOutlets: number;
  ownerUid: string;
  priceHikeThresholdPercent?: number; // e.g. 2.0%
  defaultTargetDays?: number; // e.g. 5 days
  createdAt: string;
  updatedAt: string;
}

export interface RestaurantUser {
  uid: string;
  name: string;
  email?: string;
  phone?: string;
  role: UserRole;
  departmentId?: string | null;
  departmentName?: string | null;
  restaurantId: string;
  status: 'active' | 'inactive' | 'ACTIVE' | 'INACTIVE';
  accountStatus?: 'ACTIVE' | 'SUSPENDED';
  authorizedByUid?: string;
  authorizedByName?: string;
  authorizedAt?: string;
  authorizationId?: string;
  createdAt: string;
}

export interface StaffAuthorization {
  id: string;
  restaurantId: string;
  restaurantName?: string;
  email: string;
  fullName: string;
  role: UserRole;
  departmentId?: string | null;
  departmentName?: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  authorizedByUid: string;
  authorizedByName?: string;
  authorizedByRole?: UserRole;
  authorizedAt: string;
  attachedUid?: string | null;
}

export interface StaffInvitation {
  id: string;
  restaurantId: string;
  restaurantName?: string;
  email: string;
  fullName: string;
  requestedRole: UserRole;
  departmentId?: string | null;
  departmentName?: string | null;
  invitedByUid: string;
  invitedByName?: string;
  invitedByRole?: UserRole;
  invitedAt: string;
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  acceptedAt?: string;
  acceptedByUid?: string;
}

export interface Department {
  id: string;
  name: string;
  description?: string;
  restaurantId: string;
  createdAt: string;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  unit: string;
  departmentId?: string;
  departmentName?: string;
  primaryVendorId?: string;
  primaryVendorName?: string;
  currentStock: number;
  minimumStock: number;
  maximumStock: number;
  targetStockDays: number;
  lastPurchaseRate: number;
  averageStockRate: number;
  taxPercent: number;
  shelfLifeDays?: number;
  reorderLevel: number;
  status: 'active' | 'inactive';
  restaurantId: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  mobile?: string;
  email?: string;
  address?: string;
  gstNumber?: string;
  taxNumber?: string;
  paymentTerms?: string;
  creditDays: number;
  openingDue: number;
  totalPurchases: number;
  totalPaid: number;
  currentDue: number;
  restaurantId: string;
  createdAt: string;
}

export interface PurchaseItemRow {
  itemId: string;
  itemName: string;
  category: string;
  unit: string;
  quantity: number;
  rate: number;
  purchaseRate?: number;
  taxPercent: number;
  total: number;
  amount?: number;
  previousRate: number;
  priceHikeAbsolute: number;
  priceHikePercent: number;
  isPriceHike: boolean;
  currentStock: number;
  targetStockDays: number;
  isAboveTarget: boolean;
}

export type PurchasePaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'unpaid' | 'partially_paid' | 'paid';

export interface Purchase {
  id: string;
  billNumber: string;
  billDate: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  taxAmount: number;
  netAmount: number;
  paidAmount?: number;
  remainingAmount?: number;
  paymentStatus: PurchasePaymentStatus;
  isOverride: boolean;
  overrideReason?: string;
  itemsCount: number;
  items: PurchaseItemRow[];
  poId?: string;
  poNumber?: string;
  invoiceImageUrl?: string;
  invoiceImagePath?: string;
  recordedByUid: string;
  recordedByName: string;
  restaurantId: string;
  createdAt: string;
  updatedAt?: string;
}

export type StockTransactionType =
  | 'PURCHASE_RECEIVE'
  | 'DEPT_ISSUE'
  | 'EMERGENCY_ISSUE'
  | 'WASTAGE'
  | 'PHYSICAL_ADJUSTMENT';

export interface StockTransaction {
  id: string;
  itemId: string;
  itemName: string;
  type: StockTransactionType;
  quantity: number; // positive for addition, negative or absolute for issue/wastage
  rate: number;
  value: number;
  departmentId?: string;
  departmentName?: string;
  staffUid?: string;
  staffName?: string;
  actorUid?: string;
  actorName?: string;
  reason?: string;
  referenceId?: string;
  restaurantId: string;
  createdAt: string;
}

export interface Issue {
  id: string;
  departmentId: string;
  departmentName: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  rate: number;
  value: number;
  staffUid: string;
  staffName: string;
  issuedByUid: string;
  issuedByName: string;
  shift: 'MORNING' | 'EVENING' | 'NIGHT' | 'GENERAL';
  restaurantId: string;
  createdAt: string;
}

export type EmergencyReason =
  | 'Stock finished'
  | 'Unexpected rush'
  | 'Wrong estimation'
  | 'Wastage'
  | 'Preparation increased'
  | 'Other';

export interface EmergencyIssue {
  id: string;
  departmentId: string;
  departmentName: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  rate: number;
  value: number;
  reason: EmergencyReason;
  customReason?: string;
  staffUid: string;
  staffName: string;
  restaurantId: string;
  createdAt: string;
}

export type WastageReason =
  | 'Expired'
  | 'Spoiled'
  | 'Burnt'
  | 'Damaged'
  | 'Overproduction'
  | 'Spillage'
  | 'Other';

export interface Wastage {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  rate: number;
  value: number;
  departmentId?: string;
  departmentName?: string;
  reason: WastageReason;
  staffUid: string;
  staffName: string;
  notes?: string;
  restaurantId: string;
  createdAt: string;
}

export interface StockCount {
  id: string;
  itemId: string;
  itemName: string;
  unit: string;
  systemStock: number;
  physicalStock: number;
  varianceQuantity: number;
  varianceValue: number;
  rate: number;
  reason: string;
  countedByUid: string;
  countedByName: string;
  restaurantId: string;
  createdAt: string;
}

export type PaymentMode = 'Cash' | 'UPI' | 'Bank Transfer' | 'Card' | 'Other';

export interface VendorPayment {
  id: string;
  vendorId: string;
  vendorName: string;
  purchaseId?: string;
  billNumber?: string;
  amount: number;
  paymentMode: PaymentMode;
  paymentDate?: string;
  reference?: string;
  notes?: string;
  recordedByUid: string;
  recordedByName: string;
  restaurantId: string;
  createdAt: string;
  updatedAt?: string;
}

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'PENDING_SEND'
  | 'SENT'
  | 'RECEIVED'
  | 'PARTIALLY_RECEIVED'
  | 'CANCELLED'
  | 'FULFILLED';

export interface PurchaseOrderItem {
  itemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  recommendedQuantity?: number; // legacy support
  estimatedRate: number;
  estimatedAmount: number;
  reason?: string;
  receivedQty?: number;
  missingQty?: number;
  actualRate?: number;
  actualAmount?: number;
  previouslyReceivedQty?: number;
  itemStatus?: 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'MISSING';
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  vendorPhone?: string;
  status: PurchaseOrderStatus;
  items: PurchaseOrderItem[];
  totalEstimatedAmount?: number; // legacy support
  estimatedTotal: number;
  actualReceivedTotal?: number;
  sentAt?: string;
  sentByUid?: string;
  sentByName?: string;
  receivedAt?: string;
  receivedByUid?: string;
  receivedByName?: string;
  whatsappMessageId?: string;
  whatsappSessionInfo?: string;
  purchaseId?: string;
  invoiceId?: string;
  billNumber?: string;
  invoiceImageUrl?: string;
  invoiceImagePath?: string;
  invoiceTotal?: number;
  calculatedInvoiceTotal?: number;
  totalDifference?: number;
  restaurantId: string;
  createdAt: string;
  updatedAt?: string;
}

export interface NotificationItem {
  id: string;
  title: string;
  message: string;
  type: 'PRICE_HIKE' | 'LOW_STOCK' | 'EXCESS_STOCK' | 'EMERGENCY_ALERT' | 'VENDOR_DUE' | 'WASTAGE' | 'VARIANCE';
  severity: 'info' | 'warning' | 'critical';
  isRead: boolean;
  restaurantId: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorName: string;
  actorRole?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  targetEmail?: string;
  targetRole?: string;
  department?: string;
  restaurantId: string;
  createdAt: string;
}

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'expired';

export interface Subscription {
  id: string;
  restaurantId: string;
  planId: string;
  status: SubscriptionStatus;
  startDate: string;
  trialEndDate: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoreHealthScoreBreakdown {
  score: number;
  stockControlScore: number;
  excessStockScore: number;
  vendorDueScore: number;
  wastageScore: number;
  varianceScore: number;
  emergencyScore: number;
  priceHikeScore: number;
  reasons: string[];
}

export interface POSSaleRecord {
  id: string;
  billNumber: string;
  posItemName: string;
  quantity: number;
  totalAmount: number;
  saleDate: string;
  restaurantId: string;
}

export interface RecipeBOMIngredient {
  itemId: string;
  itemName: string;
  quantity: number;
  unit: string;
}

export interface RecipeBOM {
  id: string;
  posItemName: string;
  posItemCode?: string;
  ingredients: RecipeBOMIngredient[];
  restaurantId: string;
  createdAt: string;
}

export interface POSIntegrationConfig {
  provider: 'PETPOOJA' | 'EZEE' | 'CUSTOM';
  apiKey?: string;
  webhookSecret?: string;
  syncStatus: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  lastSyncTime?: string;
}

export interface PurchasePlanItem {
  itemId: string;
  itemName: string;
  unit: string;
  currentStock: number;
  avgDailyQty: number;
  targetDays: number;
  targetStockQty: number;
  suggestedBuyQty: number;
  lastRate: number;
  estimatedCost: number;
  vendorId?: string;
  vendorName?: string;
  reason: string;
}

export type WhatsAppConnectionStatus =
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'CONFIGURATION_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'UNKNOWN';

export type WhatsAppHealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'DISCONNECTED';

export type WhatsAppMessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsAppSettings {
  connected: boolean;
  status: WhatsAppConnectionStatus;
  businessPhoneNumber: string;
  phoneNumberId: string;
  businessAccountId: string;
  connectedByUid: string;
  connectedByName?: string;
  connectedAt: string;
  lastWebhookAt?: string;
  lastSuccessfulMessageAt?: string;
  healthStatus: WhatsAppHealthStatus;
  lastHealthCheckAt?: string;
  lastError?: string;
  webhookVerifyToken?: string;
  hasCustomAccessToken?: boolean;
}

export interface WhatsAppMessageRecord {
  id: string;
  restaurantId: string;
  purchaseOrderId?: string;
  poNumber?: string;
  vendorId?: string;
  vendorName?: string;
  vendorPhone: string;
  messageId: string;
  status: WhatsAppMessageStatus;
  messageBody: string;
  createdAt: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  isTestMessage?: boolean;
  sentByUid?: string;
  sentByName?: string;
}

