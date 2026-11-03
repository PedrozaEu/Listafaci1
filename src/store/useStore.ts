import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppState, ShoppingItem, ShoppingList, SortMode, CategoryId } from '@/types/shopping';
import { normalizeText } from '@/lib/text';
import { priceKey, toMilli } from '@/lib/units';
import { buildPurchaseRecord, type PurchaseRecord, type BuildPurchaseInput } from '@/lib/purchase';
import { MAX_QUANTITY } from '@/lib/money';
import { invertRoute, orderSnapshot, canUndoInversion, applyOrders, buildNextList, type OrderSnapshot, type NextListOptions } from '@/lib/route';
import { STORAGE_VERSION, migrateRaw, normalizeState as normalizeStateWith, pruneMonths } from '@/lib/migrations';

const createId = () => crypto.randomUUID();

export { STORAGE_VERSION, PRICE_HISTORY_MONTHS } from '@/lib/migrations';

const monthKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

type PriceRef = Pick<ShoppingItem, 'name' | 'priceCents' | 'unit' | 'priceBasis' | 'packSize' | 'packUnit' | 'priceEstimated' | 'presentation'>;

/** Records a price under name + price basis (+ package). Reused, unconfirmed prices are not recorded. */
const recordPrice = (
  history: Record<string, Record<string, number>>,
  item: PriceRef,
): Record<string, Record<string, number>> => {
  const priceCents = item.priceCents;
  if (priceCents == null || item.priceEstimated) return history;
  const n = normalizeText(item.name);
  if (!n) return history;
  const key = priceKey(n, item);
  return {
    ...history,
    [key]: pruneMonths({ ...history[key], [monthKey()]: priceCents }),
  };
};

const prefersDark = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

const makeList = (name = 'Minha Lista', emoji = '🛒'): ShoppingList => ({
  id: createId(),
  name,
  emoji,
  createdAt: Date.now(),
  items: [],
});

const defaultList = makeList();

interface Actions {
  // Lists
  addList: (name: string, emoji: string) => void;
  /** Adds an already validated independent copy (new ids) and opens it. */
  importListCopy: (list: ShoppingList) => void;
  deleteList: (id: string) => void;
  setActiveList: (id: string) => void;
  updateListName: (id: string, name: string, emoji: string) => void;
  setBudget: (listId: string, budgetCents: number | undefined) => void;

  // Items
  addItem: (item: Omit<ShoppingItem, 'id' | 'createdAt' | 'order' | 'purchased'>) => void;
  /** Restores a deleted item into its original list. Returns false when that list no longer exists. */
  restoreItem: (listId: string, item: ShoppingItem) => boolean;
  updateItem: (itemId: string, updates: Partial<ShoppingItem>) => void;
  deleteItem: (itemId: string) => void;
  togglePurchased: (itemId: string) => void;
  reorderItems: (itemIds: string[]) => void;
  clearPurchased: () => void;
  clearAll: () => void;
  resetAll: () => void;
  /** Returns an existing item of the active list whose name matches (accent/case insensitive). */
  findItemByName: (name: string) => ShoppingItem | undefined;
  mergeQuantity: (itemId: string, quantity: number, priceCents?: number) => void;
  /** Saves an immutable purchase record from the checked items. Idempotent by record id. */
  completePurchase: (listId: string, input: BuildPurchaseInput, pending: 'keep' | 'move', moveName?: string, bought?: 'remove' | 'keep') =>
    { status: 'ok'; record: PurchaseRecord } | { status: 'duplicate' | 'empty' | 'missing-list' };

  /** Inverts the whole active route and switches it to Roteiro. Returns an undo token. */
  invertActiveList: () => InversionUndo | null;
  /** Restores positions only if nothing moved since the inversion. */
  undoInversion: (token: InversionUndo) => boolean;
  /** Creates a new list from a source list (source untouched) and activates it. */
  createNextList: (sourceId: string, opts: NextListOptions) => string | null;

  // UI
  setSortMode: (mode: SortMode) => void;
  setSearchQuery: (q: string) => void;
  setCategoryFilter: (c: CategoryId | null) => void;
  toggleDarkMode: () => void;
  setDarkModeFromSystem: (dark: boolean) => void;
  toggleShoppingMode: () => void;
  getHistoryItems: () => Array<{ name: string; category?: CategoryId; note?: string }>;
  /** month key (YYYY-MM) -> unit price, for a given item name */
  getPriceHistory: (name: string, ref?: Pick<ShoppingItem, 'unit' | 'priceBasis' | 'packSize' | 'packUnit' | 'presentation'>) => Record<string, number>;
  /** Replaces local lists/history with a snapshot restored from the cloud. */
  hydrateFromCloud: (snapshot: Partial<AppState>) => void;
}

export interface InversionUndo { listId: string; before: OrderSnapshot; after: OrderSnapshot }

type Store = AppState & Actions;

const getActiveList = (state: AppState): ShoppingList | undefined =>
  state.lists.find(l => l.id === state.activeListId);

const updateActiveList = (state: AppState, updater: (list: ShoppingList) => ShoppingList): Partial<AppState> => ({
  lists: state.lists.map(l => (l.id === state.activeListId ? updater(l) : l)),
});

const normalizeState = (state: Record<string, unknown>) => normalizeStateWith(state, () => makeList());

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      lists: [defaultList],
      activeListId: defaultList.id,
      sortMode: 'created',
      searchQuery: '',
      categoryFilter: null,
      darkMode: prefersDark(),
      themeManual: false,
      shoppingMode: false,
      version: STORAGE_VERSION,
      priceHistory: {},
      purchases: [],

      importListCopy: (list) => set(s => ({ lists: [...s.lists, list], activeListId: list.id })),
      addList: (name, emoji) => {
        const newList = makeList(name, emoji);
        set(s => ({ lists: [...s.lists, newList], activeListId: newList.id }));
      },
      deleteList: (id) => set(s => {
        const lists = s.lists.filter(l => l.id !== id);
        return { lists, activeListId: lists.length ? lists[0].id : null };
      }),
      setActiveList: (id) => set({ activeListId: id }),
      updateListName: (id, name, emoji) => set(s => ({
        lists: s.lists.map(l => (l.id === id ? { ...l, name, emoji } : l)),
      })),
      setBudget: (listId, budgetCents) => set(s => ({
        lists: s.lists.map(l => (l.id === listId ? { ...l, budgetCents } : l)),
      })),

      addItem: (item) => set(s => {
        const list = getActiveList(s);
        if (!list) return s;
        const newItem: ShoppingItem = {
          ...item,
          id: createId(),
          createdAt: Date.now(),
          order: 0,
          purchased: false,
        };
        const items = list.items.map(i => ({ ...i, order: i.order + 1 }));
        return {
          ...updateActiveList(s, l => ({ ...l, items: [newItem, ...items] })),
          priceHistory: recordPrice(s.priceHistory, item),
        };
      }),

      restoreItem: (listId, item) => {
        if (!get().lists.some(l => l.id === listId)) return false;
        set(s => ({
          lists: s.lists.map(l => {
            if (l.id !== listId || l.items.some(i => i.id === item.id)) return l;
            return { ...l, items: [...l.items, item].sort((a, b) => a.order - b.order) };
          }),
        }));
        return true;
      },

      updateItem: (itemId, updates) => set(s => {
        const item = getActiveList(s)?.items.find(i => i.id === itemId);
        return {
          ...updateActiveList(s, l => ({
            ...l,
            items: l.items.map(i => (i.id === itemId ? { ...i, ...updates } : i)),
          })),
          priceHistory: item && updates.priceCents != null
            ? recordPrice(s.priceHistory, { ...item, ...updates })
            : s.priceHistory,
        };
      }),

      findItemByName: (name) => {
        const key = normalizeText(name);
        return getActiveList(get())?.items.find(i => normalizeText(i.name) === key);
      },

      mergeQuantity: (itemId, quantity, priceCents) => set(s => {
        const item = getActiveList(s)?.items.find(i => i.id === itemId);
        if (!item) return s;
        return {
          ...updateActiveList(s, l => ({
            ...l,
            items: l.items.map(i =>
              i.id === itemId
                ? {
                    ...i,
                    // fixed point: sum in thousandths, integers stay integers
                    quantity: Math.min(toMilli(i.quantity) + toMilli(quantity), MAX_QUANTITY * 1000) / 1000,
                    ...(priceCents != null ? { priceCents, priceEstimated: undefined } : {}),
                  }
                : i,
            ),
          })),
          priceHistory: priceCents != null ? recordPrice(s.priceHistory, { ...item, priceCents, priceEstimated: undefined }) : s.priceHistory,
        };
      }),

      deleteItem: (itemId) => set(s => updateActiveList(s, l => ({
        ...l,
        items: l.items.filter(i => i.id !== itemId),
      }))),

      togglePurchased: (itemId) => set(s => updateActiveList(s, l => ({
        ...l,
        items: l.items.map(i => (i.id === itemId ? { ...i, purchased: !i.purchased } : i)),
      }))),

      reorderItems: (itemIds) => set(s => updateActiveList(s, l => {
        // Only the received ids are reordered; every other item is preserved.
        const idSet = new Set(itemIds);
        const affected = l.items.filter(i => idSet.has(i.id));
        const slots = affected.map(i => i.order).sort((a, b) => a - b);
        const newOrderById = new Map<string, number>();
        itemIds.forEach((id, idx) => {
          if (slots[idx] != null) newOrderById.set(id, slots[idx]);
        });
        return {
          ...l,
          items: l.items.map(i =>
            newOrderById.has(i.id) ? { ...i, order: newOrderById.get(i.id)! } : i,
          ),
        };
      })),

      clearPurchased: () => set(s => updateActiveList(s, l => ({
        ...l,
        items: l.items.filter(i => !i.purchased),
      }))),

      completePurchase: (listId, input, pending, moveName, bought = 'remove') => {
        const s = get();
        if (s.purchases.some(p => p.id === input.id)) return { status: 'duplicate' };
        const list = s.lists.find(l => l.id === listId);
        if (!list) return { status: 'missing-list' };
        const record = buildPurchaseRecord(list, input);
        if (!record.lines.length) return { status: 'empty' };
        const boughtIds = new Set(record.lines.map(l => l.itemId));
        const pendingItems = list.items.filter(i => !boughtIds.has(i.id));
        // 'keep' leaves bought items in place, unchecked, as a guide for the next purchase.
        const keptBought = bought === 'keep'
          ? list.items.filter(i => boughtIds.has(i.id)).map(i => ({ ...i, purchased: false, markedBy: undefined, markedAt: undefined }))
          : [];
        const keptIds = new Set(keptBought.map(i => i.id));
        const remaining = list.items
          .filter(i => keptIds.has(i.id) || (pending !== 'move' && !boughtIds.has(i.id)))
          .map(i => keptBought.find(k => k.id === i.id) ?? i);
        let lists = s.lists.map(l => (l.id === listId ? { ...l, items: remaining } : l));
        let activeListId = s.activeListId;
        if (pending === 'move' && pendingItems.length) {
          const moved: ShoppingList = {
            ...makeList(moveName?.trim() || `${list.name} (pendentes)`, list.emoji),
            items: pendingItems,
            sortMode: list.sortMode,
            budgetCents: list.budgetCents,
            sourceListId: list.id,
          };
          lists = [...lists, moved];
          activeListId = moved.id;
        }
        set({ purchases: [...s.purchases, record], lists, activeListId });
        return { status: 'ok', record };
      },

      clearAll: () => set(s => updateActiveList(s, l => ({ ...l, items: [] }))),

      resetAll: () => {
        const fresh = makeList();
        set({
          lists: [fresh],
          activeListId: fresh.id,
          priceHistory: {},
          purchases: [],
          searchQuery: '',
          categoryFilter: null,
          sortMode: 'created',
          shoppingMode: false,
        });
      },

      invertActiveList: () => {
        const s = get();
        const list = getActiveList(s);
        if (!list) return null;
        const before = orderSnapshot(list.items);
        const items = invertRoute(list.items);
        set(st => updateActiveList(st, l => ({ ...l, items, sortMode: 'custom' })));
        return { listId: list.id, before, after: orderSnapshot(items) };
      },
      undoInversion: (token) => {
        const list = get().lists.find(l => l.id === token.listId);
        if (!list || !canUndoInversion(list.items, token.after)) return false;
        set(s => ({
          lists: s.lists.map(l => (l.id === token.listId ? { ...l, items: applyOrders(l.items, token.before) } : l)),
        }));
        return true;
      },
      createNextList: (sourceId, opts) => {
        const source = get().lists.find(l => l.id === sourceId);
        if (!source) return null;
        const next = buildNextList(source, opts, { newId: createId, now: Date.now() });
        set(s => ({ lists: [...s.lists, next], activeListId: next.id, searchQuery: '', categoryFilter: null }));
        return next.id;
      },

      // View preference is stored per list; the global value is only the default for lists without one.
      setSortMode: (mode) => set(s => updateActiveList(s, l => ({ ...l, sortMode: mode }))),
      setSearchQuery: (q) => set({ searchQuery: q }),
      setCategoryFilter: (c) => set({ categoryFilter: c }),
      toggleDarkMode: () => set(s => ({ darkMode: !s.darkMode, themeManual: true })),
      setDarkModeFromSystem: (dark) => set(s => (s.themeManual ? s : { darkMode: dark })),
      toggleShoppingMode: () => set(s => ({ shoppingMode: !s.shoppingMode })),

      getHistoryItems: () => {
        const s = get();
        const map = new Map<string, { name: string; category?: CategoryId; note?: string }>();
        for (const list of s.lists) {
          for (const item of list.items) {
            const key = normalizeText(item.name);
            if (key && !map.has(key)) {
              map.set(key, { name: item.name, category: item.category, note: item.note });
            }
          }
        }
        return Array.from(map.values());
      },
      getPriceHistory: (name, ref) => {
        // same presentation first; otherwise the generic history of the same unit (never the other unit)
        const h = get().priceHistory, n = normalizeText(name), r = ref ?? {};
        return h[priceKey(n, r)] ?? h[priceKey(n, r, false)] ?? {};
      },

      hydrateFromCloud: (snapshot) => set(s => {
        const v = typeof snapshot.version === 'number' ? snapshot.version : 1;
        const merged = normalizeState(migrateRaw({ ...snapshot } as Record<string, unknown>, v));
        return {
          lists: merged.lists,
          activeListId: merged.activeListId,
          priceHistory: merged.priceHistory,
          purchases: merged.purchases,
        };
      }),
    }),
    {
      name: 'listafacil-storage',
      version: STORAGE_VERSION,
      migrate: (persistedState, version) =>
        normalizeState(migrateRaw((persistedState as Record<string, unknown>) ?? {}, version)),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeState((persisted as Record<string, unknown>) ?? {}),
      }),
    },
  ),
);

/** Active list's view, falling back to the global default. */
export const useActiveSortMode = () =>
  useStore(s => s.lists.find(l => l.id === s.activeListId)?.sortMode ?? s.sortMode);
