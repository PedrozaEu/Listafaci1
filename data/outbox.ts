import type { Snapshot } from '@/lib/backup';
import type { Op } from '@/lib/ops';

/**
 * Per-user IndexedDB storage: the outbox of pending operations and the cache
 * (confirmed server state + local state). A local change and its operations are written in ONE transaction.
 */
export interface CacheEntry {
  userId: string;
  mode: 'relational';
  confirmed: Snapshot;          // last server-confirmed state
  local: Snapshot;              // what the user sees (confirmed + pending ops)
  itemVersion: [string, number][];
  routeVersion: [string, number][];
  tombstones: string[];
  confirmedAt: number | null;   // last server confirmation (server reply time on this device)
}

const DB = 'listafacil-v1';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        const ops = d.createObjectStore('ops', { keyPath: 'id' });
        ops.createIndex('user', 'userId');
        d.createObjectStore('cache', { keyPath: 'userId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}

const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => {
  tx.oncomplete = () => res();
  tx.onerror = () => rej(tx.error);
  tx.onabort = () => rej(tx.error ?? new Error('aborted'));
});
const get = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const outboxAvailable = () => typeof indexedDB !== 'undefined';

/** Atomic: new local state + its operations (+ optional cache fields). */
export async function commitLocal(userId: string, cache: Partial<CacheEntry>, ops: Op[]) {
  const d = await db();
  const tx = d.transaction(['ops', 'cache'], 'readwrite');
  const cs = tx.objectStore('cache');
  const cur = (await get(cs.get(userId))) as CacheEntry | undefined;
  cs.put({ ...(cur ?? {}), ...cache, userId, mode: 'relational' });
  for (const o of ops) {
    if (o.userId !== userId) { tx.abort(); throw new Error('op_user_mismatch'); }
    tx.objectStore('ops').put(o);
  }
  await done(tx);
}

export async function loadCache(userId: string): Promise<CacheEntry | null> {
  const d = await db();
  return ((await get(d.transaction('cache').objectStore('cache').get(userId))) as CacheEntry | undefined) ?? null;
}

export async function listOps(userId: string): Promise<Op[]> {
  const d = await db();
  const all = (await get(d.transaction('ops').objectStore('ops').index('user').getAll(userId))) as Op[];
  return all.sort((a, b) => a.seq - b.seq);
}

/** Server confirmed `opId`: remove it and store the new confirmed state in the same transaction. */
export async function confirmOp(userId: string, opId: string, cache: Partial<CacheEntry>) {
  const d = await db();
  const tx = d.transaction(['ops', 'cache'], 'readwrite');
  const cs = tx.objectStore('cache');
  const cur = (await get(cs.get(userId))) as CacheEntry | undefined;
  cs.put({ ...(cur ?? {}), ...cache, userId, mode: 'relational' });
  tx.objectStore('ops').delete(opId);
  await done(tx);
}

export async function putOp(op: Op) {
  const d = await db();
  const tx = d.transaction('ops', 'readwrite');
  tx.objectStore('ops').put(op);
  await done(tx);
}

export async function deleteOps(ids: string[]) {
  const d = await db();
  const tx = d.transaction('ops', 'readwrite');
  ids.forEach(id => tx.objectStore('ops').delete(id));
  await done(tx);
}

export async function clearUser(userId: string) {
  const d = await db();
  const tx = d.transaction(['ops', 'cache'], 'readwrite');
  const ids = (await get(tx.objectStore('ops').index('user').getAllKeys(userId))) as string[];
  ids.forEach(id => tx.objectStore('ops').delete(id));
  tx.objectStore('cache').delete(userId);
  await done(tx);
}

/** Test helper: forget the open connection. */
export const _resetOutboxConnection = () => { dbp = null; };
