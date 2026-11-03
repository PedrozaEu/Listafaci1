import { describe, it, expect, beforeEach } from 'vitest';
import { lineResult, parseQuantityFor, formatQty, priceKey } from '@/lib/units';
import { buildPurchaseRecord } from '@/lib/purchase';
import { migrateRaw, normalizeLists } from '@/lib/migrations';
import { useStore } from '@/store/useStore';
import type { ShoppingItem, ShoppingList } from '@/types/shopping';

const it_ = (id: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id, name: id, quantity: 1, purchased: false, createdAt: 1, order: 0, ...extra,
});

describe('unidades e cálculo', () => {
  it('1,5 kg a R$ 10,00/kg = R$ 15,00', () => {
    const q = parseQuantityFor('1,5', 'kg');
    expect(q).toEqual({ ok: true, value: 1.5 });
    expect(lineResult({ quantity: 1.5, unit: 'kg', priceCents: 1000, priceBasis: 'kg' })).toEqual({ ok: true, cents: 1500 });
  });

  it('2 pacotes de 5 kg a R$ 25,00/pacote = R$ 50,00 e 2 embalagens', () => {
    const i = { quantity: 2, unit: 'pacote' as const, packSize: 5, packUnit: 'kg' as const, priceCents: 2500, priceBasis: 'pacote' as const };
    expect(lineResult(i)).toEqual({ ok: true, cents: 5000 });
    expect(formatQty(i)).toBe('2 pacotes de 5 kg');
    // the same packages priced per kg: 10 kg × R$ 5,00
    expect(lineResult({ ...i, priceCents: 500, priceBasis: 'kg' })).toEqual({ ok: true, cents: 5000 });
  });

  it('converte g e mL, arredonda uma vez por linha', () => {
    expect(lineResult({ quantity: 250, unit: 'g', priceCents: 3990, priceBasis: 'kg' })).toEqual({ ok: true, cents: 998 });
    expect(lineResult({ quantity: 0.333, unit: 'kg', priceCents: 1000, priceBasis: 'kg' })).toEqual({ ok: true, cents: 333 });
    expect(lineResult({ quantity: 350, unit: 'mL', priceCents: 1000, priceBasis: 'L' })).toEqual({ ok: true, cents: 350 });
  });

  it('rejeita combinações incompatíveis e mantém preço ausente como ausente', () => {
    expect(lineResult({ quantity: 3, unit: 'un', priceCents: 500, priceBasis: 'kg' })).toEqual({ ok: false, reason: 'incompatible' });
    expect(lineResult({ quantity: 2, unit: 'pacote', priceCents: 500, priceBasis: 'kg' })).toEqual({ ok: false, reason: 'incompatible' });
    expect(lineResult({ quantity: 1, unit: 'kg', priceBasis: 'kg' })).toEqual({ ok: false, reason: 'missing' });
  });

  it('quantidade: inteira em un/pacote, até 3 casas em massa/volume', () => {
    expect(parseQuantityFor('1,5', 'un').ok).toBe(false);
    expect(parseQuantityFor('1,5', 'pacote').ok).toBe(false);
    expect(parseQuantityFor('0,1234', 'kg').ok).toBe(false);
    expect(parseQuantityFor('0,125', 'L')).toEqual({ ok: true, value: 0.125 });
  });

  it('precisão preservada ao recarregar (normalização)', () => {
    const [l] = normalizeLists([{ id: 'l', name: 'L', emoji: 'x', createdAt: 1, items: [it_('a', { unit: 'kg', quantity: 1.255, priceBasis: 'kg' })] }]);
    expect(l.items[0].quantity).toBe(1.255);
    expect(l.items[0].unit).toBe('kg');
  });

  it('itens antigos viram un com preço por unidade', () => {
    const m = migrateRaw({ lists: [{ id: 'l', items: [{ id: 'a', name: 'a', quantity: 2, priceCents: 100 }] }] }, 4);
    const items = (m.lists as ShoppingList[])[0].items;
    expect(items[0]).toMatchObject({ unit: 'un', priceBasis: 'un' });
  });

  it('histórico de preço separa base e embalagem', () => {
    expect(priceKey('arroz', { unit: 'un' })).toBe('arroz');
    expect(priceKey('arroz', { unit: 'kg', priceBasis: 'kg' })).toBe('arroz::kg');
    expect(priceKey('arroz', { unit: 'pacote', priceBasis: 'pacote', packSize: 5, packUnit: 'kg' })).toBe('arroz::pacote:5kg');
    expect(priceKey('arroz', { unit: 'pacote', priceBasis: 'pacote', packSize: 1, packUnit: 'kg' })).not.toBe('arroz::pacote:5kg');
  });
});

describe('registro da compra', () => {
  const list: ShoppingList = {
    id: 'L', name: 'Mercado', emoji: 'x', createdAt: 1,
    items: [
      it_('arroz', { purchased: true, unit: 'pacote', quantity: 2, packSize: 5, packUnit: 'kg', priceCents: 2500, priceBasis: 'pacote', order: 1 }),
      it_('carne', { purchased: true, unit: 'kg', quantity: 1.5, priceCents: 1000, priceBasis: 'kg', order: 0 }),
      it_('sabão', { purchased: true, priceCents: 800, priceEstimated: true, order: 2 }),
      it_('leite', { purchased: true, order: 3 }),
      it_('pão', { purchased: false, priceCents: 500, order: 4 }),
    ],
  };

  it('só itens marcados; estimado até confirmar; total parcial sem preço', () => {
    const r = buildPurchaseRecord(list, { id: 'p1', purchasedOn: '2026-10-09', now: 5, confirmedIds: new Set() });
    expect(r.lines.map(l => l.name)).toEqual(['carne', 'arroz', 'sabão', 'leite']);
    expect(r.lines.some(l => l.name === 'pão')).toBe(false);
    expect(r.confirmedCents).toBe(6500);
    expect(r.estimatedCents).toBe(800);
    expect(r.missingCount).toBe(1);
    expect(r.complete).toBe(false);
    expect(r.lines.find(l => l.name === 'leite')!.lineCents).toBeNull();
    expect(r.lines.every(l => l.author === undefined)).toBe(true);
    const ok = buildPurchaseRecord(list, { id: 'p2', purchasedOn: '2026-10-09', now: 5, confirmedIds: new Set(['sabão']) });
    expect(ok.confirmedCents).toBe(7300);
  });

  it('registro é imutável', () => {
    const r = buildPurchaseRecord(list, { id: 'p1', purchasedOn: '2026-10-09', now: 5, confirmedIds: new Set() });
    expect(Object.isFrozen(r.lines[0])).toBe(true);
  });
});

describe('concluir compra na loja', () => {
  beforeEach(() => {
    useStore.setState({ lists: [JSON.parse(JSON.stringify({
      id: 'L', name: 'Mercado', emoji: 'x', createdAt: 1,
      items: [it_('a', { purchased: true, priceCents: 100 }), it_('b', { order: 1 })],
    }))], activeListId: 'L', purchases: [] });
  });

  it('toque repetido não duplica; pendentes ficam; editar depois não altera o histórico', () => {
    const input = { id: 'same', purchasedOn: '2026-10-09', now: 1, confirmedIds: new Set<string>() };
    const s = useStore.getState();
    expect(s.completePurchase('L', input, 'keep').status).toBe('ok');
    expect(useStore.getState().completePurchase('L', input, 'keep').status).toBe('duplicate');
    const st = useStore.getState();
    expect(st.purchases).toHaveLength(1);
    expect(st.lists[0].items.map(i => i.id)).toEqual(['b']);
    st.updateItem('b', { name: 'mudou' });
    useStore.setState(x => ({ lists: x.lists.map(l => ({ ...l, name: 'Outro nome' })) }));
    expect(useStore.getState().purchases[0].listName).toBe('Mercado');
    expect(useStore.getState().purchases[0].lines.map(l => l.name)).toEqual(['a']);
  });

  it('mover pendentes cria nova lista e não perde nada', () => {
    const r = useStore.getState().completePurchase('L', { id: 'x', purchasedOn: '2026-10-09', now: 1, confirmedIds: new Set() }, 'move');
    expect(r.status).toBe('ok');
    const st = useStore.getState();
    expect(st.lists).toHaveLength(2);
    expect(st.lists[1].items.map(i => i.id)).toEqual(['b']);
    expect(st.lists[0].items).toEqual([]);
  });

  it('manter comprados: ficam na lista desmarcados, na mesma ordem, e a compra é guardada', () => {
    const r = useStore.getState().completePurchase('L', { id: 'k', purchasedOn: '2026-10-09', now: 1, confirmedIds: new Set() }, 'keep', undefined, 'keep');
    expect(r.status).toBe('ok');
    const st = useStore.getState();
    expect(st.lists[0].items.map(i => [i.id, i.purchased])).toEqual([['a', false], ['b', false]]);
    expect(st.purchases[0].lines.map(l => l.itemId)).toEqual(['a']);
  });

  it('manter comprados e mover pendentes: comprados ficam, pendentes vão para nova lista', () => {
    useStore.getState().completePurchase('L', { id: 'm', purchasedOn: '2026-10-09', now: 1, confirmedIds: new Set() }, 'move', undefined, 'keep');
    const st = useStore.getState();
    expect(st.lists[0].items.map(i => i.id)).toEqual(['a']);
    expect(st.lists[1].items.map(i => i.id)).toEqual(['b']);
  });
});
