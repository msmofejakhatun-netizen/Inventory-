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
  departmentId?: string;
  departmentName?: string;
  restaurantId: string;
  status: 'active' | 'inactive';
  createdAt: string;
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
  taxPercent: number;
  total: number;
  previousRate: number;
  priceHikeAbsolute: number;
  priceHikePercent: number;
  isPriceHike: boolean;
  currentStock: number;
  targetStockDays: number;
  isAboveTarget: boolean;
}

export interface Purchase {
  id: string;
  billNumber: string;
  billDate: string;
  vendorId: string;
  vendorName: string;
  totalAmount: number;
  taxAmount: number;
  netAmount: number;
  paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
  isOverride: boolean;
  overrideReason?: string;
  itemsCount: number;
  items: PurchaseItemRow[];
  recordedByUid: string;
  recordedByName: string;
  restaurantId: string;
  createdAt: string;
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
  billNumber?: string;
  amount: number;
  paymentMode: PaymentMode;
  reference?: string;
  recordedByUid: string;
  recordedByName: string;
  restaurantId: string;
  createdAt: string;
}

export interface PurchaseOrderItem {
  itemId: string;
  itemName: string;
  unit: string;
  recommendedQuantity: number;
  estimatedRate: number;
  estimatedAmount: number;
  reason: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  vendorId: string;
  vendorName: string;
  status: 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'FULFILLED' | 'CANCELLED';
  totalEstimatedAmount: number;
  items: PurchaseOrderItem[];
  restaurantId: string;
  createdAt: string;
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
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
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

