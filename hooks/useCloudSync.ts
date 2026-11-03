import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useStore } from '@/store/useStore';
import { useAuth } from '@/hooks/useAuth';
import {
  GUEST, LEGACY, CONFLICT_COPY, EMPTY_SNAPSHOT, type Snapshot, snapshotOf, isEmptySnapshot,
  mergeSnapshots, upgradeSnapshot, getLocalOwner, setLocalOwner, saveStash, loadStash, clearStash,
} from '@/lib/backup';
import {
  activeImport, loadRelational, importLegacy, setImportState, emptyMeta, type RemoteMeta,
} from '@/data/cloudRepository';
import { summarize, compareSummaries, remapSummary, scopeToBatch } from '@/lib/legacyImport';
import { OpSync, type OpSyncStatus } from '@/data/opSync';
import { subscribeList, type LiveState } from '@/data/live';
import { loadCache, listOps, outboxAvailable } from '@/data/outbox';

/** Where the account data lives: legacy JSON row (user_state) or the relational model. Only one writer at a time. */
export type StorageMode = 'legacy' | 'relational';

/** The storage upgrade can be offered only outside the published app until the safe return is validated there. */
export const RELATIONAL_RELEASE = import.meta.env.DEV
  || (typeof location !== 'undefined' && /id-preview|lovableproject\.com|localhost/.test(location.hostname));

export interface MigrationReport {
  phase: 'running' | 'done' | 'failed' | 'rolled_back';
  done?: number;
  total?: number;
  before?: { lists: number; items: number; checked: number; purchases: number };
  diffs?: string[];
  message?: string;
}

export type SyncStatus = 'offline' | 'loading' | 'synced' | 'saving' | 'pending' | 'error' | 'conflict';

/** Asked when guest data exists on the device and the user signs in. */
export interface SyncDecision {
  hasRemoteData: boolean;
  localListCount: number;
}

/** Device changes not yet sent AND a cloud copy changed elsewhere. Nothing is overwritten until the user chooses. */
export interface SyncConflict {
  local: Snapshot;
  remote: Snapshot;
}

export type ConflictChoice = 'device' | 'cloud' | 'join';

const dirtyKey = (uid: string) => `listafacil-dirty-${uid}`;
const tokenKey = (uid: string) => `listafacil-token-${uid}`;

let flushFn: (() => Promise<void>) | null = null;
/** Sends any change still waiting in the debounce. Call before signing out. */
export const flushPendingSync = async () => { if (flushFn) await flushFn(); };

const local = () => snapshotOf(useStore.getState());
const same = (a: Snapshot, b: Snapshot) =>
  JSON.stringify([a.lists, a.priceHistory, a.purchases ?? []]) === JSON.stringify([b.lists, b.priceHistory, b.purchases ?? []]);

type PushResult = 'ok' | 'conflict' | 'error' | 'stale' | 'route_stale';

/**
 * Local-first cloud sync with strict account isolation.
 * Every sign-in/out starts a new generation; responses, timers and callbacks from an older
 * generation are ignored, so data from account A can never be written to or shown for account B.
 */
export function useCloudSync() {
  const { user, loading } = useAuth();
  const userId = user?.id ?? null;
  const [status, setStatus] = useState<SyncStatus>('offline');
  const [decision, setDecision] = useState<SyncDecision | null>(null);
  const [conflict, setConflict] = useState<SyncConflict | null>(null);
  const [readyFor, setReadyFor] = useState<string | null>(null);

  const gen = useRef(0);
  const hydrating = useRef(false);
  const canPush = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef(false);
  const remoteToken = useRef<string | null>(null);
  const remoteSnap = useRef<Snapshot | null>(null);
  const storage = useRef<StorageMode>('legacy');
  const importId = useRef<string | null>(null);
  const synced = useRef<Snapshot>(EMPTY_SNAPSHOT); // last server state seen (relational mode)
  const meta = useRef<RemoteMeta>(emptyMeta());
  const [mode, setMode] = useState<StorageMode>('legacy');
  const [migration, setMigration] = useState<MigrationReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const engine = useRef<OpSync | null>(null);
  const [opStatus, setOpStatus] = useState<OpSyncStatus | null>(null);

  /** Operation sync for the relational model (Bloco 7). Every callback is ignored once the session changed. */
  const makeEngine = (uid: string, my: number) => {
    engine.current?.stop();
    const e = new OpSync(uid, {
      isCurrent: () => gen.current === my && getLocalOwner() === uid,
      onLocal: snap => load(snap),
      onStatus: st => {
        setOpStatus(st);
        setStatus(st.conflicts.length || st.denied ? 'conflict' : st.pending ? 'pending' : 'synced');
      },
      onNotice: msg => setNotice(msg),
    }, EMPTY_SNAPSHOT);
    engine.current = e;
    return e;
  };

  const load = (snap: Snapshot) => {
    hydrating.current = true;
    useStore.getState().hydrateFromCloud(snap);
    hydrating.current = false;
  };

  const rememberToken = (uid: string, token: string | null) => {
    remoteToken.current = token;
    if (token) localStorage.setItem(tokenKey(uid), token);
  };

  const fetchRemote = async (uid: string) => {
    const { data, error } = await supabase
      .from('user_state').select('data, updated_at').eq('user_id', uid).maybeSingle();
    if (error) throw error;
    return {
      token: data?.updated_at ?? null,
      snap: data ? upgradeSnapshot(data.data as unknown as Snapshot) : null,
    };
  };

  /** Relational server state; sets the versions used by the next writes. */
  const fetchRelational = async (uid: string) => {
    const r = await loadRelational(uid, useStore.getState().activeListId);
    return r;
  };

  /** Relational writer: the current local state is recorded as queued operations (atomic with the cache). */
  const pushRelational = async (uid: string, my: number): Promise<PushResult> => {
    if (gen.current !== my || getLocalOwner() !== uid || !engine.current) return 'stale';
    try { await engine.current.record(local()); } catch { return 'error'; }
    return 'ok';
  };

  /** Writes device data only if the cloud row is still the version we last saw. */
  const push = useCallback(async (uid: string, my: number): Promise<PushResult> => {
    if (storage.current === 'relational') return pushRelational(uid, my);
    for (let attempt = 0; attempt < 2; attempt++) {
      if (gen.current !== my || getLocalOwner() !== uid) return 'stale';
      const data = local() as never;
      if (remoteToken.current) {
        const { data: rows, error } = await supabase
          .from('user_state').update({ data }).eq('user_id', uid)
          .eq('updated_at', remoteToken.current).select('updated_at');
        if (gen.current !== my) return 'stale';
        if (error) return 'error';
        if (rows.length) { rememberToken(uid, rows[0].updated_at); return 'ok'; }
      } else {
        const { data: row, error } = await supabase
          .from('user_state').insert({ user_id: uid, data }).select('updated_at').single();
        if (gen.current !== my) return 'stale';
        if (!error) { rememberToken(uid, row.updated_at); return 'ok'; }
        if (error.code !== '23505') return 'error';
      }
      // Someone else saved first: compare before doing anything.
      let remote: Awaited<ReturnType<typeof fetchRemote>>;
      try { remote = await fetchRemote(uid); } catch { return 'error'; }
      if (gen.current !== my) return 'stale';
      remoteToken.current = remote.token;
      if (remote.snap && !same(local(), remote.snap)) {
        setConflict({ local: local(), remote: remote.snap });
        return 'conflict';
      }
    }
    return 'error';
  }, []);

  const doPush = useCallback(async (uid: string, my: number) => {
    pending.current = false;
    setStatus('saving');
    const r = await push(uid, my);
    if (r === 'stale') return;
    if (storage.current === 'relational') { if (r === 'ok') localStorage.removeItem(dirtyKey(uid)); else setStatus('error'); return; }
    if (r === 'route_stale') {
      setNotice('A ordem da lista mudou em outro lugar. A inversão foi cancelada e a lista foi atualizada.');
      if (!pending.current) localStorage.removeItem(dirtyKey(uid));
      setStatus('synced');
      return;
    }
    if (r === 'ok' && !pending.current) localStorage.removeItem(dirtyKey(uid));
    if (r === 'conflict') canPush.current = false;
    setStatus(r === 'ok' ? 'synced' : r === 'conflict' ? 'conflict' : 'error');
  }, [push]);

  /**
   * Device data already belongs to `uid`. Decide between keeping it, taking the cloud copy,
   * or showing a divergence. Never replaces unsent device changes silently.
   */
  const reconcileOwn = useCallback(async (
    uid: string, my: number, remote: { token: string | null; snap: Snapshot | null },
  ) => {
    const mine = local();
    const dirty = localStorage.getItem(dirtyKey(uid)) === '1';
    const lastToken = localStorage.getItem(tokenKey(uid));
    remoteToken.current = remote.token;
    if (storage.current === 'relational') synced.current = remote.snap ?? EMPTY_SNAPSHOT;

    if (!remote.snap) {
      if (dirty || !isEmptySnapshot(mine)) pending.current = true;
    } else if (!dirty || same(mine, remote.snap)) {
      if (!dirty) load(remote.snap);
      rememberToken(uid, remote.token);
    } else if (storage.current === 'legacy' && remote.token && remote.token === lastToken) {
      pending.current = true; // cloud unchanged since our last sync: our edits are simply newer
    } else {
      setConflict({ local: mine, remote: remote.snap });
      setReadyFor(uid);
      setStatus('conflict');
      return;
    }
    setReadyFor(uid);
    canPush.current = true;
    if (pending.current) await doPush(uid, my);
    else if (gen.current === my) setStatus('synced');
  }, [doPush]);

  // React to sign-in / sign-out.
  useEffect(() => {
    const my = ++gen.current;
    canPush.current = false;
    pending.current = false;
    window.clearTimeout(timer.current);
    setReadyFor(null);
    setDecision(null);
    setConflict(null);
    remoteToken.current = null;
    engine.current?.stop();
    engine.current = null;
    setOpStatus(null);
    storage.current = 'legacy';
    importId.current = null;
    synced.current = EMPTY_SNAPSHOT;
    meta.current = emptyMeta();
    setMode('legacy');
    setMigration(null);
    if (loading) return;
    const owner = getLocalOwner();

    if (!userId) {
      // Data of a signed-out account stays parked under that account; guest data comes back.
      if (owner && owner !== GUEST) {
        saveStash(owner, local());
        load(loadStash(GUEST) ?? EMPTY_SNAPSHOT);
        clearStash(GUEST);
      }
      setLocalOwner(GUEST);
      setStatus('offline');
      setReadyFor(GUEST);
      return;
    }

    setStatus('loading');
    (async () => {
      let remote: Awaited<ReturnType<typeof fetchRemote>> | null = null;
      let rel: { id: string } | null = null;
      try {
        rel = await activeImport(userId);
        if (gen.current !== my) return;
        if (rel) {
          const r = await fetchRelational(userId);
          if (gen.current !== my) return;
          meta.current = r.meta;
          remote = { token: null, snap: r.snap };
        } else remote = await fetchRemote(userId);
      } catch {
        // offline: an account already moved to the relational model keeps working from the device cache
        try { if (outboxAvailable() && (await loadCache(userId))?.mode === 'relational') rel = { id: '' }; } catch { /* no cache */ }
      }
      if (gen.current !== my) return; // a newer sign-in/out happened meanwhile
      if (rel) {
        // single writer: once the account moved, the legacy row is never written by this device
        storage.current = 'relational';
        importId.current = rel.id;
        setMode('relational');
      }

      const mine = local();
      const switchTo = () => {
        load(loadStash(userId) ?? EMPTY_SNAPSHOT);
        clearStash(userId);
        setLocalOwner(userId);
      };

      if (owner === GUEST && !isEmptySnapshot(mine)) {
        if (!remote) { setStatus('error'); return; }
        // Guest data on the device: ask before moving it into the account.
        remoteSnap.current = remote.snap;
        if (storage.current === 'relational') {
          synced.current = remote.snap ?? EMPTY_SNAPSHOT;
          await makeEngine(userId, my).start({ snap: remote.snap ?? EMPTY_SNAPSHOT, meta: meta.current }, { silent: true });
          if (gen.current !== my) return;
        }
        remoteToken.current = remote.token;
        setDecision({
          hasRemoteData: !isEmptySnapshot(remote.snap),
          localListCount: mine.lists.filter(l => l.items.length).length,
        });
        setReadyFor(userId);
        return;
      }
      if (owner !== userId) {
        if (!owner) { if (!isEmptySnapshot(mine)) saveStash(LEGACY, mine); } // unknown owner: keep for explicit import
        else if (owner !== GUEST) saveStash(owner, mine); // another account: park, never upload
        switchTo();
      }
      if (storage.current === 'relational') {
        const ok = await makeEngine(userId, my).start(remote?.snap ? { snap: remote.snap, meta: meta.current } : null);
        if (gen.current !== my) return;
        setReadyFor(userId);
        canPush.current = true;
        if (!ok) setStatus('error');
        return;
      }
      if (!remote) {
        setReadyFor(userId);
        setStatus('error');
        return;
      }
      await reconcileOwn(userId, my, remote);
    })();
  }, [userId, loading, reconcileOwn]);

  /** 'join' moves the guest lists into the account; 'separate' keeps them parked as guest data. */
  const resolveDecision = useCallback(async (choice: 'join' | 'separate') => {
    if (!userId) return;
    const my = gen.current;
    const guest = local();
    const remote = remoteSnap.current;
    const own = !isEmptySnapshot(remote) ? remote! : loadStash(userId) ?? EMPTY_SNAPSHOT;
    clearStash(userId);
    setDecision(null);
    setLocalOwner(userId);
    if (choice === 'join') {
      load(mergeSnapshots(guest, own));
      localStorage.setItem(dirtyKey(userId), '1');
      pending.current = true;
    } else {
      saveStash(GUEST, guest);
      load(own);
      if (remote) rememberToken(userId, remoteToken.current);
      else if (!isEmptySnapshot(own)) pending.current = true;
    }
    canPush.current = true;
    if (pending.current) await doPush(userId, my);
    else setStatus('synced');
  }, [userId, doPush]);

  const resolveConflict = useCallback(async (choice: ConflictChoice) => {
    if (!userId || !conflict) return;
    const my = gen.current;
    if (choice === 'cloud') {
      saveStash(CONFLICT_COPY, conflict.local); // device copy is never thrown away
      load(conflict.remote);
      localStorage.removeItem(dirtyKey(userId));
      rememberToken(userId, remoteToken.current);
    } else {
      if (choice === 'join') load(mergeSnapshots(conflict.local, conflict.remote));
      pending.current = true; // 'device': cloud copy is archived in history by the server
    }
    setConflict(null);
    canPush.current = true;
    if (pending.current) await doPush(userId, my);
    else setStatus('synced');
  }, [userId, conflict, doPush]);

  // Push local changes (debounced).
  useEffect(() => {
    if (!userId) return;
    flushFn = async () => {
      if (storage.current === 'relational' && engine.current) { await engine.current.drain(); return; }
      if (!pending.current || !canPush.current) return;
      window.clearTimeout(timer.current);
      await doPush(userId, gen.current);
    };
    const unsub = useStore.subscribe((state, prev) => {
      if (hydrating.current || getLocalOwner() !== userId) return;
      if (
        state.lists === prev.lists &&
        state.activeListId === prev.activeListId &&
        state.priceHistory === prev.priceHistory &&
        state.purchases === prev.purchases
      ) return;
      localStorage.setItem(dirtyKey(userId), '1');
      pending.current = true;
      if (!canPush.current) return;
      const my = gen.current;
      if (storage.current === 'relational') { pending.current = false; void doPush(userId, my); return; }
      window.clearTimeout(timer.current);
      setStatus('saving');
      timer.current = window.setTimeout(() => { void doPush(userId, my); }, 800);
    });
    return () => {
      unsub();
      window.clearTimeout(timer.current);
      flushFn = null;
    };
  }, [userId, doPush]);

  /** Copies the account data into the relational model, verifies it and only then switches the writer. */
  const migrate = useCallback(async () => {
    if (!userId || storage.current !== 'legacy' || conflict || decision || getLocalOwner() !== userId) return;
    const my = gen.current;
    await flushFn?.();
    if (pending.current) { setMigration({ phase: 'failed', message: 'Há alterações ainda não salvas. Tente de novo em instantes.' }); return; }
    canPush.current = false; // no legacy writes while importing
    const before = local();
    const sum = summarize(before);
    const counts = { lists: sum.lists, items: sum.items, checked: sum.checked, purchases: sum.purchases };
    setMigration({ phase: 'running', done: 0, total: 1, before: counts });
    try {
      const res = await importLegacy(before, 'account', p => { if (gen.current === my) setMigration({ phase: 'running', ...p, before: counts }); });
      if (gen.current !== my) return;
      const fresh = await fetchRelational(userId);
      if (gen.current !== my) return;
      // compare only this batch: lists shared with me and own lists outside the batch are not imported data
      const diffs = res.verdict.ok ? compareSummaries(remapSummary(res.expected, res.map), summarize(scopeToBatch(fresh.snap, res.map))) : ['a conferência no servidor não fechou'];
      if (diffs.length || !same(local(), before)) {
        canPush.current = true;
        setMigration({ phase: 'failed', before: counts, diffs: diffs.length ? diffs : ['a lista mudou durante a atualização'] });
        return;
      }
      await setImportState(res.importId, 'active');
      if (gen.current !== my) return;
      storage.current = 'relational';
      importId.current = res.importId;
      synced.current = fresh.snap;
      meta.current = fresh.meta;
      localStorage.removeItem(dirtyKey(userId));
      setMode('relational');
      await makeEngine(userId, my).start({ snap: fresh.snap, meta: fresh.meta });
      canPush.current = true;
      setMigration({ phase: 'done', before: counts, diffs: [] });
    } catch (e) {
      if (gen.current !== my) return;
      canPush.current = true;
      setMigration({ phase: 'failed', before: counts, message: e instanceof Error ? e.message : 'erro desconhecido' });
    }
  }, [userId, conflict, decision]);

  /** Safe return: writes the current relational state (including later edits) back to the legacy row. */
  const rollback = useCallback(async () => {
    if (!userId || storage.current !== 'relational') return;
    const my = gen.current;
    await flushFn?.();
    if ((await listOps(userId)).length) {
      setMigration({ phase: 'failed', message: 'Ainda há alterações aguardando sincronização ou revisão. Resolva antes de voltar.' });
      return;
    }
    canPush.current = false;
    try {
      const remote = await fetchRemote(userId);
      if (!importId.current) { const a = await activeImport(userId); importId.current = a?.id ?? null; }
      if (!importId.current) throw new Error('importação não encontrada');
      if (gen.current !== my) return;
      await setImportState(importId.current, 'rolled_back');
      engine.current?.stop();
      engine.current = null;
      setOpStatus(null);
      storage.current = 'legacy';
      setMode('legacy');
      remoteToken.current = remote.token; // optimistic lock; the server archives the previous row in history
      localStorage.setItem(dirtyKey(userId), '1');
      pending.current = true;
      canPush.current = true;
      await doPush(userId, my);
      setMigration({ phase: 'rolled_back' });
    } catch (e) {
      canPush.current = true;
      setMigration({ phase: 'failed', message: e instanceof Error ? e.message : 'erro desconhecido' });
    }
  }, [userId, doPush]);

  // Another tab switched the device owner (sign-in/out there): this tab still holds the previous account's
  // data in memory and would write it back into shared device storage. Reload so it re-reads under the new owner.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'listafacil-owner' && e.newValue !== e.oldValue) location.reload();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Reconnect on open, focus and network return. navigator.onLine is only a hint; the server reply decides.
  useEffect(() => {
    if (!userId) return;
    const kick = () => {
      const e = engine.current;
      if (!e || document.visibilityState === 'hidden') return;
      void e.drain().then(() => e.refresh());
    };
    window.addEventListener('online', kick);
    window.addEventListener('focus', kick);
    document.addEventListener('visibilitychange', kick);
    return () => {
      window.removeEventListener('online', kick);
      window.removeEventListener('focus', kick);
      document.removeEventListener('visibilitychange', kick);
    };
  }, [userId]);

  const resolveOp = useCallback(async (opId: string, choice: 'discard' | 'retry' | 'archive') => {
    await engine.current?.resolve(opId, choice);
  }, []);

  /** Before sending a list: try to finish the sync and report what the other person will really see. */
  const prepareShare = useCallback(async (listId: string) => {
    const e = engine.current;
    if (!userId || !e) return null;
    await e.drain();
    const ops = (await listOps(userId)).filter(o => o.listId === listId);
    return {
      pending: ops.length,
      confirmedAt: e.confirmedAt,
      revision: e.meta.routeVersion.get(listId) ?? 0,
      onServer: e.confirmed.lists.some(l => l.id === listId),
    };
  }, [userId]);

  const ready = !loading && readyFor !== null && readyFor === (userId ?? GUEST);

  /**
   * Bloco 9: live notifications for the open list only (relational mode). One channel at a time, closed on list
   * change, sign-out or account switch; every event or reconnection re-reads the authorized server state.
   */
  const activeListId = useStore(s => s.activeListId);
  const [live, setLive] = useState<LiveState>('off');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => {
    if (!ready || !userId || mode !== 'relational' || !activeListId || !online) { setLive('off'); return; }
    const my = gen.current;
    const listId = activeListId;
    const wasShared = () => {
      const l = engine.current?.confirmed.lists.find(x => x.id === listId);
      return l ? { name: l.name, guest: (l.role ?? 'owner') !== 'owner' } : null;
    };
    const sync = async () => {
      const e = engine.current;
      if (!e || gen.current !== my) return;
      const before = wasShared();
      await e.refresh();
      if (gen.current !== my) return;
      // access revoked: the server no longer returns the list, so it already left this device's view
      if (before?.guest && !e.confirmed.lists.some(x => x.id === listId)) {
        setNotice(`Seu acesso à lista "${before.name}" foi encerrado pelo proprietário.`);
      }
    };
    const stop = subscribeList(listId, () => void sync(), st => { if (gen.current === my) setLive(st); });
    // RLS hides membership deletions from the removed person, so revocation is also checked periodically
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void sync(); }, 60_000);
    return () => { window.clearInterval(poll); stop(); };
  }, [ready, userId, mode, activeListId, online]);

  return {
    live: online ? live : 'off' as LiveState, online,
    status, decision, resolveDecision, conflict, resolveConflict, ready,
    storage: mode, migration, migrate, rollback, clearMigration: () => setMigration(null),
    notice, clearNotice: () => setNotice(null),
    opStatus, resolveOp, prepareShare, refreshNow: () => engine.current?.drain().then(() => engine.current?.refresh()),
  };
}
