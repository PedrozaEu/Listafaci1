import type { AppState, ShoppingList } from '@/types/shopping';
import { STORAGE_VERSION, migrateRaw, normalizeLists } from '@/lib/migrations';
import { normalizePurchases } from '@/lib/purchase';

/** The user data that is backed up, synced and restored (no UI preferences). */
export type Snapshot = Pick<AppState, 'lists' | 'activeListId' | 'priceHistory' | 'purchases' | 'version'>;

export const BACKUP_APP = 'listafacil';
export const BACKUP_FORMAT = 1;

export const snapshotOf = (s: Snapshot): Snapshot => ({
  lists: s.lists,
  activeListId: s.activeListId,
  priceHistory: s.priceHistory,
  purchases: s.purchases ?? [],
  version: s.version,
});

export const EMPTY_SNAPSHOT: Snapshot = { lists: [], activeListId: null, priceHistory: {}, purchases: [], version: STORAGE_VERSION };

/**
 * Brings a snapshot of any version (cloud row, backup file, device stash) to the current format.
 * Money in reais becomes cents exactly once; already-current snapshots are left as they are.
 */
export function upgradeSnapshot(raw: Partial<Snapshot> | null | undefined): Snapshot {
  const from = typeof raw?.version === 'number' ? raw.version : 1;
  const m = migrateRaw({ ...(raw ?? {}) } as Record<string, unknown>, from);
  const lists = normalizeLists(m.lists);
  const active = typeof m.activeListId === 'string' && lists.some(l => l.id === m.activeListId)
    ? (m.activeListId as string) : lists[0]?.id ?? null;
  return {
    lists,
    activeListId: active,
    priceHistory: (m.priceHistory as Snapshot['priceHistory']) ?? {},
    purchases: normalizePurchases(m.purchases),
    version: STORAGE_VERSION,
  };
}

export const isEmptySnapshot = (snap: Partial<Snapshot> | null | undefined) =>
  (!snap?.lists?.length || snap.lists.every(l => !l.items?.length)) && !snap?.purchases?.length;

export function buildBackup(snap: Snapshot, now = new Date()): string {
  return JSON.stringify(
    { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: now.toISOString(), data: snapshotOf(snap) },
    null,
    2,
  );
}

export class BackupError extends Error {}

/** Validates a backup file and returns its snapshot. Throws BackupError with a pt-BR message. */
export function parseBackup(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new BackupError('O arquivo não é um backup válido.');
  }
  const obj = raw as { app?: unknown; format?: unknown; data?: Partial<Snapshot> };
  if (!obj || obj.app !== BACKUP_APP) throw new BackupError('Este arquivo não é um backup do ListaFácil.');
  if (typeof obj.format !== 'number' || obj.format > BACKUP_FORMAT || (obj.data?.version ?? 0) > STORAGE_VERSION) {
    throw new BackupError('Este backup foi feito por uma versão mais nova do app.');
  }
  const data = obj.data;
  if (!data || !Array.isArray(data.lists)) throw new BackupError('O backup não contém listas.');
  for (const l of data.lists) {
    if (!l || typeof l.id !== 'string' || !Array.isArray(l.items)) {
      throw new BackupError('O backup tem uma lista danificada.');
    }
  }
  return upgradeSnapshot(data);
}

/**
 * Joins two snapshots without losing anything: lists and items are matched by id;
 * when both sides have the same item, `primary` wins. Price history months are unioned.
 */
export function mergeSnapshots(primary: Snapshot, secondary: Snapshot): Snapshot {
  const byId = new Map<string, ShoppingList>();
  for (const l of secondary.lists ?? []) byId.set(l.id, l);
  for (const l of primary.lists ?? []) {
    const other = byId.get(l.id);
    if (!other) { byId.set(l.id, l); continue; }
    const items = new Map(other.items.map(i => [i.id, i]));
    for (const i of l.items) items.set(i.id, i);
    byId.set(l.id, { ...other, ...l, items: Array.from(items.values()) });
  }
  const priceHistory: Snapshot['priceHistory'] = { ...(secondary.priceHistory ?? {}) };
  for (const [k, months] of Object.entries(primary.priceHistory ?? {})) {
    priceHistory[k] = { ...(priceHistory[k] ?? {}), ...months };
  }
  return {
    lists: Array.from(byId.values()),
    activeListId: primary.activeListId ?? secondary.activeListId,
    priceHistory,
    // Finished purchases are immutable: union by id, never overwritten.
    purchases: normalizePurchases([...(primary.purchases ?? []), ...(secondary.purchases ?? [])]),
    version: Math.max(primary.version ?? 1, secondary.version ?? 1),
  };
}

/* ---------- Per-account device storage ---------- */

const OWNER_KEY = 'listafacil-owner';
const STASH_PREFIX = 'listafacil-stash-';
export const GUEST = 'guest';
/** Device data from older versions whose owner cannot be proven. Only imported on explicit request. */
export const LEGACY = 'legacy';
/** Device copy kept when the user chooses the cloud version in a divergence. */
export const CONFLICT_COPY = 'conflito';

/** Who the data currently loaded on this device belongs to ('guest' or a user id). Null when unknown (older versions). */
export const getLocalOwner = (): string | null => localStorage.getItem(OWNER_KEY);
export const setLocalOwner = (owner: string) => localStorage.setItem(OWNER_KEY, owner);

export const saveStash = (owner: string, snap: Snapshot) =>
  localStorage.setItem(STASH_PREFIX + owner, JSON.stringify(snapshotOf(snap)));

export function loadStash(owner: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(STASH_PREFIX + owner);
    return raw ? upgradeSnapshot(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export const clearStash = (owner: string) => localStorage.removeItem(STASH_PREFIX + owner);

/** Saves a snapshot as a backup file in the browser. */
export function downloadBackup(snap: Snapshot, suffix = '') {
  const blob = new Blob([buildBackup(snap)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `listafacil-backup-${new Date().toISOString().slice(0, 10)}${suffix ? `-${suffix}` : ''}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
