import type { Unit, PackUnit, PriceBasis, UnitMigration } from '@/lib/units';
import type { PurchaseRecord } from '@/lib/purchase';

export type CategoryId = 'alimentos' | 'merendas' | 'proteinas' | 'limpeza' | 'higiene' | 'bebidas' | 'outros';

export interface Category {
  id: CategoryId;
  emoji: string;
  label: string;
  color: string; // tailwind border color class token
  bar: string; // tailwind background class for the category marker
}

export const CATEGORIES: Category[] = [
  { id: 'alimentos', emoji: '🍎', label: 'Alimentos', color: 'border-orange-400', bar: 'bg-orange-400' },
  { id: 'merendas', emoji: '🥪', label: 'Merendas', color: 'border-yellow-500', bar: 'bg-yellow-500' },
  { id: 'proteinas', emoji: '🥩', label: 'Proteínas', color: 'border-red-500', bar: 'bg-red-500' },
  { id: 'limpeza', emoji: '🧹', label: 'Limpeza', color: 'border-cyan-400', bar: 'bg-cyan-400' },
  { id: 'higiene', emoji: '🧴', label: 'Higiene', color: 'border-blue-400', bar: 'bg-blue-400' },
  { id: 'bebidas', emoji: '🥤', label: 'Bebidas', color: 'border-teal-400', bar: 'bg-teal-400' },
  { id: 'outros', emoji: '📦', label: 'Outros', color: 'border-muted-foreground', bar: 'bg-muted-foreground' },
];

export interface ShoppingItem {
  id: string;
  name: string;
  /** Bought amount in `unit`. Integer for un/pacote; up to 3 decimals for kg, g, L, mL. */
  quantity: number;
  /** New products: only 'un' or 'kg'. Other values exist only on legacy items waiting for review. Missing = 'un'. */
  unit?: Unit;
  /** Optional informative text ("Pacote 5 kg", "Garrafa 2 L"). Never used in calculations. */
  presentation?: string;
  /** Set when the item came from an old unit: converted automatically or waiting for the user's review. */
  unitMigration?: UnitMigration;
  /** Optional package content, e.g. 2 pacotes of 5 kg: packSize 5, packUnit 'kg'. */
  packSize?: number;
  packUnit?: PackUnit;
  /** Price in integer cents per `priceBasis`. undefined = not informed (different from 0). */
  priceCents?: number;
  /** What the price refers to. Missing = default for the unit. */
  priceBasis?: PriceBasis;
  /** true when the price was reused (history / previous list) and not confirmed yet. */
  priceEstimated?: boolean;
  /** Mass/volume only: explicit portion (in `unit`) that one PDF consumption box represents. */
  controlPortion?: number;
  /** Author id, only when known. Legacy items stay without author. */
  addedBy?: string;
  /** Who put it in the cart (shared lists, from the server). */
  markedBy?: string;
  /** When it was put in the cart (server time, shared lists). */
  markedAt?: number;
  category?: CategoryId;
  note?: string;
  purchased: boolean;
  createdAt: number;
  order: number;
}

export interface ShoppingList {
  id: string;
  name: string;
  emoji: string;
  createdAt: number;
  /** Budget in integer cents. */
  budgetCents?: number;
  items: ShoppingItem[];
  /** View preference of this list. Missing = falls back to the global default. */
  sortMode?: SortMode;
  /** Id of the list this one was created from ("Criar próxima compra"). */
  sourceListId?: string;
  /** Shared lists only (from the server, never sent back): my role and the participants. */
  role?: ListRole;
  /** Remote lists only: owner_id confirmed by the server. Undefined = local/guest list. */
  ownerId?: string;
  members?: ListMember[];
  /** Server route revision last confirmed for this list. */
  routeVersion?: number;
}

export interface ListMember {
  userId: string;
  name: string;
  color: string;
  role: ListRole | 'viewer';
  /** review = legacy viewer link without access until the owner picks editor or checker. */
  status?: 'active' | 'review';
}

/** Per-list role. checker = "Apenas marcar": marks/unmarks only. */
export type ListRole = 'owner' | 'editor' | 'checker' | 'unknown';
/** undefined = local/guest list (always mine); 'unknown' = remote list whose authorization is not confirmed. */
export const canEditItems = (role?: ListRole | 'viewer') => role === undefined || role === 'owner' || role === 'editor';
export const canMarkItems = (role?: ListRole | 'viewer') => canEditItems(role) || role === 'checker';
/** Per-list role from server data: ownership from owner_id vs the signed-in id, guests from their ACTIVE link. */
export function resolveListRole(ownerId: string | null | undefined, uid: string,
  myLink?: { role: string; status?: string }): ListRole {
  if (!ownerId) return 'unknown';
  if (ownerId === uid) return myLink && (myLink.role !== 'owner' || (myLink.status ?? 'active') !== 'active') ? 'unknown' : 'owner';
  if (!myLink || (myLink.status ?? 'active') !== 'active') return 'unknown';
  return myLink.role === 'editor' ? 'editor' : myLink.role === 'checker' ? 'checker' : 'unknown';
}

/** custom = Roteiro (explicit positions); category = grouped presentation of the route. */
export type SortMode = 'custom' | 'category' | 'alpha' | 'created';
export const SORT_MODES: SortMode[] = ['custom', 'category', 'alpha', 'created'];

export interface AppState {
  lists: ShoppingList[];
  activeListId: string | null;
  sortMode: SortMode;
  searchQuery: string;
  categoryFilter: CategoryId | null;
  darkMode: boolean;
  /** true once the user toggled the theme manually; before that we follow prefers-color-scheme */
  themeManual: boolean;
  /** simplified in-store view: bigger type, no animations, screen wake lock */
  shoppingMode: boolean;
  version: number;
  /** item name (normalized) -> month key (YYYY-MM) -> unit price in cents */
  priceHistory: Record<string, Record<string, number>>;
  /** Finished purchases (immutable records). */
  purchases: PurchaseRecord[];
}

