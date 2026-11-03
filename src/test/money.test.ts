import { describe, it, expect } from 'vitest';
import { parseMoneyBR, parseQuantity, formatBRL, centsToInput, lineTotal, totalsOf } from '@/lib/money';
import { migrateRaw, STORAGE_VERSION } from '@/lib/migrations';
import { upgradeSnapshot } from '@/lib/backup';

const cents = (raw: string) => {
  const r = parseMoneyBR(raw);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

describe('parseMoneyBR', () => {
  it('reads pt-BR values exactly in cents', () => {
    expect(cents('6,00')).toBe(600);
    expect(cents('1.234,56')).toBe(123456);
    expect(cents('1234,56')).toBe(123456);
    expect(cents('5,5')).toBe(550);
    expect(cents('R$ 10')).toBe(1000);
    expect(cents('5.49')).toBe(549);
    expect(cents('0,10')).toBe(10);
  });

  it('keeps "not informed" apart from zero', () => {
    expect(cents('')).toBeUndefined();
    expect(cents('0')).toBe(0);
    expect(cents('0,00')).toBe(0);
  });

  it('rejects invalid input with a message instead of dropping separators', () => {
    for (const bad of ['1,2,3', '12.34.5', 'abc', '1,234', '-5', '1.23,4,5']) {
      expect(parseMoneyBR(bad).ok).toBe(false);
    }
  });
});

describe('parseQuantity', () => {
  it('rejects 1,5 and never turns it into 15', () => {
    const r = parseQuantity('1,5');
    expect(r.ok).toBe(false);
    expect(parseQuantity('1.5').ok).toBe(false);
  });
  it('accepts whole numbers from 1', () => {
    expect(parseQuantity('15')).toEqual({ ok: true, value: 15 });
    expect(parseQuantity('0').ok).toBe(false);
  });
});

describe('formatting', () => {
  it('sums only checked items for the cart, preserving missing and zero prices', () => {
    const items = [
      { quantity: 2, priceCents: 549, purchased: true },
      { quantity: 1, priceCents: 0, purchased: true },
      { quantity: 1, purchased: true },
      { quantity: 3, priceCents: 600, purchased: false },
    ];
    expect(totalsOf(items.filter(i => i.purchased))).toEqual({ cents: 1098, priced: 2, missing: 1 });
    expect(totalsOf(items).cents).toBe(2898);
    expect(totalsOf([])).toEqual({ cents: 0, priced: 0, missing: 0 });
  });
  it('formats cents in pt-BR', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(centsToInput(600)).toBe('6,00');
  });
  it('line total is null when price is missing, 0 when price is zero', () => {
    expect(lineTotal({ quantity: 3 })).toBeNull();
    expect(lineTotal({ quantity: 3, priceCents: 0 })).toBe(0);
  });
});

describe('v3 -> v4 money migration', () => {
  const v3 = {
    version: 3,
    lists: [{
      id: 'l', name: 'L', emoji: '🛒', createdAt: 1, budget: 150.5,
      items: [
        { id: 'a', name: 'Arroz', quantity: 2, price: 5.49, purchased: false, createdAt: 1, order: 0 },
        { id: 'b', name: 'Brinde', quantity: 1, price: 0, purchased: false, createdAt: 1, order: 1 },
        { id: 'c', name: 'Ovos', quantity: 1, purchased: false, createdAt: 1, order: 2 },
      ],
    }],
    priceHistory: { arroz: { '2026-09': 5.49 } },
  };

  it('converts reais to cents once, keeping zero and missing apart', () => {
    const s = upgradeSnapshot(v3 as never);
    const [a, b, c] = s.lists[0].items;
    expect(a.priceCents).toBe(549);
    expect(b.priceCents).toBe(0);
    expect(c.priceCents).toBeUndefined();
    expect(s.lists[0].budgetCents).toBe(15050);
    expect(s.priceHistory.arroz['2026-09']).toBe(549);
    expect(s.version).toBe(STORAGE_VERSION);
  });

  it('does not multiply by 100 again when run on current data', () => {
    const once = upgradeSnapshot(v3 as never);
    const twice = upgradeSnapshot(once);
    expect(twice.lists[0].items[0].priceCents).toBe(549);
    expect(twice.priceHistory.arroz['2026-09']).toBe(549);
    expect(migrateRaw({ ...once }, STORAGE_VERSION).priceHistory).toEqual(once.priceHistory);
  });
});
