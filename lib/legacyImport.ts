import { normalizeUnits } from '@/lib/migrations';
import type { ShoppingItem, ShoppingList, SortMode, CategoryId } from '@/types/shopping';
import type { Snapshot } from '@/lib/backup';
import { STORAGE_VERSION } from '@/lib/migrations';
import { toMilli } from '@/lib/units';
import type { PurchaseRecord } from '@/lib/purchase';

/**
 * Legacy (device / user_state JSON) -> relational model, as pure functions.
 * Three different versions exist and are never mixed:
 *  - schemaVersion: data format of the legacy snapshot (STORAGE_VERSION),
 *  - version: per row operation counter on the server (items, lists),
 *  - route_version: per list counter of the item order.
 */

export const CHUNK_ITEMS = 200;

export interface ImportSummary {
  lists: number;
  items: number;
  checked: number;
  priced: number;
  price_cents_sum: number;
  quantity_milli_sum: number;
  purchases: number;
  price_history: number;
  /** list legacy id -> item legacy ids in route order */
  sequence: Record<string, string[]>;
}

/** Items in route order with a unique position (stable: order, then original index). */
export const routeOrder = (items: ShoppingItem[]) =>
  items.map((it, idx) => ({ it, idx }))
    .sort((a, b) => (a.it.order - b.it.order) || (a.idx - b.idx))
    .map(x => x.it);

const ms = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Date.now());

export function buildPayload(snap: Snapshot) {
  const lists = snap.lists.map(l => ({
    legacy_id: l.id, name: l.name, emoji: l.emoji, budget_cents: l.budgetCents ?? null,
    sort_mode: l.sortMode ?? null, created_at_ms: ms(l.createdAt),
    ...(l.sourceListId ? { source_legacy_id: l.sourceListId } : {}),
  }));
  const items = snap.lists.flatMap(l => routeOrder(l.items).map((i, position) => ({
    legacy_id: i.id, list_legacy_id: l.id, name: i.name, category: i.category ?? null, note: i.note ?? null,
    quantity: i.quantity, unit: i.unit ?? 'un', pack_size: i.packSize ?? null, pack_unit: i.packUnit ?? null,
    price_cents: i.priceCents ?? null, price_basis: i.priceBasis ?? 'un', price_estimated: i.priceEstimated === true,
    control_portion: i.controlPortion ?? null, presentation: i.presentation ?? null,
    position, purchased: i.purchased, created_at_ms: ms(i.createdAt),
  })));
  const purchases = (snap.purchases ?? []).map(p => ({
    legacy_id: p.id, list_legacy_id: p.listId, purchased_on: p.purchasedOn, snapshot: p,
  }));
  const price_history = Object.entries(snap.priceHistory ?? {}).flatMap(([key, months]) =>
    Object.entries(months ?? {}).map(([month, cents]) => ({ key, month, cents })));
  return { lists, items, purchases, price_history };
}

export type ImportPayload = ReturnType<typeof buildPayload>;

/** Ordered batches: lists first, then items, purchases and legacy price history. Each batch is safe to resend. */
export function buildChunks(p: ImportPayload, size = CHUNK_ITEMS): Partial<ImportPayload>[] {
  const out: Partial<ImportPayload>[] = [{ lists: p.lists }];
  for (let i = 0; i < p.items.length; i += size) out.push({ items: p.items.slice(i, i + size) });
  if (p.purchases.length) out.push({ purchases: p.purchases });
  for (let i = 0; i < p.price_history.length; i += size) out.push({ price_history: p.price_history.slice(i, i + size) });
  return out;
}

export function summarize(snap: Snapshot): ImportSummary {
  const items = snap.lists.flatMap(l => l.items);
  return {
    lists: snap.lists.length,
    items: items.length,
    checked: items.filter(i => i.purchased).length,
    priced: items.filter(i => i.priceCents !== undefined).length,
    price_cents_sum: items.reduce((s, i) => s + (i.priceCents ?? 0), 0),
    quantity_milli_sum: items.reduce((s, i) => s + toMilli(i.quantity), 0),
    purchases: (snap.purchases ?? []).length,
    price_history: Object.values(snap.priceHistory ?? {}).reduce((s, m) => s + Object.keys(m ?? {}).length, 0),
    sequence: Object.fromEntries(snap.lists.map(l => [l.id, routeOrder(l.items).map(i => i.id)])),
  };
}

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(v ?? null);

/** FNV-1a 64-bit of the canonical payload: same data, same import record. */
export function checksum(p: ImportPayload): string {
  let h = 0xcbf29ce484222325n;
  for (const ch of stable({ ...p, schemaVersion: STORAGE_VERSION })) {
    h ^= BigInt(ch.codePointAt(0)!);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/** Before/after comparison shown to the user. Empty array = identical. */
export function compareSummaries(before: ImportSummary, after: ImportSummary): string[] {
  const diffs: string[] = [];
  const labels: [keyof ImportSummary, string][] = [
    ['lists', 'listas'], ['items', 'itens'], ['checked', 'itens no carrinho'], ['priced', 'itens com preço'],
    ['price_cents_sum', 'soma dos preços'], ['quantity_milli_sum', 'soma das quantidades'],
    ['purchases', 'compras concluídas'], ['price_history', 'histórico de preços'],
  ];
  for (const [k, label] of labels) if (before[k] !== after[k]) diffs.push(`${label}: ${before[k]} antes, ${after[k]} depois`);
  for (const [id, seq] of Object.entries(before.sequence)) {
    if (JSON.stringify(seq) !== JSON.stringify(after.sequence[id] ?? null)) diffs.push('ordem dos itens diferente');
  }
  return [...new Set(diffs)];
}

/** Server id map of one import batch, separated by entity kind so list, item and purchase ids never collide. */
export interface BatchMap { list: Map<string, string>; item: Map<string, string>; purchase: Map<string, string> }

export const emptyBatchMap = (): BatchMap => ({ list: new Map(), item: new Map(), purchase: new Map() });

/** Keeps only the map rows of the entities present in this payload (the batch manifest). */
export function batchMapFor(p: ImportPayload, rows: { kind: string; legacy_id: string; new_id: string }[]): BatchMap {
  const want = { list: new Set(p.lists.map(l => l.legacy_id)), item: new Set(p.items.map(i => i.legacy_id)), purchase: new Set(p.purchases.map(x => x.legacy_id)) };
  const out = emptyBatchMap();
  for (const r of rows) {
    const k = r.kind as keyof BatchMap;
    if (k in want && want[k].has(r.legacy_id)) out[k].set(r.legacy_id, r.new_id);
  }
  return out;
}

/** Applies the server id map so the device summary can be compared with the relational one. */
export function remapSummary(s: ImportSummary, map: BatchMap): ImportSummary {
  return { ...s, sequence: Object.fromEntries(Object.entries(s.sequence).map(([l, ids]) =>
    [map.list.get(l) ?? l, ids.map(i => map.item.get(i) ?? i)])) };
}

/**
 * Restricts the relational snapshot to the records of this import batch. Shared lists of other owners and own
 * lists outside the batch are not migration data; a batch record missing or changed is still a divergence.
 */
export function scopeToBatch(snap: Snapshot, map: BatchMap): Snapshot {
  const lists = new Set(map.list.values());
  return {
    ...snap,
    lists: snap.lists.filter(l => lists.has(l.id)),
    purchases: (snap.purchases ?? []).filter(p => map.purchase.has(p.id)),
  };
}

// ---------- relational rows -> app snapshot ----------
export interface ListRow {
  id: string; name: string; emoji: string; budget_cents: number | null; sort_mode: string | null;
  source_list_id: string | null; legacy_created_at: string | null; created_at: string; status: string;
  route_version: number;
  /** Confirmed by the server; decides ownership. */
  owner_id: string;
}
export interface ItemRow {
  id: string; list_id: string; name: string; category: string | null; note: string | null; quantity: number | string;
  unit: string; pack_size: number | string | null; pack_unit: string | null; price_cents: number | null;
  price_basis: string; price_estimated: boolean; control_portion: number | string | null; position: number;
  presentation?: string | null;
  purchased: boolean; added_by: string | null; marked_by?: string | null; marked_at?: string | null; legacy_created_at: string | null; created_at: string; version: number;
}
export interface PurchaseRow { id: string; snapshot: unknown }
export interface HistoryRow { item_key: string; month: string; cents: number }

/** Server rows may still carry legacy units: simplify on read, exactly like local data. */
const withSimpleUnits = (i: ShoppingItem): ShoppingItem => ({ ...i, ...normalizeUnits(i) });
const num = (v: number | string | null) => (v === null || v === undefined ? undefined : Number(v));
const time = (a: string | null, b: string) => new Date(a ?? b).getTime();

export function rowsToSnapshot(
  lists: ListRow[], items: ItemRow[], purchases: PurchaseRow[], history: HistoryRow[], activeListId: string | null,
): Snapshot {
  const visible = lists.filter(l => l.status === 'active')
    .sort((a, b) => time(a.legacy_created_at, a.created_at) - time(b.legacy_created_at, b.created_at));
  const out: ShoppingList[] = visible.map(l => ({
    id: l.id, name: l.name, emoji: l.emoji,
    createdAt: time(l.legacy_created_at, l.created_at),
    budgetCents: l.budget_cents ?? undefined,
    sortMode: (l.sort_mode as SortMode) ?? undefined,
    sourceListId: l.source_list_id ?? undefined,
    routeVersion: l.route_version,
    ownerId: l.owner_id,
    items: items.filter(i => i.list_id === l.id).sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
      .map((i): ShoppingItem => withSimpleUnits({
        id: i.id, presentation: i.presentation ?? undefined, name: i.name, quantity: Number(i.quantity), unit: i.unit as ShoppingItem['unit'],
        packSize: num(i.pack_size), packUnit: (i.pack_unit ?? undefined) as ShoppingItem['packUnit'],
        priceCents: i.price_cents ?? undefined, priceBasis: i.price_basis as ShoppingItem['priceBasis'],
        priceEstimated: i.price_estimated || undefined, controlPortion: num(i.control_portion),
        addedBy: i.added_by ?? undefined, markedBy: i.marked_by ?? undefined, markedAt: i.marked_at ? new Date(i.marked_at).getTime() : undefined,
        category: (i.category ?? undefined) as CategoryId | undefined, note: i.note ?? undefined,
        purchased: i.purchased, createdAt: time(i.legacy_created_at, i.created_at), order: i.position,
      })),
  }));
  const priceHistory: Snapshot['priceHistory'] = {};
  for (const h of history) (priceHistory[h.item_key] ??= {})[h.month] = h.cents;
  return {
    lists: out,
    activeListId: activeListId && out.some(l => l.id === activeListId) ? activeListId : out[0]?.id ?? null,
    priceHistory,
    purchases: purchases.map(p => p.snapshot as PurchaseRecord).filter(p => p && typeof p.id === 'string'),
    version: STORAGE_VERSION,
  };
}
