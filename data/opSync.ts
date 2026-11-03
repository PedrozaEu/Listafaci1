import type { Snapshot } from '@/lib/backup';
import { applyOps, diffToOps, backoffMs, type Op } from '@/lib/ops';
import { commitLocal, confirmOp, listOps, loadCache, putOp, deleteOps, type CacheEntry } from '@/data/outbox';
import { sendOp, loadRelational, refreshItemVersions, emptyMeta, type RemoteMeta } from '@/data/cloudRepository';

export interface OpSyncStatus {
  pending: number;
  conflicts: Op[];
  denied: number;
  deniedOps: Op[];
  confirmedAt: number | null;
  /** last send failed for network reasons; retry is scheduled */
  waitingNetwork: boolean;
}

interface Hooks {
  isCurrent: () => boolean;            // false once the session changed: everything stops
  onLocal: (snap: Snapshot) => void;   // replace what the user sees (confirmed + pending)
  onStatus: (s: OpSyncStatus) => void;
  onNotice: (msg: string) => void;
}

/**
 * Operation-based sync for one signed-in user. Local changes are written to IndexedDB together with their
 * operations; the outbox is sent in order and an operation leaves it only after the server confirms it.
 */
export class OpSync {
  confirmed: Snapshot;
  local: Snapshot;
  meta: RemoteMeta = emptyMeta();
  tombstones = new Set<string>();
  confirmedAt: number | null = null;
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(readonly userId: string, private h: Hooks, empty: Snapshot) {
    this.confirmed = empty;
    this.local = empty;
  }

  private cacheFields(): Partial<CacheEntry> {
    return {
      confirmed: this.confirmed, local: this.local, confirmedAt: this.confirmedAt,
      itemVersion: [...this.meta.itemVersion], routeVersion: [...this.meta.routeVersion], tombstones: [...this.tombstones],
    };
  }

  private async emit() {
    if (!this.h.isCurrent()) return;
    const ops = await listOps(this.userId);
    if (!this.h.isCurrent()) return;
    this.h.onStatus({
      pending: ops.filter(o => o.state === 'pending').length,
      conflicts: ops.filter(o => o.state === 'conflict'),
      denied: ops.filter(o => o.state === 'denied').length,
      deniedOps: ops.filter(o => o.state === 'denied'),
      confirmedAt: this.confirmedAt,
      waitingNetwork: ops.some(o => o.state === 'pending' && o.attempts > 0),
    });
  }

  /** Server state (when reachable) + cache + pending ops. A remote snapshot never replaces unsent edits. */
  async start(remote: { snap: Snapshot; meta: RemoteMeta } | null, opts: { silent?: boolean } = {}): Promise<boolean> {
    const cache = await loadCache(this.userId);
    const ops = await listOps(this.userId);
    if (!this.h.isCurrent()) return false;
    this.seq = ops.reduce((m, o) => Math.max(m, o.seq + 1), 0);
    if (cache) {
      this.meta = { itemVersion: new Map(cache.itemVersion), routeVersion: new Map(cache.routeVersion) };
      this.tombstones = new Set(cache.tombstones);
      this.confirmedAt = cache.confirmedAt;
      this.confirmed = cache.confirmed;
    }
    if (remote) {
      for (const l of this.confirmed.lists) for (const i of l.items) {
        if (!remote.snap.lists.some(r => r.items.some(x => x.id === i.id))) this.tombstones.add(i.id);
      }
      this.confirmed = remote.snap;
      this.meta = remote.meta;
      this.confirmedAt = Date.now();
    } else if (!cache) return false;
    this.local = applyOps(this.confirmed, ops, this.tombstones);
    await commitLocal(this.userId, this.cacheFields(), []);
    if (!this.h.isCurrent()) return false;
    if (!opts.silent) this.h.onLocal(this.local);
    await this.emit();
    void this.drain();
    return true;
  }

  /** Records a user change: local state and its operations in one IndexedDB transaction. */
  async record(next: Snapshot) {
    const ops = diffToOps(this.local, next, this.userId, {
      item: id => this.meta.itemVersion.get(id) ?? null,
      list: () => null,
    }, Date.now(), this.seq);
    this.local = next;
    if (!ops.length) { await commitLocal(this.userId, { local: next }, []); return; }
    this.seq += ops.length;
    await commitLocal(this.userId, { local: next }, ops);
    await this.emit();
    void this.drain();
  }

  async refresh() {
    try {
      const remote = await loadRelational(this.userId, this.local.activeListId);
      if (!this.h.isCurrent()) return;
      const ops = await listOps(this.userId);
      for (const l of this.confirmed.lists) for (const i of l.items) {
        if (!remote.snap.lists.some(r => r.items.some(x => x.id === i.id))) this.tombstones.add(i.id);
      }
      this.confirmed = remote.snap;
      this.meta = remote.meta;
      this.confirmedAt = Date.now();
      this.local = applyOps(this.confirmed, ops, this.tombstones);
      await commitLocal(this.userId, this.cacheFields(), []);
      if (!this.h.isCurrent()) return;
      this.h.onLocal(this.local);
      await this.emit();
    } catch { /* offline: keep the cached state */ }
  }

  /** Sends pending operations in order. Only one tab drains at a time (Web Locks when available). */
  private running: Promise<void> | null = null;
  async drain(immediate = true): Promise<void> {
    while (this.running) await this.running; // a drain requested meanwhile runs after the current one
    const run = () => this.drainInner(immediate);
    const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
    this.running = (locks ? locks.request(`listafacil-outbox-${this.userId}`, run) : run()).finally(() => { this.running = null; });
    await this.running;
  }

  private async drainInner(immediate: boolean) {
    if (!this.h.isCurrent()) return;
    this.draining = true;
    clearTimeout(this.timer);
    try {
      for (;;) {
        if (!this.h.isCurrent()) return;
        const ops = (await listOps(this.userId)).filter(o => o.state === 'pending');
        const op = ops[0];
        if (!op) break;
        if (!immediate && op.nextAt > Date.now()) { this.schedule(op.nextAt - Date.now()); break; }
        if (!this.h.isCurrent()) return;
        const res = await sendOp(op, this.meta);
        if (!this.h.isCurrent()) return;
        if (res.status === 'wrong_session') break; // never sent under another account; stays queued for its owner
        if (res.status === 'ok') {
          if (op.entity === 'item' && res.version) this.meta.itemVersion.set(op.entityId, res.version);
          if (op.kind === 'item_delete') this.tombstones.add(op.entityId);
          if (op.kind === 'reorder' && res.routeVersion !== undefined) {
            this.meta.routeVersion.set(op.listId, res.routeVersion);
            try { await refreshItemVersions(op.listId, this.meta); } catch { /* next conflict will refetch */ }
          }
          if (op.kind === 'list_create' && res.routeVersion !== undefined) this.meta.routeVersion.set(op.listId, res.routeVersion);
          this.confirmed = applyOps(this.confirmed, [op], this.tombstones);
          this.confirmedAt = Date.now();
          await confirmOp(this.userId, op.id, this.cacheFields());
        } else if (res.status === 'network') {
          await putOp({ ...op, attempts: op.attempts + 1, nextAt: Date.now() + backoffMs(op.attempts), error: 'rede' });
          this.schedule(backoffMs(op.attempts));
          immediate = false;
          break;
        } else if (res.status === 'mark_lost') {
          // first valid operation won on the server: take its state and author, tell the user, never toggle back
          await deleteOps([op.id]);
          await this.refresh();
          const item = this.confirmed.lists.flatMap(l => l.items).find(i => i.id === op.entityId);
          const by = item?.markedBy ? this.confirmed.lists.flatMap(l => l.members ?? []).find(m => m.userId === item.markedBy)?.name : undefined;
          this.h.onNotice(res.already && op.payload.marked
            ? `${item?.name ?? 'Este item'} já estava no carrinho${by ? `, marcado por ${by}` : ''}.`
            : `${item?.name ?? 'Este item'} foi alterado por outra pessoa antes. A lista foi atualizada.`);
        } else if (res.status === 'route_stale') {
          await deleteOps([op.id]);
          this.h.onNotice('A ordem da lista mudou em outro lugar. A inversão foi cancelada e a lista foi atualizada.');
          await this.refresh();
        } else if (res.status === 'denied') {
          await putOp({ ...op, state: 'denied', error: 'sem permissão' });
        } else {
          await putOp({ ...op, state: 'conflict', error: res.status === 'conflict' ? (res.deleted ? 'item excluído em outro lugar' : 'alterado em outro lugar') : 'recusado pelo servidor' });
        }
        await this.emit();
      }
    } finally {
      this.draining = false;
      await this.emit();
    }
  }

  private schedule(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.drain(false); }, Math.max(250, ms));
  }

  /** Review of a conflicting operation: drop it, or send it again over the current server version. */
  async resolve(opId: string, choice: 'discard' | 'retry' | 'archive') {
    if (choice === 'archive') {
      // a refused list_leave on a list I really own: only after re-reading the server and an explicit confirmation,
      // archive it with a NEW operation id that records the refused one; the refused op is never reused.
      const old = (await listOps(this.userId)).find(o => o.id === opId);
      if (!old || old.kind !== 'list_leave' || old.state !== 'denied') return;
      await this.refresh();
      const l = this.confirmed.lists.find(x => x.id === old.listId);
      if (!l || l.role !== 'owner') { this.h.onNotice('Não foi possível confirmar que você é o dono desta lista.'); await this.emit(); return; }
      await putOp({ ...old, id: crypto.randomUUID(), kind: 'list_archive', payload: { replaces: old.id }, state: 'pending', attempts: 0, nextAt: 0, error: undefined, createdAt: Date.now() });
      await deleteOps([old.id]);
      void this.drain();
      await this.emit();
      return;
    }
    if (opId === 'denied') {
      await deleteOps((await listOps(this.userId)).filter(o => o.state === 'denied').map(o => o.id));
      await this.refresh();
      await this.emit();
      return;
    }
    const op = (await listOps(this.userId)).find(o => o.id === opId);
    if (!op) return;
    if (choice === 'discard') {
      await deleteOps([opId]);
      await this.refresh();
    } else {
      await this.refresh(); // learns the current server version: the resend applies "my version" explicitly
      await putOp({ ...op, id: crypto.randomUUID(), state: 'pending', attempts: 0, nextAt: 0, error: undefined });
      await deleteOps([opId]);
      void this.drain();
    }
    await this.emit();
  }

  stop() { clearTimeout(this.timer); }
}
