/**
 * Report column configuration: pure helpers (presets, layout widths, orientation) plus the
 * device-local "last configuration" preference. Never synced and never stored in the list.
 */
export type ColumnId =
  | 'category' | 'presentation' | 'quantity' | 'unit' | 'unitPrice' | 'subtotal' | 'note' | 'control' | 'repor';

/** Display order in the PDF (Produto always first, Repor last). */
export const COLUMN_ORDER: ColumnId[] = [
  'category', 'presentation', 'quantity', 'unit', 'unitPrice', 'subtotal', 'note', 'control', 'repor',
];

export const COLUMN_LABEL: Record<ColumnId, string> = {
  category: 'Categoria', presentation: 'Apresentação', quantity: 'Quantidade', unit: 'Unidade',
  unitPrice: 'Preço unitário', subtotal: 'Subtotal', note: 'Observação', control: 'Controle de consumo', repor: 'Repor',
};

export const COLUMN_HEAD: Record<ColumnId, string> = {
  category: 'Categoria', presentation: 'Apres.', quantity: 'Qtd.', unit: 'Un.',
  unitPrice: 'Unitário', subtotal: 'Total', note: 'Obs.', control: 'Controle', repor: 'Repor',
};

export type PresetId = 'reposicao' | 'compras' | 'financeiro' | 'completo';

export const PRESETS: { id: PresetId; label: string; columns: ColumnId[] }[] = [
  { id: 'reposicao', label: 'Controle de reposição', columns: ['control', 'repor'] },
  { id: 'compras', label: 'Lista de compras', columns: ['quantity', 'unit', 'repor'] },
  { id: 'financeiro', label: 'Relatório financeiro', columns: ['quantity', 'unit', 'unitPrice', 'subtotal'] },
  { id: 'completo', label: 'Completo', columns: ['presentation', 'quantity', 'unit', 'unitPrice', 'subtotal', 'note', 'control', 'repor'] },
];

export const DEFAULT_COLUMNS: ColumnId[] = ['control', 'repor'];

/** Normalizes a selection: known ids, no duplicates, fixed order; drops columns not available. */
export function normalizeColumns(cols: readonly string[], available: readonly ColumnId[] = COLUMN_ORDER): ColumnId[] {
  const set = new Set(cols);
  return COLUMN_ORDER.filter(c => set.has(c) && available.includes(c));
}

export const presetColumns = (id: PresetId, available: readonly ColumnId[] = COLUMN_ORDER) =>
  normalizeColumns(PRESETS.find(p => p.id === id)!.columns, available);

export const matchingPreset = (cols: readonly ColumnId[], available: readonly ColumnId[] = COLUMN_ORDER): PresetId | null => {
  const key = normalizeColumns(cols, available).join(',');
  return PRESETS.find(p => presetColumns(p.id, available).join(',') === key)?.id ?? null;
};

/** "Colunas selecionadas: N" counts Produto too. */
export const selectedCount = (cols: readonly ColumnId[]) => cols.length + 1;

export const hasPriceColumns = (cols: readonly ColumnId[]) => cols.includes('unitPrice') || cols.includes('subtotal');

export type Orientation = 'portrait' | 'landscape';

export const MARGIN = 9;
export const PAGE = { portrait: { w: 210, h: 297 }, landscape: { w: 297, h: 210 } } as const;

const FIXED: Record<Exclude<ColumnId, 'control'>, number> = {
  category: 22, presentation: 25, quantity: 13, unit: 10, unitPrice: 23, subtotal: 20, note: 32, repor: 12,
};
export const PRODUCT_MIN = 40;
export const CONTROL_MIN = 42;

/** Presentation goes under the product name when a separate column would crowd the row. */
export const presentationInline = (cols: readonly ColumnId[]) => cols.includes('presentation') && cols.length > 4;

export interface ColumnLayout {
  id: ColumnId | 'product';
  width: number;
}

const tableColumns = (cols: readonly ColumnId[]) =>
  normalizeColumns(cols).filter(c => !(c === 'presentation' && presentationInline(cols)));

const fixedSum = (cols: readonly ColumnId[]) =>
  tableColumns(cols).reduce((s, c) => s + (c === 'control' ? 0 : FIXED[c]), 0);

/** Width needed without squeezing any column below its minimum. */
export const requiredWidth = (cols: readonly ColumnId[]) =>
  fixedSum(cols) + PRODUCT_MIN + (cols.includes('control') ? CONTROL_MIN : 0);

export const usableWidth = (o: Orientation) => PAGE[o].w - 2 * MARGIN;

export const needsLandscape = (cols: readonly ColumnId[]) => requiredWidth(cols) > usableWidth('portrait');

/**
 * Column widths that always add up to the usable width. When the user keeps portrait with too
 * many columns, fixed columns shrink proportionally (text wraps, nothing overlaps); fonts never shrink.
 */
export function layoutColumns(cols: readonly ColumnId[], o: Orientation): ColumnLayout[] {
  const usable = usableWidth(o);
  const list = tableColumns(cols);
  const ctrl = list.includes('control');
  let fixed = fixedSum(cols);
  const flexMin = PRODUCT_MIN + (ctrl ? CONTROL_MIN : 0);
  const scale = fixed + flexMin > usable ? Math.max(0.55, (usable - flexMin) / fixed) : 1;
  fixed *= scale;
  const rest = usable - fixed;
  let product = rest;
  let control = 0;
  if (ctrl) {
    product = Math.min(Math.max(PRODUCT_MIN, rest * 0.42), 75);
    control = rest - product;
    if (control < CONTROL_MIN * 0.75) { control = CONTROL_MIN * 0.75; product = rest - control; }
  }
  const out: ColumnLayout[] = [{ id: 'product', width: product }];
  for (const c of list) out.push({ id: c, width: c === 'control' ? control : FIXED[c] * scale });
  return out;
}

const KEY = 'listafacil-report-config';

export interface SavedReportConfig {
  columns: ColumnId[];
  orientation?: Orientation;
}

export function loadReportConfig(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): SavedReportConfig | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !Array.isArray(v.columns)) return null;
    return {
      columns: normalizeColumns(v.columns),
      orientation: v.orientation === 'landscape' || v.orientation === 'portrait' ? v.orientation : undefined,
    };
  } catch {
    return null;
  }
}

export function saveReportConfig(cfg: SavedReportConfig, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage) {
  try { storage?.setItem(KEY, JSON.stringify({ columns: normalizeColumns(cfg.columns), orientation: cfg.orientation })); } catch { /* full storage: keep going */ }
}
