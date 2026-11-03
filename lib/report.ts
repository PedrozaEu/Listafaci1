import { CATEGORIES, type CategoryId, type ShoppingList } from '@/types/shopping';
import type { PurchaseRecord } from '@/lib/purchase';
import { routeSequence } from '@/lib/route';
import { formatBRL } from '@/lib/money';
import {
  basisShort, defaultBasis, formatKgNumber, formatNumberBR, formatQty, isDecimalUnit, lineResult, toMilli,
  type PackUnit, type PriceBasis, type Unit,
} from '@/lib/units';

/** One product line as the report needs it, independent of where it came from. */
export interface ReportLineInput {
  name: string;
  category?: CategoryId;
  unit: Unit;
  quantity: number;
  packSize?: number;
  packUnit?: PackUnit;
  presentation?: string;
  priceCents?: number;
  priceBasis: PriceBasis;
  lineCents: number | null;
  estimated: boolean;
  controlPortion?: number;
  note?: string;
}

export type Control =
  | { kind: 'boxes'; count: number; legend?: string; remainder?: string }
  | { kind: 'remaining'; unit?: string };

export interface ReportRow {
  name: string;
  presentation?: string;
  qtyText: string;
  /** Quantity without unit, for when the Unit column is shown. */
  qtyNumber: string;
  unitText: string;
  unitPriceText: string;
  /** Unit price without "/un." for when the Unit column is shown. */
  unitPriceShort: string;
  note?: string;
  categoryLabel: string;
  subtotalText: string;
  control: Control;
}

export interface ReportGroup {
  category: CategoryId;
  label: string;
  rows: ReportRow[];
  /** null when no line of the group has a value. */
  subtotalCents: number | null;
  missing: number;
}

export interface ReportModel {
  kind: 'purchase' | 'cart';
  title: string;
  /** "Compra em andamento, não conferida" for the cart source. */
  subtitle?: string;
  listName: string;
  /** Monthly reference, e.g. "outubro de 2026" (from the purchase date). */
  monthRef: string;
  purchaseDate: string;
  issuedAt: string;
  groups: ReportGroup[];
  totals: {
    products: number;
    categories: number;
    consumeBoxes: number;
    reporBoxes: number;
    cents: number;
    missing: number;
    estimated: number;
    /** Amount per unit kind, never summed together ("10 un", "2 pacotes", "1,5 kg"). */
    byUnit: string[];
  };
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const pad = (n: number) => String(n).padStart(2, '0');

export const formatDateBR = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
export const monthRefOf = (iso: string) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
};
export const formatDateTimeBR = (d: Date) =>
  `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

/**
 * Consumption control for one line.
 * Countable: one box per bought unit/package. Mass/volume: a "Restante" field unless the user set a
 * portion; then whole portions become boxes and any leftover is stated explicitly (never rounded).
 */
export function controlFor(l: Pick<ReportLineInput, 'unit' | 'quantity' | 'packSize' | 'packUnit' | 'controlPortion'>): Control {
  if (l.unit === 'un') return { kind: 'boxes', count: l.quantity };
  if (l.unit === 'pacote') {
    const what = l.packSize && l.packUnit ? `1 pacote de ${formatNumberBR(l.packSize)} ${l.packUnit}` : '1 pacote';
    return { kind: 'boxes', count: l.quantity, legend: `1 caixa = ${what}` };
  }
  // kg (and legacy mass/volume without a portion): one REPOR box plus a written remainder, never boxes per kg
  if (!isDecimalUnit(l.unit) || !l.controlPortion) return { kind: 'remaining', unit: l.unit };
  const q = toMilli(l.quantity);
  const p = toMilli(l.controlPortion);
  const count = Math.floor(q / p);
  const rest = q % p;
  if (count === 0) return { kind: 'remaining', unit: l.unit };
  return {
    kind: 'boxes',
    count,
    legend: `1 caixa = ${formatNumberBR(l.controlPortion)} ${l.unit}`,
    remainder: rest ? `sobra de ${formatNumberBR(rest / 1000)} ${l.unit} fora das caixas` : undefined,
  };
}

export function linesFromPurchase(p: PurchaseRecord): ReportLineInput[] {
  return [...p.lines].sort((a, b) => a.order - b.order).map(l => ({
    name: l.name,
    category: l.category,
    unit: l.unit,
    quantity: l.quantity,
    packSize: l.packSize,
    packUnit: l.packUnit,
    presentation: l.presentation,
    priceCents: l.priceCents,
    priceBasis: l.priceBasis,
    lineCents: l.lineCents,
    estimated: l.priceStatus === 'estimated',
    controlPortion: l.controlPortion,
  }));
}

/** Checked items of a list, in route order. Screen filters are not applied. */
export function linesFromCart(list: ShoppingList): ReportLineInput[] {
  return routeSequence(list.items.filter(i => i.purchased)).map(i => {
    const r = lineResult(i);
    return {
      name: i.name,
      category: i.category,
      unit: i.unit ?? 'un',
      quantity: i.quantity,
      packSize: i.packSize,
      packUnit: i.packUnit,
      presentation: i.presentation,
      priceCents: i.priceCents,
      priceBasis: i.priceBasis ?? defaultBasis(i.unit ?? 'un'),
      lineCents: r.ok ? r.cents : null,
      estimated: Boolean(i.priceEstimated),
      controlPortion: i.controlPortion,
      note: i.note?.trim() || undefined,
    };
  });
}

export interface BuildReportInput {
  kind: 'purchase' | 'cart';
  listName: string;
  /** YYYY-MM-DD */
  purchaseDate: string;
  issuedAt: Date;
  lines: ReportLineInput[];
}

export function buildReportModel(input: BuildReportInput): ReportModel {
  const groups: ReportGroup[] = [];
  let cents = 0, missing = 0, estimated = 0, consumeBoxes = 0;
  const unitTotals = new Map<string, number>();
  for (const cat of CATEGORIES) {
    const lines = input.lines.filter(l => (l.category ?? 'outros') === cat.id);
    if (!lines.length) continue;
    let sub = 0, priced = 0, gMissing = 0;
    const rows = lines.map(l => {
      const control = controlFor(l);
      if (control.kind === 'boxes') consumeBoxes += control.count;
      if (l.lineCents == null) { gMissing++; missing++; } else { sub += l.lineCents; priced++; }
      if (l.estimated && l.lineCents != null) estimated++;
      const key = l.unit === 'pacote' ? 'pacote' : l.unit;
      unitTotals.set(key, (unitTotals.get(key) ?? 0) + toMilli(l.quantity));
      return {
        name: l.name,
        presentation: l.presentation,
        qtyText: formatQty(l),
        qtyNumber: l.unit === 'kg' ? formatKgNumber(l.quantity) : formatNumberBR(l.quantity),
        unitText: l.unit === 'un' ? 'un.' : l.unit,
        unitPriceText: l.priceCents == null ? '-' : `${formatBRL(l.priceCents)}/${basisShort[l.priceBasis]}${l.priceBasis === 'un' ? '.' : ''}${l.estimated ? ' (est.)' : ''}`,
        unitPriceShort: l.priceCents == null ? '-' : `${formatBRL(l.priceCents)}${l.estimated ? ' (est.)' : ''}`,
        subtotalText: l.lineCents == null ? (l.priceCents == null ? '-' : 'unid. incompatível') : formatBRL(l.lineCents),
        note: l.note,
        categoryLabel: cat.label,
        control,
      };
    });
    cents += sub;
    groups.push({ category: cat.id, label: cat.label, rows, subtotalCents: priced ? sub : null, missing: gMissing });
  }
  const byUnit = [...unitTotals.entries()].map(([u, milli]) => {
    const q = milli / 1000;
    if (u === 'pacote') return `${formatNumberBR(q)} ${q === 1 ? 'pacote' : 'pacotes'}`;
    if (u === 'un') return `${formatNumberBR(q)} un.`;
    if (u === 'kg') return `${formatKgNumber(q)} kg`;
    return `${formatNumberBR(q)} ${u}`;
  });
  return {
    kind: input.kind,
    title: 'Controle de reposição mensal',
    subtitle: input.kind === 'cart' ? 'Compra em andamento, não conferida' : undefined,
    listName: input.listName,
    monthRef: monthRefOf(input.purchaseDate),
    purchaseDate: formatDateBR(input.purchaseDate),
    issuedAt: formatDateTimeBR(input.issuedAt),
    groups,
    totals: {
      products: input.lines.length,
      categories: groups.length,
      consumeBoxes,
      reporBoxes: input.lines.length,
      cents,
      missing,
      estimated,
      byUnit,
    },
  };
}
