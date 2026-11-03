import { normalizeUnits } from '@/lib/migrations';
import type { Snapshot } from '@/lib/backup';
import type { ShoppingItem, ShoppingList } from '@/types/shopping';
import type { PurchaseRecord } from '@/lib/purchase';
import { routeOrder } from '@/lib/legacyImport';

/**
 * Device operations for the relational model, as pure functions.
 * An operation is created together with the local change, kept in the outbox until the server confirms it,
 * and replayed over the confirmed server state so a remote snapshot never wipes unsent edits.
 */
export type OpKind =
  | 'list_create' | 'list_update' | 'list_archive'
  | 'item_create' | 'item_update' | 'item_delete' | 'item_mark'
  | 'reorder' | 'purchase_save' | 'list_leave';
export type OpState = 'pending' | 'conflict' | 'denied';

export interface Op {
  id: string;            // operation UUID, also the server dedupe key
  userId: string;        // session that created it; never sent as identity
  listId: string;
  entity: 'list' | 'item' | 'purchase';
  entityId: string;
  kind: OpKind;
  payload: Record<string, unknown>;
  baseVersion: number | null; // server version known when the op was created
  state: OpState;
  attempts: number;
  nextAt: number;
  createdAt: number;
  seq: number;           // strict order inside the outbox
  error?: string;
}

export const itemPayload = (i: ShoppingItem) => ({
  name: i.name, category: i.category ?? null, note: i.note ?? null, quantity: i.quantity, unit: i.unit ?? 'un',
  pack_size: i.packSize ?? null, pack_unit: i.packUnit ?? null, price_cents: i.priceCents ?? null,
  price_basis: i.priceBasis ?? 'un', price_estimated: i.priceEstimated === true, control_portion: i.controlPortion ?? null,
  presentation: i.presentation ?? null,
});
export const listPayload = (l: ShoppingList) => ({
  name: l.name.slice(0, 120) || 'Lista', emoji: l.emoji, budget_cents: l.budgetCents ?? null,
  sort_mode: l.sortMode ?? null, source_list_id: l.sourceListId ?? null,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const sequenceOf = (l: ShoppingList) => routeOrder(l.items).map(i => i.id);

type Versions = { item: (id: string) => number | null; list: (id: string) => number | null };

/** Operations that turn `prev` into `next`. Order: lists, item data, marks, route, archive, purchases. */
export function diffToOps(prev: Snapshot, next: Snapshot, userId: string, v: Versions, now = Date.now(), firstSeq = 0): Op[] {
  const ops: Op[] = [];
  let seq = firstSeq;
  const op = (kind: OpKind, listId: string, entity: Op['entity'], entityId: string, payload: Record<string, unknown>, base: number | null) =>
    ops.push({ id: crypto.randomUUID(), userId, listId, entity, entityId, kind, payload, baseVersion: base, state: 'pending', attempts: 0, nextAt: 0, createdAt: now, seq: seq++ });
  const prevLists = new Map(prev.lists.map(l => [l.id, l]));
  const nextIds = new Set(next.lists.map(l => l.id));
  for (const l of next.lists) {
    const old = prevLists.get(l.id);
    if (l.role === 'viewer' as string || l.role === 'unknown') continue; // unconfirmed authorization: nothing is sent
    if (l.role === 'checker') {
      // "Apenas marcar": only explicit mark states leave the device; any other local change is dropped by the next refresh
      const oldItems = new Map((old?.items ?? []).map(i => [i.id, i]));
      for (const i of l.items) {
        const o = oldItems.get(i.id);
        if (o && o.purchased !== i.purchased) op('item_mark', l.id, 'item', i.id, { marked: i.purchased }, v.item(i.id));
      }
      continue;
    }
    if (!old) op('list_create', l.id, 'list', l.id, listPayload(l), null);
    else if ((l.role ?? 'owner') === 'owner' && !same(listPayload(old), listPayload(l))) op('list_update', l.id, 'list', l.id, listPayload(l), v.list(l.id));
    const oldItems = new Map((old?.items ?? []).map(i => [i.id, i]));
    const ids = new Set(l.items.map(i => i.id));
    for (const i of l.items) {
      const o = oldItems.get(i.id);
      if (!o) op('item_create', l.id, 'item', i.id, itemPayload(i), null);
      else if (!same(itemPayload(o), itemPayload(i))) op('item_update', l.id, 'item', i.id, itemPayload(i), v.item(i.id));
      if ((o?.purchased ?? false) !== i.purchased) op('item_mark', l.id, 'item', i.id, { marked: i.purchased }, v.item(i.id));
    }
    for (const o of old?.items ?? []) if (!ids.has(o.id)) op('item_delete', l.id, 'item', o.id, {}, null);
    if (l.items.length && (!old || !same(sequenceOf(old), sequenceOf(l)))) op('reorder', l.id, 'list', l.id, { ids: sequenceOf(l) }, null);
  }
  // removing a list I do not own means leaving it, never archiving it for everyone
  // explicit intents: archive only my own list, leave only a list I was invited to; unknown role sends nothing destructive
  for (const old of prev.lists) if (!nextIds.has(old.id)) {
    const r = old.role;
    if (r === undefined || r === 'owner') op('list_archive', old.id, 'list', old.id, {}, null);
    else if (r === 'editor' || r === 'checker') op('list_leave', old.id, 'list', old.id, {}, null);
  }
  const known = new Set((prev.purchases ?? []).map(p => p.id));
  for (const p of next.purchases ?? []) if (!known.has(p.id)) op('purchase_save', p.listId, 'purchase', p.id, { record: p }, null);
  return ops;
}

const simple = (i: ShoppingItem): ShoppingItem => ({ ...i, ...normalizeUnits(i) });
const toItem = (id: string, p: Record<string, unknown>, order: number): ShoppingItem => simple({
  id, name: String(p.name), presentation: (p.presentation ?? undefined) as string | undefined, quantity: Number(p.quantity ?? 1),
  unit: (p.unit ?? undefined) as ShoppingItem['unit'], packSize: (p.pack_size ?? undefined) as number | undefined,
  packUnit: (p.pack_unit ?? undefined) as ShoppingItem['packUnit'], priceCents: (p.price_cents ?? undefined) as number | undefined,
  priceBasis: (p.price_basis ?? undefined) as ShoppingItem['priceBasis'], priceEstimated: p.price_estimated ? true : undefined,
  controlPortion: (p.control_portion ?? undefined) as number | undefined,
  category: (p.category ?? undefined) as ShoppingItem['category'], note: (p.note ?? undefined) as string | undefined,
  purchased: false, createdAt: Date.now(), order,
});

/**
 * Replays operations over a snapshot (confirmed server state + pending local ops = what the user sees).
 * `tombstones` are ids deleted on the server: they never come back.
 */
export function applyOps(base: Snapshot, ops: Op[], tombstones: Set<string> = new Set()): Snapshot {
  let lists = base.lists.map(l => ({ ...l, items: [...l.items] }));
  let purchases: PurchaseRecord[] = [...(base.purchases ?? [])];
  const byId = (id: string) => lists.find(l => l.id === id);
  for (const o of [...ops].sort((a, b) => a.seq - b.seq)) {
    if (o.state === 'denied') continue;
    const l = byId(o.listId);
    const p = o.payload;
    switch (o.kind) {
      case 'list_create':
        if (!l) lists.push({ id: o.listId, name: String(p.name), emoji: String(p.emoji ?? '🛒'), createdAt: o.createdAt,
          budgetCents: (p.budget_cents ?? undefined) as number | undefined, sortMode: (p.sort_mode ?? undefined) as ShoppingList['sortMode'],
          sourceListId: (p.source_list_id ?? undefined) as string | undefined, items: [] });
        break;
      case 'list_update':
        if (l) Object.assign(l, { name: p.name, emoji: p.emoji, budgetCents: p.budget_cents ?? undefined, sortMode: p.sort_mode ?? undefined });
        break;
      case 'list_archive':
      case 'list_leave':
        lists = lists.filter(x => x.id !== o.listId);
        break;
      case 'item_create':
        if (l && !tombstones.has(o.entityId) && !l.items.some(i => i.id === o.entityId)) l.items.push(toItem(o.entityId, p, l.items.length));
        break;
      case 'item_update':
        if (l) l.items = l.items.map(i => (i.id === o.entityId ? { ...toItem(i.id, p, i.order), purchased: i.purchased, markedBy: i.markedBy, markedAt: i.markedAt, createdAt: i.createdAt, addedBy: i.addedBy } : i));
        break;
      case 'item_mark':
        if (l) l.items = l.items.map(i => (i.id === o.entityId ? (p.marked ? { ...i, purchased: true, markedBy: i.purchased ? i.markedBy : o.userId, markedAt: i.purchased ? i.markedAt : o.createdAt } : { ...i, purchased: false, markedBy: undefined, markedAt: undefined }) : i));
        break;
      case 'item_delete':
        if (l) l.items = l.items.filter(i => i.id !== o.entityId);
        break;
      case 'reorder':
        if (l) {
          const pos = new Map((p.ids as string[]).map((id, n) => [id, n]));
          l.items = l.items.map(i => ({ ...i, order: pos.get(i.id) ?? pos.size + i.order }));
        }
        break;
      case 'purchase_save':
        if (!purchases.some(x => x.id === o.entityId)) purchases = [...purchases, p.record as PurchaseRecord];
        break;
    }
  }
  return { ...base, lists, purchases };
}

export type SendFailure = 'network' | 'denied' | 'conflict' | 'route_stale' | 'invalid';

/** Network vs revoked permission vs anything else. navigator.onLine alone proves nothing. */
export function classifyError(e: unknown): 'network' | 'denied' | 'invalid' {
  const err = e as { code?: string; message?: string; status?: number } | null;
  const msg = String(err?.message ?? e ?? '');
  if (err?.code === '42501' || /forbidden|not_authenticated|permission denied|JWT/i.test(msg) || err?.status === 401 || err?.status === 403) return 'denied';
  if (e instanceof TypeError || /Failed to fetch|NetworkError|network|timeout|Load failed/i.test(msg) || err?.status === 0 || (err?.status ?? 0) >= 500) return 'network';
  return 'invalid';
}

/** 1s, 2s, 4s ... capped at 5 minutes, with up to 20% jitter. */
export const backoffMs = (attempts: number, rnd = Math.random()) =>
  Math.min(300_000, 1000 * 2 ** Math.min(attempts, 9)) * (1 + 0.2 * rnd);
