import { describe, it, expect } from 'vitest';
import { buildListFile, parseListFile, ListFileError } from '@/lib/listFile';
import type { ShoppingList } from '@/types/shopping';

const shared: ShoppingList = {
  id: 'orig', name: 'Mercado', emoji: '🛒', createdAt: 1, budgetCents: 15000, role: 'editor', routeVersion: 7,
  members: [{ userId: 'u1', name: 'Ana', color: '#000', role: 'owner' }],
  items: [
    { id: 'a', name: 'Arroz', quantity: 1.5, unit: 'kg', priceCents: 0, priceBasis: 'kg', purchased: true, createdAt: 1, order: 1, addedBy: 'u1' },
    { id: 'b', name: 'Sal', quantity: 2, purchased: false, createdAt: 1, order: 0 },
  ],
};

describe('arquivo de cópia da lista', () => {
  it('importação vira cópia independente: ids novos, sem papel nem participantes', () => {
    let n = 0;
    const copy = parseListFile(buildListFile(shared), () => `novo-${n++}`);
    expect(copy.id).not.toBe('orig');
    expect(copy.items.map(i => i.id)).toEqual(['novo-1', 'novo-2']);
    expect(copy.role).toBeUndefined();
    expect(copy.members).toBeUndefined();
    expect(copy.items[0]).toMatchObject({ name: 'Arroz', quantity: 1.5, priceCents: 0, purchased: true });
    expect(copy.items[0].addedBy).toBeUndefined();
    expect(copy.items[1].priceCents).toBeUndefined();
    expect(copy.budgetCents).toBe(15000);
  });

  it('papel no arquivo não dá permissão', () => {
    const f = JSON.parse(buildListFile(shared));
    f.list.role = 'owner'; f.list.members = [{ userId: 'x', role: 'owner' }];
    expect(parseListFile(JSON.stringify(f)).role).toBeUndefined();
  });

  it('rejeita arquivos malformados, grandes ou de outro tipo', () => {
    expect(() => parseListFile('{oi')).toThrow(ListFileError);
    expect(() => parseListFile(JSON.stringify({ kind: 'outro', format: 1 }))).toThrow('não é uma lista');
    const f = JSON.parse(buildListFile(shared));
    f.list.items[0].quantity = -1;
    expect(() => parseListFile(JSON.stringify(f))).toThrow('inválidos');
    f.list.items[0].quantity = 1; f.list.items[0].priceCents = 1.5;
    expect(() => parseListFile(JSON.stringify(f))).toThrow('inválidos');
    expect(() => parseListFile('x'.repeat(1_000_001))).toThrow('grande');
    const g = JSON.parse(buildListFile(shared)); g.schemaVersion = 99;
    expect(() => parseListFile(JSON.stringify(g))).toThrow('versão mais nova');
  });
});
