import { describe, it, expect } from 'vitest';
import { diffToOps } from '@/lib/ops';
import { canEditItems, type ShoppingList } from '@/types/shopping';
import type { Snapshot } from '@/lib/backup';

const item = (id: string, over = {}) => ({ id, name: id, quantity: 1, purchased: false, createdAt: 1, order: 0, ...over });
const snap = (lists: ShoppingList[]): Snapshot => ({ lists, activeListId: lists[0]?.id ?? null, priceHistory: {}, purchases: [] } as unknown as Snapshot);
const list = (role: ShoppingList['role'], items: ReturnType<typeof item>[]) =>
  ({ id: 'L', name: 'Mercado', emoji: '🛒', createdAt: 1, items, role } as unknown as ShoppingList);
const v = { item: () => 1, list: () => 1 };

describe('papéis por lista', () => {
  it('Apenas marcar envia só marcações, mesmo com outras mudanças locais', () => {
    const prev = snap([list('checker', [item('a'), item('b')])]);
    const next = snap([list('checker', [item('a', { purchased: true, name: 'mudado', priceCents: 1 }), item('c')])]);
    const ops = diffToOps(prev, next, 'u', v);
    expect(ops.map(o => o.kind)).toEqual(['item_mark']);
    expect(ops[0].payload).toEqual({ marked: true });
  });
  it('desmarcar também é enviado por quem só marca', () => {
    const ops = diffToOps(snap([list('checker', [item('a', { purchased: true })])]), snap([list('checker', [item('a')])]), 'u', v);
    expect(ops.map(o => [o.kind, o.payload.marked])).toEqual([['item_mark', false]]);
  });
  it('editor envia edição de item', () => {
    const ops = diffToOps(snap([list('editor', [item('a')])]), snap([list('editor', [item('a', { name: 'x' })])]), 'u', v);
    expect(ops.map(o => o.kind)).toEqual(['item_update']);
  });
  it('só dono e editor editam itens', () => {
    expect(canEditItems('owner')).toBe(true);
    expect(canEditItems('editor')).toBe(true);
    expect(canEditItems('checker')).toBe(false);
    expect(canEditItems('viewer')).toBe(false);
  });
});
