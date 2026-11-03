import { describe, it, expect } from 'vitest';
import { invertRoute, routeSequence, canUndoInversion, orderSnapshot, applyOrders, buildNextList } from '@/lib/route';
import { normalizeLists } from '@/lib/migrations';
import type { ShoppingItem, ShoppingList } from '@/types/shopping';

const item = (id: string, order: number, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, name: id, quantity: 1, purchased: false, createdAt: 1000 + order, order, ...extra,
});
const names = (items: ShoppingItem[]) => routeSequence(items).map(i => i.id);

describe('inverter roteiro', () => {
  const cba = [item('C', 0), item('B', 1, { purchased: true, priceCents: 0 }), item('A', 2, { category: 'limpeza' })];

  it('C, B, A vira A, B, C e volta', () => {
    const inv = invertRoute(cba);
    expect(names(inv)).toEqual(['A', 'B', 'C']);
    expect(names(invertRoute(inv))).toEqual(['C', 'B', 'A']);
  });

  it('não altera ids, datas, marcação, preço nem categoria e não muta a entrada', () => {
    const before = JSON.stringify(cba);
    const inv = invertRoute(cba);
    expect(JSON.stringify(cba)).toBe(before);
    const b = inv.find(i => i.id === 'B')!;
    expect(b).toMatchObject({ purchased: true, priceCents: 0, createdAt: 1001 });
    expect(inv.find(i => i.id === 'A')!.category).toBe('limpeza');
  });

  it('desempate estável com posições repetidas', () => {
    const tie = [item('X', 0, { createdAt: 1 }), item('Y', 0, { createdAt: 2 })];
    expect(names(tie)).toEqual(['Y', 'X']);
    expect(names(invertRoute(tie))).toEqual(['X', 'Y']);
  });

  it('lista vazia e item único', () => {
    expect(invertRoute([])).toEqual([]);
    expect(names(invertRoute([item('A', 5)]))).toEqual(['A']);
  });

  it('persiste após recarregar (normalização mantém posições e preferência)', () => {
    const list: ShoppingList = { id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: invertRoute(cba), sortMode: 'custom' };
    const [reloaded] = normalizeLists(JSON.parse(JSON.stringify([list])));
    expect(names(reloaded.items)).toEqual(['A', 'B', 'C']);
    expect(reloaded.sortMode).toBe('custom');
  });

  it('desfazer só quando nada mudou depois', () => {
    const before = orderSnapshot(cba);
    const inv = invertRoute(cba);
    const after = orderSnapshot(inv);
    expect(canUndoInversion(inv, after)).toBe(true);
    expect(names(applyOrders(inv, before))).toEqual(['C', 'B', 'A']);
    const moved = inv.map(i => (i.id === 'A' ? { ...i, order: 9 } : i));
    expect(canUndoInversion(moved, after)).toBe(false);
    expect(canUndoInversion([...inv, item('D', 3)], after)).toBe(false);
  });
});

describe('criar próxima compra', () => {
  const source: ShoppingList = {
    id: 'src', name: 'Março', emoji: '🛒', createdAt: 1, budgetCents: 50000,
    items: [item('C', 0, { purchased: true, priceCents: 500 }), item('B', 1), item('A', 2, { purchased: true })],
  };
  let n = 0;
  const deps = { newId: () => `n${n++}`, now: 99 };

  it('novos ids, tudo pendente, origem intacta', () => {
    const snap = JSON.stringify(source);
    const next = buildNextList(source, { name: 'Abril', invert: false, keepBudget: true, usePrices: true }, deps);
    expect(JSON.stringify(source)).toBe(snap);
    expect(next.sourceListId).toBe('src');
    expect(next.id).not.toBe('src');
    expect(next.items.every(i => !i.purchased)).toBe(true);
    expect(next.items.some(i => ['A', 'B', 'C'].includes(i.id))).toBe(false);
    expect(routeSequence(next.items).map(i => i.name)).toEqual(['C', 'B', 'A']);
    expect(next.budgetCents).toBe(50000);
    expect(next.items[0].priceCents).toBe(500);
  });

  it('inverter roteiro e não reaproveitar orçamento/preços', () => {
    const next = buildNextList(source, { name: '', invert: true, keepBudget: false, usePrices: false }, deps);
    expect(routeSequence(next.items).map(i => i.name)).toEqual(['A', 'B', 'C']);
    expect(next.budgetCents).toBeUndefined();
    expect(next.items.every(i => i.priceCents === undefined)).toBe(true);
    expect(next.name).toBe('Março (próxima)');
  });

  it('lista vazia', () => {
    const next = buildNextList({ ...source, items: [] }, { name: 'X', invert: true, keepBudget: false, usePrices: false }, deps);
    expect(next.items).toEqual([]);
  });
});
