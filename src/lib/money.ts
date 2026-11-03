import type { ShoppingItem } from '@/types/shopping';
import { lineResult } from '@/lib/units';

type LineInput = Pick<ShoppingItem, 'priceCents' | 'quantity' | 'unit' | 'priceBasis' | 'packSize' | 'packUnit'>;

/** All money in the app is stored as integer cents. `undefined` means "price not informed", which is different from 0. */
export type Cents = number;

export const MAX_CENTS = 9_999_999_99;
export const MAX_QUANTITY = 9999;

export type ParseResult<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; error: string; value?: undefined };

/**
 * Parses a pt-BR money input into cents without float math.
 * Accepts: "6", "6,00", "1.234,56", "1234,56", "R$ 5,49" and also "5.49" (dot with 1-2 decimals).
 * Empty input returns `undefined` (not informed). Anything else is rejected with a message.
 */
export function parseMoneyBR(raw: string): ParseResult<Cents | undefined> {
  const s = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  if (!s) return { ok: true, value: undefined };
  if (s.startsWith('-')) return { ok: false, error: 'O preço não pode ser negativo.' };

  let intPart: string;
  let decPart = '';
  if (/^\d+$/.test(s)) {
    intPart = s;
  } else if (/^\d+,\d+$/.test(s)) {
    [intPart, decPart] = s.split(',');
  } else if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {
    const [i, d = ''] = s.split(',');
    intPart = i.replace(/\./g, '');
    decPart = d;
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    [intPart, decPart] = s.split('.');
  } else {
    return { ok: false, error: 'Preço inválido. Use o formato 1.234,56.' };
  }
  if (decPart.length > 2) return { ok: false, error: 'Use no máximo 2 casas decimais no preço.' };

  const cents = parseInt(intPart, 10) * 100 + parseInt(decPart.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) {
    return { ok: false, error: 'Preço alto demais.' };
  }
  return { ok: true, value: cents };
}

/** Integer quantities only, until fractional units exist. "1,5" is rejected, never turned into 15. */
export function parseQuantity(raw: string): ParseResult<number> {
  const s = raw.trim();
  if (!s) return { ok: false, error: 'Informe a quantidade.' };
  if (/[.,]/.test(s)) {
    return { ok: false, error: 'Quantidade fracionada ainda não é aceita. Use um número inteiro.' };
  }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Quantidade inválida. Use só números.' };
  const n = parseInt(s, 10);
  if (n < 1) return { ok: false, error: 'A quantidade mínima é 1.' };
  if (n > MAX_QUANTITY) return { ok: false, error: `A quantidade máxima é ${MAX_QUANTITY}.` };
  return { ok: true, value: n };
}

/** Legacy values were stored in reais (floats). Converted exactly once by the v4 migration. */
export const reaisToCents = (reais: number): Cents => Math.round(reais * 100);

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
/** "R$ 1.234,56" with a regular space (safe for WhatsApp and text files). */
export const formatBRL = (cents: Cents) => brl.format(cents / 100).replace(/\s/g, ' ');

/** Value for an input field: 123456 -> "1234,56". */
export const centsToInput = (cents: Cents | undefined) =>
  cents == null ? '' : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;

/** null when the price is not informed or its basis is incompatible (never treated as free). */
export const lineTotal = (item: LineInput): Cents | null => {
  const r = lineResult(item);
  return r.ok ? r.cents : null;
};

export interface Totals {
  cents: Cents;
  priced: number;
  missing: number;
}

/** Sum of the given items only. Items without price are counted, not summed. */
export function totalsOf(items: LineInput[]): Totals {
  let cents = 0;
  let priced = 0;
  let missing = 0;
  for (const i of items) {
    const t = lineTotal(i);
    if (t == null) missing++;
    else { cents += t; priced++; }
  }
  return { cents, priced, missing };
}
