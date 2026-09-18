import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { calculateWeightedAverageCost } from './calculations';
import {
  Restaurant,
  RestaurantUser,
  StaffInvitation,
  StaffAuthorization,
  UserRole,
  Department,
  Item,
  Vendor,
  Purchase,
  PurchaseItemRow,
  StockTransaction,
  Issue,
  EmergencyIssue,
  Wastage,
  StockCount,
  VendorPayment,
  PurchaseOrder,
  NotificationItem,
  AuditLog,
  Subscription,
} from '../types';

// Root Collection References
export const usersCol = collection(db, 'users');
export const restaurantsCol = collection(db, 'restaurants');

// Tenant Collection Helpers
export function getTenantCol(restaurantId: string, colName: string) {
  return collection(db, 'restaurants', restaurantId, colName);
}

export function getTenantDoc(restaurantId: string, colName: string, docId: string) {
  return doc(db, 'restaurants', restaurantId, colName, docId);
}

// RESTAURANTS & ONBOARDING
export async function createRestaurantWithDefaults(
  ownerUid: string,
  ownerName: string,
  ownerEmail: string | undefined,
  data: {
    name: string;
    address?: string;
    country: string;
    currency: string;
    currencySymbol: string;
    timezone: string;
    taxSystem: string;
    numberOfOutlets: number;
    departments: string[];
  }
): Promise<string> {
  const restDocRef = doc(restaurantsCol);
  const restaurantId = restDocRef.id;
  const now = new Date().toISOString();

  try {
    const batch = writeBatch(db);

    // 1. Restaurant document
    const restaurantData: Restaurant = {
      id: restaurantId,
      name: data.name,
      address: data.address || '',
      country: data.country,
      currency: data.currency,
      currencySymbol: data.currencySymbol,
      timezone: data.timezone,
      taxSystem: data.taxSystem,
      numberOfOutlets: Number(data.numberOfOutlets) || 1,
      ownerUid,
      priceHikeThresholdPercent: 2.0,
      defaultTargetDays: 5,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(restDocRef, restaurantData);

    // 2. Owner user membership document inside restaurant
    const ownerUserRef = doc(getTenantCol(restaurantId, 'users'), ownerUid);
    const ownerUserData: RestaurantUser = {
      uid: ownerUid,
      name: ownerName,
      email: ownerEmail || '',
      role: 'OWNER',
      restaurantId,
      status: 'active',
      createdAt: now,
    };
    batch.set(ownerUserRef, ownerUserData);

    // 3. Departments
    const deptList = data.departments.length > 0
      ? data.departments
      : ['Indian', 'Chinese', 'Tandoor', 'Bar', 'Bakery', 'General Store'];

    deptList.forEach((deptName) => {
      const deptRef = doc(getTenantCol(restaurantId, 'departments'));
      const deptData: Department = {
        id: deptRef.id,
        name: deptName,
        restaurantId,
        createdAt: now,
      };
      batch.set(deptRef, deptData);
    });

    // 4. Initialize 14-day Free Trial Subscription
    const subRef = doc(getTenantCol(restaurantId, 'subscriptions'), 'current');
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const subData: Subscription = {
      id: 'current',
      restaurantId,
      planId: 'monthly_99',
      status: 'trialing',
      startDate: now,
      trialEndDate: trialEnd.toISOString(),
      currentPeriodStart: now,
      currentPeriodEnd: trialEnd.toISOString(),
      cancelAtPeriodEnd: false,
      amount: 99,
      currency: data.currency,
      createdAt: now,
      updatedAt: now,
    };
    batch.set(subRef, subData);

    // 5. Initial Audit Log
    const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
    const auditData: AuditLog = {
      id: auditRef.id,
      actorUid: ownerUid,
      actorName: ownerName,
      action: 'RESTAURANT_CREATED',
      entity: 'Restaurant',
      entityId: restaurantId,
      details: `Created restaurant ${data.name} with 14-day free trial`,
      restaurantId,
      createdAt: now,
    };
    batch.set(auditRef, auditData);

    // 6. Update user's global profile restaurantIds
    const userDocRef = doc(usersCol, ownerUid);
    batch.set(
      userDocRef,
      {
        uid: ownerUid,
        name: ownerName,
        email: ownerEmail || '',
        lastLoginAt: now,
        restaurantIds: [restaurantId],
      },
      { merge: true }
    );

    await batch.commit();
    return restaurantId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}`);
  }
}

// AUDIT LOG HELPER
export async function logAuditEvent(
  restaurantId: string,
  actorUid: string,
  actorName: string,
  action: string,
  entity: string,
  entityId?: string,
  details?: string
) {
  try {
    const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
    const data: AuditLog = {
      id: auditRef.id,
      actorUid,
      actorName,
      action,
      entity,
      entityId,
      details,
      restaurantId,
      createdAt: new Date().toISOString(),
    };
    await setDoc(auditRef, data);
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
}

// INVENTORY & PURCHASE TRANSACTIONS

/**
 * Executes a purchase atomically:
 * - Updates item current stock
 * - Recalculates weighted average cost
 * - Updates lastPurchaseRate
 * - Updates vendor totalPurchases and currentDue
 * - Creates Purchase document
 * - Creates StockTransaction for each item
 * - Checks price hikes against previous rates and emits Notification
 */
export async function executePurchaseTransaction(
  restaurantId: string,
  purchaseData: {
    billNumber: string;
    billDate: string;
    vendorId: string;
    vendorName: string;
    totalAmount: number;
    taxAmount: number;
    netAmount: number;
    paymentStatus: 'unpaid' | 'partially_paid' | 'paid' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
    isOverride: boolean;
    overrideReason?: string;
    items: PurchaseItemRow[];
    recordedByUid: string;
    recordedByName: string;
  },
  priceHikeThresholdPercent = 2.0
): Promise<string> {
  const purchaseRef = doc(getTenantCol(restaurantId, 'purchases'));
  const purchaseId = purchaseRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Fetch vendor
      const vendorRef = getTenantDoc(restaurantId, 'vendors', purchaseData.vendorId);
      const vendorSnap = await transaction.get(vendorRef);
      if (!vendorSnap.exists()) {
        throw new Error('Vendor not found');
      }
      const vendorData = vendorSnap.data() as Vendor;

      // 2. Fetch and prepare updates for all items
      const itemUpdates: {
        ref: ReturnType<typeof getTenantDoc>;
        newItem: Partial<Item>;
        prevRate: number;
        newRate: number;
        itemName: string;
        hikePct: number;
      }[] = [];

      for (const itemRow of purchaseData.items) {
        const itemRef = getTenantDoc(restaurantId, 'items', itemRow.itemId);
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error(`Item with ID ${itemRow.itemId} not found`);
        }
        const currentItem = itemSnap.data() as Item;

        const updatedAverageRate = calculateWeightedAverageCost(
          currentItem.currentStock || 0,
          currentItem.averageStockRate || currentItem.lastPurchaseRate || itemRow.rate,
          itemRow.quantity,
          itemRow.rate
        );

        const newStock = Number(((currentItem.currentStock || 0) + itemRow.quantity).toFixed(2));
        const prevRate = currentItem.lastPurchaseRate || 0;
        const hikePct = prevRate > 0 ? Number((((itemRow.rate - prevRate) / prevRate) * 100).toFixed(2)) : 0;

        itemUpdates.push({
          ref: itemRef,
          newItem: {
            currentStock: newStock,
            averageStockRate: updatedAverageRate,
            lastPurchaseRate: itemRow.rate,
            updatedAt: now,
          },
          prevRate,
          newRate: itemRow.rate,
          itemName: currentItem.name,
          hikePct,
        });
      }

      // 3. Write Item updates and Stock Transactions
      for (let i = 0; i < itemUpdates.length; i++) {
        const update = itemUpdates[i];
        const row = purchaseData.items[i];
        transaction.update(update.ref, update.newItem);

        // Stock Transaction
        const txnRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
        const txnData: StockTransaction = {
          id: txnRef.id,
          itemId: row.itemId,
          itemName: row.itemName,
          type: 'PURCHASE_RECEIVE',
          quantity: row.quantity,
          rate: row.rate,
          value: Number((row.quantity * row.rate).toFixed(2)),
          staffUid: purchaseData.recordedByUid,
          staffName: purchaseData.recordedByName,
          referenceId: purchaseId,
          reason: `Bill #${purchaseData.billNumber} from ${purchaseData.vendorName}`,
          restaurantId,
          createdAt: now,
        };
        transaction.set(txnRef, txnData);

        // Price Hike Notification if threshold exceeded
        if (update.hikePct >= priceHikeThresholdPercent && update.prevRate > 0) {
          const notifRef = doc(getTenantCol(restaurantId, 'notifications'));
          const notif: NotificationItem = {
            id: notifRef.id,
            title: `Price Hike Detected: ${update.itemName}`,
            message: `Purchase rate increased by ₹${(update.newRate - update.prevRate).toFixed(2)} (${update.hikePct}%) from ₹${update.prevRate} to ₹${update.newRate} under Bill #${purchaseData.billNumber}.`,
            type: 'PRICE_HIKE',
            severity: update.hikePct > 5 ? 'critical' : 'warning',
            isRead: false,
            restaurantId,
            createdAt: now,
          };
          transaction.set(notifRef, notif);
        }
      }

      // 4. Update Vendor Balances
      const isPaid = purchaseData.paymentStatus === 'paid' || purchaseData.paymentStatus === 'PAID';
      const initialPaidAmount = isPaid ? purchaseData.netAmount : 0;
      const initialRemainingAmount = isPaid ? 0 : purchaseData.netAmount;
      const initialStatus: 'UNPAID' | 'PAID' = isPaid ? 'PAID' : 'UNPAID';

      const newVendorPurchases = Number(((vendorData.totalPurchases || 0) + purchaseData.netAmount).toFixed(2));
      const additionalDue = isPaid ? 0 : purchaseData.netAmount;
      const newCurrentDue = Number(((vendorData.currentDue || 0) + additionalDue).toFixed(2));
      const newTotalPaid = isPaid
        ? Number(((vendorData.totalPaid || 0) + purchaseData.netAmount).toFixed(2))
        : (vendorData.totalPaid || 0);

      transaction.update(vendorRef, {
        totalPurchases: newVendorPurchases,
        totalPaid: newTotalPaid,
        currentDue: newCurrentDue,
        updatedAt: now,
      });

      // 5. Create Purchase Doc
      const finalPurchase: Purchase = {
        id: purchaseId,
        billNumber: purchaseData.billNumber,
        billDate: purchaseData.billDate,
        vendorId: purchaseData.vendorId,
        vendorName: purchaseData.vendorName,
        totalAmount: purchaseData.totalAmount,
        taxAmount: purchaseData.taxAmount,
        netAmount: purchaseData.netAmount,
        paidAmount: initialPaidAmount,
        remainingAmount: initialRemainingAmount,
        paymentStatus: initialStatus,
        isOverride: purchaseData.isOverride,
        overrideReason: purchaseData.overrideReason || '',
        itemsCount: purchaseData.items.length,
        items: purchaseData.items,
        recordedByUid: purchaseData.recordedByUid,
        recordedByName: purchaseData.recordedByName,
        restaurantId,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(purchaseRef, finalPurchase);

      // 6. Audit Log
      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: purchaseData.recordedByUid,
        actorName: purchaseData.recordedByName,
        action: purchaseData.isOverride ? 'PURCHASE_RECORDED_WITH_OVERRIDE' : 'PURCHASE_RECORDED',
        entity: 'Purchase',
        entityId: purchaseId,
        details: `Recorded purchase bill #${purchaseData.billNumber} (${purchaseData.items.length} items, total ₹${purchaseData.netAmount})${
          purchaseData.isOverride ? ` [OVERRIDE REASON: ${purchaseData.overrideReason}]` : ''
        }`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return purchaseId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/purchases`);
  }
}

/**
 * Executes Department Stock Issue:
 * - Checks available current stock
 * - Atomically decrements stock
 * - Issues at current weighted average cost: Issue Value = Quantity * Current Weighted Average Cost
 * - Creates Issue document
 * - Creates StockTransaction (DEPT_ISSUE)
 * - Writes Audit log
 */
export async function executeDepartmentIssueTransaction(
  restaurantId: string,
  issueData: {
    departmentId: string;
    departmentName: string;
    itemId: string;
    itemName: string;
    unit: string;
    quantity: number;
    staffUid: string;
    staffName: string;
    issuedByUid: string;
    issuedByName: string;
    shift: 'MORNING' | 'EVENING' | 'NIGHT' | 'GENERAL';
  }
): Promise<string> {
  const issueRef = doc(getTenantCol(restaurantId, 'issues'));
  const issueId = issueRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const itemRef = getTenantDoc(restaurantId, 'items', issueData.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) {
        throw new Error('Item not found');
      }
      const item = itemSnap.data() as Item;

      if ((item.currentStock || 0) < issueData.quantity) {
        throw new Error(`Insufficient stock for ${item.name}. Available: ${item.currentStock} ${item.unit}, Requested: ${issueData.quantity} ${item.unit}`);
      }

      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const issueValue = Number((issueData.quantity * rate).toFixed(2));
      const newStock = Number(((item.currentStock || 0) - issueData.quantity).toFixed(2));

      // Decrement stock
      transaction.update(itemRef, {
        currentStock: newStock,
        updatedAt: now,
      });

      // Save Issue
      const issueDoc: Issue = {
        id: issueId,
        departmentId: issueData.departmentId,
        departmentName: issueData.departmentName,
        itemId: issueData.itemId,
        itemName: issueData.itemName,
        unit: issueData.unit,
        quantity: issueData.quantity,
        rate,
        value: issueValue,
        staffUid: issueData.staffUid,
        staffName: issueData.staffName,
        issuedByUid: issueData.issuedByUid,
        issuedByName: issueData.issuedByName,
        shift: issueData.shift,
        restaurantId,
        createdAt: now,
      };
      transaction.set(issueRef, issueDoc);

      // Stock transaction
      const txnRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
      const txn: StockTransaction = {
        id: txnRef.id,
        itemId: issueData.itemId,
        itemName: issueData.itemName,
        type: 'DEPT_ISSUE',
        quantity: -issueData.quantity,
        rate,
        value: issueValue,
        departmentId: issueData.departmentId,
        departmentName: issueData.departmentName,
        staffUid: issueData.staffUid,
        staffName: issueData.staffName,
        referenceId: issueId,
        reason: `Issued to ${issueData.departmentName} (${issueData.shift} shift)`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(txnRef, txn);

      // Audit log
      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: issueData.issuedByUid,
        actorName: issueData.issuedByName,
        action: 'STOCK_ISSUED',
        entity: 'Issue',
        entityId: issueId,
        details: `Issued ${issueData.quantity} ${issueData.unit} of ${issueData.itemName} to ${issueData.departmentName} (Taken by ${issueData.staffName})`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return issueId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/issues`);
  }
}

/**
 * Executes Emergency Issue Requisition:
 * - Decrements stock atomically
 * - Records EmergencyIssue document
 * - Creates StockTransaction
 * - Checks repeated emergency count in the past 7 days for this department
 *   If >= 3, emits an alert: "[Department] is repeatedly requesting emergency stock. Consider increasing pre-shift issue quantity."
 */
export async function executeEmergencyIssueTransaction(
  restaurantId: string,
  emergencyData: {
    departmentId: string;
    departmentName: string;
    itemId: string;
    itemName: string;
    unit: string;
    quantity: number;
    reason: EmergencyIssue['reason'];
    customReason?: string;
    staffUid: string;
    staffName: string;
  }
): Promise<string> {
  const emergRef = doc(getTenantCol(restaurantId, 'emergencyIssues'));
  const emergId = emergRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const itemRef = getTenantDoc(restaurantId, 'items', emergencyData.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) {
        throw new Error('Item not found');
      }
      const item = itemSnap.data() as Item;

      if ((item.currentStock || 0) < emergencyData.quantity) {
        throw new Error(`Insufficient stock for emergency issue. Available: ${item.currentStock} ${item.unit}`);
      }

      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const value = Number((emergencyData.quantity * rate).toFixed(2));
      const newStock = Number(((item.currentStock || 0) - emergencyData.quantity).toFixed(2));

      // Decrement stock
      transaction.update(itemRef, {
        currentStock: newStock,
        updatedAt: now,
      });

      // Save emergency issue
      const emergDoc: EmergencyIssue = {
        id: emergId,
        departmentId: emergencyData.departmentId,
        departmentName: emergencyData.departmentName,
        itemId: emergencyData.itemId,
        itemName: emergencyData.itemName,
        unit: emergencyData.unit,
        quantity: emergencyData.quantity,
        rate,
        value,
        reason: emergencyData.reason,
        customReason: emergencyData.customReason || '',
        staffUid: emergencyData.staffUid,
        staffName: emergencyData.staffName,
        restaurantId,
        createdAt: now,
      };
      transaction.set(emergRef, emergDoc);

      // Stock transaction
      const txnRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
      const txn: StockTransaction = {
        id: txnRef.id,
        itemId: emergencyData.itemId,
        itemName: emergencyData.itemName,
        type: 'EMERGENCY_ISSUE',
        quantity: -emergencyData.quantity,
        rate,
        value,
        departmentId: emergencyData.departmentId,
        departmentName: emergencyData.departmentName,
        staffUid: emergencyData.staffUid,
        staffName: emergencyData.staffName,
        referenceId: emergId,
        reason: `Emergency requisition: ${emergencyData.reason} (${emergencyData.customReason || ''})`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(txnRef, txn);

      // Audit log
      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: emergencyData.staffUid,
        actorName: emergencyData.staffName,
        action: 'EMERGENCY_ISSUE_RECORDED',
        entity: 'EmergencyIssue',
        entityId: emergId,
        details: `Emergency requisition by ${emergencyData.departmentName}: ${emergencyData.quantity} ${emergencyData.unit} of ${emergencyData.itemName} (${emergencyData.reason})`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    // Check emergency frequency asynchronously to avoid holding transaction
    checkRepeatedEmergencyAlert(restaurantId, emergencyData.departmentId, emergencyData.departmentName);

    return emergId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/emergencyIssues`);
  }
}

/**
 * Evaluates actual emergency issue history. If a department has 3+ emergency issues
 * in the last 7 days, generates an alert without fake numbers.
 */
async function checkRepeatedEmergencyAlert(restaurantId: string, departmentId: string, departmentName: string) {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffIso = cutoff.toISOString();

    const emergCol = getTenantCol(restaurantId, 'emergencyIssues');
    const q = query(
      emergCol,
      where('departmentId', '==', departmentId),
      where('createdAt', '>=', cutoffIso)
    );
    const snap = await getDocs(q);

    if (snap.size >= 3) {
      const notifRef = doc(getTenantCol(restaurantId, 'notifications'));
      const notif: NotificationItem = {
        id: notifRef.id,
        title: `Repeated Emergency Alert: ${departmentName}`,
        message: `${departmentName} has requested emergency stock ${snap.size} times in the last 7 days. Consider increasing pre-shift issue quantities to prevent service bottlenecks.`,
        type: 'EMERGENCY_ALERT',
        severity: 'critical',
        isRead: false,
        restaurantId,
        createdAt: new Date().toISOString(),
      };
      await setDoc(notifRef, notif);
    }
  } catch (e) {
    console.error('Error evaluating repeated emergency alert:', e);
  }
}

/**
 * Wastage Recording
 */
export async function executeWastageTransaction(
  restaurantId: string,
  wastageData: {
    itemId: string;
    itemName: string;
    unit: string;
    quantity: number;
    departmentId?: string;
    departmentName?: string;
    reason: Wastage['reason'];
    notes?: string;
    staffUid: string;
    staffName: string;
  }
): Promise<string> {
  const wastageRef = doc(getTenantCol(restaurantId, 'wastage'));
  const wastageId = wastageRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const itemRef = getTenantDoc(restaurantId, 'items', wastageData.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) {
        throw new Error('Item not found');
      }
      const item = itemSnap.data() as Item;

      if ((item.currentStock || 0) < wastageData.quantity) {
        throw new Error(`Available stock is only ${item.currentStock} ${item.unit}. Cannot record wastage of ${wastageData.quantity} ${item.unit}.`);
      }

      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const value = Number((wastageData.quantity * rate).toFixed(2));
      const newStock = Number(((item.currentStock || 0) - wastageData.quantity).toFixed(2));

      transaction.update(itemRef, {
        currentStock: newStock,
        updatedAt: now,
      });

      const docObj: Wastage = {
        id: wastageId,
        itemId: wastageData.itemId,
        itemName: wastageData.itemName,
        unit: wastageData.unit,
        quantity: wastageData.quantity,
        rate,
        value,
        departmentId: wastageData.departmentId,
        departmentName: wastageData.departmentName,
        reason: wastageData.reason,
        notes: wastageData.notes,
        staffUid: wastageData.staffUid,
        staffName: wastageData.staffName,
        restaurantId,
        createdAt: now,
      };
      transaction.set(wastageRef, docObj);

      const txnRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
      const txn: StockTransaction = {
        id: txnRef.id,
        itemId: wastageData.itemId,
        itemName: wastageData.itemName,
        type: 'WASTAGE',
        quantity: -wastageData.quantity,
        rate,
        value,
        departmentId: wastageData.departmentId,
        departmentName: wastageData.departmentName,
        staffUid: wastageData.staffUid,
        staffName: wastageData.staffName,
        referenceId: wastageId,
        reason: `Wastage: ${wastageData.reason}`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(txnRef, txn);

      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: wastageData.staffUid,
        actorName: wastageData.staffName,
        action: 'WASTAGE_RECORDED',
        entity: 'Wastage',
        entityId: wastageId,
        details: `Recorded wastage of ${wastageData.quantity} ${wastageData.unit} of ${wastageData.itemName} (${wastageData.reason}, Loss: ₹${value})`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return wastageId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/wastage`);
  }
}

/**
 * Physical Stock Count / Variance
 */
export async function executeStockAdjustmentTransaction(
  restaurantId: string,
  countData: {
    itemId: string;
    itemName: string;
    unit: string;
    physicalStock: number;
    reason: string;
    countedByUid: string;
    countedByName: string;
  }
): Promise<string> {
  const countRef = doc(getTenantCol(restaurantId, 'stockCounts'));
  const countId = countRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const itemRef = getTenantDoc(restaurantId, 'items', countData.itemId);
      const itemSnap = await transaction.get(itemRef);
      if (!itemSnap.exists()) {
        throw new Error('Item not found');
      }
      const item = itemSnap.data() as Item;
      const systemStock = item.currentStock || 0;
      const varianceQuantity = Number((countData.physicalStock - systemStock).toFixed(2));
      const rate = item.averageStockRate || item.lastPurchaseRate || 0;
      const varianceValue = Number((varianceQuantity * rate).toFixed(2));

      // Mandatory reason if variance exists
      if (varianceQuantity !== 0 && (!countData.reason || countData.reason.trim().length === 0)) {
        throw new Error('Reason is strictly mandatory when physical variance exists.');
      }

      transaction.update(itemRef, {
        currentStock: countData.physicalStock,
        updatedAt: now,
      });

      const countDoc: StockCount = {
        id: countId,
        itemId: countData.itemId,
        itemName: countData.itemName,
        unit: countData.unit,
        systemStock,
        physicalStock: countData.physicalStock,
        varianceQuantity,
        varianceValue,
        rate,
        reason: countData.reason,
        countedByUid: countData.countedByUid,
        countedByName: countData.countedByName,
        restaurantId,
        createdAt: now,
      };
      transaction.set(countRef, countDoc);

      const txnRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
      const txn: StockTransaction = {
        id: txnRef.id,
        itemId: countData.itemId,
        itemName: countData.itemName,
        type: 'PHYSICAL_ADJUSTMENT',
        quantity: varianceQuantity,
        rate,
        value: Math.abs(varianceValue),
        staffUid: countData.countedByUid,
        staffName: countData.countedByName,
        referenceId: countId,
        reason: `Physical Count: System ${systemStock} -> Physical ${countData.physicalStock} (Variance ${varianceQuantity}). ${countData.reason}`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(txnRef, txn);

      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: countData.countedByUid,
        actorName: countData.countedByName,
        action: 'PHYSICAL_STOCK_ADJUSTMENT',
        entity: 'StockCount',
        entityId: countId,
        details: `Audited ${countData.itemName}: System ${systemStock} vs Physical ${countData.physicalStock} (${varianceQuantity > 0 ? '+' : ''}${varianceQuantity} ${countData.unit}). Reason: ${countData.reason}`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return countId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/stockCounts`);
  }
}

/**
 * Vendor Payment
 */
export async function executeVendorPaymentTransaction(
  restaurantId: string,
  paymentData: {
    vendorId: string;
    vendorName: string;
    purchaseId?: string;
    billNumber?: string;
    amount: number;
    paymentMode: VendorPayment['paymentMode'];
    paymentDate?: string;
    reference?: string;
    notes?: string;
    recordedByUid: string;
    recordedByName: string;
  }
): Promise<string> {
  const amountToPay = Number(paymentData.amount);
  if (!amountToPay || amountToPay <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const payRef = doc(getTenantCol(restaurantId, 'vendorPayments'));
  const paymentId = payRef.id;
  const now = new Date().toISOString();
  const paymentDate = paymentData.paymentDate || now.slice(0, 10);

  try {
    await runTransaction(db, async (transaction) => {
      // 1. Read vendor
      const vendorRef = getTenantDoc(restaurantId, 'vendors', paymentData.vendorId);
      const vendorSnap = await transaction.get(vendorRef);
      if (!vendorSnap.exists()) {
        throw new Error('Vendor not found');
      }
      const vendor = vendorSnap.data() as Vendor;

      // 2. Read selected purchase/invoice if payment is invoice-specific
      let purchaseRef: ReturnType<typeof getTenantDoc> | null = null;
      let purchaseData: Purchase | null = null;
      let newPaidAmount = 0;
      let newRemainingAmount = 0;
      let newPurchasePaymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';

      if (paymentData.purchaseId) {
        purchaseRef = getTenantDoc(restaurantId, 'purchases', paymentData.purchaseId);
        const purchaseSnap = await transaction.get(purchaseRef);
        if (!purchaseSnap.exists()) {
          throw new Error('Purchase invoice not found');
        }
        purchaseData = purchaseSnap.data() as Purchase;

        if (purchaseData.vendorId !== paymentData.vendorId) {
          throw new Error('Selected purchase invoice does not belong to this vendor');
        }

        const netAmount = Number(purchaseData.netAmount) || 0;
        let currentPaid = 0;
        if (purchaseData.paidAmount !== undefined) {
          currentPaid = Number(purchaseData.paidAmount) || 0;
        } else if (purchaseData.paymentStatus === 'paid' || purchaseData.paymentStatus === 'PAID') {
          currentPaid = netAmount;
        }

        const currentRemaining =
          purchaseData.remainingAmount !== undefined
            ? Number(purchaseData.remainingAmount)
            : Math.max(0, netAmount - currentPaid);

        // Validate payment does not exceed applicable invoice outstanding
        if (amountToPay > currentRemaining + 0.01) {
          throw new Error(
            `Payment amount ₹${amountToPay.toFixed(2)} exceeds invoice remaining balance of ₹${currentRemaining.toFixed(2)}.`
          );
        }

        newPaidAmount = Number((currentPaid + amountToPay).toFixed(2));
        newRemainingAmount = Number(Math.max(0, netAmount - newPaidAmount).toFixed(2));

        if (newRemainingAmount <= 0.01) {
          newPurchasePaymentStatus = 'PAID';
        } else if (newPaidAmount > 0) {
          newPurchasePaymentStatus = 'PARTIALLY_PAID';
        } else {
          newPurchasePaymentStatus = 'UNPAID';
        }

        transaction.update(purchaseRef, {
          paidAmount: newPaidAmount,
          remainingAmount: newRemainingAmount,
          paymentStatus: newPurchasePaymentStatus,
          updatedAt: now,
        });
      }

      // 5. Update vendor balances
      const newPaid = Number(((vendor.totalPaid || 0) + amountToPay).toFixed(2));
      const newDue = Number(((vendor.currentDue || 0) - amountToPay).toFixed(2));

      transaction.update(vendorRef, {
        totalPaid: newPaid,
        currentDue: newDue,
        updatedAt: now,
      });

      // 7. Create Vendor Payment Ledger Doc
      const resolvedBill = paymentData.billNumber || purchaseData?.billNumber || '';
      const payDoc: VendorPayment = {
        id: paymentId,
        vendorId: paymentData.vendorId,
        vendorName: paymentData.vendorName || vendor.name,
        purchaseId: paymentData.purchaseId || '',
        billNumber: resolvedBill,
        amount: amountToPay,
        paymentMode: paymentData.paymentMode,
        paymentDate,
        reference: paymentData.reference || '',
        notes: paymentData.notes || '',
        recordedByUid: paymentData.recordedByUid,
        recordedByName: paymentData.recordedByName,
        restaurantId,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(payRef, payDoc);

      // 11. Create Audit Log
      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: paymentData.recordedByUid,
        actorName: paymentData.recordedByName,
        action: 'VENDOR_PAYMENT_RECORDED',
        entity: 'VendorPayment',
        entityId: paymentId,
        details: `Disbursed ₹${amountToPay.toFixed(2)} to ${vendor.name} via ${paymentData.paymentMode} (Ref: ${
          paymentData.reference || 'N/A'
        })${
          resolvedBill
            ? ` against Bill #${resolvedBill} [Invoice Status: ${purchaseData ? newPurchasePaymentStatus : 'N/A'}]`
            : ''
        }. Vendor remaining due: ₹${newDue.toFixed(2)}`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return paymentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/vendorPayments`);
    throw err;
  }
}

/**
 * Reconcile existing unlinked payment with an invoice
 */
export async function reconcilePaymentWithPurchase(
  restaurantId: string,
  params: {
    paymentId: string;
    purchaseId: string;
    recordedByUid: string;
    recordedByName: string;
  }
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await runTransaction(db, async (transaction) => {
      // 1. Read payment
      const payRef = getTenantDoc(restaurantId, 'vendorPayments', params.paymentId);
      const paySnap = await transaction.get(payRef);
      if (!paySnap.exists()) {
        throw new Error('Payment record not found');
      }
      const payment = paySnap.data() as VendorPayment;

      // 2. Read purchase
      const purchaseRef = getTenantDoc(restaurantId, 'purchases', params.purchaseId);
      const purchaseSnap = await transaction.get(purchaseRef);
      if (!purchaseSnap.exists()) {
        throw new Error('Purchase invoice not found');
      }
      const purchase = purchaseSnap.data() as Purchase;

      if (payment.vendorId !== purchase.vendorId) {
        throw new Error('Vendor mismatch: Payment and Invoice belong to different vendors.');
      }

      if (payment.purchaseId && payment.purchaseId === purchase.id) {
        throw new Error('This payment is already linked to this invoice.');
      }

      const netAmount = Number(purchase.netAmount) || 0;
      let currentPaid = 0;
      if (purchase.paidAmount !== undefined) {
        currentPaid = Number(purchase.paidAmount) || 0;
      } else if (purchase.paymentStatus === 'paid' || purchase.paymentStatus === 'PAID') {
        currentPaid = netAmount;
      }

      const currentRemaining =
        purchase.remainingAmount !== undefined
          ? Number(purchase.remainingAmount)
          : Math.max(0, netAmount - currentPaid);

      if (payment.amount > currentRemaining + 0.01) {
        throw new Error(
          `Payment voucher amount (₹${payment.amount.toFixed(2)}) exceeds invoice remaining balance (₹${currentRemaining.toFixed(2)}).`
        );
      }

      const newPaidAmount = Number((currentPaid + payment.amount).toFixed(2));
      const newRemainingAmount = Number(Math.max(0, netAmount - newPaidAmount).toFixed(2));
      const newStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' =
        newRemainingAmount <= 0.01 ? 'PAID' : newPaidAmount > 0 ? 'PARTIALLY_PAID' : 'UNPAID';

      // Update purchase
      transaction.update(purchaseRef, {
        paidAmount: newPaidAmount,
        remainingAmount: newRemainingAmount,
        paymentStatus: newStatus,
        updatedAt: now,
      });

      // Update payment record with purchaseId and billNumber
      transaction.update(payRef, {
        purchaseId: purchase.id,
        billNumber: purchase.billNumber,
        updatedAt: now,
      });

      // Audit Log
      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: params.recordedByUid,
        actorName: params.recordedByName,
        action: 'PAYMENT_RECONCILED_WITH_INVOICE',
        entity: 'Purchase',
        entityId: purchase.id,
        details: `Reconciled existing payment voucher ${payment.id} (₹${payment.amount.toFixed(2)}) with Bill #${
          purchase.billNumber
        }. New invoice status: ${newStatus}.`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/purchases`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// PURCHASE ORDER (PO) LIFECYCLE WORKFLOW
// ---------------------------------------------------------------------------

export async function updateVendorContact(
  restaurantId: string,
  vendorId: string,
  phone: string,
  actorUid?: string,
  actorName?: string
): Promise<void> {
  try {
    const vendorRef = getTenantDoc(restaurantId, 'vendors', vendorId);
    await updateDoc(vendorRef, {
      phone,
      mobile: phone,
      updatedAt: new Date().toISOString(),
    });
    if (actorUid && actorName) {
      await logAuditEvent(
        restaurantId,
        actorUid,
        actorName,
        'VENDOR_CONTACT_UPDATED',
        'Vendor',
        vendorId,
        `Updated vendor contact number to ${phone}`
      );
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `restaurants/${restaurantId}/vendors/${vendorId}`);
    throw err;
  }
}

export async function createPurchaseOrder(
  restaurantId: string,
  poData: {
    vendorId: string;
    vendorName: string;
    vendorPhone?: string;
    items: {
      itemId: string;
      itemName: string;
      unit: string;
      orderedQty: number;
      estimatedRate: number;
      estimatedAmount: number;
      reason?: string;
    }[];
    actorUid: string;
    actorName: string;
  }
): Promise<string> {
  const poRef = doc(getTenantCol(restaurantId, 'purchaseOrders'));
  const now = new Date().toISOString();
  const totalEstimated = poData.items.reduce((sum, item) => sum + item.estimatedAmount, 0);

  const po: PurchaseOrder = {
    id: poRef.id,
    poNumber: `PO-${Date.now().toString().slice(-6)}`,
    vendorId: poData.vendorId,
    vendorName: poData.vendorName,
    vendorPhone: poData.vendorPhone || '',
    status: 'DRAFT',
    items: poData.items.map((i) => ({
      itemId: i.itemId,
      itemName: i.itemName,
      unit: i.unit,
      orderedQty: i.orderedQty,
      recommendedQuantity: i.orderedQty,
      estimatedRate: i.estimatedRate,
      estimatedAmount: i.estimatedAmount,
      reason: i.reason || 'Store replenishment',
      receivedQty: 0,
      missingQty: i.orderedQty,
      previouslyReceivedQty: 0,
      itemStatus: 'MISSING',
    })),
    totalEstimatedAmount: totalEstimated,
    estimatedTotal: totalEstimated,
    actualReceivedTotal: 0,
    restaurantId,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(poRef, po);
    await logAuditEvent(
      restaurantId,
      poData.actorUid,
      poData.actorName,
      'PURCHASE_ORDER_CREATED',
      'PurchaseOrder',
      poRef.id,
      `Created Purchase Order ${po.poNumber} for vendor ${po.vendorName} (${po.items.length} items, total ₹${totalEstimated.toFixed(2)})`
    );
    return poRef.id;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/purchaseOrders`);
    throw err;
  }
}

export async function updatePurchaseOrderStatus(
  restaurantId: string,
  poId: string,
  status: import('../types').PurchaseOrderStatus,
  actorUid: string,
  actorName: string,
  extraData?: {
    sentAt?: string;
    whatsappSessionInfo?: string;
    whatsappMessageId?: string;
    vendorPhone?: string;
    cancelReason?: string;
  }
): Promise<void> {
  try {
    const poRef = getTenantDoc(restaurantId, 'purchaseOrders', poId);
    const now = new Date().toISOString();
    const updates: Partial<PurchaseOrder> & Record<string, any> = {
      status,
      updatedAt: now,
    };

    if (status === 'SENT') {
      updates.sentAt = extraData?.sentAt || now;
      updates.sentByUid = actorUid;
      updates.sentByName = actorName;
      if (extraData?.whatsappSessionInfo) {
        updates.whatsappSessionInfo = extraData.whatsappSessionInfo;
      }
      if (extraData?.whatsappMessageId) {
        updates.whatsappMessageId = extraData.whatsappMessageId;
      }
      if (extraData?.vendorPhone) {
        updates.vendorPhone = extraData.vendorPhone;
      }
    }

    await updateDoc(poRef, updates);

    let auditAction = 'PURCHASE_ORDER_STATUS_UPDATED';
    if (status === 'SENT') auditAction = 'PURCHASE_ORDER_SENT';
    if (status === 'PENDING_SEND') auditAction = 'PURCHASE_ORDER_PENDING_SEND';
    if (status === 'CANCELLED') auditAction = 'PURCHASE_ORDER_CANCELLED';

    await logAuditEvent(
      restaurantId,
      actorUid,
      actorName,
      auditAction,
      'PurchaseOrder',
      poId,
      `Purchase Order status updated to ${status}${extraData?.cancelReason ? ` (${extraData.cancelReason})` : ''}`
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `restaurants/${restaurantId}/purchaseOrders/${poId}`);
    throw err;
  }
}

export interface ReceiveOrderLineItem {
  itemId: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  newlyReceivedQty: number; // strictly what is arriving now
  actualRate: number;       // vendor invoice rate
  estimatedRate: number;    // original PO estimate
  estimatedAmount: number;
  itemStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'MISSING';
}

export interface ReceiveOrderTransactionParams {
  restaurantId: string;
  poId: string;
  billNumber: string;
  billDate: string;
  vendorInvoiceTotal: number;
  isOverride: boolean;
  overrideReason?: string;
  invoiceImageUrl?: string;
  invoiceImagePath?: string;
  items: ReceiveOrderLineItem[];
  recordedByUid: string;
  recordedByName: string;
  priceHikeThresholdPercent?: number;
}

export async function receivePurchaseOrderTransaction(
  params: ReceiveOrderTransactionParams
): Promise<{ purchaseId: string; poStatus: import('../types').PurchaseOrderStatus }> {
  const {
    restaurantId,
    poId,
    billNumber,
    billDate,
    vendorInvoiceTotal,
    isOverride,
    overrideReason,
    invoiceImageUrl,
    invoiceImagePath,
    items,
    recordedByUid,
    recordedByName,
    priceHikeThresholdPercent = 2.0,
  } = params;

  try {
    return await runTransaction(db, async (transaction) => {
      const now = new Date().toISOString();
      const poRef = getTenantDoc(restaurantId, 'purchaseOrders', poId);
      const poSnap = await transaction.get(poRef);

      if (!poSnap.exists()) {
        throw new Error(`Purchase Order ${poId} not found.`);
      }

      const poData = poSnap.data() as PurchaseOrder;

      if (poData.status === 'RECEIVED') {
        throw new Error(`Purchase Order ${poData.poNumber} has already been fully received.`);
      }
      if (poData.status === 'CANCELLED') {
        throw new Error(`Purchase Order ${poData.poNumber} was cancelled and cannot be received.`);
      }

      // Read vendor
      const vendorRef = getTenantDoc(restaurantId, 'vendors', poData.vendorId);
      const vendorSnap = await transaction.get(vendorRef);
      if (!vendorSnap.exists()) {
        throw new Error(`Vendor ${poData.vendorId} not found.`);
      }
      const vendorData = vendorSnap.data() as Vendor;

      // Filter line items with newly received quantity > 0
      const receivedItems = items.filter((i) => i.newlyReceivedQty > 0);
      if (receivedItems.length === 0) {
        throw new Error('Please specify a received quantity greater than 0 for at least one item.');
      }

      // Read all corresponding item documents
      const itemSnaps: { itemDoc: Item; itemRef: any; input: ReceiveOrderLineItem }[] = [];
      for (const row of receivedItems) {
        const itemRef = getTenantDoc(restaurantId, 'items', row.itemId);
        const itemSnap = await transaction.get(itemRef);
        if (!itemSnap.exists()) {
          throw new Error(`Item ${row.itemName} (${row.itemId}) not found in database.`);
        }
        itemSnaps.push({
          itemDoc: itemSnap.data() as Item,
          itemRef,
          input: row,
        });
      }

      // Calculate calculated invoice total
      let calculatedInvoiceTotal = 0;
      const purchaseItemRows: PurchaseItemRow[] = [];
      const priceHikesDetected: { name: string; oldRate: number; newRate: number; pct: number }[] = [];

      for (const { itemDoc, itemRef, input } of itemSnaps) {
        const lineTotal = Number((input.newlyReceivedQty * input.actualRate).toFixed(2));
        calculatedInvoiceTotal = Number((calculatedInvoiceTotal + lineTotal).toFixed(2));

        const prevRate = itemDoc.lastPurchaseRate || itemDoc.averageStockRate || input.estimatedRate;
        const hikeAbs = Math.max(0, input.actualRate - prevRate);
        const hikePct = prevRate > 0 ? (hikeAbs / prevRate) * 100 : 0;
        const isHike = hikePct >= priceHikeThresholdPercent;

        purchaseItemRows.push({
          itemId: input.itemId,
          itemName: input.itemName,
          category: itemDoc.category || 'General',
          unit: input.unit,
          quantity: input.newlyReceivedQty,
          rate: input.actualRate,
          purchaseRate: input.actualRate,
          taxPercent: itemDoc.taxPercent || 0,
          total: lineTotal,
          amount: lineTotal,
          previousRate: prevRate,
          priceHikeAbsolute: Number(hikeAbs.toFixed(2)),
          priceHikePercent: Number(hikePct.toFixed(2)),
          isPriceHike: isHike,
          currentStock: itemDoc.currentStock || 0,
          targetStockDays: itemDoc.targetStockDays || 15,
          isAboveTarget: (itemDoc.currentStock || 0) + input.newlyReceivedQty > (itemDoc.maximumStock || 9999),
        });

        // Price hike check
        const baselineRate = itemDoc.lastPurchaseRate || input.estimatedRate;
        if (baselineRate > 0 && input.actualRate > baselineRate) {
          const hikePct = ((input.actualRate - baselineRate) / baselineRate) * 100;
          if (hikePct >= priceHikeThresholdPercent) {
            priceHikesDetected.push({
              name: input.itemName,
              oldRate: baselineRate,
              newRate: input.actualRate,
              pct: Number(hikePct.toFixed(2)),
            });
          }
        }

        // Recalculate WAC strictly using the actual purchase rate
        const currentStock = itemDoc.currentStock || 0;
        const currentRate = itemDoc.averageStockRate || itemDoc.lastPurchaseRate || input.actualRate;
        const newAverageStockRate = calculateWeightedAverageCost(
          currentStock,
          currentRate,
          input.newlyReceivedQty,
          input.actualRate
        );
        const newStock = Number((currentStock + input.newlyReceivedQty).toFixed(2));

        // Update item in inventory
        transaction.update(itemRef, {
          currentStock: newStock,
          averageStockRate: newAverageStockRate,
          lastPurchaseRate: input.actualRate,
          updatedAt: now,
        });
      }

      // Total difference check
      const totalDifference = Number(Math.abs(calculatedInvoiceTotal - vendorInvoiceTotal).toFixed(2));

      // Generate Purchase ID
      const purchaseRef = doc(getTenantCol(restaurantId, 'purchases'));
      const purchaseId = purchaseRef.id;

      // Stock transaction entries
      for (const { itemDoc, input } of itemSnaps) {
        const stockTxRef = doc(getTenantCol(restaurantId, 'stockTransactions'));
        const stockTx: StockTransaction = {
          id: stockTxRef.id,
          itemId: input.itemId,
          itemName: input.itemName,
          type: 'PURCHASE_RECEIVE',
          quantity: input.newlyReceivedQty,
          rate: input.actualRate,
          value: Number((input.newlyReceivedQty * input.actualRate).toFixed(2)),
          referenceId: purchaseId,
          reason: `PO ${poData.poNumber} Receive (Bill #${billNumber})`,
          restaurantId,
          createdAt: now,
          actorUid: recordedByUid,
          actorName: recordedByName,
        };
        transaction.set(stockTxRef, stockTx);
      }

      // Update Vendor Due & Total Purchases
      const currentVendorPurchases = vendorData.totalPurchases || 0;
      const currentVendorDue = vendorData.currentDue || 0;
      transaction.update(vendorRef, {
        totalPurchases: Number((currentVendorPurchases + calculatedInvoiceTotal).toFixed(2)),
        currentDue: Number((currentVendorDue + calculatedInvoiceTotal).toFixed(2)),
        updatedAt: now,
      });

      // Create Purchase Record
      const purchaseRecord: Purchase = {
        id: purchaseId,
        billNumber,
        billDate,
        vendorId: poData.vendorId,
        vendorName: poData.vendorName,
        totalAmount: calculatedInvoiceTotal,
        taxAmount: 0,
        netAmount: calculatedInvoiceTotal,
        paidAmount: 0,
        remainingAmount: calculatedInvoiceTotal,
        paymentStatus: 'UNPAID',
        isOverride: Boolean(isOverride || priceHikesDetected.length > 0 || totalDifference > 0.01),
        overrideReason:
          overrideReason ||
          (priceHikesDetected.length > 0
            ? `Price hike verified on ${priceHikesDetected.map((h) => h.name).join(', ')}`
            : totalDifference > 0.01
            ? `Invoice amount difference ₹${totalDifference.toFixed(2)} accepted`
            : 'Standard receipt'),
        itemsCount: purchaseItemRows.length,
        items: purchaseItemRows,
        poId: poData.id,
        poNumber: poData.poNumber,
        invoiceImageUrl: invoiceImageUrl || '',
        invoiceImagePath: invoiceImagePath || '',
        recordedByUid,
        recordedByName,
        restaurantId,
        createdAt: now,
        updatedAt: now,
      };
      transaction.set(purchaseRef, purchaseRecord);

      // Compute updated PO items and overall status
      const existingPoItems = poData.items || [];
      let totalOrderedAll = 0;
      let totalReceivedAll = 0;

      const updatedPoItems = existingPoItems.map((original) => {
        const matched = items.find((i) => i.itemId === original.itemId);
        const ordered = original.orderedQty || original.recommendedQuantity || 0;
        const prevReceived = original.previouslyReceivedQty || original.receivedQty || 0;
        const newlyReceived = matched?.newlyReceivedQty || 0;
        const totalReceived = Number((prevReceived + newlyReceived).toFixed(2));
        const missing = Number(Math.max(0, ordered - totalReceived).toFixed(2));
        const actualRate = matched?.actualRate ?? original.actualRate ?? original.estimatedRate;
        const actualAmount = Number((totalReceived * actualRate).toFixed(2));

        totalOrderedAll += ordered;
        totalReceivedAll += totalReceived;

        const itemStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED' | 'MISSING' =
          totalReceived >= ordered
            ? 'RECEIVED'
            : totalReceived > 0
            ? 'PARTIALLY_RECEIVED'
            : 'MISSING';

        return {
          ...original,
          orderedQty: ordered,
          recommendedQuantity: ordered,
          receivedQty: totalReceived,
          missingQty: missing,
          previouslyReceivedQty: totalReceived,
          actualRate,
          actualAmount,
          itemStatus,
        };
      });

      const poStatus: import('../types').PurchaseOrderStatus =
        totalReceivedAll >= totalOrderedAll && totalOrderedAll > 0
          ? 'RECEIVED'
          : totalReceivedAll > 0
          ? 'PARTIALLY_RECEIVED'
          : poData.status;

      // Update PO
      const poUpdates: Partial<PurchaseOrder> & Record<string, any> = {
        status: poStatus,
        items: updatedPoItems,
        purchaseId,
        invoiceId: billNumber,
        billNumber,
        receivedAt: now,
        receivedByUid: recordedByUid,
        receivedByName: recordedByName,
        actualReceivedTotal: Number(((poData.actualReceivedTotal || 0) + calculatedInvoiceTotal).toFixed(2)),
        invoiceTotal: vendorInvoiceTotal,
        calculatedInvoiceTotal,
        totalDifference,
        updatedAt: now,
      };

      if (invoiceImageUrl) poUpdates.invoiceImageUrl = invoiceImageUrl;
      if (invoiceImagePath) poUpdates.invoiceImagePath = invoiceImagePath;

      transaction.update(poRef, poUpdates);

      // Record Audit Logs
      const auditRef1 = doc(getTenantCol(restaurantId, 'auditLogs'));
      const auditLog1: AuditLog = {
        id: auditRef1.id,
        actorUid: recordedByUid,
        actorName: recordedByName,
        action: poStatus === 'RECEIVED' ? 'PURCHASE_ORDER_RECEIVED' : 'PURCHASE_ORDER_PARTIALLY_RECEIVED',
        entity: 'PurchaseOrder',
        entityId: poData.id,
        details: `Received inward delivery for ${poData.poNumber} (Bill #${billNumber}, ₹${calculatedInvoiceTotal.toFixed(
          2
        )}). Status: ${poStatus}.`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef1, auditLog1);

      const auditRef2 = doc(getTenantCol(restaurantId, 'auditLogs'));
      const auditLog2: AuditLog = {
        id: auditRef2.id,
        actorUid: recordedByUid,
        actorName: recordedByName,
        action: 'INVOICE_VERIFIED',
        entity: 'Purchase',
        entityId: purchaseId,
        details: `Verified Invoice Bill #${billNumber} for Vendor ${poData.vendorName}. Total: ₹${calculatedInvoiceTotal.toFixed(
          2
        )} (Difference: ₹${totalDifference.toFixed(2)}).`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef2, auditLog2);

      if (isOverride || priceHikesDetected.length > 0) {
        const auditRef3 = doc(getTenantCol(restaurantId, 'auditLogs'));
        const auditLog3: AuditLog = {
          id: auditRef3.id,
          actorUid: recordedByUid,
          actorName: recordedByName,
          action: 'INVOICE_PRICE_OVERRIDE',
          entity: 'Purchase',
          entityId: purchaseId,
          details: `Invoice price override applied: ${overrideReason || 'Price hike / mismatch confirmed'}`,
          restaurantId,
          createdAt: now,
        };
        transaction.set(auditRef3, auditLog3);
      }

      // Notifications for price hike
      if (priceHikesDetected.length > 0) {
        const notifRef = doc(getTenantCol(restaurantId, 'notifications'));
        const notification: NotificationItem = {
          id: notifRef.id,
          title: `Price Hike Alert: PO ${poData.poNumber}`,
          message: `${priceHikesDetected
            .map((h) => `${h.name} up +${h.pct}% (₹${h.oldRate} → ₹${h.newRate})`)
            .join('; ')} on Bill #${billNumber} from ${poData.vendorName}.`,
          type: 'PRICE_HIKE',
          severity: 'warning',
          isRead: false,
          restaurantId,
          createdAt: now,
        };
        transaction.set(notifRef, notification);
      }

      return { purchaseId, poStatus };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/purchaseOrders/${poId}`);
    throw err;
  }
}

// ==========================================
// AUTHORIZED DIRECT-ACTIVE TEAM MEMBERS
// ==========================================

export async function addActiveTeamMember(
  restaurantId: string,
  restaurantName: string,
  caller: { uid: string; name: string; role: UserRole },
  params: {
    fullName: string;
    email: string;
    role: UserRole;
    departmentId?: string | null;
    departmentName?: string | null;
  }
): Promise<{ success: boolean; memberId?: string; error?: string }> {
  if (!restaurantId) {
    return { success: false, error: 'Restaurant ID is required' };
  }

  const fullName = params.fullName.trim();
  const normalizedEmail = params.email.trim().toLowerCase();

  if (!fullName || fullName.length < 2) {
    return { success: false, error: 'Please enter a valid staff full name.' };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!normalizedEmail || !emailRegex.test(normalizedEmail)) {
    return { success: false, error: 'Please enter a valid email address.' };
  }

  if (!['OWNER', 'MANAGER', 'STOREKEEPER', 'DEPARTMENT_STAFF'].includes(params.role)) {
    return { success: false, error: 'Invalid staff role specified.' };
  }

  if (caller.role !== 'OWNER' && caller.role !== 'MANAGER') {
    return { success: false, error: 'Only restaurant Owners or Managers can authorize team members.' };
  }

  // RBAC Role Elevation Protection: Managers cannot grant Owner or Manager roles
  if (caller.role === 'MANAGER' && (params.role === 'OWNER' || params.role === 'MANAGER')) {
    return { success: false, error: 'Managers can only authorize Storekeeper or Department Staff roles.' };
  }

  try {
    // 1. Check if user already exists as an active member in this restaurant's users subcollection
    const usersColRef = collection(db, 'restaurants', restaurantId, 'users');
    const existingUsersSnap = await getDocs(usersColRef);
    const existingUserDoc = existingUsersSnap.docs.find((d) => {
      const u = d.data() as RestaurantUser;
      return Boolean(u.email && u.email.trim().toLowerCase() === normalizedEmail);
    });

    if (existingUserDoc) {
      const u = existingUserDoc.data() as RestaurantUser;
      const isAlreadyActive =
        u.status !== 'inactive' &&
        u.status !== 'INACTIVE' &&
        u.accountStatus !== 'SUSPENDED';

      if (isAlreadyActive) {
        return {
          success: false,
          error: 'This email is already an active team member.',
        };
      }
    }

    // 2. Check if active authorization already exists in authorizations subcollection
    const authColRef = collection(db, 'restaurants', restaurantId, 'authorizations');
    const existingAuthSnap = await getDocs(
      query(authColRef, where('email', '==', normalizedEmail))
    );

    const activeAuthDoc = existingAuthSnap.docs.find((d) => {
      const a = d.data() as StaffAuthorization;
      return a.status === 'ACTIVE' && a.accountStatus !== 'SUSPENDED';
    });

    if (activeAuthDoc) {
      return {
        success: false,
        error: 'This email is already an active team member.',
      };
    }

    // 3. Check for any non-active authorization (PENDING, PENDING_ACTIVATION, INACTIVE) to update instead of creating duplicate
    const existingNonActiveAuthDoc = existingAuthSnap.docs.find((d) => {
      const a = d.data() as StaffAuthorization;
      return a.status !== 'ACTIVE' || a.accountStatus === 'SUSPENDED';
    });

    // Check for any legacy PENDING invitation and migrate it directly to ACTIVE
    const invColRef = collection(db, 'restaurants', restaurantId, 'invitations');
    const existingInvSnap = await getDocs(
      query(invColRef, where('email', '==', normalizedEmail))
    );
    const legacyPendingInv = existingInvSnap.docs.find((d) => {
      const inv = d.data() as StaffInvitation;
      return inv.status === 'PENDING';
    });

    const now = new Date().toISOString();
    const batch = writeBatch(db);

    // Reuse existing doc if updating non-active authorization, migrating legacy invitation, or create new doc
    const targetAuthRef = existingNonActiveAuthDoc
      ? existingNonActiveAuthDoc.ref
      : legacyPendingInv
      ? doc(authColRef, legacyPendingInv.id)
      : doc(authColRef);

    // If an existing real UID is already known for this user in this restaurant, preserve/attach it.
    // Otherwise, DO NOT invent a fake UID - leave attachedUid null so real UID attaches upon login.
    const realUid =
      existingUserDoc?.id ||
      (existingNonActiveAuthDoc?.data() as StaffAuthorization | undefined)?.attachedUid ||
      null;

    const authData: StaffAuthorization = {
      id: targetAuthRef.id,
      restaurantId,
      restaurantName: restaurantName || 'Restaurant',
      email: normalizedEmail,
      fullName,
      role: params.role,
      departmentId: params.departmentId || null,
      departmentName: params.departmentName || null,
      status: 'ACTIVE',
      accountStatus: 'ACTIVE',
      authorizedByUid: caller.uid,
      authorizedByName: caller.name || 'Authorized Manager',
      authorizedByRole: caller.role,
      authorizedAt: now,
      ...(realUid ? { attachedUid: realUid } : {}),
    };

    // If migrating legacy invitation, mark the legacy record as ACCEPTED / migrated
    if (legacyPendingInv) {
      batch.update(legacyPendingInv.ref, {
        status: 'ACCEPTED',
        acceptedAt: now,
        acceptedByUid: caller.uid,
      });
    }

    // If an inactive restaurant user doc exists, reactivate them directly with their real UID
    if (existingUserDoc) {
      batch.update(existingUserDoc.ref, {
        name: fullName,
        role: params.role,
        departmentId: params.departmentId || null,
        departmentName: params.departmentName || null,
        status: 'ACTIVE',
        accountStatus: 'ACTIVE',
        authorizedByUid: caller.uid,
        authorizedByName: caller.name || 'Authorized Manager',
        authorizedAt: now,
        authorizationId: targetAuthRef.id,
      });
    }

    // Write the active staff authorization document
    batch.set(targetAuthRef, authData, { merge: true });

    // 4. Immutable Audit Log (TEAM_MEMBER_CREATED)
    const auditRef = doc(collection(db, 'restaurants', restaurantId, 'auditLogs'));
    const auditData: AuditLog = {
      id: auditRef.id,
      actorUid: caller.uid,
      actorName: caller.name || 'Authorized Manager',
      actorRole: caller.role,
      action: 'TEAM_MEMBER_CREATED',
      entity: 'TeamMember',
      entityId: targetAuthRef.id,
      details: `Team member ${fullName} (${normalizedEmail}) authorized with role ${params.role}${
        params.departmentName ? ` in ${params.departmentName}` : ''
      }`,
      targetEmail: normalizedEmail,
      targetRole: params.role,
      department: params.departmentName || 'All Departments',
      restaurantId,
      createdAt: now,
    };
    batch.set(auditRef, auditData);

    await batch.commit();
    return { success: true, memberId: targetAuthRef.id };
  } catch (err: any) {
    console.error('[addActiveTeamMember] Technical diagnostic error:', {
      code: err?.code,
      message: err?.message,
      operation: 'Firestore batch write to authorizations and auditLogs',
      path: `restaurants/${restaurantId}/authorizations`,
      error: err,
    });
    return {
      success: false,
      error: err?.message || 'Unable to add team member. Please try again.',
    };
  }
}

// Backward-compatible alias for existing call sites
export async function inviteTeamMember(
  restaurantId: string,
  restaurantName: string,
  caller: { uid: string; name: string; role: UserRole },
  params: {
    fullName: string;
    email: string;
    role: UserRole;
    departmentId?: string | null;
    departmentName?: string | null;
  }
): Promise<{ success: boolean; invitationId?: string; error?: string }> {
  const result = await addActiveTeamMember(restaurantId, restaurantName, caller, params);
  return {
    success: result.success,
    invitationId: result.memberId,
    error: result.error,
  };
}

export async function updateTeamMember(
  restaurantId: string,
  memberId: string,
  updates: {
    role?: UserRole;
    departmentId?: string | null;
    departmentName?: string | null;
    status?: 'ACTIVE' | 'INACTIVE';
    accountStatus?: 'ACTIVE' | 'SUSPENDED';
  },
  caller: { uid: string; name: string; role: UserRole }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (caller.role !== 'OWNER' && caller.role !== 'MANAGER') {
      return { success: false, error: 'Only Owners or Managers can update team members.' };
    }

    if (caller.role === 'MANAGER' && (updates.role === 'OWNER' || updates.role === 'MANAGER')) {
      return { success: false, error: 'Managers cannot assign Owner or Manager roles.' };
    }

    const batch = writeBatch(db);
    const now = new Date().toISOString();
    let updatedName = 'Team Member';
    let updatedEmail = '';

    // Check in users subcollection
    const userRef = doc(db, 'restaurants', restaurantId, 'users', memberId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      const userData = userSnap.data() as RestaurantUser;
      if (userData.role === 'OWNER' && caller.role !== 'OWNER') {
        return { success: false, error: 'Only the Restaurant Owner can modify Owner permissions.' };
      }
      updatedName = userData.name;
      updatedEmail = userData.email || '';
      batch.update(userRef, {
        ...updates,
      });
    }

    // Check in authorizations subcollection
    const authRef = doc(db, 'restaurants', restaurantId, 'authorizations', memberId);
    const authSnap = await getDoc(authRef);
    if (authSnap.exists()) {
      const authData = authSnap.data() as StaffAuthorization;
      updatedName = authData.fullName;
      updatedEmail = authData.email;
      batch.update(authRef, {
        ...updates,
      });
    } else {
      // Find authorization by attachedUid
      const authQuery = query(
        collection(db, 'restaurants', restaurantId, 'authorizations'),
        where('attachedUid', '==', memberId),
        limit(1)
      );
      const authQuerySnap = await getDocs(authQuery);
      if (!authQuerySnap.empty) {
        batch.update(authQuerySnap.docs[0].ref, {
          ...updates,
        });
      }
    }

    // Audit log
    const auditRef = doc(collection(db, 'restaurants', restaurantId, 'auditLogs'));
    const auditData: AuditLog = {
      id: auditRef.id,
      actorUid: caller.uid,
      actorName: caller.name,
      actorRole: caller.role,
      action: 'TEAM_MEMBER_UPDATED',
      entity: 'TeamMember',
      entityId: memberId,
      details: `Updated team member ${updatedName} (${updatedEmail}) - Role: ${updates.role || 'unchanged'}, Status: ${updates.status || 'unchanged'}`,
      targetEmail: updatedEmail,
      targetRole: updates.role || 'DEPARTMENT_STAFF',
      restaurantId,
      createdAt: now,
    };
    batch.set(auditRef, auditData);

    await batch.commit();
    return { success: true };
  } catch (err) {
    console.error('[updateTeamMember] Technical diagnostic error:', err);
    return { success: false, error: 'Unable to update team member. Please try again.' };
  }
}

export async function revokeInvitation(
  restaurantId: string,
  invitationId: string,
  caller: { uid: string; name: string; role: UserRole }
): Promise<{ success: boolean; error?: string }> {
  try {
    const invRef = doc(db, 'restaurants', restaurantId, 'invitations', invitationId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) {
      return { success: false, error: 'Invitation not found' };
    }
    const invData = invSnap.data() as StaffInvitation;
    const now = new Date().toISOString();

    const batch = writeBatch(db);
    batch.update(invRef, {
      status: 'REVOKED',
      updatedAt: now,
    });

    const auditRef = doc(collection(db, 'restaurants', restaurantId, 'auditLogs'));
    const auditData: AuditLog = {
      id: auditRef.id,
      actorUid: caller.uid,
      actorName: caller.name,
      actorRole: caller.role,
      action: 'TEAM_INVITATION_REVOKED',
      entity: 'StaffInvitation',
      entityId: invitationId,
      details: `Revoked pending invitation for ${invData.fullName} (${invData.email})`,
      targetEmail: invData.email,
      targetRole: invData.requestedRole,
      restaurantId,
      createdAt: now,
    };
    batch.set(auditRef, auditData);

    await batch.commit();
    return { success: true };
  } catch (err) {
    console.error('[revokeInvitation] Technical diagnostic error:', err);
    return { success: false, error: 'Unable to revoke invitation. Please try again.' };
  }
}

export async function removeTeamMember(
  restaurantId: string,
  memberId: string,
  memberName: string,
  caller: { uid: string; name: string; role: UserRole }
): Promise<{ success: boolean; error?: string }> {
  try {
    if (caller.role !== 'OWNER' && caller.role !== 'MANAGER') {
      return { success: false, error: 'Only Owners or Managers can remove team members.' };
    }

    if (caller.uid === memberId) {
      return { success: false, error: 'You cannot remove yourself from the restaurant.' };
    }

    const now = new Date().toISOString();
    const batch = writeBatch(db);
    let targetEmail = '';
    let targetRole: UserRole = 'DEPARTMENT_STAFF';

    // 1. Check users subcollection
    const memberRef = doc(db, 'restaurants', restaurantId, 'users', memberId);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
      const memberData = memberSnap.data() as RestaurantUser;
      if (memberData.role === 'OWNER') {
        return { success: false, error: 'Cannot remove restaurant owner.' };
      }
      targetEmail = memberData.email || '';
      targetRole = memberData.role;
      batch.delete(memberRef);
    }

    // 2. Check authorizations subcollection (direct doc or attachedUid)
    const authRef = doc(db, 'restaurants', restaurantId, 'authorizations', memberId);
    const authSnap = await getDoc(authRef);
    if (authSnap.exists()) {
      const authData = authSnap.data() as StaffAuthorization;
      if (authData.role === 'OWNER') {
        return { success: false, error: 'Cannot remove restaurant owner.' };
      }
      targetEmail = authData.email || targetEmail;
      targetRole = authData.role;
      batch.delete(authRef);
    } else {
      const authQuery = query(
        collection(db, 'restaurants', restaurantId, 'authorizations'),
        where('attachedUid', '==', memberId)
      );
      const authQuerySnap = await getDocs(authQuery);
      authQuerySnap.forEach((d) => batch.delete(d.ref));
    }

    // 3. Check legacy invitations
    const invRef = doc(db, 'restaurants', restaurantId, 'invitations', memberId);
    const invSnap = await getDoc(invRef);
    if (invSnap.exists()) {
      batch.delete(invRef);
    }

    const auditRef = doc(collection(db, 'restaurants', restaurantId, 'auditLogs'));
    const auditData: AuditLog = {
      id: auditRef.id,
      actorUid: caller.uid,
      actorName: caller.name,
      actorRole: caller.role,
      action: 'TEAM_MEMBER_REMOVED',
      entity: 'RestaurantUser',
      entityId: memberId,
      details: `Removed team member ${memberName} (${targetEmail || memberId}) [Role: ${targetRole}]`,
      targetEmail,
      targetRole,
      restaurantId,
      createdAt: now,
    };
    batch.set(auditRef, auditData);

    await batch.commit();
    return { success: true };
  } catch (err) {
    console.error('[removeTeamMember] Technical diagnostic error:', err);
    return { success: false, error: 'Unable to remove team member. Please try again.' };
  }
}

export async function syncUserAuthorizations(user: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}): Promise<string[]> {
  if (!user.email) return [];
  const normalizedEmail = user.email.trim().toLowerCase();
  const activatedRestaurantIds: string[] = [];
  const now = new Date().toISOString();

  try {
    // 1. Sync from direct active authorizations
    const authQuery = query(
      collectionGroup(db, 'authorizations'),
      where('email', '==', normalizedEmail),
      where('status', '==', 'ACTIVE')
    );
    const authSnap = await getDocs(authQuery);

    for (const d of authSnap.docs) {
      const authData = d.data() as StaffAuthorization;
      const rId = authData.restaurantId;
      if (!rId) continue;

      try {
        const userMemberRef = doc(db, 'restaurants', rId, 'users', user.uid);
        const batch = writeBatch(db);

        const newMember: RestaurantUser = {
          uid: user.uid,
          name: authData.fullName || user.displayName || 'Staff Member',
          email: normalizedEmail,
          role: authData.role,
          departmentId: authData.departmentId || null,
          departmentName: authData.departmentName || null,
          restaurantId: rId,
          status: 'ACTIVE',
          accountStatus: 'ACTIVE',
          authorizedByUid: authData.authorizedByUid,
          authorizedByName: authData.authorizedByName,
          authorizedAt: authData.authorizedAt,
          authorizationId: d.id,
          createdAt: now,
        };

        batch.set(userMemberRef, newMember, { merge: true });
        batch.update(d.ref, { attachedUid: user.uid });

        // Add to user's root profile restaurantIds
        const rootUserRef = doc(db, 'users', user.uid);
        batch.set(
          rootUserRef,
          {
            restaurantIds: arrayUnion(rId),
          },
          { merge: true }
        );

        await batch.commit();
        activatedRestaurantIds.push(rId);
        console.log(`[Staff Sync] Linked active authorization for ${normalizedEmail} in restaurant ${rId}`);
      } catch (authLinkErr) {
        console.error(`[Staff Sync] Error linking authorization ${d.id}:`, authLinkErr);
      }
    }

    // 2. Sync from any legacy invitations (migrate to active)
    const invQuery = query(
      collectionGroup(db, 'invitations'),
      where('email', '==', normalizedEmail),
      where('status', 'in', ['PENDING', 'ACCEPTED'])
    );
    const invSnap = await getDocs(invQuery);

    for (const d of invSnap.docs) {
      const inv = d.data() as StaffInvitation;
      const rId = inv.restaurantId;
      if (!rId || activatedRestaurantIds.includes(rId)) continue;

      try {
        const userMemberRef = doc(db, 'restaurants', rId, 'users', user.uid);
        const batch = writeBatch(db);

        const newMember: RestaurantUser = {
          uid: user.uid,
          name: user.displayName || inv.fullName || 'Staff Member',
          email: normalizedEmail,
          role: inv.requestedRole,
          departmentId: inv.departmentId || null,
          departmentName: inv.departmentName || null,
          restaurantId: rId,
          status: 'ACTIVE',
          accountStatus: 'ACTIVE',
          authorizedByUid: inv.invitedByUid,
          authorizedByName: inv.invitedByName,
          authorizedAt: inv.invitedAt,
          createdAt: now,
        };

        batch.set(userMemberRef, newMember, { merge: true });
        batch.update(d.ref, {
          status: 'ACCEPTED',
          acceptedAt: now,
          acceptedByUid: user.uid,
        });

        const rootUserRef = doc(db, 'users', user.uid);
        batch.set(
          rootUserRef,
          {
            restaurantIds: arrayUnion(rId),
          },
          { merge: true }
        );

        await batch.commit();
        activatedRestaurantIds.push(rId);
      } catch (legacyErr) {
        console.error(`[Legacy Invitation Sync] Error:`, legacyErr);
      }
    }
  } catch (err) {
    console.error('[syncUserAuthorizations] Error syncing authorizations:', err);
  }

  return Array.from(new Set(activatedRestaurantIds));
}

// Backward-compatible alias for existing call sites
export async function activatePendingInvitationsForUser(user: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
}): Promise<string[]> {
  return syncUserAuthorizations(user);
}

