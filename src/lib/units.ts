import type { ShoppingItem } from '@/types/shopping';
import { MAX_QUANTITY, type ParseResult } from '@/lib/money';

/** Every unit that may exist in stored data. Only `ItemUnit` is offered for new products. */
export type Unit = 'un' | 'pacote' | 'kg' | 'g' | 'L' | 'mL';
/** The two functional units: whole units (packaged goods) and kilograms (sold by weight). */
export type ItemUnit = 'un' | 'kg';
export const ITEM_UNITS: ItemUnit[] = ['un', 'kg'];
export const isItemUnit = (u: unknown): u is ItemUnit => u === 'un' || u === 'kg';
export const MAX_PRESENTATION = 80;
export type PackUnit = 'un' | 'kg' | 'g' | 'L' | 'mL';
export type PriceBasis = 'un' | 'pacote' | 'kg' | 'L';

export const UNITS: Unit[] = ['un', 'pacote', 'kg', 'g', 'L', 'mL'];
export const PACK_UNITS: PackUnit[] = ['un', 'kg', 'g', 'L', 'mL'];
export const PRICE_BASES: PriceBasis[] = ['un', 'pacote', 'kg', 'L'];
/** Decimal precision for mass/volume quantities (fixed point, thousandths). */
export const QTY_DECIMALS = 3;

export const isDecimalUnit = (u: Unit | PackUnit) => u === 'kg' || u === 'g' || u === 'L' || u === 'mL';

export const unitLabel = (u: Unit, qty = 1) => (u === 'pacote' ? (qty === 1 ? 'pacote' : 'pacotes') : u === 'un' ? 'un.' : u);
export const basisLabel: Record<PriceBasis, string> = { un: 'unidade', pacote: 'pacote', kg: 'kg', L: 'litro' };
export const basisShort: Record<PriceBasis, string> = { un: 'un', pacote: 'pct', kg: 'kg', L: 'L' };

export const defaultBasis = (u: Unit): PriceBasis =>
  u === 'kg' || u === 'g' ? 'kg' : u === 'L' || u === 'mL' ? 'L' : u === 'pacote' ? 'pacote' : 'un';

/** Physical dimension of a unit. */
const dim = (u: Unit | PackUnit) => (u === 'kg' || u === 'g' ? 'mass' : u === 'L' || u === 'mL' ? 'volume' : 'count');

/** Price bases that can be converted from the bought unit (and package content, when informed). */
export function compatibleBases(unit: Unit, packUnit?: PackUnit, packSize?: number): PriceBasis[] {
  if (unit === 'un') return ['un'];
  if (unit === 'kg' || unit === 'g') return ['kg'];
  if (unit === 'L' || unit === 'mL') return ['L'];
  const out: PriceBasis[] = ['pacote'];
  if (packUnit && packSize && packSize > 0) {
    const d = dim(packUnit);
    out.push(d === 'mass' ? 'kg' : d === 'volume' ? 'L' : 'un');
  }
  return out;
}

/** Number -> integer thousandths. Values are validated to at most 3 decimals, so rounding only removes float noise. */
export const toMilli = (q: number) => Math.round(q * 1000);

/** Parses "1,5", "0,250" or "2" into a number with at most 3 decimals, without float parsing. */
export function parseDecimal3(raw: string): ParseResult<number> {
  const s = raw.trim().replace(/\s/g, '');
  if (!s) return { ok: false, error: 'Informe a quantidade.' };
  const m = /^(\d+)(?:[,.](\d+))?$/.exec(s);
  if (!m) return { ok: false, error: 'Quantidade inválida. Use o formato 1,5.' };
  const dec = m[2] ?? '';
  if (dec.length > QTY_DECIMALS) return { ok: false, error: 'Use no máximo 3 casas decimais.' };
  const milli = parseInt(m[1], 10) * 1000 + parseInt(dec.padEnd(3, '0') || '0', 10);
  if (milli <= 0) return { ok: false, error: 'A quantidade precisa ser maior que zero.' };
  if (milli > MAX_QUANTITY * 1000) return { ok: false, error: `A quantidade máxima é ${MAX_QUANTITY}.` };
  return { ok: true, value: milli / 1000 };
}

/** Countable units take integers only; mass/volume take up to 3 decimals. */
export function parseQuantityFor(raw: string, unit: Unit): ParseResult<number> {
  if (isDecimalUnit(unit)) return parseDecimal3(raw);
  const s = raw.trim();
  if (!s) return { ok: false, error: 'Informe a quantidade.' };
  if (/[.,]/.test(s)) {
    return { ok: false, error: 'Para itens em unidades, informe uma quantidade inteira.' };
  }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Quantidade inválida. Use só números.' };
  const n = parseInt(s, 10);
  if (n < 1) return { ok: false, error: 'A quantidade mínima é 1.' };
  if (n > MAX_QUANTITY) return { ok: false, error: `A quantidade máxima é ${MAX_QUANTITY}.` };
  return { ok: true, value: n };
}

/** 1.5 -> "1,5"; 0.25 -> "0,25"; 2 -> "2". */
export const formatNumberBR = (q: number) => {
  const milli = toMilli(q);
  const int = Math.floor(milli / 1000);
  const dec = String(milli % 1000).padStart(3, '0').replace(/0+$/, '');
  return dec ? `${int},${dec}` : String(int);
};

/** kg display: "1 kg" for whole values, otherwise always 3 decimals ("1,750", "0,250"). */
export const formatKgNumber = (q: number) => {
  const milli = toMilli(q);
  return milli % 1000 === 0 ? String(milli / 1000) : `${Math.floor(milli / 1000)},${String(milli % 1000).padStart(3, '0')}`;
};
/** Value for an edit field that keeps the exact stored precision. */
export const quantityInput = (q: number, unit: Unit) => (unit === 'kg' ? formatKgNumber(q) : formatNumberBR(q));

type QtyItem = Pick<ShoppingItem, 'quantity' | 'unit' | 'packSize' | 'packUnit'>;

/** "1,750 kg", "2 un.", legacy "2 pacotes de 5 kg". */
export function formatQty(i: QtyItem): string {
  const unit = i.unit ?? 'un';
  if (unit === 'kg') return `${formatKgNumber(i.quantity)} kg`;
  const base = `${formatNumberBR(i.quantity)} ${unitLabel(unit, i.quantity)}`;
  if (unit === 'pacote' && i.packSize && i.packUnit) return `${base} de ${formatNumberBR(i.packSize)} ${i.packUnit}`;
  return base;
}

type LineItem = QtyItem & Pick<ShoppingItem, 'priceCents' | 'priceBasis'>;
export type LineResult =
  | { ok: true; cents: number }
  | { ok: false; reason: 'missing' | 'incompatible' };

/** Thousandths-of-base per one bought unit: [numerator, denominator] as BigInt. */
function amountPerUnit(i: LineItem, basis: PriceBasis): [bigint, bigint] | null {
  const unit = i.unit ?? 'un';
  if (!compatibleBases(unit, i.packUnit, i.packSize).includes(basis)) return null;
  const factor = (u: Unit | PackUnit): [bigint, bigint] => (u === 'g' || u === 'mL' ? [1n, 1000n] : [1n, 1n]);
  if (unit === 'pacote' && basis !== 'pacote') {
    const [fn, fd] = factor(i.packUnit!);
    return [BigInt(toMilli(i.packSize!)) * fn, 1000n * fd];
  }
  const [fn, fd] = factor(unit);
  return [fn, fd];
}

/**
 * Line value in cents using integer (BigInt) fixed point and one rounding rule:
 * half up, once per line. Incompatible unit/price-basis combinations are rejected, never guessed.
 */
export function lineResult(i: LineItem): LineResult {
  if (i.priceCents == null) return { ok: false, reason: 'missing' };
  const basis = i.priceBasis ?? defaultBasis(i.unit ?? 'un');
  const per = amountPerUnit(i, basis);
  if (!per) return { ok: false, reason: 'incompatible' };
  const num = BigInt(i.priceCents) * BigInt(toMilli(i.quantity)) * per[0];
  const den = 1000n * per[1];
  return { ok: true, cents: Number((2n * num + den) / (2n * den)) };
}

const presKey = (p?: string) => (p ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Price-history key: name + price basis (+ presentation when informed; + package content for legacy prices).
 * un and kg never share a key. `withPresentation: false` gives the generic key used as fallback.
 */
export function priceKey(normalizedName: string, i: Pick<ShoppingItem, 'unit' | 'priceBasis' | 'packSize' | 'packUnit' | 'presentation'>,
  withPresentation = true): string {
  const basis = i.priceBasis ?? defaultBasis(i.unit ?? 'un');
  const pres = withPresentation ? presKey(i.presentation) : '';
  if (pres && (basis === 'un' || basis === 'kg')) return `${normalizedName}::${basis}::p:${pres}`;
  if (basis === 'un') return normalizedName; // legacy keys were per unit
  if (basis === 'pacote') {
    return i.packSize && i.packUnit
      ? `${normalizedName}::pacote:${formatNumberBR(i.packSize)}${i.packUnit}`
      : `${normalizedName}::pacote`;
  }
  return `${normalizedName}::${basis}`;
}

// ---------- simplification to un / kg ----------

export interface LegacyUnitInfo {
  quantity: number;
  unit: string;
  packSize?: number;
  packUnit?: string;
  priceBasis?: string;
  priceCents?: number;
  controlPortion?: number;
}
/** converted = automatic safe conversion (kept for audit); review = ambiguous, waits for the user. */
export interface UnitMigration { status: 'converted' | 'review'; from: LegacyUnitInfo }

type SimplifyIn = Pick<ShoppingItem, 'quantity' | 'unit' | 'packSize' | 'packUnit' | 'priceBasis' | 'priceCents' | 'controlPortion' | 'presentation' | 'unitMigration'>;
type SimplifyOut = Pick<ShoppingItem, 'quantity' | 'unit' | 'packSize' | 'packUnit' | 'priceBasis' | 'controlPortion' | 'presentation' | 'unitMigration'>;

const cleanPresentation = (p?: string) => {
  const t = (p ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PRESENTATION);
  return t || undefined;
};
const legacyOf = (i: SimplifyIn): LegacyUnitInfo => {
  const f: LegacyUnitInfo = { quantity: i.quantity, unit: String(i.unit ?? 'un') };
  if (i.packSize != null) f.packSize = i.packSize;
  if (i.packUnit) f.packUnit = i.packUnit;
  if (i.priceBasis) f.priceBasis = i.priceBasis;
  if (i.priceCents != null) f.priceCents = i.priceCents;
  if (i.controlPortion != null) f.controlPortion = i.controlPortion;
  return f;
};

/**
 * Pure and idempotent: un/kg pass through; g becomes kg exactly; packages priced per package become un
 * (the package text goes to the presentation). L, mL, packages priced by content and unknown units are kept
 * as they are and flagged for review: nothing is guessed.
 */
export function simplifyUnit(i: SimplifyIn): SimplifyOut {
  const unit = i.unit ?? 'un';
  const basis = i.priceBasis ?? defaultBasis(unit as Unit);
  const presentation = cleanPresentation(i.presentation);
  const keep = i.unitMigration?.status === 'converted' ? i.unitMigration : undefined;
  const plain = (u: ItemUnit, quantity: number, pres = presentation, mig = keep): SimplifyOut => ({
    quantity, unit: u, priceBasis: u, packSize: undefined, packUnit: undefined, controlPortion: undefined,
    presentation: pres, unitMigration: mig,
  });
  if (i.unitMigration?.status === 'review') return { ...pick(i), presentation };
  if (unit === 'un' && basis === 'un') return plain('un', i.quantity);
  if (unit === 'kg' && basis === 'kg') return plain('kg', i.quantity);
  if (unit === 'g' && basis === 'kg') {
    const gMilli = toMilli(i.quantity);
    if (gMilli % 1000 === 0 && gMilli > 0) return plain('kg', gMilli / 1000 / 1000, presentation, { status: 'converted', from: legacyOf(i) });
  }
  if (unit === 'pacote' && basis === 'pacote' && Number.isInteger(i.quantity) && i.quantity >= 1) {
    const content = i.packSize && i.packUnit ? ` ${formatNumberBR(i.packSize)} ${i.packUnit}` : '';
    return plain('un', i.quantity, presentation ?? `Pacote${content}`, { status: 'converted', from: legacyOf(i) });
  }
  return { ...pick(i), presentation, unitMigration: { status: 'review', from: legacyOf(i) } };
}
const pick = (i: SimplifyIn): SimplifyOut => ({
  quantity: i.quantity, unit: i.unit, packSize: i.packSize, packUnit: i.packUnit, priceBasis: i.priceBasis,
  controlPortion: i.controlPortion, presentation: i.presentation, unitMigration: i.unitMigration,
});

export const needsUnitReview = (i: Pick<ShoppingItem, 'unitMigration'>) => i.unitMigration?.status === 'review';
