import { jsPDF } from 'jspdf';
import autoTable, { type CellDef, type RowInput } from 'jspdf-autotable';
import type { Control, ReportModel, ReportRow } from '@/lib/report';
import { formatBRL } from '@/lib/money';
import {
  COLUMN_HEAD, DEFAULT_COLUMNS, MARGIN, PAGE, hasPriceColumns, layoutColumns, presentationInline,
  type ColumnId, type ColumnLayout, type Orientation,
} from '@/lib/reportConfig';

/** Millimetres. Boxes stay large enough to tick by hand. */
const BOX = 3.6;
const GAP = 1.2;
const PAD = 1.1;
const SEP = 4.2; // category separator drawn inside the top padding of a group's first row
const LEGEND_LINE = 3;
const FIRST_TOP = MARGIN + 15; // table start on page 1 (compact header above)
const NEXT_TOP = MARGIN + 6; // later pages: one short header line
const BOTTOM = 9;
const MAX_BOX_ROWS = 28;
const TOTAL_PAGES = '{np}';
const BODY_PT = 8.5;

export interface PdfOptions {
  /** Selected columns besides Produto. Default: the compact replenishment profile. */
  columns?: ColumnId[];
  orientation?: Orientation;
  /** Tests turn stream compression off to inspect the drawing operators. */
  compress?: boolean;
}

interface RowMeta {
  control: Control;
  boxes: number;
  legend: string[];
  first: boolean;
  /** Category label drawn above this row (first row of a group). */
  sep?: string;
}

export const boxesPerRow = (controlWidth: number) =>
  Math.max(1, Math.floor((controlWidth - 2 * PAD + GAP) / (BOX + GAP)));

/** Splits a row's boxes into chunks that each fit on one page. Total boxes are always preserved. */
export function splitBoxes(count: number, perRow: number): number[] {
  const max = perRow * MAX_BOX_ROWS;
  if (count <= max) return [count];
  const out: number[] = [];
  for (let left = count; left > 0; left -= max) out.push(Math.min(max, left));
  return out;
}

const boxesHeight = (boxes: number, perRow: number, legendLines: number) => {
  const rows = Math.max(1, Math.ceil(boxes / perRow));
  return 2 * PAD + rows * BOX + (rows - 1) * GAP + legendLines * LEGEND_LINE;
};

const monthTitle = (ref: string) => {
  const [m, y] = ref.split(' de ');
  return `${m.charAt(0).toUpperCase()}${m.slice(1)}/${y}`;
};

const cellText = (id: ColumnId, r: ReportRow, cols: readonly ColumnId[], first: boolean): string => {
  if (!first) return '';
  const unitShown = cols.includes('unit');
  switch (id) {
    case 'category': return r.categoryLabel;
    case 'presentation': return r.presentation ?? '';
    case 'quantity': return unitShown ? r.qtyNumber : r.qtyText;
    case 'unit': return r.unitText;
    case 'unitPrice': return unitShown ? r.unitPriceShort : r.unitPriceText;
    case 'subtotal': return r.subtotalText;
    case 'note': return r.note ?? '';
    case 'control': return r.control.kind === 'remaining' ? 'Restante: __________' : '';
    case 'repor': return '';
  }
};

export function buildReportPdf(model: ReportModel, opts: PdfOptions = {}): jsPDF {
  const cols = opts.columns ?? DEFAULT_COLUMNS;
  const orientation = opts.orientation ?? 'portrait';
  const { w: PW, h: PH } = PAGE[orientation];
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation, compress: opts.compress ?? true });
  doc.setProperties({ title: `ListaFácil - ${model.listName}`, creator: 'ListaFácil' });

  const layout: ColumnLayout[] = layoutColumns(cols, orientation);
  const idx = (id: ColumnLayout['id']) => layout.findIndex(c => c.id === id);
  const ctrlIdx = idx('control');
  const reporIdx = idx('repor');
  const ctrlW = ctrlIdx >= 0 ? layout[ctrlIdx].width : 0;
  const perRow = ctrlIdx >= 0 ? boxesPerRow(ctrlW) : 1;
  const inlinePres = presentationInline(cols);
  const useSeparators = !cols.includes('category');

  const head = [layout.map(c => (c.id === 'product' ? 'Produto' : COLUMN_HEAD[c.id]))];
  const body: RowInput[] = [];
  const meta: RowMeta[] = [];

  for (const group of model.groups) {
    group.rows.forEach((r, rowIdx) => {
      const c = r.control;
      const chunks = ctrlIdx >= 0 && c.kind === 'boxes' ? splitBoxes(c.count, perRow) : [0];
      let start = 1;
      chunks.forEach((n, k) => {
        const first = k === 0;
        const legend: string[] = [];
        if (ctrlIdx >= 0 && c.kind === 'boxes') {
          if (chunks.length > 1) legend.push(`caixas ${start} a ${start + n - 1} de ${c.count}`);
          if (k === chunks.length - 1) {
            if (c.legend) legend.push(c.legend);
            if (c.remainder) legend.push(c.remainder);
          }
        }
        const sep = useSeparators && first && rowIdx === 0 ? group.label.toUpperCase() : undefined;
        const top = PAD + (sep ? SEP : 0);
        const ctrlH = ctrlIdx >= 0 && c.kind === 'boxes' ? boxesHeight(n, perRow, legend.length) : 0;
        const reporH = reporIdx >= 0 ? 2 * PAD + BOX : 0;
        const minH = Math.max(ctrlH, reporH) + (sep ? SEP : 0);
        const name = first ? (inlinePres && r.presentation ? `${r.name}\n${r.presentation}` : r.name) : `${r.name} (continuação)`;
        const row: CellDef[] = layout.map((col, ci) => ({
          content: col.id === 'product' ? name : cellText(col.id, r, cols, first),
          styles: { cellPadding: { top, bottom: PAD, left: PAD, right: PAD }, ...(ci === 0 ? { minCellHeight: minH } : {}) },
        }));
        body.push(row);
        meta.push({ control: c, boxes: n, legend, first, sep });
        start += n;
      });
    });
  }

  const tableW = PW - 2 * MARGIN;
  autoTable(doc, {
    head,
    body,
    startY: FIRST_TOP,
    margin: { left: MARGIN, right: MARGIN, top: NEXT_TOP, bottom: BOTTOM },
    theme: 'plain',
    rowPageBreak: 'avoid',
    showHead: 'everyPage',
    tableWidth: tableW,
    styles: { font: 'helvetica', fontSize: BODY_PT, textColor: 0, cellPadding: PAD, valign: 'top', overflow: 'linebreak' },
    headStyles: { fontStyle: 'bold', fontSize: 8, textColor: 40, cellPadding: { top: 1, bottom: 1.2, left: PAD, right: PAD } },
    columnStyles: Object.fromEntries(layout.map((c, i) => [i, {
      cellWidth: c.width,
      ...(c.id === 'subtotal' || c.id === 'unitPrice' ? { halign: 'right' as const } : {}),
      ...(c.id === 'note' || c.id === 'presentation' || c.id === 'category' ? { fontSize: 7.5 } : {}),
    }])),
    didParseCell: (data) => {
      if (data.section !== 'head') return;
      const id = layout[data.column.index]?.id;
      if (id === 'repor') data.cell.styles.halign = 'center';
      if (id === 'unitPrice' || id === 'subtotal') data.cell.styles.halign = 'right';
    },
    didDrawCell: (data) => {
      if (data.section === 'head') {
        if (data.column.index === 0) {
          doc.setDrawColor(0); doc.setLineWidth(0.3);
          doc.line(MARGIN, data.cell.y + data.cell.height, MARGIN + tableW, data.cell.y + data.cell.height);
        }
        return;
      }
      if (data.section !== 'body') return;
      const m = meta[data.row.index];
      if (!m) return;
      const sepOff = m.sep ? SEP : 0;
      if (data.column.index === 0) {
        if (m.sep) {
          doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(70);
          doc.text(m.sep, MARGIN + PAD, data.cell.y + 3.2);
          const tw = doc.getTextWidth(m.sep);
          doc.setDrawColor(150); doc.setLineWidth(0.15);
          doc.line(MARGIN + PAD + tw + 2, data.cell.y + 2.3, MARGIN + tableW, data.cell.y + 2.3);
          doc.setTextColor(0);
        }
        // hairline under each product row
        doc.setDrawColor(210); doc.setLineWidth(0.1);
        const yb = data.cell.y + data.cell.height;
        doc.line(MARGIN, yb, MARGIN + tableW, yb);
      }
      doc.setDrawColor(0); doc.setLineWidth(0.25);
      if (data.column.index === reporIdx) {
        if (m.first) doc.rect(data.cell.x + (data.cell.width - BOX) / 2, data.cell.y + PAD + sepOff, BOX, BOX, 'S');
        return;
      }
      if (data.column.index !== ctrlIdx || m.control.kind !== 'boxes') return;
      const x0 = data.cell.x + PAD;
      const y0 = data.cell.y + PAD + sepOff;
      for (let k = 0; k < m.boxes; k++) {
        doc.rect(x0 + (k % perRow) * (BOX + GAP), y0 + Math.floor(k / perRow) * (BOX + GAP), BOX, BOX, 'S');
      }
      const rows = Math.ceil(m.boxes / perRow);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      m.legend.forEach((t, i) => doc.text(t, x0, y0 + rows * (BOX + GAP) + 2 + i * LEGEND_LINE, { maxWidth: ctrlW - 2 * PAD }));
    },
  });

  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;

  // Compact closing lines: finance only when a price column is shown; a one-line legend for boxes.
  const t = model.totals;
  const lines: string[] = [];
  if (hasPriceColumns(cols)) {
    const notes: string[] = [];
    if (t.estimated) notes.push(`${t.estimated} ${t.estimated === 1 ? 'preço estimado' : 'preços estimados'}`);
    if (model.kind === 'cart') notes.push('compra não conferida');
    const extra = notes.length ? ` (${notes.join('; ')})` : '';
    lines.push(t.missing
      ? `Subtotal dos produtos com preço: ${formatBRL(t.cents)}   Produtos sem preço: ${t.missing}${extra}`
      : `Total: ${formatBRL(t.cents)}${extra}`);
  }
  if (ctrlIdx >= 0 || reporIdx >= 0) {
    lines.push([
      ctrlIdx >= 0 ? 'Marque uma caixa a cada unidade consumida.' : '',
      reporIdx >= 0 ? 'Marque Repor quando precisar comprar novamente.' : '',
    ].filter(Boolean).join(' '));
  }
  if (lines.length) {
    if (y + lines.length * 4 > PH - BOTTOM) { doc.addPage(); y = NEXT_TOP + 2; }
    lines.forEach((s, i) => {
      doc.setFont('helvetica', i === 0 && hasPriceColumns(cols) ? 'bold' : 'normal');
      doc.setFontSize(i === 0 && hasPriceColumns(cols) ? 8.5 : 7.5);
      doc.text(s, MARGIN, y + 3 + i * 4, { maxWidth: tableW });
    });
  }

  // Headers (full on page 1, one line afterwards) and a discreet footer.
  const pages = doc.getNumberOfPages();
  const issuedDay = model.issuedAt.split(' ')[0];
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setTextColor(0);
    if (p === 1) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text('ListaFácil', MARGIN, MARGIN + 3);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      doc.text(`Lista de reposição mensal  ·  ${monthTitle(model.monthRef)}`, MARGIN, MARGIN + 7.5);
      doc.setFontSize(7.5); doc.setTextColor(60);
      const info = `Lista: ${model.listName}  ·  ${model.kind === 'cart' ? 'Data dos itens' : 'Data da compra'}: ${model.purchaseDate}  ·  Emitido em: ${model.issuedAt}${model.subtitle ? `  ·  ${model.subtitle}` : ''}`;
      doc.text(info, MARGIN, MARGIN + 11.5, { maxWidth: tableW });
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(60);
      doc.text(`ListaFácil | Reposição mensal | Página ${p}/${TOTAL_PAGES}`, MARGIN, MARGIN + 2);
    }
    doc.setFontSize(6.5); doc.setTextColor(110);
    doc.text(`ListaFácil | ${issuedDay} | Página ${p} de ${TOTAL_PAGES}`, PW - MARGIN, PH - 4.5, { align: 'right' });
    doc.setTextColor(0);
  }
  doc.putTotalPages(TOTAL_PAGES);
  return doc;
}
