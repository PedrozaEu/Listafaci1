import type { ShoppingItem, ShoppingList } from '@/types/shopping';

type Seq = Pick<ShoppingItem, 'id' | 'order' | 'createdAt'>;

/** Route order: explicit position, then newest first, then id. Never mutates. */
export function compareRoute(a: Seq, b: Seq): number {
  if (a.order !== b.order) return a.order - b.order;
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function routeSequence<T extends Seq>(items: readonly T[]): T[] {
  return [...items].sort(compareRoute);
}

/** Inverts the full sequence (purchased included) and assigns explicit positions 0..n-1.
 * Only `order` changes; ids, dates, quantities, prices, categories and marks are kept. */
export function invertRoute<T extends Seq>(items: readonly T[]): T[] {
  const seq = routeSequence(items);
  const pos = new Map<string, number>();
  seq.forEach((it, idx) => pos.set(it.id, seq.length - 1 - idx));
  return items.map(it => ({ ...it, order: pos.get(it.id)! }));
}

export type OrderSnapshot = Record<string, number>;

export const orderSnapshot = (items: readonly Seq[]): OrderSnapshot =>
  Object.fromEntries(items.map(i => [i.id, i.order]));

/** Undo is allowed only when the current orders are exactly the post-inversion ones
 * (no item added, removed or moved since). */
export function canUndoInversion(items: readonly Seq[], after: OrderSnapshot): boolean {
  if (items.length !== Object.keys(after).length) return false;
  return items.every(i => after[i.id] === i.order);
}

/** Restores only positions; any other later edit (name, price, mark) is kept. */
export function applyOrders<T extends Seq>(items: readonly T[], snap: OrderSnapshot): T[] {
  return items.map(i => (i.id in snap ? { ...i, order: snap[i.id] } : i));
}

export interface NextListOptions {
  name: string;
  invert: boolean;
  keepBudget: boolean;
  usePrices: boolean;
}

/** Builds a new list from a source list. The source is never modified. */
export function buildNextList(
  source: ShoppingList,
  opts: NextListOptions,
  deps: { newId: () => string; now: number },
): ShoppingList {
  const base = opts.invert ? invertRoute(source.items) : source.items;
  const seq = routeSequence(base);
  const items: ShoppingItem[] = seq.map((it, idx) => ({
    id: deps.newId(),
    name: it.name,
    quantity: it.quantity,
    unit: it.unit,
    presentation: it.presentation,
    unitMigration: it.unitMigration,
    packSize: it.packSize,
    packUnit: it.packUnit,
    priceBasis: it.priceBasis,
    controlPortion: it.controlPortion,
    priceCents: opts.usePrices ? it.priceCents : undefined,
    // reused prices are estimates until confirmed
    priceEstimated: opts.usePrices && it.priceCents != null ? true : undefined,
    category: it.category,
    note: it.note,
    purchased: false,
    createdAt: deps.now,
    order: idx,
  }));
  return {
    id: deps.newId(),
    name: opts.name.trim() || `${source.name} (próxima)`,
    emoji: source.emoji,
    createdAt: deps.now,
    budgetCents: opts.keepBudget ? source.budgetCents : undefined,
    items,
    sortMode: 'custom',
    sourceListId: source.id,
  };
}
