import { describe, it, expect } from 'vitest';
import { STORAGE_VERSION } from '@/lib/migrations';
import { buildBackup, parseBackup, mergeSnapshots, BackupError, type Snapshot } from '@/lib/backup';

const item = (id: string, name: string, extra = {}) => ({
  id, name, quantity: 1, purchased: false, createdAt: 1, order: 0, ...extra,
});

const snap = (lists: Snapshot['lists'], priceHistory = {}): Snapshot => ({
  lists, activeListId: lists[0]?.id ?? null, priceHistory, purchases: [], version: 4,
});

describe('backup', () => {
  it('round trips every list, item, budget, note and price history', () => {
    const s = snap(
      [{ id: 'l1', name: 'Casa', emoji: '🏠', createdAt: 1, budgetCents: 30000, items: [item('i1', 'Arroz', { note: '5kg', priceCents: 0, unit: 'un', priceBasis: 'un' })] }],
      { arroz: { '2026-09': 2590 } },
    );
    expect(parseBackup(buildBackup({ ...s, version: STORAGE_VERSION }))).toEqual({ ...s, version: STORAGE_VERSION });
  });

  it('rejects files that are not ListaFácil backups', () => {
    expect(() => parseBackup('{"app":"outro","format":1,"data":{"lists":[]}}')).toThrow(BackupError);
    expect(() => parseBackup('não é json')).toThrow(BackupError);
  });

  it('rejects backups from a newer format', () => {
    expect(() => parseBackup('{"app":"listafacil","format":99,"data":{"lists":[]}}')).toThrow(BackupError);
  });
});

describe('mergeSnapshots', () => {
  it('keeps lists and items from both sides', () => {
    const a = snap([{ id: 'l1', name: 'A', emoji: '🛒', createdAt: 1, items: [item('i1', 'Leite')] }]);
    const b = snap([
      { id: 'l1', name: 'A', emoji: '🛒', createdAt: 1, items: [item('i2', 'Pão')] },
      { id: 'l2', name: 'B', emoji: '🛒', createdAt: 1, items: [item('i3', 'Café')] },
    ]);
    const m = mergeSnapshots(a, b);
    expect(m.lists).toHaveLength(2);
    expect(m.lists.find(l => l.id === 'l1')!.items.map(i => i.id).sort()).toEqual(['i1', 'i2']);
  });

  it('prefers the primary side when the same item exists on both', () => {
    const a = snap([{ id: 'l1', name: 'A', emoji: '🛒', createdAt: 1, items: [item('i1', 'Leite', { quantity: 3 })] }]);
    const b = snap([{ id: 'l1', name: 'A', emoji: '🛒', createdAt: 1, items: [item('i1', 'Leite', { quantity: 1 })] }]);
    expect(mergeSnapshots(a, b).lists[0].items[0].quantity).toBe(3);
  });

  it('unions price history months', () => {
    const a = snap([], { leite: { '2026-10': 5 } });
    const b = snap([], { leite: { '2026-09': 4 } });
    expect(mergeSnapshots(a, b).priceHistory.leite).toEqual({ '2026-09': 4, '2026-10': 5 });
  });
});
