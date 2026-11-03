import type { ShoppingList, ShoppingItem } from '@/types/shopping';
import { STORAGE_VERSION, normalizeLists } from '@/lib/migrations';

/**
 * "Enviar cópia" file: one list, complete local state, schema version. Importing creates an independent
 * private list with new ids; roles, members and server revisions in the file are never trusted.
 */
export const LIST_FILE_KIND = 'listafacil-list-copy';
export const LIST_FILE_FORMAT = 1;
export const MAX_FILE_BYTES = 1_000_000;
export const MAX_ITEMS = 2000;

export class ListFileError extends Error {}

export function buildListFile(list: ShoppingList, now = new Date()): string {
  const { role: _r, members: _m, routeVersion: _v, ...plain } = list;
  return JSON.stringify({
    kind: LIST_FILE_KIND, format: LIST_FILE_FORMAT, schemaVersion: STORAGE_VERSION, exportedAt: now.toISOString(),
    list: { ...plain, items: plain.items.map(({ addedBy: _a, markedBy: _b, markedAt: _c, ...i }) => i) },
  }, null, 2);
}

const isStr = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const optStr = (v: unknown, max: number) => v === undefined || v === null || (typeof v === 'string' && v.length <= max);
const optNum = (v: unknown) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);

/** Validates size, types and limits; returns a brand new private list (new ids, nothing marked as shared). */
export function parseListFile(text: string, newId: () => string = () => crypto.randomUUID()): ShoppingList {
  if (new TextEncoder().encode(text).length > MAX_FILE_BYTES) throw new ListFileError('Arquivo grande demais (máximo 1 MB).');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ListFileError('O arquivo não é um JSON válido.'); }
  const f = raw as { kind?: unknown; format?: unknown; schemaVersion?: unknown; list?: Record<string, unknown> };
  if (f?.kind !== LIST_FILE_KIND || f.format !== LIST_FILE_FORMAT) throw new ListFileError('Este arquivo não é uma lista do ListaFácil.');
  if (typeof f.schemaVersion !== 'number' || f.schemaVersion > STORAGE_VERSION) throw new ListFileError('Arquivo de uma versão mais nova do app. Atualize o app e tente de novo.');
  const l = f.list;
  if (!l || !isStr(l.name, 120) || !Array.isArray(l.items)) throw new ListFileError('Lista sem nome ou sem itens válidos.');
  if (l.items.length > MAX_ITEMS) throw new ListFileError(`Lista com itens demais (máximo ${MAX_ITEMS}).`);
  if (!optNum(l.budgetCents) || (l.budgetCents !== undefined && l.budgetCents !== null && !Number.isInteger(l.budgetCents))) throw new ListFileError('Orçamento inválido.');
  for (const it of l.items as Record<string, unknown>[]) {
    if (!it || !isStr(it.name, 200) || typeof it.quantity !== 'number' || !(it.quantity > 0)
      || !optNum(it.priceCents) || (it.priceCents != null && !Number.isInteger(it.priceCents))
      || !optStr(it.note, 500) || !optStr(it.category, 30) || typeof (it.purchased ?? false) !== 'boolean') {
      throw new ListFileError('Há um item com dados inválidos no arquivo.');
    }
  }
  const [clean] = normalizeLists([{ ...l, id: 'tmp' }]);
  return {
    id: newId(),
    name: clean.name,
    emoji: typeof l.emoji === 'string' && l.emoji.length <= 8 ? l.emoji : '🛒',
    createdAt: Date.now(),
    budgetCents: clean.budgetCents,
    sortMode: clean.sortMode,
    items: clean.items.map((i, idx): ShoppingItem => {
      const { addedBy: _a, markedBy: _b, markedAt: _c, ...rest } = i;
      return { ...rest, id: newId(), order: Number.isFinite(i.order) ? i.order : idx, createdAt: Date.now() };
    }),
  };
}
