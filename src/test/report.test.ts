import { describe, it, expect } from 'vitest';
import { buildReportModel, controlFor, type ReportLineInput } from '@/lib/report';
import { splitBoxes, boxesPerRow, buildReportPdf } from '@/lib/reportPdf';

const line = (extra: Partial<ReportLineInput>): ReportLineInput => ({
  name: 'x', unit: 'un', quantity: 1, priceBasis: 'un', lineCents: null, estimated: false, ...extra,
});

// Test fixture only (never stored in production data).
const fixture = [
  line({ name: 'Açúcar', category: 'alimentos', quantity: 10, priceCents: 600, lineCents: 6000 }),
  line({ name: 'Água', category: 'bebidas', quantity: 8, priceCents: 300, lineCents: 2400 }),
];

describe('relatório de reposição', () => {
  it('fixture: 2 produtos, 2 categorias, 18 caixas de consumo, 2 Repor, R$ 84,00', () => {
    const m = buildReportModel({ kind: 'purchase', listName: 'Casa', purchaseDate: '2026-10-09', issuedAt: new Date(2026, 9, 9, 8, 30), lines: fixture });
    expect(m.totals).toMatchObject({ products: 2, categories: 2, consumeBoxes: 18, reporBoxes: 2, cents: 8400, missing: 0 });
    expect(m.groups.map(g => g.label)).toEqual(['Alimentos', 'Bebidas']);
    expect(m.monthRef).toBe('outubro de 2026');
    expect(m.purchaseDate).toBe('09/10/2026');
  });

  it('2 pacotes de 5 kg = 2 caixas com legenda', () => {
    expect(controlFor({ unit: 'pacote', quantity: 2, packSize: 5, packUnit: 'kg' }))
      .toEqual({ kind: 'boxes', count: 2, legend: '1 caixa = 1 pacote de 5 kg' });
  });

  it('massa sem porção: campo Restante, sem caixas inventadas', () => {
    expect(controlFor({ unit: 'kg', quantity: 1.5 })).toEqual({ kind: 'remaining', unit: 'kg' });
  });

  it('1,5 kg em porções de 0,5 kg = 3 caixas; sobra explícita', () => {
    expect(controlFor({ unit: 'kg', quantity: 1.5, controlPortion: 0.5 })).toMatchObject({ kind: 'boxes', count: 3, remainder: undefined });
    expect(controlFor({ unit: 'kg', quantity: 1.7, controlPortion: 0.5 }))
      .toMatchObject({ kind: 'boxes', count: 3, remainder: 'sobra de 0,2 kg fora das caixas' });
  });

  it('não soma kg, litros e pacotes; preço ausente não vira zero', () => {
    const m = buildReportModel({ kind: 'cart', listName: 'L', purchaseDate: '2026-01-31', issuedAt: new Date(), lines: [
      line({ unit: 'kg', quantity: 1.5, priceBasis: 'kg' }),
      line({ unit: 'L', quantity: 2, priceBasis: 'L', priceCents: 0, lineCents: 0 }),
      line({ unit: 'pacote', quantity: 2, priceBasis: 'pacote' }),
    ] });
    expect(m.totals.byUnit).toEqual(['1,500 kg', '2 L', '2 pacotes']);
    expect(m.totals.missing).toBe(2);
    expect(m.totals.cents).toBe(0);
    expect(m.subtitle).toBe('Compra em andamento, não conferida');
  });

  it('itens grandes continuam sem perder caixas', () => {
    const per = boxesPerRow(60);
    const chunks = splitBoxes(9999, per);
    expect(chunks.reduce((a, b) => a + b, 0)).toBe(9999);
    expect(splitBoxes(60, per)).toEqual([60]);
  });

  it('gera PDF com texto real', () => {
    const m = buildReportModel({ kind: 'purchase', listName: 'Casa', purchaseDate: '2026-10-09', issuedAt: new Date(), lines: fixture });
    const doc = buildReportPdf(m, { columns: ['quantity', 'unitPrice', 'subtotal', 'control', 'repor'] });
    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.output()).toContain('ListaF');
  });
});
