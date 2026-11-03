import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/* ---- controllable fakes for auth and the cloud ---- */
type Deferred = { resolve: (v: unknown) => void; promise: Promise<unknown> };
const defer = (): Deferred => { let resolve!: (v: unknown) => void; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };

const auth = { user: null as { id: string } | null, loading: false };
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

const fetches: Record<string, Deferred[]> = {};
const writes: Array<{ uid: string; data: unknown }> = [];
vi.mock('@/integrations/supabase/client', () => {
  const builder = () => {
    let uid = '';
    let payload: unknown;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, v: string) => { if (col === 'user_id') uid = v; return b; };
    b.update = (p: { data: unknown }) => { payload = p.data; return b; };
    b.insert = (p: { user_id: string; data: unknown }) => { uid = p.user_id; payload = p.data; return b; };
    b.maybeSingle = () => { const d = defer(); (fetches[uid] ??= []).push(d); return d.promise; };
    b.single = async () => { writes.push({ uid, data: payload }); return { data: { updated_at: 't2' }, error: null }; };
    b.then = (res: (v: unknown) => void) => { writes.push({ uid, data: payload }); res({ data: [{ updated_at: 't2' }], error: null }); };
    return b;
  };
  return { supabase: { from: () => builder() } };
});

const liveSubs: string[] = [];
const liveClosed: string[] = [];
vi.mock('@/data/live', () => ({
  subscribeList: (id: string, _c: () => void, st: (s: string) => void) => { liveSubs.push(id); st('live'); return () => { liveClosed.push(id); }; },
  initials: () => 'X',
}));

const relational = { active: new Set<string>(), diffs: 0 };
vi.mock('@/data/cloudRepository', () => ({
  emptyMeta: () => ({ routeVersion: new Map(), itemVersion: new Map() }),
  activeImport: async (uid: string) => (relational.active.has(uid) ? { id: 'imp-' + uid, state: 'active' } : null),
  loadRelational: async () => ({
    snap: { version: 5, activeListId: 'r', priceHistory: {}, purchases: [], lists: [{ id: 'r', name: 'Rel', emoji: '🛒', createdAt: 1, items: [{ id: 'rel', name: 'Relacional', quantity: 1, purchased: false, createdAt: 1, order: 0 }] }] },
    meta: { routeVersion: new Map(), itemVersion: new Map() },
  }),
  writeDiff: async () => { relational.diffs++; return 'ok'; },
  refreshItemVersions: async () => {},
  sendOp: async () => { relational.diffs++; return { status: 'ok', version: 2 }; },
  importLegacy: vi.fn(), setImportState: vi.fn(),
}));

import { useCloudSync } from '@/hooks/useCloudSync';
import { useStore } from '@/store/useStore';

const row = (name: string) => ({
  data: {
    data: { version: 4, activeListId: 'r', priceHistory: {}, lists: [{ id: 'r', name, emoji: '🛒', createdAt: 1, items: [{ id: name, name, quantity: 1, purchased: false, createdAt: 1, order: 0 }] }] },
    updated_at: 't1',
  },
  error: null,
});
const names = () => useStore.getState().lists.flatMap(l => l.items.map(i => i.name));

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(fetches)) delete fetches[k];
  writes.length = 0;
  relational.active.clear();
  relational.diffs = 0;
  useStore.getState().resetAll();
  auth.user = null;
  auth.loading = false;
});

describe('account isolation', () => {
  it('a late response for account A does not load into account B', async () => {
    auth.user = { id: 'A' };
    const { result, rerender } = renderHook(() => useCloudSync());
    await waitFor(() => expect(fetches.A?.length).toBe(1));

    // A signs out and B signs in before A's response arrives.
    auth.user = { id: 'B' };
    rerender();
    await waitFor(() => expect(fetches.B?.length).toBe(1));
    await act(async () => { fetches.A[0].resolve(row('Item de A')); });
    expect(result.current.ready).toBe(false);
    expect(names()).not.toContain('Item de A');

    await act(async () => { fetches.B[0].resolve(row('Item de B')); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(names()).toEqual(['Item de B']);
    expect(writes.some(w => w.uid === 'B' && JSON.stringify(w.data).includes('Item de A'))).toBe(false);
  });

  it("account B never receives A's device data, and A's data comes back for A", async () => {
    auth.user = { id: 'A' };
    const { result, rerender } = renderHook(() => useCloudSync());
    await waitFor(() => expect(fetches.A?.length).toBe(1));
    await act(async () => { fetches.A[0].resolve(row('Item de A')); });
    await waitFor(() => expect(result.current.ready).toBe(true));

    auth.user = { id: 'B' };
    rerender();
    expect(result.current.ready).toBe(false); // nothing of A on screen while B loads
    await waitFor(() => expect(fetches.B?.length).toBe(1));
    await act(async () => { fetches.B[0].resolve({ data: null, error: null }); }); // B has no cloud data
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(names()).not.toContain('Item de A');
    expect(writes.filter(w => w.uid === 'B')).toHaveLength(0); // empty cloud is not a reason to upload

    auth.user = { id: 'A' };
    rerender();
    await waitFor(() => expect(fetches.A?.length).toBe(2));
    await act(async () => { fetches.A[1].resolve(row('Item de A')); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(names()).toEqual(['Item de A']);
  });

  it('a pending change of A is not sent after B signs in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    auth.user = { id: 'A' };
    const { result, rerender } = renderHook(() => useCloudSync());
    await waitFor(() => expect(fetches.A?.length).toBe(1));
    await act(async () => { fetches.A[0].resolve(row('Item de A')); });
    await waitFor(() => expect(result.current.ready).toBe(true));

    act(() => { useStore.getState().addItem({ name: 'Novo de A', quantity: 1 }); }); // debounce starts
    auth.user = { id: 'B' };
    rerender();
    await act(async () => { vi.advanceTimersByTime(2000); });
    expect(writes).toHaveLength(0);
    vi.useRealTimers();
  });

  it('legacy device data without owner is kept for import, not given to the account', async () => {
    useStore.getState().addItem({ name: 'Antigo', quantity: 1 });
    localStorage.removeItem('listafacil-owner');
    auth.user = { id: 'B' };
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(fetches.B?.length).toBe(1));
    await act(async () => { fetches.B[0].resolve({ data: null, error: null }); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(names()).not.toContain('Antigo');
    expect(writes).toHaveLength(0);
    expect(localStorage.getItem('listafacil-stash-legacy')).toContain('Antigo');
  });

  it('unsent device changes are not replaced by a changed cloud copy', async () => {
    localStorage.setItem('listafacil-owner', 'A');
    localStorage.setItem('listafacil-dirty-A', '1');
    localStorage.setItem('listafacil-token-A', 't0');
    useStore.getState().addItem({ name: 'Editado offline', quantity: 1 });
    localStorage.setItem('listafacil-owner', 'A');
    auth.user = { id: 'A' };
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(fetches.A?.length).toBe(1));
    await act(async () => { fetches.A[0].resolve(row('Mudou em outro aparelho')); });
    await waitFor(() => expect(result.current.conflict).not.toBeNull());
    expect(names()).toContain('Editado offline');
    expect(writes).toHaveLength(0);
  });

  it('after the switch the legacy row is never written (single writer)', async () => {
    relational.active.add('A');
    auth.user = { id: 'A' };
    const { result } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.storage).toBe('relational'));
    await waitFor(() => expect(names()).toEqual(['Relacional']));
    expect(fetches.A).toBeUndefined(); // user_state not even read
    await act(async () => { useStore.getState().addItem({ name: 'Novo', quantity: 1 } as never); });
    await waitFor(() => expect(relational.diffs).toBe(2), { timeout: 2000 });
    expect(writes).toHaveLength(0);
  });

  it('opens one live channel for the open list and closes it on sign-out', async () => {
    liveSubs.length = 0; liveClosed.length = 0;
    relational.active.add('A');
    auth.user = { id: 'A' };
    const { result, rerender } = renderHook(() => useCloudSync());
    await waitFor(() => expect(result.current.live).toBe('live'));
    expect(liveSubs).toEqual(['r']);
    auth.user = null;
    rerender();
    await waitFor(() => expect(liveClosed).toEqual(['r']));
    expect(result.current.live).toBe('off');
  });
});
