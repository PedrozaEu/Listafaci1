import { CATEGORIES, type ShoppingItem } from '@/types/shopping';
import { formatBRL, lineTotal, totalsOf, centsToInput, type Totals } from '@/lib/money';
import { formatQty, formatNumberBR, defaultBasis, basisShort } from '@/lib/units';

export const categoryLabel = (catId?: string) =>
  CATEGORIES.find(c => c.id === catId)?.label ?? 'Outros';

export const categoryLabelWithEmoji = (catId?: string) => {
  const cat = CATEGORIES.find(c => c.id === catId);
  return cat ? `${cat.emoji} ${cat.label}` : '📦 Outros';
};

/** Which items were exported. Every line, subtotal and total uses exactly this set. */
export interface ExportScope {
  /** 'all' = the whole list; 'visible' = what the active filter/search shows. */
  kind: 'all' | 'visible';
  /** Human description, e.g. "Seleção visível: categoria Limpeza (3 de 10 itens)". */
  label: string;
}

/** Groups items following the canonical CATEGORIES order; items without category fall into "outros". */
export function groupByCategory(items: ShoppingItem[]): Array<{ id: string; items: ShoppingItem[] }> {
  return CATEGORIES.map(cat => ({
    id: cat.id,
    items: items.filter(i => i.category === cat.id || (!i.category && cat.id === 'outros')),
  })).filter(g => g.items.length > 0);
}

/** "R$ 10,00" or "R$ 10,00 (2 itens sem preço não somados)" or "sem preços informados". */
export function totalText(t: Totals): string {
  if (t.priced === 0) return 'sem preços informados';
  const miss = t.missing === 0 ? '' : ` (${t.missing} ${t.missing === 1 ? 'item sem preço não somado' : 'itens sem preço não somados'})`;
  return formatBRL(t.cents) + miss;
}

/** "" for legacy per-unit prices (keeps the old format), "/kg", "/L", "/pct" otherwise. */
const perBasis = (i: ShoppingItem) => {
  const b = i.priceBasis ?? defaultBasis(i.unit ?? 'un');
  return b === 'un' ? '' : `/${basisShort[b]}`;
};

/** Legacy "2x"; "1,5 kg" or "2 pacotes de 5 kg" for other units. */
export const qtyText = (i: ShoppingItem) => ((i.unit ?? 'un') === 'un' ? `${i.quantity}x` : formatQty(i));

const priceText = (i: ShoppingItem) => {
  const sub = lineTotal(i);
  if (i.priceCents == null) return 'sem preço';
  if (sub == null) return 'preço com unidade incompatível';
  return `${formatBRL(i.priceCents)}${perBasis(i)} = ${formatBRL(sub)}`;
};

function whatsappSection(title: string, items: ShoppingItem[], checkbox: string): string {
  if (!items.length) return '';
  const sections = groupByCategory(items).map(group => {
    const lines = group.items.map(i => `${checkbox} ${i.name}${i.presentation ? ` (${i.presentation})` : ''}: ${qtyText(i)} ${priceText(i)}`);
    return `*${categoryLabelWithEmoji(group.id)}*\n${lines.join('\n')}`;
  });
  return `*${title}*\n\n${sections.join('\n\n')}\n_Subtotal: ${totalText(totalsOf(items))}_`;
}

/** Pending first, purchased below, both from `items` only. */
export function buildWhatsAppText(listName: string, items: ShoppingItem[], scope: ExportScope): string {
  const pending = items.filter(i => !i.purchased);
  const purchased = items.filter(i => i.purchased);
  const parts = [`🛒 *${listName}*\n_${scope.label}_`];
  const p = whatsappSection('PENDENTES', pending, '☐');
  const c = whatsappSection('COMPRADOS', purchased, '✅');
  if (p) parts.push(p);
  if (c) parts.push(c);
  parts.push(`💰 *Total: ${totalText(totalsOf(items))}*`);
  return parts.join('\n\n');
}

/** RFC 4180 escaping: wrap in quotes when needed and double inner quotes. */
export function csvEscape(value: string | number | undefined | null): string {
  const raw = value == null ? '' : String(value);
  if (/[",;\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export const CSV_HEADER = 'Nome,Categoria,Quantidade,Preço Unitário,Subtotal,Status,Observação,Unidade,Apresentação,Preço por';

/** Missing prices stay empty in the CSV (never 0,00). */
export function buildCsv(items: ShoppingItem[]): string {
  const lines = items.map(i => {
    const sub = lineTotal(i);
    return [
      csvEscape(i.name),
      csvEscape(categoryLabel(i.category)),
      csvEscape(formatNumberBR(i.quantity)),
      csvEscape(centsToInput(i.priceCents)),
      csvEscape(sub == null ? '' : centsToInput(sub)),
      csvEscape(i.purchased ? 'Comprado' : 'Pendente'),
      csvEscape(i.note ?? ''),
      csvEscape(i.unit ?? 'un'),
      csvEscape(i.presentation ?? (i.packSize && i.packUnit ? `${formatNumberBR(i.packSize)} ${i.packUnit}` : '')),
      csvEscape(i.priceBasis ?? defaultBasis(i.unit ?? 'un')),
    ].join(',');
  });
  return [CSV_HEADER, ...lines].join('\n');
}

export function buildTxtExport(listName: string, items: ShoppingItem[], scope: ExportScope): string {
  const rule = '='.repeat(40);
  const formatted = items.map(i => {
    const status = i.purchased ? '[x]' : '[ ]';
    let line = `${status} ${i.name}`;
    line += `  |  Categoria: ${categoryLabel(i.category)}`;
    line += `  |  Qtd: ${(i.unit ?? 'un') === 'un' ? i.quantity : formatQty(i)}`;
    const sub = lineTotal(i);
    line += i.priceCents == null
      ? '  |  Sem preço'
      : sub == null
        ? '  |  Preço com unidade incompatível'
        : `  |  Unit: ${formatBRL(i.priceCents)}${perBasis(i)}  |  Sub: ${formatBRL(sub)}`;
    if (i.note) line += `\n   Obs: ${i.note}`;
    return line;
  });
  const section1 =
    `${listName}\n${scope.label}\n${rule}\n\n` + formatted.join('\n') + `\n\nTotal: ${totalText(totalsOf(items))}`;
  const section2 = `\n\n${rule}\nDADOS (CSV)\n${rule}\n\n` + buildCsv(items);
  return section1 + section2;
}
