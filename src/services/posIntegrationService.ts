import { POSSaleRecord, RecipeBOM, Issue, Item } from '../types';

export interface PosWebhookPayload {
  orderId: string;
  timestamp: string;
  items: {
    posItemId: string;
    name: string;
    quantity: number;
    department?: string;
  }[];
}

export interface PosIntegrationConfig {
  provider: 'Petpooja' | 'eZee' | 'CustomWebhook' | null;
  status: 'disconnected' | 'connected' | 'error';
  apiKey?: string;
  webhookUrl?: string;
  lastSyncedAt?: string;
}

export class PosIntegrationService {
  private static isConfigured = false;

  static getStatus(): { isConfigured: boolean; message: string; provider?: string } {
    if (!this.isConfigured) {
      return {
        isConfigured: false,
        message:
          'POS integration not configured. Connect your Petpooja or eZee API key to stream live sales into consumption analysis.',
      };
    }
    return {
      isConfigured: true,
      message: 'POS integration active.',
      provider: 'Petpooja',
    };
  }

  static getWebhookEndpoint(restaurantId: string): string {
    return `/api/pos/webhook/${restaurantId}`;
  }
}

export interface TheoreticalConsumptionItem {
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
}

export interface TheoreticalVarianceItem {
  itemId: string;
  itemName: string;
  unit: string;
  theoreticalQty: number;
  actualIssuedQty: number;
  varianceQty: number;
  varianceValue: number;
}

/**
 * Calculates theoretical raw ingredient usage based on POS sales records and Recipe BOMs.
 */
export function calculateTheoreticalConsumption(
  sales: POSSaleRecord[],
  recipes: RecipeBOM[]
): TheoreticalConsumptionItem[] {
  const usageMap: { [itemId: string]: TheoreticalConsumptionItem } = {};

  sales.forEach((sale) => {
    // Match recipe by item name or code
    const matchedRecipe = recipes.find(
      (r) =>
        r.posItemName.toLowerCase() === sale.posItemName.toLowerCase() ||
        (r.posItemCode && sale.billNumber && r.posItemCode === sale.billNumber)
    );

    if (matchedRecipe && matchedRecipe.ingredients) {
      matchedRecipe.ingredients.forEach((ing) => {
        const neededQty = (Number(sale.quantity) || 0) * (Number(ing.quantity) || 0);
        if (!usageMap[ing.itemId]) {
          usageMap[ing.itemId] = {
            itemId: ing.itemId,
            itemName: ing.itemName,
            unit: ing.unit,
            quantity: 0,
          };
        }
        usageMap[ing.itemId].quantity += neededQty;
      });
    }
  });

  return Object.values(usageMap);
}

/**
 * Compares theoretical requirement against actual store issues to detect kitchen shrinkage/leakage.
 */
export function calculateTheoreticalVsActualVariance(
  theoreticalUsage: TheoreticalConsumptionItem[],
  issues: Issue[],
  items: Item[]
): TheoreticalVarianceItem[] {
  // Aggregate actual issues by itemId
  const actualUsageMap: { [itemId: string]: number } = {};
  issues.forEach((iss) => {
    actualUsageMap[iss.itemId] = (actualUsageMap[iss.itemId] || 0) + (Number(iss.quantity) || 0);
  });

  // Calculate variances for items that have either theoretical usage or actual issue
  const allItemIds = new Set<string>([
    ...theoreticalUsage.map((t) => t.itemId),
    ...Object.keys(actualUsageMap),
  ]);

  const results: TheoreticalVarianceItem[] = [];

  allItemIds.forEach((itemId) => {
    const theoItem = theoreticalUsage.find((t) => t.itemId === itemId);
    const itemObj = items.find((i) => i.id === itemId);
    const itemName = theoItem?.itemName || itemObj?.name || 'Raw Material';
    const unit = theoItem?.unit || itemObj?.unit || 'Kg';
    const theoreticalQty = Number((theoItem?.quantity || 0).toFixed(2));
    const actualIssuedQty = Number((actualUsageMap[itemId] || 0).toFixed(2));
    const varianceQty = Number((theoreticalQty - actualIssuedQty).toFixed(2));

    const rate = itemObj?.averageStockRate || itemObj?.lastPurchaseRate || 0;
    const varianceValue = Number((varianceQty * rate).toFixed(2));

    results.push({
      itemId,
      itemName,
      unit,
      theoreticalQty,
      actualIssuedQty,
      varianceQty,
      varianceValue,
    });
  });

  return results;
}
