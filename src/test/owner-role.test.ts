import { describe, it, expect, vi, beforeEach } from 'vitest';

// Only the SDK layer is replaced: the real loadRelational -> rowsToSnapshot -> role resolution runs.
const tables: Record<string, unknown[]> = {};
vi.mock('@/integrations/supabase/client', () => {
  const query = (t: string) => {
    const res = { data: tables[t] ?? [], error: null };
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'is', 'eq', 'in', 'order', 'limit']) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(res).then(ok, ko);
    return q;
  };
  return { supabase: { from: (t: string) => query(t), rpc: async () => ({ data: null, error: null }), auth: { getSession: async () => ({ data: { session: null } }) } } };
});

import { loadRelational } from '@/data/cloudRepository';
import { diffToOps } from '@/lib/ops';
import { canEditItems, resolveListRole } from '@/types/shopping';

const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b1';
const C = '00000000-0000-0000-0000-0000000000c1';
const row = (id: string, owner: string) => ({ id, owner_id: owner, name: id, emoji: '🛒', budget_cents: null, sort_mode: null,
  source_list_id: null, legacy_created_at: null, created_at: '2026-10-01T00:00:00Z', status: 'active', route_version: 0 });
const member = (list: string, user: string, role: string, name: string, status = 'active') =>
  ({ list_id: list, user_id: user, role, display_name: name, color: '#1D4ED8', status });

beforeEach(() => {
  for (const k of Object.keys(tables)) delete tables[k];
  tables.shared_purchases = []; tables.legacy_price_history = []; tables.list_items = [];
});

describe('dono reconhecido a partir do servidor', () => {
  it('owner_id = A e vínculo owner de A: papel owner, pode editar', async () => {
    tables.shared_lists = [row('mercado', A)];
    tables.list_members = [member('mercado', A, 'owner', 'Ana'), member('mercado', B, 'editor', 'Bruno')];
    const { snap } = await loadRelational(A, null);
    expect(snap.lists[0].role).toBe('owner');
    expect(canEditItems(snap.lists[0].role)).toBe(true);
  });
  it('excluir a própria lista gera list_archive, nunca list_leave', async () => {
    tables.shared_lists = [row('mercado', A), row('outra', A)];
    tables.list_members = [member('mercado', A, 'owner', 'Ana'), member('outra', A, 'owner', 'Ana')];
    const { snap } = await loadRelational(A, null);
    const next = { ...snap, lists: snap.lists.filter(l => l.id !== 'mercado') };
    const ops = diffToOps(snap, next, A, { item: () => 1, list: () => 1 });
    expect(ops.map(o => o.kind)).toEqual(['list_archive']);
  });
  it('convidados mantêm o próprio papel por lista', async () => {
    tables.shared_lists = [row('mercado', A)];
    tables.list_members = [member('mercado', A, 'owner', 'Ana'), member('mercado', B, 'editor', 'Bruno'), member('mercado', C, 'checker', 'Clara')];
    expect((await loadRelational(B, null)).snap.lists[0].role).toBe('editor');
    expect((await loadRelational(C, null)).snap.lists[0].role).toBe('checker');
  });
  it('mesmo nome de exibição com outro UUID não dá propriedade', async () => {
    tables.shared_lists = [row('mercado', A)];
    tables.list_members = [member('mercado', A, 'owner', 'Ana'), member('mercado', B, 'checker', 'Ana')];
    expect((await loadRelational(B, null)).snap.lists[0].role).toBe('checker');
  });
  it('papel ausente ou em revisão não assume permissões nem gera exclusão', async () => {
    tables.shared_lists = [row('mercado', A)];
    tables.list_members = [member('mercado', A, 'owner', 'Ana'), member('mercado', C, 'viewer', 'Clara', 'review')];
    const { snap } = await loadRelational(C, null);
    expect(snap.lists[0].role).toBe('unknown');
    expect(canEditItems('unknown')).toBe(false);
    expect(diffToOps(snap, { ...snap, lists: [] }, C, { item: () => 1, list: () => 1 })).toEqual([]);
    expect(resolveListRole(undefined, A)).toBe('unknown');
  });
});
