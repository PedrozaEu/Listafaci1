import type { CategoryId, ShoppingList } from '@/types/shopping';
import { routeSequence } from '@/lib/route';
import { defaultBasis, lineResult, type PackUnit, type PriceBasis, type Unit } from '@/lib/units';

export type PriceStatus = 'confirmed' | 'estimated' | 'missing' | 'incompatible';

/** Copy of one bought line. Nothing here points back to live list data. */
export interface PurchaseLine {
  itemId: string;
  name: string;
  category?: CategoryId;
  unit: Unit;
  quantity: number;
  packSize?: number;
  packUnit?: PackUnit;
  /** Informative text copied as it was at purchase time. */
  presentation?: string;
  priceCents?: number;
  priceBasis: PriceBasis;
  priceStatus: PriceStatus;
  /** null when the price is missing or incompatible: never treated as free. */
  lineCents: number | null;
  order: number;
  controlPortion?: number;
  /** Only when the item had an author; legacy items stay without one. */
  author?: string;
}

/** Immutable record of a finished purchase. Source for the future PDF report. */
export interface PurchaseRecord {
  id: string;
  format: 1;
  listId: string;
  listName: string;
  /** Date the user chose for the purchase (YYYY-MM-DD). */
  purchasedOn: string;
  completedAt: number;
  lines: PurchaseLine[];
  confirmedCents: number;
  estimatedCents: number;
  missingCount: number;
  estimatedCount: number;
  /** true only when every line has a confirmed, compatible price: then the total is the amount paid. */
  complete: boolean;
}

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o as object).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

export interface BuildPurchaseInput {
  id: string;
  purchasedOn: string;
  now: number;
  /** Items whose reused (estimated) price the user explicitly confirmed. */
  confirmedIds: ReadonlySet<string>;
}

/** Builds the record from the checked items only; pending items never enter as bought. */
export function buildPurchaseRecord(list: ShoppingList, input: BuildPurchaseInput): PurchaseRecord {
  const bought = routeSequence(list.items.filter(i => i.purchased));
  let confirmedCents = 0;
  let estimatedCents = 0;
  let missingCount = 0;
  let estimatedCount = 0;
  const lines: PurchaseLine[] = bought.map((i, idx) => {
    const r = lineResult(i);
    let priceStatus: PriceStatus;
    if (r.ok === false) {
      priceStatus = r.reason;
      missingCount++;
    } else if (i.priceEstimated && !input.confirmedIds.has(i.id)) {
      priceStatus = 'estimated';
      estimatedCount++;
      estimatedCents += r.cents;
    } else {
      priceStatus = 'confirmed';
      confirmedCents += r.cents;
    }
    const line: PurchaseLine = {
      itemId: i.id,
      name: i.name,
      unit: i.unit ?? 'un',
      quantity: i.quantity,
      priceBasis: i.priceBasis ?? defaultBasis(i.unit ?? 'un'),
      priceStatus,
      lineCents: r.ok ? r.cents : null,
      order: idx,
    };
    if (i.category) line.category = i.category;
    if (i.packSize != null) line.packSize = i.packSize;
    if (i.packUnit) line.packUnit = i.packUnit;
    if (i.presentation) line.presentation = i.presentation;
    if (i.priceCents != null) line.priceCents = i.priceCents;
    if (i.controlPortion != null) line.controlPortion = i.controlPortion;
    if (i.addedBy) line.author = i.addedBy;
    return line;
  });
  return deepFreeze({
    id: input.id,
    format: 1,
    listId: list.id,
    listName: list.name,
    purchasedOn: input.purchasedOn,
    completedAt: input.now,
    lines,
    confirmedCents,
    estimatedCents,
    missingCount,
    estimatedCount,
    complete: lines.length > 0 && missingCount === 0 && estimatedCount === 0,
  });
}

/** Keeps only well-formed records (storage, cloud, backup). */
export function normalizePurchases(raw: unknown): PurchaseRecord[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return (raw as PurchaseRecord[]).filter(p => {
    if (!p || typeof p.id !== 'string' || !Array.isArray(p.lines) || seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

export const todayISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
