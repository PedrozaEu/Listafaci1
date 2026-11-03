import { describe, it, expect } from 'vitest';
import { buildPayload, buildChunks, summarize, checksum, compareSummaries, remapSummary, rowsToSnapshot, scopeToBatch, batchMapFor, emptyBatchMap, type ListRow, type ItemRow } from '@/lib/legacyImport';
import type { Snapshot } from '@/lib/backup';

const L1 = '9a000000-0000-0000-0000-000000000001';
const fixture = (): Snapshot => ({
  version: 5,
  activeListId: L1,
  lists: [
    { id: L1, name: 'Mercado', emoji: '🛒', createdAt: 1700000000000, budgetCents: 15000, sortMode: 'custom', items: [
      { id: 'a', name: 'Arroz', quantity: 1.5, unit: 'kg', priceCents: 0, priceBasis: 'kg', purchased: true, createdAt: 1, order: 2 },
      { id: 'b', name: 'Sal', quantity: 2, purchased: false, createdAt: 2, order: 0, note: 'fino' },
      { id: 'c', name: 'Óleo', quantity: 1, priceCents: 899, purchased: false, createdAt: 3, order: 0 },
    ] },
    { id: 'vazia', name: 'Vazia', emoji: '📦', createdAt: 1700000000001, items: [], sourceListId: L1 },
  ],
  priceHistory: { arroz: { '2026-01': 2500, '2026-02': 2600 } },
  purchases: [],
});

describe('importação do legado', () => {
  it('resumo conta listas vazias, preço zero, preço ausente e quantidade em milésimos', () => {
    const s = summarize(fixture());
    expect(s).toMatchObject({ lists: 2, items: 3, checked: 1, priced: 2, price_cents_sum: 899, quantity_milli_sum: 4500, price_history: 2 });
    expect(s.sequence).toEqual({ [L1]: ['b', 'c', 'a'], vazia: [] }); // empate de ordem: estável pela posição original
  });

  it('mesmos dados geram o mesmo checksum; mudar uma marcação muda', () => {
    const a = checksum(buildPayload(fixture()));
    expect(checksum(buildPayload(fixture()))).toBe(a);
    const f = fixture(); f.lists[0].items[1].purchased = true;
    expect(checksum(buildPayload(f))).not.toBe(a);
  });

  it('lotes cobrem todos os itens uma vez, na ordem listas -> itens -> histórico', () => {
    const p = buildPayload(fixture());
    const chunks = buildChunks(p, 2);
    expect(chunks[0].lists).toHaveLength(2);
    expect(chunks.flatMap(c => c.items ?? []).map(i => i.legacy_id)).toEqual(['b', 'c', 'a']);
    expect(chunks.flatMap(c => c.price_history ?? [])).toHaveLength(2);
    expect(p.items.find(i => i.legacy_id === 'b')!.price_cents).toBeNull(); // ausente continua ausente
  });

  it('linhas relacionais voltam ao mesmo resumo (ida e volta) com o mapa de ids', () => {
    const map = { ...emptyBatchMap(), list: new Map([[L1, L1], ['vazia', '9a000000-0000-0000-0000-000000000002']]), item: new Map([['a', 'i-a'], ['b', 'i-b'], ['c', 'i-c']]) };
    const lists: ListRow[] = [
      { id: L1, name: 'Mercado', emoji: '🛒', budget_cents: 15000, sort_mode: 'custom', source_list_id: null, legacy_created_at: '2023-11-14T22:13:20Z', created_at: '2026-10-10T00:00:00Z', status: 'active', route_version: 0, owner_id: 'u' },
      { id: map.list.get('vazia')!, name: 'Vazia', emoji: '📦', budget_cents: null, sort_mode: null, source_list_id: L1, legacy_created_at: '2023-11-14T22:13:21Z', created_at: '2026-10-10T00:00:00Z', status: 'active', route_version: 0, owner_id: 'u' },
      { id: 'holder', name: 'Compras antigas', emoji: '🧾', budget_cents: null, sort_mode: null, source_list_id: null, legacy_created_at: null, created_at: '2026-10-10T00:00:00Z', status: 'archived', route_version: 0, owner_id: 'u' },
    ];
    const row = (id: string, name: string, position: number, extra: Partial<ItemRow>): ItemRow => ({
      id, list_id: L1, name, category: null, note: null, quantity: '1.000', unit: 'un', pack_size: null, pack_unit: null,
      price_cents: null, price_basis: 'un', price_estimated: false, control_portion: null, position, purchased: false,
      added_by: null, legacy_created_at: null, created_at: '2026-10-10T00:00:00Z', version: 1, ...extra,
    });
    const items = [
      row('i-a', 'Arroz', 2, { quantity: '1.500', unit: 'kg', price_cents: 0, price_basis: 'kg', purchased: true }),
      row('i-b', 'Sal', 0, { quantity: '2.000', note: 'fino' }),
      row('i-c', 'Óleo', 1, { price_cents: 899 }),
    ];
    const history = [{ item_key: 'arroz', month: '2026-01', cents: 2500 }, { item_key: 'arroz', month: '2026-02', cents: 2600 }];
    const snap = rowsToSnapshot(lists, items, [], history, L1);
    expect(snap.lists).toHaveLength(2); // arquivo de compras antigas não aparece como lista
    expect(snap.lists[0].items[2]).toMatchObject({ quantity: 1.5, priceCents: 0, purchased: true });
    expect(snap.lists[0].items[0].priceCents).toBeUndefined();
    expect(compareSummaries(remapSummary(summarize(fixture()), map), summarize(snap))).toEqual([]);
    expect(compareSummaries(remapSummary(summarize(fixture()), map), summarize(scopeToBatch(snap, map)))).toEqual([]);
  });

  it('divergência de ordem ou marcação é apontada', () => {
    const f = fixture(); f.lists[0].items[0].purchased = false; f.lists[0].items[0].order = -1;
    const diffs = compareSummaries(summarize(fixture()), summarize(f));
    expect(diffs).toContain('ordem dos itens diferente');
    expect(diffs.some(d => d.startsWith('itens no carrinho'))).toBe(true);
  });
});

describe('conferência limitada ao lote importado (hotfix 02)', () => {
  const B_LIST = 'b-pessoal', A_LIST = 'a-compartilhada';
  const listRow = (id: string, owner: string): ListRow => ({ id, name: id, emoji: '🛒', budget_cents: null, sort_mode: null, source_list_id: null, legacy_created_at: null, created_at: '2026-10-10T00:00:00Z', status: 'active', route_version: 0, owner_id: owner });
  const itemRow = (id: string, list: string, position: number, extra: Partial<ItemRow> = {}): ItemRow => ({ id, list_id: list, name: id, category: null, note: null, quantity: '1.000', unit: 'un', pack_size: null, pack_unit: null, price_cents: 500, price_basis: 'un', price_estimated: false, control_portion: null, position, purchased: false, added_by: null, legacy_created_at: null, created_at: '2026-10-10T00:00:00Z', version: 1, ...extra });
  const legacyB = (): Snapshot => ({ version: 5, activeListId: 'legado-b', lists: [{ id: 'legado-b', name: 'Minha', emoji: '🛒', createdAt: 1, items: [] }], priceHistory: {}, purchases: [] });
  const shared54 = Array.from({ length: 54 }, (_, n) => itemRow(`a${n}`, A_LIST, n));
  const mapB = () => batchMapFor(buildPayload(legacyB()), [
    { kind: 'list', legacy_id: 'legado-b', new_id: B_LIST },
    { kind: 'item', legacy_id: 'legado-b', new_id: 'colisao' }, // mesmo id em outro tipo não vira lista
  ]);

  it('lista pessoal vazia de B confere mesmo com a lista de A (54 itens) acessível', () => {
    const fresh = rowsToSnapshot([listRow(B_LIST, 'B'), listRow(A_LIST, 'A')], shared54, [], [], null);
    expect(fresh.lists).toHaveLength(2); // ambas continuam carregadas na interface
    expect(compareSummaries(remapSummary(summarize(legacyB()), mapB()), summarize(fresh))).not.toEqual([]); // o erro antigo
    expect(compareSummaries(remapSummary(summarize(legacyB()), mapB()), summarize(scopeToBatch(fresh, mapB())))).toEqual([]);
    expect(fresh.lists.find(l => l.id === A_LIST)!.items).toHaveLength(54);
  });

  it('outra lista própria fora do lote não contamina a conferência', () => {
    const fresh = rowsToSnapshot([listRow(B_LIST, 'B'), listRow('b-outra', 'B')], [itemRow('x', 'b-outra', 0)], [], [], null);
    expect(compareSummaries(remapSummary(summarize(legacyB()), mapB()), summarize(scopeToBatch(fresh, mapB())))).toEqual([]);
  });

  it('item ausente ou quantidade alterada dentro do lote continuam recusados', () => {
    const snap = fixture();
    const map = { ...emptyBatchMap(), list: new Map([[L1, L1], ['vazia', 'v2']]), item: new Map([['a', 'i-a'], ['b', 'i-b'], ['c', 'i-c']]) };
    const rows = [itemRow('i-b', L1, 0, { quantity: '2.000', price_cents: null }), itemRow('i-c', L1, 1, { price_cents: 899 })];
    const fresh = rowsToSnapshot([listRow(L1, 'B'), listRow('v2', 'B')], rows, [], [], null);
    fresh.priceHistory = snap.priceHistory;
    const diffs = compareSummaries(remapSummary(summarize(snap), map), summarize(scopeToBatch(fresh, map)));
    expect(diffs.some(d => d.startsWith('itens:'))).toBe(true);
    rows.push(itemRow('i-a', L1, 2, { quantity: '9.000', unit: 'kg', price_cents: 0, price_basis: 'kg', purchased: true }));
    const fresh2 = rowsToSnapshot([listRow(L1, 'B'), listRow('v2', 'B')], rows, [], [], null);
    fresh2.priceHistory = snap.priceHistory;
    expect(compareSummaries(remapSummary(summarize(snap), map), summarize(scopeToBatch(fresh2, map))).some(d => d.startsWith('soma das quantidades'))).toBe(true);
  });
});
