import { describe, it, expect } from 'vitest';
import { buildReportModel, type ReportLineInput } from '@/lib/report';
import { buildReportPdf } from '@/lib/reportPdf';
import {
  DEFAULT_COLUMNS, layoutColumns, loadReportConfig, needsLandscape, presetColumns, saveReportConfig,
  selectedCount, usableWidth, type ColumnId,
} from '@/lib/reportConfig';
import { CATEGORIES } from '@/types/shopping';

const line = (extra: Partial<ReportLineInput>): ReportLineInput => ({
  name: 'x', unit: 'un', quantity: 1, priceBasis: 'un', lineCents: null, estimated: false, ...extra,
});
const model = (lines: ReportLineInput[]) =>
  buildReportModel({ kind: 'purchase', listName: 'Casa', purchaseDate: '2026-11-02', issuedAt: new Date(2026, 10, 2, 9, 0), lines });
const pdfText = (lines: ReportLineInput[], columns: ColumnId[], orientation?: 'portrait' | 'landscape') => {
  const doc = buildReportPdf(model(lines), { columns, orientation, compress: false });
  return { doc, raw: doc.output() };
};
/** Number of stroked rectangles (only the hand-tick boxes are drawn as rectangles). */
const boxes = (raw: string) => (raw.match(/ re\s*\nS/g) ?? []).length;

const base = [
  line({ name: 'Açúcar', category: 'alimentos', quantity: 3, priceCents: 600, lineCents: 1800 }),
  line({ name: 'Água', category: 'bebidas', quantity: 2, priceCents: 300, lineCents: 600 }),
];

describe('configuração do relatório', () => {
  it('padrão é Produto + Controle + Repor (3 colunas)', () => {
    expect(DEFAULT_COLUMNS).toEqual(['control', 'repor']);
    expect(selectedCount(DEFAULT_COLUMNS)).toBe(3);
    expect(presetColumns('financeiro')).toEqual(['quantity', 'unit', 'unitPrice', 'subtotal']);
    expect(presetColumns('compras')).toEqual(['quantity', 'unit', 'repor']);
  });

  it('T01 compacto: só Produto, Controle e Repor; 3+2 caixas de consumo e 2 Repor', () => {
    const { raw } = pdfText(base, ['control', 'repor']);
    expect(raw).toContain('(Controle)');
    expect(raw).not.toContain('(Qtd.)');
    expect(raw).not.toContain('(Unit');
    expect(boxes(raw)).toBe(3 + 2 + 2);
    expect(raw).not.toContain('Total:');
  });

  it('T02 Produto + preço + subtotal: nenhuma caixa', () => {
    const { raw } = pdfText(base, ['unitPrice', 'subtotal']);
    expect(boxes(raw)).toBe(0);
    expect(raw).toContain('Total: R$ 24,00');
  });

  it('T03 completo cabe sem sobreposição: larguras somam a área útil', () => {
    const cols: ColumnId[] = ['quantity', 'unit', 'unitPrice', 'subtotal', 'control', 'repor'];
    for (const o of ['portrait', 'landscape'] as const) {
      const sum = layoutColumns(cols, o).reduce((s, c) => s + c.width, 0);
      expect(sum).toBeCloseTo(usableWidth(o), 5);
    }
    expect(pdfText(base, cols).doc.getNumberOfPages()).toBe(1);
  });

  it('T04 100 produtos em 8 categorias: sem página por categoria', () => {
    const cats = CATEGORIES.slice(0, 8).map(c => c.id);
    const lines = Array.from({ length: 100 }, (_, i) => line({ name: `Produto ${i + 1}`, category: cats[i % 8], quantity: 2 }));
    const { doc } = pdfText(lines, ['control', 'repor']);
    expect(doc.getNumberOfPages()).toBeLessThan(8);
  });

  it('T06 20 unidades geram exatamente 20 caixas; T07 kg não gera caixa por kg', () => {
    expect(boxes(pdfText([line({ name: 'Pão', quantity: 20 })], ['control']).raw)).toBe(20);
    const kg = pdfText([line({ name: 'Carne', unit: 'kg', quantity: 3, priceBasis: 'kg' })], ['control']).raw;
    expect(boxes(kg)).toBe(0);
    expect(kg).toContain('Restante');
  });

  it('T08 preço ausente mostra "-"; T09 preço zero mostra R$ 0,00', () => {
    const m = model([line({ name: 'Sem', category: 'outros' }), line({ name: 'Brinde', category: 'outros', priceCents: 0, lineCents: 0 })]);
    expect(m.groups[0].rows[0]).toMatchObject({ unitPriceText: '-', subtotalText: '-' });
    expect(m.groups[0].rows[1]).toMatchObject({ unitPriceShort: 'R$ 0,00', subtotalText: 'R$ 0,00' });
    const raw = pdfText([line({ name: 'Sem' })], ['unitPrice', 'subtotal'], 'portrait').raw;
    expect(raw).toContain('Produtos sem pre');
  });

  it('T10 muitas colunas pedem paisagem; retrato continua sem estourar a página', () => {
    const cols: ColumnId[] = ['category', 'presentation', 'quantity', 'unit', 'unitPrice', 'subtotal', 'note', 'control', 'repor'];
    expect(needsLandscape(cols)).toBe(true);
    expect(needsLandscape(DEFAULT_COLUMNS)).toBe(false);
    const sum = layoutColumns(cols, 'portrait').reduce((s, c) => s + c.width, 0);
    expect(sum).toBeLessThanOrEqual(usableWidth('portrait') + 1e-6);
    expect(pdfText(base, cols, 'landscape').doc.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
  });

  it('T11 nome longo quebra sem perder caixas', () => {
    const { raw } = pdfText([line({ name: 'Produto com um nome muito comprido que precisa quebrar em várias linhas no relatório', quantity: 4 })], ['control', 'repor']);
    expect(boxes(raw)).toBe(5);
  });

  it('T12 última configuração fica salva só no aparelho', () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveReportConfig({ columns: ['subtotal', 'quantity', 'bogus' as ColumnId], orientation: 'landscape' }, st);
    expect(loadReportConfig(st)).toEqual({ columns: ['quantity', 'subtotal'], orientation: 'landscape' });
  });
});
