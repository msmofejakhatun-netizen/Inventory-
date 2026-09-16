import {
  collection,
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
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { handleFirestoreError, OperationType } from '../firebase/errorHandler';
import { calculateWeightedAverageCost } from './calculations';
import {
  Restaurant,
  RestaurantUser,
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
    paymentStatus: 'unpaid' | 'partially_paid' | 'paid';
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
      const newVendorPurchases = Number(((vendorData.totalPurchases || 0) + purchaseData.netAmount).toFixed(2));
      const additionalDue = purchaseData.paymentStatus === 'paid' ? 0 : purchaseData.netAmount;
      const newCurrentDue = Number(((vendorData.currentDue || 0) + additionalDue).toFixed(2));

      transaction.update(vendorRef, {
        totalPurchases: newVendorPurchases,
        currentDue: newCurrentDue,
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
        paymentStatus: purchaseData.paymentStatus,
        isOverride: purchaseData.isOverride,
        overrideReason: purchaseData.overrideReason || '',
        itemsCount: purchaseData.items.length,
        items: purchaseData.items,
        recordedByUid: purchaseData.recordedByUid,
        recordedByName: purchaseData.recordedByName,
        restaurantId,
        createdAt: now,
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
    billNumber?: string;
    amount: number;
    paymentMode: VendorPayment['paymentMode'];
    reference?: string;
    recordedByUid: string;
    recordedByName: string;
  }
): Promise<string> {
  const payRef = doc(getTenantCol(restaurantId, 'vendorPayments'));
  const paymentId = payRef.id;
  const now = new Date().toISOString();

  try {
    await runTransaction(db, async (transaction) => {
      const vendorRef = getTenantDoc(restaurantId, 'vendors', paymentData.vendorId);
      const vendorSnap = await transaction.get(vendorRef);
      if (!vendorSnap.exists()) {
        throw new Error('Vendor not found');
      }
      const vendor = vendorSnap.data() as Vendor;

      const newPaid = Number(((vendor.totalPaid || 0) + paymentData.amount).toFixed(2));
      const newDue = Number(((vendor.currentDue || 0) - paymentData.amount).toFixed(2));

      transaction.update(vendorRef, {
        totalPaid: newPaid,
        currentDue: newDue,
      });

      const payDoc: VendorPayment = {
        id: paymentId,
        vendorId: paymentData.vendorId,
        vendorName: paymentData.vendorName,
        billNumber: paymentData.billNumber || '',
        amount: paymentData.amount,
        paymentMode: paymentData.paymentMode,
        reference: paymentData.reference || '',
        recordedByUid: paymentData.recordedByUid,
        recordedByName: paymentData.recordedByName,
        restaurantId,
        createdAt: now,
      };
      transaction.set(payRef, payDoc);

      const auditRef = doc(getTenantCol(restaurantId, 'auditLogs'));
      const audit: AuditLog = {
        id: auditRef.id,
        actorUid: paymentData.recordedByUid,
        actorName: paymentData.recordedByName,
        action: 'VENDOR_PAYMENT_RECORDED',
        entity: 'VendorPayment',
        entityId: paymentId,
        details: `Disbursed ₹${paymentData.amount} to ${paymentData.vendorName} via ${paymentData.paymentMode} (Ref: ${paymentData.reference || 'N/A'}). Remaining Due: ₹${newDue}`,
        restaurantId,
        createdAt: now,
      };
      transaction.set(auditRef, audit);
    });

    return paymentId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `restaurants/${restaurantId}/vendorPayments`);
  }
}
