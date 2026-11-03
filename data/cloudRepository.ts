import { supabase } from '@/integrations/supabase/client';
import type { Snapshot } from '@/lib/backup';
import type { ShoppingItem, ShoppingList } from '@/types/shopping';
import {
  buildPayload, buildChunks, summarize, checksum, rowsToSnapshot, routeOrder, batchMapFor,
  type ImportSummary, type ListRow, type ItemRow, type PurchaseRow, type HistoryRow,
} from '@/lib/legacyImport';
import { STORAGE_VERSION } from '@/lib/migrations';
import { resolveListRole } from '@/types/shopping';

/**
 * Data access for the relational model. Components never call the backend directly:
 * they change the store, and the sync hook hands the before/after snapshots to this repository.
 */

// The generated types lag behind RPC signatures; calls are narrowed here, in one place.
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>)(fn, args);
const from = (t: string) => (supabase.from as unknown as (t: string) => ReturnType<typeof supabase.from>)(t as never);

/** Server versions the device last saw: operation version per item, route version per list. */
export interface RemoteMeta {
  routeVersion: Map<string, number>;
  itemVersion: Map<string, number>;
}
export const emptyMeta = (): RemoteMeta => ({ routeVersion: new Map(), itemVersion: new Map() });

export type WriteResult = 'ok' | 'route_stale' | 'error';

export async function activeImport(uid: string): Promise<{ id: string; state: string } | null> {
  const { data, error } = await from('legacy_imports').select('id, state')
    .eq('owner_id', uid).in('state', ['active']).order('updated_at', { ascending: false }).limit(1);
  if (error) throw error;
  return (data as { id: string; state: string }[])[0] ?? null;
}

export async function loadRelational(uid: string, activeListId: string | null) {
  const [l, i, p, h, mb] = await Promise.all([
    from('shared_lists').select('*'), // RLS: lists I own or was invited to
    from('list_items').select('*').is('deleted_at', null),
    from('shared_purchases').select('id, snapshot, list_id'),
    from('legacy_price_history').select('item_key, month, cents'),
    from('list_members').select('list_id, user_id, role, display_name, color, status'),
  ]);
  const err = l.error || i.error || p.error || h.error || mb.error;
  if (err) throw err;
  const lists = l.data as unknown as ListRow[];
  const own = new Set(lists.map(x => x.id));
  const items = (i.data as unknown as ItemRow[]).filter(x => own.has(x.list_id));
  const meta = emptyMeta();
  lists.forEach(x => meta.routeVersion.set(x.id, x.route_version));
  items.forEach(x => meta.itemVersion.set(x.id, x.version));
  // Shared lists never feed personal history: only purchases of lists I own (server RLS also hides others' history).
  const mine = new Set(lists.filter(x => x.owner_id === uid).map(x => x.id));
  const purchases = (p.data as unknown as (PurchaseRow & { list_id: string })[]).filter(x => mine.has(x.list_id));
  const snap = rowsToSnapshot(lists, items, purchases, h.data as unknown as HistoryRow[], activeListId);
  const members = mb.data as unknown as { list_id: string; user_id: string; role: 'owner' | 'editor' | 'checker' | 'viewer'; display_name: string; color: string; status: 'active' | 'review' }[];
  snap.lists = snap.lists.map(x => {
    const ms = members.filter(m => m.list_id === x.id).map(m => ({ userId: m.user_id, name: m.display_name, color: m.color, role: m.role, status: m.status }));
    // ownership comes from the server row's owner_id (kept by rowsToSnapshot), never from names or order
    const role = resolveListRole(x.ownerId, uid, ms.find(m => m.userId === uid));
    return { ...x, role, members: ms };
  });
  return { snap, meta };
}

export interface ImportProgress { done: number; total: number }

/** Idempotent, resumable import. Returns the server verdict and the legacy id -> new id map. */
export async function importLegacy(snap: Snapshot, source: 'account' | 'guest' | 'legacy-stash',
  onProgress?: (p: ImportProgress) => void) {
  const payload = buildPayload(snap);
  const expected: ImportSummary = summarize(snap);
  const begin = await rpc('begin_legacy_import', {
    _source: source, _checksum: checksum(payload), _schema_version: STORAGE_VERSION, _expected: expected,
  });
  if (begin.error) throw new Error(begin.error.message);
  const importId = (begin.data as { import_id: string }).import_id;
  const chunks = buildChunks(payload);
  for (let n = 0; n < chunks.length; n++) {
    const r = await rpc('import_legacy_chunk', { _import_id: importId, _payload: chunks[n] });
    if (r.error) throw new Error(r.error.message);
    onProgress?.({ done: n + 1, total: chunks.length });
  }
  const fin = await rpc('finalize_legacy_import', { _import_id: importId });
  if (fin.error) throw new Error(fin.error.message);
  // RLS limits rows to this account; the manifest of this payload limits them to this batch, per entity kind.
  const { data: rows, error } = await from('legacy_id_map').select('kind, legacy_id, new_id');
  if (error) throw error;
  const map = batchMapFor(payload, rows as { kind: string; legacy_id: string; new_id: string }[]);
  return { importId, expected, verdict: fin.data as { ok: boolean; state: string }, map };
}

export async function setImportState(importId: string, state: 'active' | 'rolled_back') {
  const r = await rpc('set_legacy_import_state', { _import_id: importId, _state: state });
  if (r.error) throw new Error(r.error.message);
}

// ---------- diff writer ----------
const itemFields = (i: ShoppingItem) => ({
  name: i.name, category: i.category ?? null, note: i.note ?? null, quantity: i.quantity, unit: i.unit ?? 'un',
  pack_size: i.packSize ?? null, pack_unit: i.packUnit ?? null, price_cents: i.priceCents ?? null,
  price_basis: i.priceBasis ?? 'un', price_estimated: i.priceEstimated === true, control_portion: i.controlPortion ?? null,
  presentation: i.presentation ?? null,
});
const listFields = (l: ShoppingList, ids: Set<string>) => ({
  name: l.name.slice(0, 120) || 'Lista', emoji: l.emoji, budget_cents: l.budgetCents ?? null, sort_mode: l.sortMode ?? null,
  source_list_id: l.sourceListId && ids.has(l.sourceListId) ? l.sourceListId : null,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const seq = (l: ShoppingList) => routeOrder(l.items).map(i => i.id);

/**
 * Sends the difference between the last synced snapshot and the current one.
 * Order: lists, item data, marks, then route; a stale route only rejects the reorder.
 */
export async function writeDiff(prev: Snapshot, next: Snapshot, meta: RemoteMeta): Promise<WriteResult> {
  const prevLists = new Map(prev.lists.map(l => [l.id, l]));
  const nextIds = new Set(next.lists.map(l => l.id));
  let routeStale = false;
  try {
    for (const l of next.lists) {
      const old = prevLists.get(l.id);
      if (!old) {
        const { error } = await from('shared_lists').insert({ id: l.id, ...listFields(l, nextIds) } as never);
        if (error) throw error;
        meta.routeVersion.set(l.id, 0);
      } else if (!same(listFields(old, nextIds), listFields(l, nextIds))) {
        const { error } = await from('shared_lists').update(listFields(l, nextIds) as never).eq('id', l.id);
        if (error) throw error;
      }
    }
    for (const old of prev.lists) if (!nextIds.has(old.id)) {
      const { error } = await from('shared_lists').update({ status: 'archived' } as never).eq('id', old.id);
      if (error) throw error;
    }
    for (const l of next.lists) {
      const old = prevLists.get(l.id);
      const oldItems = new Map((old?.items ?? []).map(i => [i.id, i]));
      const ids = new Set(l.items.map(i => i.id));
      for (const i of l.items) {
        const o = oldItems.get(i.id);
        if (!o) {
          const { data, error } = await from('list_items').insert({ id: i.id, list_id: l.id, ...itemFields(i) } as never).select('version').single();
          if (error) throw error;
          meta.itemVersion.set(i.id, (data as { version: number }).version);
        } else if (!same(itemFields(o), itemFields(i))) {
          const { data, error } = await from('list_items').update(itemFields(i) as never).eq('id', i.id).select('version').single();
          if (error) throw error;
          meta.itemVersion.set(i.id, (data as { version: number }).version);
        }
        if ((o?.purchased ?? false) !== i.purchased) {
          const r = await rpc('set_item_marked', {
            _operation_id: crypto.randomUUID(), _item_id: i.id, _expected_version: meta.itemVersion.get(i.id) ?? 1, _marked: i.purchased,
          });
          const res = r.data as { status: string; version?: number } | null;
          if (r.error || res?.status !== 'ok') throw new Error(r.error?.message ?? res?.status ?? 'mark_failed');
          if (res.version) meta.itemVersion.set(i.id, res.version);
        }
      }
      for (const o of old?.items ?? []) if (!ids.has(o.id)) {
        const { error } = await from('list_items').update({ deleted_at: new Date().toISOString() } as never).eq('id', o.id);
        if (error) throw error;
      }
      if (l.items.length && (!old || !same(seq(old), seq(l)))) {
        const r = await rpc('reorder_items', {
          _operation_id: crypto.randomUUID(), _list_id: l.id, _expected_route_version: meta.routeVersion.get(l.id) ?? 0, _item_ids: seq(l),
        });
        const res = r.data as { status: string; route_version: number } | null;
        if (r.error) throw new Error(r.error.message);
        if (res?.status === 'ok') {
          meta.routeVersion.set(l.id, res.route_version);
          // positions changed on the server, so did the operation version of those items
          const { data, error } = await from('list_items').select('id, version').eq('list_id', l.id);
          if (error) throw error;
          (data as { id: string; version: number }[]).forEach(x => meta.itemVersion.set(x.id, x.version));
        } else routeStale = true;
      }
    }
    const known = new Set((prev.purchases ?? []).map(p => p.id));
    for (const p of next.purchases ?? []) if (!known.has(p.id) && nextIds.has(p.listId)) {
      const r = await rpc('save_purchase_record', { _id: p.id, _list_id: p.listId, _purchased_on: p.purchasedOn, _snapshot: p });
      if (r.error) throw new Error(r.error.message);
    }
  } catch {
    return 'error';
  }
  return routeStale ? 'route_stale' : 'ok';
}

// ---------- operation sender (Bloco 7) ----------
export type SendResult =
  | { status: 'ok'; version?: number; routeVersion?: number; deleted?: boolean }
  /** item_mark only: someone else's operation came first; the server state stands (never toggled back) */
  | { status: 'mark_lost'; already: boolean; markedBy?: string | null }
  | { status: 'conflict' | 'route_stale' | 'denied' | 'network' | 'invalid' | 'wrong_session'; detail?: string; deleted?: boolean };

/** Sends one queued operation. The server deduplicates by operation id, so a resend after a lost reply is harmless. */
export async function sendOp(op: import('@/lib/ops').Op, meta: RemoteMeta): Promise<SendResult> {
  const { classifyError } = await import('@/lib/ops');
  const fail = (e: unknown): SendResult => ({ status: classifyError(e), detail: String((e as { message?: string })?.message ?? e) });
  try {
    // the operation belongs to the session that created it; a different signed-in account never sends it
    const { data: sess } = await supabase.auth.getSession();
    if (sess.session?.user.id !== op.userId) return { status: 'wrong_session' };
    let r: { data: unknown; error: { message: string; code?: string } | null };
    if (op.kind === 'item_mark') {
      r = await rpc('set_item_marked', { _operation_id: op.id, _item_id: op.entityId, _expected_version: meta.itemVersion.get(op.entityId) ?? op.baseVersion ?? 1, _marked: op.payload.marked });
    } else if (op.kind === 'reorder') {
      r = await rpc('reorder_items', { _operation_id: op.id, _list_id: op.listId, _expected_route_version: meta.routeVersion.get(op.listId) ?? 0, _item_ids: op.payload.ids });
    } else if (op.kind === 'list_leave') {
      r = await rpc('remove_list_member', { _list_id: op.listId, _user_id: op.userId });
      if (!r.error || /member_not_found/.test(r.error.message)) return { status: 'ok' };
    } else if (op.kind === 'purchase_save') {
      const rec = op.payload.record as { purchasedOn: string };
      r = await rpc('save_purchase_record', { _id: op.entityId, _list_id: op.listId, _purchased_on: rec.purchasedOn, _snapshot: op.payload.record });
      if (!r.error) return { status: 'ok' };
    } else {
      const base = op.kind === 'item_update' ? meta.itemVersion.get(op.entityId) ?? op.baseVersion : null;
      r = await rpc('apply_list_op', { _operation_id: op.id, _list_id: op.listId, _kind: op.kind, _entity_id: op.entity === 'item' ? op.entityId : null, _base_version: base, _payload: op.payload });
    }
    if (r.error) return fail(r.error);
    const res = (r.data ?? {}) as { status?: string; version?: number; route_version?: number; deleted?: boolean; marked_by?: string | null };
    if (op.kind === 'item_mark' && (res.status === 'already' || res.status === 'conflict')) {
      return { status: 'mark_lost', already: res.status === 'already', markedBy: res.marked_by };
    }
    if (res.status === 'ok') return { status: 'ok', version: res.version, routeVersion: res.route_version, deleted: res.deleted };
    if (res.status === 'conflict') return { status: op.kind === 'reorder' ? 'route_stale' : 'conflict', deleted: res.deleted };
    return { status: 'invalid', detail: res.status };
  } catch (e) {
    return fail(e);
  }
}

export async function refreshItemVersions(listId: string, meta: RemoteMeta) {
  const { data, error } = await from('list_items').select('id, version').eq('list_id', listId);
  if (error) throw error;
  (data as { id: string; version: number }[]).forEach(x => meta.itemVersion.set(x.id, x.version));
}
