import { describe, it, expect } from 'vitest';
import { buildCsv, buildTxtExport, buildWhatsAppText, csvEscape, groupByCategory, type ExportScope } from '@/lib/export';
import { totalsOf } from '@/lib/money';
import { normalizeText } from '@/lib/text';
import type { ShoppingItem } from '@/types/shopping';

const item = (over: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  name: 'Item',
  quantity: 1,
  purchased: false,
  createdAt: 0,
  order: 0,
  ...over,
});

describe('normalizeText', () => {
  it('strips accents and casing', () => {
    expect(normalizeText('Açúcar')).toBe('acucar');
    expect(normalizeText('  ÓLEO ')).toBe('oleo');
  });
});

describe('csvEscape', () => {
  it('quotes values containing commas', () => {
    expect(csvEscape('Leite, integral')).toBe('"Leite, integral"');
  });
  it('escapes double quotes', () => {
    expect(csvEscape('Marca "X"')).toBe('"Marca ""X"""');
  });
  it('leaves plain values untouched', () => {
    expect(csvEscape('Leite')).toBe('Leite');
    expect(csvEscape(undefined)).toBe('');
  });
});

describe('totals and grouping', () => {
  it('sums price * quantity in cents and counts missing prices apart', () => {
    expect(totalsOf([item({ priceCents: 550, quantity: 2 }), item({ quantity: 3 })])).toEqual({ cents: 1100, priced: 1, missing: 1 });
  });
  it('puts uncategorized items into outros', () => {
    const groups = groupByCategory([item({ name: 'X' }), item({ name: 'Y', category: 'limpeza' })]);
    expect(groups.map(g => g.id)).toEqual(['limpeza', 'outros']);
  });
});

describe('buildCsv', () => {
  it('keeps column count stable with commas in fields', () => {
    const csv = buildCsv([item({ name: 'Pão, francês', note: 'sem sal, quente', priceCents: 200 })]);
    const row = csv.split('\n')[1];
    expect(row).toContain('"Pão, francês"');
    expect(row).toContain('"sem sal, quente"');
  });
});

const ALL: ExportScope = { kind: 'all', label: 'Lista completa' };

describe('buildWhatsAppText / buildTxtExport', () => {
  const arroz = item({ name: 'Arroz', priceCents: 1000, quantity: 2, category: 'alimentos' });
  const sabao = item({ name: 'Sabão', priceCents: 500, purchased: true, category: 'limpeza' });

  it('includes both sections and the total of the exported items', () => {
    const text = buildWhatsAppText('Semana', [arroz, sabao], ALL);
    expect(text).toContain('PENDENTES');
    expect(text).toContain('COMPRADOS');
    expect(text).toContain('Total: R$ 25,00');
    expect(text).toContain('Lista completa');
  });

  it('a filtered export closes its own total', () => {
    const scope: ExportScope = { kind: 'visible', label: 'Seleção visível (1 de 2 itens)' };
    const text = buildWhatsAppText('Semana', [sabao], scope);
    expect(text).toContain('Total: R$ 5,00');
    expect(text).not.toContain('Arroz');
    expect(text).toContain('Seleção visível (1 de 2 itens)');
  });

  it('a missing price is not exported as free', () => {
    const semPreco = item({ name: 'Ovos', quantity: 12 });
    const text = buildWhatsAppText('Semana', [arroz, semPreco], ALL);
    expect(text).toContain('Ovos: 12x sem preço');
    expect(text).toContain('Total: R$ 20,00 (1 item sem preço não somado)');
    expect(buildCsv([semPreco]).split('\n')[1]).toBe('Ovos,Outros,12,,,Pendente,,un,,un');
  });

  it('price zero is exported as R$ 0,00', () => {
    const gratis = item({ name: 'Brinde', priceCents: 0, quantity: 2 });
    expect(buildWhatsAppText('S', [gratis], ALL)).toContain('Brinde: 2x R$ 0,00 = R$ 0,00');
  });

  it('txt export carries the readable and csv sections', () => {
    const txt = buildTxtExport('Semana', [arroz, sabao], ALL);
    expect(txt).toContain('[ ] Arroz');
    expect(txt).toContain('[x] Sabão');
    expect(txt).toContain('DADOS (CSV)');
    expect(txt).toContain('Total: R$ 25,00');
  });
});
