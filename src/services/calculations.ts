import { Item, Issue, Purchase, StoreHealthScoreBreakdown } from '../types';

/**
 * Weighted Average Costing Formula:
 * New Average Cost = (Current Stock Qty * Current Average Cost + New Purchase Qty * New Purchase Rate) / (Current Stock Qty + New Purchase Qty)
 */
export function calculateWeightedAverageCost(
  currentStockQty: number,
  currentAvgCost: number,
  newPurchaseQty: number,
  newPurchaseRate: number
): number {
  const validCurrentQty = Math.max(0, Number(currentStockQty) || 0);
  const validCurrentCost = Math.max(0, Number(currentAvgCost) || 0);
  const validNewQty = Math.max(0, Number(newPurchaseQty) || 0);
  const validNewRate = Math.max(0, Number(newPurchaseRate) || 0);

  const totalQty = validCurrentQty + validNewQty;
  if (totalQty <= 0) {
    return validNewRate > 0 ? validNewRate : validCurrentCost;
  }
  if (validCurrentQty === 0) {
    return validNewRate;
  }

  const totalValue = (validCurrentQty * validCurrentCost) + (validNewQty * validNewRate);
  const result = totalValue / totalQty;
  return Number(result.toFixed(2));
}

/**
 * Stock Value: Quantity * Weighted Average Cost
 */
export function calculateStockValue(quantity: number, averageStockRate: number): number {
  return Number(((Math.max(0, quantity || 0)) * (Math.max(0, averageStockRate || 0))).toFixed(2));
}

/**
 * Daily Consumption from historical issues
 */
export function calculateAverageDailyConsumption(
  issues: Issue[],
  itemId: string,
  daysRange = 14
): { avgDailyQty: number; hasData: boolean; totalConsumed: number } {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysRange);
  const cutoffIso = cutoffDate.toISOString();

  const relevantIssues = issues.filter(
    (issue) => issue.itemId === itemId && issue.createdAt >= cutoffIso
  );

  const totalConsumed = relevantIssues.reduce((sum, issue) => sum + (Number(issue.quantity) || 0), 0);

  if (relevantIssues.length === 0 || totalConsumed <= 0) {
    return { avgDailyQty: 0, hasData: false, totalConsumed: 0 };
  }

  const avgDailyQty = totalConsumed / daysRange;
  return { avgDailyQty: Number(avgDailyQty.toFixed(2)), hasData: true, totalConsumed };
}

/**
 * Stock Days: Current Stock Quantity / Average Daily Consumption Quantity
 */
export function calculateStockDays(
  currentStock: number,
  avgDailyConsumption: number
): { days: number | null; label: string } {
  if (!avgDailyConsumption || avgDailyConsumption <= 0) {
    return { days: null, label: 'Insufficient consumption data' };
  }
  const days = currentStock / avgDailyConsumption;
  return { days: Number(days.toFixed(1)), label: `${days.toFixed(1)} days` };
}

/**
 * Excess Stock & Cash Blocked
 */
export function calculateExcessStock(
  item: Item,
  avgDailyConsumption: number
): {
  targetStockQty: number;
  excessQty: number;
  excessValue: number;
  isExcess: boolean;
} {
  const targetDays = item.targetStockDays || 5;
  if (!avgDailyConsumption || avgDailyConsumption <= 0) {
    // If no consumption history, treat stock exceeding maximumStock as potential excess
    if (item.maximumStock && item.currentStock > item.maximumStock) {
      const excessQty = item.currentStock - item.maximumStock;
      const excessValue = excessQty * (item.averageStockRate || item.lastPurchaseRate || 0);
      return {
        targetStockQty: item.maximumStock,
        excessQty: Number(excessQty.toFixed(2)),
        excessValue: Number(excessValue.toFixed(2)),
        isExcess: true,
      };
    }
    return { targetStockQty: 0, excessQty: 0, excessValue: 0, isExcess: false };
  }

  const targetStockQty = Number((avgDailyConsumption * targetDays).toFixed(2));
  const excessQty = Math.max(0, item.currentStock - targetStockQty);
  const rate = item.averageStockRate || item.lastPurchaseRate || 0;
  const excessValue = Number((excessQty * rate).toFixed(2));

  return {
    targetStockQty,
    excessQty: Number(excessQty.toFixed(2)),
    excessValue,
    isExcess: excessQty > 0,
  };
}

/**
 * 15-Day Purchase Requirement
 * Required Purchase = Math.max(0, (Expected 15-Day Consumption + Buffer) - Usable Current Stock)
 */
export function calculate15DayPurchaseRequirement(
  item: Item,
  avgDailyConsumption: number
): {
  recommendedQty: number;
  estimatedAmount: number;
  reason: string;
} {
  const rate = item.averageStockRate || item.lastPurchaseRate || 0;

  if (!avgDailyConsumption || avgDailyConsumption <= 0) {
    if (item.minimumStock && item.currentStock < item.minimumStock) {
      const target = item.maximumStock || item.minimumStock * 2;
      const qty = Math.max(0, target - item.currentStock);
      return {
        recommendedQty: Number(qty.toFixed(2)),
        estimatedAmount: Number((qty * rate).toFixed(2)),
        reason: `Current stock (${item.currentStock} ${item.unit}) is below minimum threshold (${item.minimumStock} ${item.unit}).`,
      };
    }
    return {
      recommendedQty: 0,
      estimatedAmount: 0,
      reason: 'Insufficient consumption data to forecast 15-day requirement.',
    };
  }

  const targetDays = item.targetStockDays || 5;
  const neededForCycle = avgDailyConsumption * Math.max(15, targetDays);
  const requiredPurchase = Math.max(0, neededForCycle - item.currentStock);

  if (requiredPurchase <= 0) {
    return {
      recommendedQty: 0,
      estimatedAmount: 0,
      reason: `Current stock is already sufficient for ${((item.currentStock / avgDailyConsumption) || 0).toFixed(1)} days.`,
    };
  }

  return {
    recommendedQty: Number(requiredPurchase.toFixed(2)),
    estimatedAmount: Number((requiredPurchase * rate).toFixed(2)),
    reason: `Projected 15-day need: ${neededForCycle.toFixed(1)} ${item.unit}, current stock: ${item.currentStock} ${item.unit}.`,
  };
}

/**
 * Store Health Score (0 - 100)
 * Evaluates real operational metrics transparently:
 * - Excess Stock penalty
 * - Low Stock / Stockout risk penalty
 * - High Vendor Due ratio
 * - High Wastage % penalty
 * - Physical Stock variance penalty
 * - Emergency Issues frequency penalty
 * - Price hike impact
 */
export function calculateStoreHealthScore(params: {
  totalStockValue: number;
  totalCashBlocked: number;
  itemsWithLowStockCount: number;
  totalItemsCount: number;
  totalVendorDue: number;
  totalPurchases30Days: number;
  totalWastageValue30Days: number;
  totalIssuesValue30Days: number;
  emergencyIssuesCount7Days: number;
  varianceIncidentsCount30Days: number;
  priceHikesCount30Days: number;
}): StoreHealthScoreBreakdown {
  const reasons: string[] = [];

  // 1. Stock Control Score (Max 25 pts)
  let stockControlScore = 25;
  if (params.totalItemsCount > 0) {
    const lowStockRatio = params.itemsWithLowStockCount / params.totalItemsCount;
    if (lowStockRatio > 0.3) {
      stockControlScore = 10;
      reasons.push(`${(lowStockRatio * 100).toFixed(0)}% of items are below reorder levels`);
    } else if (lowStockRatio > 0.1) {
      stockControlScore = 18;
      reasons.push(`${(lowStockRatio * 100).toFixed(0)}% of items are low on stock`);
    }
  }

  // 2. Excess Stock / Cash Blocked (Max 20 pts)
  let excessStockScore = 20;
  if (params.totalStockValue > 0) {
    const blockedRatio = params.totalCashBlocked / params.totalStockValue;
    if (blockedRatio > 0.4) {
      excessStockScore = 5;
      reasons.push(`High cash blocked: ${(blockedRatio * 100).toFixed(0)}% of store value is excess stock`);
    } else if (blockedRatio > 0.2) {
      excessStockScore = 12;
      reasons.push(`Moderate cash blocked: ${(blockedRatio * 100).toFixed(0)}% in excess inventory`);
    }
  }

  // 3. Vendor Due Ratio (Max 15 pts)
  let vendorDueScore = 15;
  if (params.totalPurchases30Days > 0) {
    const dueRatio = params.totalVendorDue / params.totalPurchases30Days;
    if (dueRatio > 0.8) {
      vendorDueScore = 5;
      reasons.push('High vendor dues relative to monthly purchase turnover');
    } else if (dueRatio > 0.5) {
      vendorDueScore = 10;
    }
  }

  // 4. Wastage Ratio (Max 15 pts)
  let wastageScore = 15;
  const turnover = params.totalIssuesValue30Days + params.totalWastageValue30Days;
  if (turnover > 0) {
    const wastageRatio = params.totalWastageValue30Days / turnover;
    if (wastageRatio > 0.08) {
      wastageScore = 3;
      reasons.push(`Critical wastage: ${(wastageRatio * 100).toFixed(1)}% of consumed stock is spoiled or expired`);
    } else if (wastageRatio > 0.03) {
      wastageScore = 9;
      reasons.push(`Elevated wastage at ${(wastageRatio * 100).toFixed(1)}%`);
    }
  }

  // 5. Variance Score (Max 10 pts)
  let varianceScore = 10;
  if (params.varianceIncidentsCount30Days >= 5) {
    varianceScore = 2;
    reasons.push(`${params.varianceIncidentsCount30Days} physical audit variances recorded this month`);
  } else if (params.varianceIncidentsCount30Days >= 2) {
    varianceScore = 6;
  }

  // 6. Emergency Issues Score (Max 10 pts)
  let emergencyScore = 10;
  if (params.emergencyIssuesCount7Days >= 5) {
    emergencyScore = 2;
    reasons.push(`${params.emergencyIssuesCount7Days} emergency requisitions in the last 7 days`);
  } else if (params.emergencyIssuesCount7Days >= 2) {
    emergencyScore = 6;
  }

  // 7. Price Hike Guard (Max 5 pts)
  let priceHikeScore = 5;
  if (params.priceHikesCount30Days >= 3) {
    priceHikeScore = 2;
    reasons.push(`${params.priceHikesCount30Days} raw material price hikes detected recently`);
  }

  const finalScore = Math.max(
    0,
    Math.min(
      100,
      stockControlScore +
        excessStockScore +
        vendorDueScore +
        wastageScore +
        varianceScore +
        emergencyScore +
        priceHikeScore
    )
  );

  if (reasons.length === 0) {
    reasons.push('Healthy inventory turnover and controlled stock days');
  }

  return {
    score: finalScore,
    stockControlScore,
    excessStockScore,
    vendorDueScore,
    wastageScore,
    varianceScore,
    emergencyScore,
    priceHikeScore,
    reasons,
  };
}

/**
 * Where Did My Money Go:
 * Stock Consumed = Opening Stock + Purchases - Closing Stock
 */
export function calculateWhereDidMyMoneyGo(
  openingStockValue: number,
  purchasesValue: number,
  closingStockValue: number,
  departmentIssues: { departmentName: string; value: number }[],
  wastageValue: number
) {
  const stockConsumed = Math.max(0, openingStockValue + purchasesValue - closingStockValue);
  const totalRecordedOutflow = departmentIssues.reduce((sum, d) => sum + d.value, 0) + wastageValue;

  return {
    openingStockValue: Number(openingStockValue.toFixed(2)),
    purchasesValue: Number(purchasesValue.toFixed(2)),
    closingStockValue: Number(closingStockValue.toFixed(2)),
    stockConsumed: Number(stockConsumed.toFixed(2)),
    totalRecordedOutflow: Number(totalRecordedOutflow.toFixed(2)),
    departmentBreakdown: departmentIssues.map((dept) => ({
      name: dept.departmentName,
      value: Number(dept.value.toFixed(2)),
      percent: stockConsumed > 0 ? Number(((dept.value / stockConsumed) * 100).toFixed(1)) : 0,
    })),
    wastageValue: Number(wastageValue.toFixed(2)),
    wastagePercent: stockConsumed > 0 ? Number(((wastageValue / stockConsumed) * 100).toFixed(1)) : 0,
  };
}

/**
 * Derives accurate invoice payment metrics from purchase records
 */
export function getPurchasePaymentInfo(purchase: Purchase): {
  status: 'PAID' | 'PARTIALLY_PAID' | 'UNPAID';
  displayStatus: 'PAID' | 'PARTIALLY PAID' | 'UNPAID';
  paidAmount: number;
  remainingAmount: number;
  badgeVariant: 'success' | 'warning' | 'danger';
} {
  const netAmount = Math.max(0, Number(purchase.netAmount) || 0);
  let paidAmount = 0;

  if (purchase.paidAmount !== undefined && purchase.paidAmount !== null) {
    paidAmount = Math.max(0, Number(purchase.paidAmount) || 0);
  } else {
    const rawStatus = String(purchase.paymentStatus || '').toUpperCase();
    if (rawStatus === 'PAID') {
      paidAmount = netAmount;
    } else {
      paidAmount = 0;
    }
  }

  // Ensure paid does not exceed net for display calculations
  paidAmount = Math.min(paidAmount, netAmount);

  const remainingAmount =
    purchase.remainingAmount !== undefined && purchase.remainingAmount !== null
      ? Math.max(0, Number(purchase.remainingAmount) || 0)
      : Math.max(0, Number((netAmount - paidAmount).toFixed(2)));

  if (remainingAmount <= 0.01 && (paidAmount > 0 || netAmount === 0)) {
    return {
      status: 'PAID',
      displayStatus: 'PAID',
      paidAmount: netAmount,
      remainingAmount: 0,
      badgeVariant: 'success',
    };
  } else if (paidAmount > 0.01) {
    return {
      status: 'PARTIALLY_PAID',
      displayStatus: 'PARTIALLY PAID',
      paidAmount: Number(paidAmount.toFixed(2)),
      remainingAmount: Number(remainingAmount.toFixed(2)),
      badgeVariant: 'warning',
    };
  } else {
    return {
      status: 'UNPAID',
      displayStatus: 'UNPAID',
      paidAmount: 0,
      remainingAmount: netAmount,
      badgeVariant: 'danger',
    };
  }
}

