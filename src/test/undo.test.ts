import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '@/store/useStore';

const reset = () => {
  useStore.getState().resetAll();
  useStore.getState().addList('Segunda', '🧺');
};

describe('undo delete', () => {
  beforeEach(reset);

  it('restores into the original list even after switching lists', () => {
    const [first, second] = useStore.getState().lists;
    useStore.getState().setActiveList(first.id);
    useStore.getState().addItem({ name: 'Leite', quantity: 2, priceCents: 0 });
    const item = useStore.getState().lists[0].items[0];

    useStore.getState().deleteItem(item.id);
    useStore.getState().setActiveList(second.id);
    expect(useStore.getState().restoreItem(first.id, item)).toBe(true);

    const lists = useStore.getState().lists;
    expect(lists.find(l => l.id === first.id)!.items.map(i => i.id)).toEqual([item.id]);
    expect(lists.find(l => l.id === second.id)!.items).toHaveLength(0);
    expect(lists[0].items[0]).toEqual(item);
  });

  it('does not restore into another list when the original list was deleted', () => {
    const [first, second] = useStore.getState().lists;
    useStore.getState().setActiveList(first.id);
    useStore.getState().addItem({ name: 'Pão', quantity: 1 });
    const item = useStore.getState().lists[0].items[0];
    useStore.getState().deleteItem(item.id);
    useStore.getState().deleteList(first.id);

    expect(useStore.getState().restoreItem(first.id, item)).toBe(false);
    expect(useStore.getState().lists.find(l => l.id === second.id)!.items).toHaveLength(0);
  });
});
