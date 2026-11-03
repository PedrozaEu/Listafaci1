import { describe, it, expect } from 'vitest';
import { lineResult, parseQuantityFor, simplifyUnit, formatQty, priceKey } from '@/lib/units';
import { normalizeLists } from '@/lib/migrations';
import { parseMoneyBR } from '@/lib/money';
import { controlFor, buildReportModel, linesFromCart } from '@/lib/report';
import { invertRoute, buildNextList } from '@/lib/route';
import { buildPurchaseRecord } from '@/lib/purchase';
import { canEditItems, type ShoppingItem, type ShoppingList } from '@/types/shopping';

const item = (extra: Partial<ShoppingItem>): ShoppingItem => ({
  id: 'i', name: 'x', quantity: 1, unit: 'un', priceBasis: 'un', purchased: false, createdAt: 1, order: 0, ...extra,
});
const one = (raw: Partial<ShoppingItem>) => normalizeLists([{ id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: [item(raw)] }])[0].items[0];
const cents = (i: Partial<ShoppingItem>) => {
  const r = lineResult(item(i));
  return r.ok ? r.cents : null;
};

describe('unidades simplificadas: un e kg', () => {
  it('T01 2 un. x R$ 10,00 = R$ 20,00', () => {
    expect(cents({ quantity: 2, unit: 'un', priceBasis: 'un', priceCents: 1000 })).toBe(2000);
  });
  it('T02 1,750 kg x R$ 39,90/kg = R$ 69,83 (meio para cima, uma vez)', () => {
    const q = parseQuantityFor('1,750', 'kg');
    expect(q).toEqual({ ok: true, value: 1.75 });
    expect(cents({ quantity: 1.75, unit: 'kg', priceBasis: 'kg', priceCents: 3990 })).toBe(6983);
  });
  it('T03 500 g legado = 0,500 kg, conversão registrada', () => {
    const i = one({ quantity: 500, unit: 'g', priceBasis: 'kg', priceCents: 3990 });
    expect([i.unit, i.quantity, i.priceBasis, i.priceCents]).toEqual(['kg', 0.5, 'kg', 3990]);
    expect(formatQty(i)).toBe('0,500 kg');
    expect(i.unitMigration).toMatchObject({ status: 'converted', from: { quantity: 500, unit: 'g' } });
  });
  it('T04 1500 g legado = 1,500 kg', () => {
    const i = one({ quantity: 1500, unit: 'g', priceBasis: 'kg' });
    expect([i.unit, i.quantity, formatQty(i)]).toEqual(['kg', 1.5, '1,500 kg']);
  });
  it('T05 3 pacotes viram 3 un. com "Pacote" na apresentação; apresentação existente não é trocada', () => {
    const a = one({ quantity: 3, unit: 'pacote', priceBasis: 'pacote', priceCents: 1200 });
    expect([a.unit, a.quantity, a.presentation, a.priceBasis, a.priceCents]).toEqual(['un', 3, 'Pacote', 'un', 1200]);
    const b = one({ quantity: 2, unit: 'pacote', priceBasis: 'pacote', packSize: 5, packUnit: 'kg' });
    expect(b.presentation).toBe('Pacote 5 kg');
    const c = one({ quantity: 2, unit: 'pacote', priceBasis: 'pacote', packSize: 5, packUnit: 'kg', presentation: 'Fardo Tio João' });
    expect(c.presentation).toBe('Fardo Tio João');
  });
  it('T06 2 L legado não vira 2 un.: fica em revisão, sem perder valor', () => {
    const i = one({ quantity: 2, unit: 'L', priceBasis: 'L', priceCents: 450 });
    expect(i.unit).toBe('L');
    expect(i.unitMigration?.status).toBe('review');
    expect(cents(i)).toBe(900);
  });
  it('T07 500 mL legado não é convertido em silêncio', () => {
    const i = one({ quantity: 500, unit: 'mL', priceBasis: 'L' });
    expect([i.unit, i.quantity, i.unitMigration?.status]).toEqual(['mL', 500, 'review']);
  });
  it('pacote com preço por kg, unidade desconhecida e grama fracionada também vão para revisão', () => {
    expect(one({ quantity: 2, unit: 'pacote', priceBasis: 'kg', packSize: 5, packUnit: 'kg' }).unitMigration?.status).toBe('review');
    expect(one({ quantity: 2, unit: 'duzia' as never }).unitMigration).toMatchObject({ status: 'review', from: { unit: 'duzia', quantity: 2 } });
    expect(one({ quantity: 0.5, unit: 'g', priceBasis: 'kg' }).unitMigration?.status).toBe('review');
  });
  it('migração é idempotente', () => {
    const once = one({ quantity: 500, unit: 'g', priceBasis: 'kg' });
    const twice = normalizeLists([{ id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: [once] }])[0].items[0];
    expect(twice).toEqual(once);
    const rev = one({ quantity: 2, unit: 'L', priceBasis: 'L' });
    expect(simplifyUnit(rev)).toMatchObject({ unit: 'L', quantity: 2, unitMigration: rev.unitMigration });
  });
  it('T08 1,5 em un. é rejeitado e nunca vira 15', () => {
    expect(parseQuantityFor('1,5', 'un')).toEqual({ ok: false, error: 'Para itens em unidades, informe uma quantidade inteira.' });
    expect(parseQuantityFor('1.5', 'un').ok).toBe(false);
  });
  it('T09 1,5 em kg = 1,500 kg; 1.750 colado = 1,750 kg (nunca 1750)', () => {
    expect(parseQuantityFor('1,5', 'kg')).toEqual({ ok: true, value: 1.5 });
    expect(formatQty({ quantity: 1.5, unit: 'kg' })).toBe('1,500 kg');
    expect(parseQuantityFor('1.750', 'kg')).toEqual({ ok: true, value: 1.75 });
    expect(formatQty({ quantity: 1, unit: 'kg' })).toBe('1 kg');
    expect(parseQuantityFor('1,2345', 'kg').ok).toBe(false);
  });
  it('T10 preço zero continua sendo zero', () => {
    expect(parseMoneyBR('0,00')).toEqual({ ok: true, value: 0 });
    expect(cents({ quantity: 3, priceCents: 0 })).toBe(0);
  });
  it('T11 sem preço é diferente de R$ 0,00', () => {
    expect(parseMoneyBR('')).toEqual({ ok: true, value: undefined });
    expect(lineResult(item({ quantity: 3 }))).toEqual({ ok: false, reason: 'missing' });
  });
  it('T12 Açúcar 10 un.: exatamente 10 caixas de consumo + 1 REPOR', () => {
    expect(controlFor({ unit: 'un', quantity: 10 })).toEqual({ kind: 'boxes', count: 10 });
    const m = buildReportModel({ kind: 'cart', listName: 'L', purchaseDate: '2026-11-02', issuedAt: new Date(),
      lines: [{ name: 'Açúcar', unit: 'un', quantity: 10, priceBasis: 'un', lineCents: null, estimated: false }] });
    expect([m.totals.consumeBoxes, m.totals.reporBoxes]).toEqual([10, 1]);
  });
  it('T13 Carne 1,750 kg: nenhuma caixa por kg, só REPOR e Restante em kg', () => {
    expect(controlFor({ unit: 'kg', quantity: 1.75 })).toEqual({ kind: 'remaining', unit: 'kg' });
    const m = buildReportModel({ kind: 'cart', listName: 'L', purchaseDate: '2026-11-02', issuedAt: new Date(),
      lines: [{ name: 'Carne', unit: 'kg', quantity: 1.75, priceBasis: 'kg', lineCents: 6983, estimated: false }] });
    expect([m.totals.consumeBoxes, m.totals.reporBoxes]).toEqual([0, 1]);
  });
  it('T14 Arroz Pacote 5 kg, 2 un. x R$ 28,90 = R$ 57,80 e 2 caixas no PDF', () => {
    const arroz = item({ name: 'Arroz', presentation: 'Pacote 5 kg', quantity: 2, unit: 'un', priceBasis: 'un', priceCents: 2890, purchased: true });
    expect(cents(arroz)).toBe(5780);
    const list: ShoppingList = { id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: [arroz] };
    const m = buildReportModel({ kind: 'cart', listName: 'L', purchaseDate: '2026-11-02', issuedAt: new Date(), lines: linesFromCart(list) });
    expect(m.totals.consumeBoxes).toBe(2);
    expect(m.groups[0].rows[0]).toMatchObject({ presentation: 'Pacote 5 kg', qtyText: '2 un.' });
  });
  it('relatório não soma un. com kg', () => {
    const m = buildReportModel({ kind: 'cart', listName: 'L', purchaseDate: '2026-11-02', issuedAt: new Date(), lines: [
      { name: 'A', unit: 'un', quantity: 37, priceBasis: 'un', lineCents: 100, estimated: false },
      { name: 'B', unit: 'kg', quantity: 8.45, priceBasis: 'kg', lineCents: 100, estimated: false },
    ] });
    expect(m.totals.byUnit).toEqual(['37 un.', '8,450 kg']);
  });
  it('T15 checker não edita unidade pela interface', () => {
    expect(canEditItems('checker')).toBe(false);
    expect(canEditItems('editor')).toBe(true);
  });
  it('T16 inverter a lista não muda unidade nem apresentação', () => {
    const items = [item({ id: 'a', order: 0, presentation: 'Pacote 5 kg' }), item({ id: 'b', order: 1, unit: 'kg', priceBasis: 'kg', quantity: 1.75 })];
    const inv = invertRoute(items);
    expect(inv.map(i => [i.id, i.unit, i.presentation, i.quantity]).sort()).toEqual([['a', 'un', 'Pacote 5 kg', 1], ['b', 'kg', undefined, 1.75]]);
  });
  it('T17 próxima compra preserva nome, apresentação, unidade e quantidade; preço vira estimativa', () => {
    const src: ShoppingList = { id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: [
      item({ id: 'a', name: 'Carne', unit: 'kg', priceBasis: 'kg', quantity: 1.75, priceCents: 3990, presentation: 'Patinho' }),
    ] };
    let n = 0;
    const next = buildNextList(src, { name: 'N', invert: false, keepBudget: false, usePrices: true }, { newId: () => `n${n++}`, now: 2 });
    expect(next.items[0]).toMatchObject({ name: 'Carne', unit: 'kg', quantity: 1.75, presentation: 'Patinho', priceCents: 3990, priceEstimated: true });
  });
  it('T18 compra concluída guarda a unidade da época e não muda depois', () => {
    const list: ShoppingList = { id: 'l', name: 'L', emoji: '🛒', createdAt: 1, items: [
      item({ id: 'a', name: 'Carne', unit: 'kg', priceBasis: 'kg', quantity: 1.75, priceCents: 3990, purchased: true, presentation: 'Patinho' }),
    ] };
    const rec = buildPurchaseRecord(list, { id: 'p', purchasedOn: '2026-11-02', now: 1, confirmedIds: new Set() });
    list.items[0].unit = 'un';
    list.items[0].quantity = 9;
    expect(rec.lines[0]).toMatchObject({ unit: 'kg', quantity: 1.75, presentation: 'Patinho', lineCents: 6983 });
    expect(Object.isFrozen(rec.lines[0])).toBe(true);
  });
  it('histórico de preço: un. e kg nunca se misturam; apresentação separa', () => {
    expect(priceKey('arroz', { unit: 'un', priceBasis: 'un' })).not.toBe(priceKey('arroz', { unit: 'kg', priceBasis: 'kg' }));
    expect(priceKey('arroz', { unit: 'un', priceBasis: 'un', presentation: 'Pacote 5 kg' }))
      .not.toBe(priceKey('arroz', { unit: 'un', priceBasis: 'un', presentation: 'Pacote 1 kg' }));
    expect(priceKey('arroz', { unit: 'un', priceBasis: 'un', presentation: 'Pacote 5 kg' }, false)).toBe('arroz');
  });
});
