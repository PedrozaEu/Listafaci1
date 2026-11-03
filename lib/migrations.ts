import { SORT_MODES, type AppState, type CategoryId, type ShoppingItem, type ShoppingList, type SortMode } from '@/types/shopping';
import { normalizeText } from '@/lib/text';
import { reaisToCents, MAX_QUANTITY } from '@/lib/money';
import { UNITS, PACK_UNITS, isDecimalUnit, toMilli, compatibleBases, defaultBasis, simplifyUnit, type Unit, type PackUnit, type PriceBasis, type UnitMigration } from '@/lib/units';
import { normalizePurchases } from '@/lib/purchase';

/**
 * Data format versions:
 * 1 original, 2 six categories, 3 normalized price history (12 months),
 * 4 money stored as integer cents (price -> priceCents, budget -> budgetCents, history in cents).
 * 5 units: explicit unit 'un' and price basis 'un' on legacy items; finished purchases list.
 * 6 only un / kg for list items (+ free-text presentation); ambiguous legacy units flagged for review.
 *   Applied by normalizeLists on every read (idempotent), so cloud rows, stashes and backups convert too.
 *   Finished purchases are never rewritten.
 */
export const STORAGE_VERSION = 6;
export const PRICE_HISTORY_MONTHS = 12;

export const pruneMonths = (entry: Record<string, number>): Record<string, number> => {
  const keys = Object.keys(entry).sort();
  if (keys.length <= PRICE_HISTORY_MONTHS) return entry;
  return Object.fromEntries(keys.slice(-PRICE_HISTORY_MONTHS).map(k => [k, entry[k]]));
};

const NEW_CATEGORY_IDS = new Set<CategoryId>(['alimentos', 'merendas', 'proteinas', 'limpeza', 'higiene', 'bebidas', 'outros']);
const categoryMigration: Record<string, CategoryId> = {
  carnes: 'proteinas', hortifruti: 'alimentos', alimentacao: 'alimentos', cafe: 'merendas',
  laticinios: 'merendas', lanches: 'merendas', padaria: 'merendas', frios: 'proteinas',
  higiene: 'higiene', limpeza: 'limpeza', guloseimas: 'merendas', outros: 'outros',
};

export function migrateCategory(cat?: string): CategoryId | undefined {
  if (!cat) return undefined;
  if (NEW_CATEGORY_IDS.has(cat as CategoryId)) return cat as CategoryId;
  return categoryMigration[cat] ?? 'outros';
}

type Raw = Record<string, unknown>;
type RawList = Raw & { items?: Raw[] };

function migrateV1toV2(state: Raw): Raw {
  const lists = ((state.lists as RawList[]) ?? []).map(list => ({
    ...list,
    items: (list.items ?? []).map(item => ({ ...item, category: migrateCategory(item.category as string) })),
  }));
  return { ...state, lists, categoryFilter: migrateCategory((state.categoryFilter as string) ?? undefined) ?? null };
}

function migrateV2toV3(state: Raw): Raw {
  const oldHistory = (state.priceHistory as Record<string, Record<string, number>>) ?? {};
  const priceHistory: Record<string, Record<string, number>> = {};
  for (const [name, months] of Object.entries(oldHistory)) {
    const key = normalizeText(name);
    if (!key || !months) continue;
    priceHistory[key] = pruneMonths({ ...priceHistory[key], ...months });
  }
  return { ...state, priceHistory, themeManual: typeof state.darkMode === 'boolean', shoppingMode: false };
}

/** v3 -> v4: reais (float) to integer cents, exactly once. Missing prices stay missing. */
export function migrateV3toV4(state: Raw): Raw {
  const lists = ((state.lists as RawList[]) ?? []).map(list => {
    const { budget, ...rest } = list as RawList & { budget?: unknown };
    return {
      ...rest,
      budgetCents: typeof rest.budgetCents === 'number' ? rest.budgetCents
        : typeof budget === 'number' && budget > 0 ? reaisToCents(budget) : undefined,
      items: (list.items ?? []).map(item => {
        const { price, ...other } = item as Raw & { price?: unknown };
        return {
          ...other,
          priceCents: typeof other.priceCents === 'number' ? other.priceCents
            : typeof price === 'number' && price >= 0 ? reaisToCents(price) : undefined,
        };
      }),
    };
  });
  const priceHistory: Record<string, Record<string, number>> = {};
  for (const [k, months] of Object.entries((state.priceHistory as Record<string, Record<string, number>>) ?? {})) {
    priceHistory[k] = Object.fromEntries(Object.entries(months ?? {}).map(([m, v]) => [m, reaisToCents(v)]));
  }
  return { ...state, lists, priceHistory };
}

/** v4 -> v5: legacy items were always counted per unit and priced per unit. */
export function migrateV4toV5(state: Raw): Raw {
  const lists = ((state.lists as RawList[]) ?? []).map(list => ({
    ...list,
    items: (list.items ?? []).map(item => ({ ...item, unit: item.unit ?? 'un', priceBasis: item.priceBasis ?? 'un' })),
  }));
  return { ...state, lists, purchases: Array.isArray(state.purchases) ? state.purchases : [] };
}

/** Runs every migration needed from `fromVersion` up to STORAGE_VERSION. */
export function migrateRaw(state: Raw, fromVersion: number): Raw {
  let s = state ?? {};
  if (fromVersion < 2) s = migrateV1toV2(s);
  if (fromVersion < 3) s = migrateV2toV3(s);
  if (fromVersion < 4) s = migrateV3toV4(s);
  if (fromVersion < 5) s = migrateV4toV5(s);
  return { ...s, version: STORAGE_VERSION };
}

const validMigration = (m: unknown): UnitMigration | undefined => {
  const x = m as UnitMigration | undefined;
  return x && (x.status === 'converted' || x.status === 'review') && x.from && typeof x.from.unit === 'string'
    && Number.isFinite(x.from.quantity) ? x : undefined;
};

/** Legacy cleanup, then the un/kg simplification. Unknown units go to review (never silently 'un'). */
export const normalizeUnits = (i: ShoppingItem): Partial<ShoppingItem> => {
  const presentation = typeof i.presentation === 'string' ? i.presentation : undefined;
  const unitMigration = validMigration(i.unitMigration);
  if (i.unit != null && !UNITS.includes(i.unit as Unit) && !unitMigration) {
    return simplifyUnit({ ...i, presentation, unitMigration: { status: 'review', from: { quantity: Number(i.quantity), unit: String(i.unit),
      ...(i.priceCents != null ? { priceCents: i.priceCents } : {}) } } });
  }
  const legacy = { ...i, ...legacyUnits(i) };
  return { ...simplifyUnit({ ...legacy, presentation, unitMigration }), priceEstimated: legacy.priceEstimated };
};

const legacyUnits = (i: ShoppingItem): Partial<ShoppingItem> => {
  const unit: Unit = UNITS.includes(i.unit as Unit) ? (i.unit as Unit) : 'un';
  const q = Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1;
  const quantity = isDecimalUnit(unit)
    ? Math.min(toMilli(q), MAX_QUANTITY * 1000) / 1000
    : Math.min(Math.max(1, Math.round(q)), MAX_QUANTITY);
  const packOk = unit === 'pacote' && PACK_UNITS.includes(i.packUnit as PackUnit)
    && Number.isFinite(i.packSize) && (i.packSize as number) > 0;
  const packSize = packOk ? toMilli(i.packSize as number) / 1000 : undefined;
  const packUnit = packOk ? (i.packUnit as PackUnit) : undefined;
  const bases = compatibleBases(unit, packUnit, packSize);
  const priceBasis: PriceBasis = bases.includes(i.priceBasis as PriceBasis) ? (i.priceBasis as PriceBasis) : defaultBasis(unit);
  const cp = isDecimalUnit(unit) && Number.isFinite(i.controlPortion) && (i.controlPortion as number) > 0
    ? toMilli(i.controlPortion as number) / 1000 : undefined;
  return { unit, quantity, packSize, packUnit, priceBasis, controlPortion: cp, priceEstimated: i.priceEstimated === true || undefined };
};

const toCents = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);

/** Cleans lists of an already-migrated (v4) payload. Never invents lists. */
export function normalizeLists(raw: unknown): ShoppingList[] {
  const rawLists = Array.isArray(raw) ? (raw as ShoppingList[]) : [];
  return rawLists
    .filter(l => l && typeof l.id === 'string')
    .map(l => ({
      ...l,
      name: l.name ?? 'Lista',
      emoji: l.emoji ?? '🛒',
      createdAt: l.createdAt ?? Date.now(),
      budgetCents: toCents(l.budgetCents) || undefined,
      sortMode: SORT_MODES.includes(l.sortMode as SortMode) ? l.sortMode : undefined,
      sourceListId: typeof l.sourceListId === 'string' ? l.sourceListId : undefined,
      items: Array.isArray(l.items)
        ? l.items
            .filter(i => i && typeof i.id === 'string' && typeof i.name === 'string')
            .map((i, idx): ShoppingItem => ({
              ...i,
              // Integers only; a legacy fraction is rounded, never concatenated (1.5 never becomes 15).
              ...normalizeUnits(i),
              priceCents: toCents(i.priceCents),
              category: migrateCategory(i.category),
              purchased: Boolean(i.purchased),
              createdAt: i.createdAt ?? Date.now(),
              order: Number.isFinite(i.order) ? i.order : idx,
            }))
        : [],
    }));
}

/** Full state from any persisted payload (already migrated). */
export function normalizeState(state: Raw, makeList: () => ShoppingList): AppState {
  const lists = normalizeLists(state.lists);
  const safeLists = lists.length ? lists : [makeList()];
  const activeId = typeof state.activeListId === 'string' && safeLists.some(l => l.id === state.activeListId)
    ? (state.activeListId as string) : safeLists[0].id;
  return {
    lists: safeLists,
    activeListId: activeId,
    sortMode: SORT_MODES.includes(state.sortMode as SortMode)
      ? (state.sortMode as SortMode) : 'created',
    searchQuery: '',
    categoryFilter: migrateCategory((state.categoryFilter as string) ?? undefined) ?? null,
    darkMode: Boolean(state.darkMode),
    themeManual: Boolean(state.themeManual),
    shoppingMode: Boolean(state.shoppingMode),
    version: STORAGE_VERSION,
    priceHistory: (state.priceHistory as AppState['priceHistory']) ?? {},
    purchases: normalizePurchases(state.purchases),
  };
}
