import { Item } from '../types';

/**
 * Checks whether an inventory item is active and eligible for Inward Purchase selection.
 * Inactive items are strictly excluded unless explicitly marked active (or legacy items with no status field).
 */
export function isActiveInventoryItem(item: Pick<Item, 'id' | 'status'> | null | undefined): boolean {
  if (!item || !item.id) return false;
  const normalizedStatus = String(item.status ?? 'active').trim().toLowerCase();
  return normalizedStatus !== 'inactive';
}

/**
 * Returns a deduplicated, alphabetically sorted list of ALL active inventory items
 * across every category in the restaurant's complete inventory.
 */
export function getAllActiveInventoryItems(items: Item[]): Item[] {
  const seenIds = new Set<string>();
  const activeUnique: Item[] = [];

  for (const item of items) {
    if (!isActiveInventoryItem(item)) continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    activeUnique.push(item);
  }

  return activeUnique.sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
  );
}

/**
 * Formats an inward purchase item search option cleanly as "Item Name (UOM)",
 * e.g. "Rice (KG)", "Oil (LTR)", "Onion (KG)", "Paper Napkin (PKT)".
 */
export function formatInwardItemOptionLabel(item: Pick<Item, 'name' | 'unit'>): string {
  const name = (item.name || '').trim() || 'Unnamed Item';
  const unit = (item.unit || '').trim();
  return unit ? `${name} (${unit})` : name;
}

/**
 * Case-insensitive, partial-match search across the ENTIRE active inventory list.
 * Supports single-word and multi-word partial queries (e.g. "ric", "RICE", "paper nap", "napkin")
 * without limiting results to the first N items or a single category.
 */
export function searchActiveInventoryItems(items: Item[], rawQuery: string): Item[] {
  const activeUnique = getAllActiveInventoryItems(items);
  const query = rawQuery.trim().toLowerCase();

  if (!query) {
    return activeUnique;
  }

  const tokens = query.split(/\s+/).filter(Boolean);

  const scored: { item: Item; rank: number; nameLower: string }[] = [];

  for (const item of activeUnique) {
    const nameLower = (item.name || '').trim().toLowerCase();
    if (!nameLower) continue;

    // Every typed partial token must appear in the item name (case-insensitive)
    let matchesAll = true;
    for (const token of tokens) {
      if (!nameLower.includes(token)) {
        matchesAll = false;
        break;
      }
    }
    if (!matchesAll) continue;

    let rank = 3;
    if (nameLower === query) {
      rank = 0; // Exact match
    } else if (nameLower.startsWith(query)) {
      rank = 1; // Prefix match
    } else if (
      nameLower
        .split(/[\s\-_/()]+/)
        .some((word) => word.startsWith(tokens[0]))
    ) {
      rank = 2; // Word-boundary match
    }

    scored.push({ item, rank, nameLower });
  }

  scored.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.nameLower.localeCompare(b.nameLower);
  });

  return scored.map((entry) => entry.item);
}
