import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Snapshot } from '@/lib/backup';
import { diffToOps, applyOps, classifyError, backoffMs, type Op } from '@/lib/ops';

/* ---- fake server: applies each operation id once, like collab_begin_op ---- */
const server = {
  applied: new Map<string, unknown>(),
  effects: [] as string[],
  offline: false,
  loseReply: false,
  conflictKinds: new Set<string>(),
  denied: false,
  sentBy: [] as string[],
};
vi.mock('@/data/cloudRepository', () => ({
  emptyMeta: () => ({ routeVersion: new Map(), itemVersion: new Map() }),
  refreshItemVersions: async () => {},
  loadRelational: async () => { if (server.offline) throw new TypeError('Failed to fetch'); return { snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } }; },
  sendOp: async (op: Op) => {
    server.sentBy.push(op.userId);
    if (server.offline) return { status: 'network' };
    if (server.denied) return { status: 'denied' };
    if (server.conflictKinds.has(op.kind)) return { status: 'conflict' };
    if (!server.applied.has(op.id)) { server.applied.set(op.id, true); server.effects.push(`${op.kind}:${op.entityId}`); }
    if (server.loseReply) { server.loseReply = false; return { status: 'network' }; } // committed, reply lost
    return { status: 'ok', version: 2 };
  },
}));

import { OpSync } from '@/data/opSync';
import { listOps, clearUser, loadCache } from '@/data/outbox';

const base = (): Snapshot => ({
  version: 5, activeListId: 'L', priceHistory: {}, purchases: [],
  lists: [{ id: 'L', name: 'Mercado', emoji: '🛒', createdAt: 1, items: [
    { id: 'a', name: 'Arroz', quantity: 1, purchased: false, createdAt: 1, order: 0 },
    { id: 'b', name: 'Feijão', quantity: 1, purchased: false, createdAt: 1, order: 1 },
  ] }],
});
const mark = (s: Snapshot, id: string): Snapshot => ({ ...s, lists: s.lists.map(l => ({ ...l, items: l.items.map(i => (i.id === id ? { ...i, purchased: true } : i)) })) });
const add = (s: Snapshot, id: string, name: string): Snapshot => ({ ...s, lists: s.lists.map(l => ({ ...l, items: [...l.items, { id, name, quantity: 2, purchased: false, createdAt: 2, order: l.items.length }] })) });

const engine = (uid: string, current = () => true) => {
  const seen: Snapshot[] = [];
  const e = new OpSync(uid, { isCurrent: current, onLocal: s => seen.push(s), onStatus: () => {}, onNotice: () => {} }, { ...base(), lists: [] });
  return { e, seen };
};
const settle = () => new Promise(r => setTimeout(r, 30));

beforeEach(async () => {
  server.applied.clear(); server.effects = []; server.offline = false; server.loseReply = false;
  server.conflictKinds.clear(); server.denied = false; server.sentBy = [];
  await clearUser('A'); await clearUser('B');
});

describe('operações (funções puras)', () => {
  const v = { item: () => 1, list: () => null };
  it('marcação e item novo viram operações explícitas com versão-base', () => {
    const ops = diffToOps(base(), add(mark(base(), 'a'), 'c', 'Leite'), 'A', v);
    expect(ops.map(o => o.kind)).toEqual(['item_mark', 'item_create', 'reorder']);
    expect(ops.find(o => o.kind === 'item_mark')).toMatchObject({ entityId: 'a', baseVersion: 1, payload: { marked: true }, userId: 'A' });
  });
  it('estado confirmado + pendentes = o que o usuário vê; excluído não ressuscita', () => {
    const ops = diffToOps(base(), add(mark(base(), 'a'), 'c', 'Leite'), 'A', v);
    const seen = applyOps(base(), ops);
    expect(seen.lists[0].items.map(i => [i.id, i.purchased])).toEqual([['a', true], ['b', false], ['c', false]]);
    const tomb = applyOps(base(), ops.filter(o => o.kind === 'item_create'), new Set(['c']));
    expect(tomb.lists[0].items.map(i => i.id)).toEqual(['a', 'b']);
  });
  it('classifica rede, permissão e recusa; espera cresce', () => {
    expect(classifyError(new TypeError('Failed to fetch'))).toBe('network');
    expect(classifyError({ code: '42501', message: 'forbidden' })).toBe('denied');
    expect(classifyError({ code: '22023', message: 'invalid_kind' })).toBe('invalid');
    expect(backoffMs(0, 0)).toBe(1000);
    expect(backoffMs(3, 0)).toBe(8000);
    expect(backoffMs(30, 0)).toBe(300000);
  });
});

describe('fila no aparelho', () => {
  it('modo avião: edita, fecha, reabre, reconecta e confirma sem perda nem duplicação', async () => {
    server.offline = true;
    const one = engine('A');
    await one.e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    await one.e.record(mark(one.e.local, 'a'));
    await one.e.record(mark(one.e.local, 'b'));
    await settle();
    expect((await listOps('A')).length).toBe(2);
    one.e.stop(); // "fecha o app"

    const two = engine('A'); // "reabre" ainda sem rede
    await two.e.start(null);
    expect(two.seen.at(-1)!.lists[0].items.every(i => i.purchased)).toBe(true); // cache local preservado
    server.offline = false;
    await two.e.drain();
    expect(await listOps('A')).toHaveLength(0);
    expect(server.effects).toEqual(['item_mark:a', 'item_mark:b']);
    expect((await loadCache('A'))!.confirmedAt).not.toBeNull();
  });

  it('resposta perdida após o commit: reenvio não duplica', async () => {
    const { e } = engine('A');
    await e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    server.loseReply = true;
    await e.record(add(e.local, 'c', 'Leite'));
    await settle();
    expect(await listOps('A')).toHaveLength(2); // still queued after the lost reply
    await new Promise(r => setTimeout(r, 1300));
    await e.drain();
    expect(server.effects.filter(x => x === 'item_create:c')).toHaveLength(1);
    expect(await listOps('A')).toHaveLength(0);
  });

  it('duas abas drenando a mesma fila não duplicam efeitos', async () => {
    server.offline = true;
    const t1 = engine('A');
    await t1.e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    await t1.e.record(mark(t1.e.local, 'a'));
    const t2 = engine('A');
    await t2.e.start(null);
    server.offline = false;
    await Promise.all([t1.e.drain(), t2.e.drain()]);
    expect(server.effects).toEqual(['item_mark:a']);
  });

  it('conflito fica para revisão e não some', async () => {
    server.conflictKinds.add('item_update');
    const { e } = engine('A');
    await e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    const next = { ...e.local, lists: e.local.lists.map(l => ({ ...l, items: l.items.map(i => (i.id === 'a' ? { ...i, name: 'Arroz integral' } : i)) })) };
    await e.record(next);
    await settle();
    const ops = await listOps('A');
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('conflict');
    expect(e.local.lists[0].items[0].name).toBe('Arroz integral');
  });

  it('acesso revogado: não reenvia nem como outra conta', async () => {
    server.denied = true;
    const a = engine('A');
    await a.e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    await a.e.record(mark(a.e.local, 'a'));
    await settle();
    expect((await listOps('A'))[0].state).toBe('denied');
    server.denied = false;
    const b = engine('B');
    await b.e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    await b.e.drain();
    await a.e.drain();
    expect(server.sentBy.every(u => u === 'A')).toBe(true);
    expect(server.effects).toHaveLength(0);
  });

  it('conta trocada: respostas e chamadas da sessão antiga são ignoradas', async () => {
    let current = true;
    server.offline = true;
    const a = engine('A', () => current);
    await a.e.start({ snap: base(), meta: { routeVersion: new Map(), itemVersion: new Map() } });
    await a.e.record(mark(a.e.local, 'a'));
    current = false; // A saiu
    server.offline = false;
    const before = a.seen.length;
    await a.e.drain();
    await a.e.refresh();
    expect(a.seen.length).toBe(before);
    expect(server.effects).toHaveLength(0);
    expect(await listOps('A')).toHaveLength(1); // guardada para quando A voltar
    expect(await listOps('B')).toHaveLength(0);
  });
});

describe('lista compartilhada', () => {
  const v = { item: () => 1, list: () => null };
  const sharedAs = (role: 'editor' | 'viewer'): Snapshot => ({ ...base(), lists: base().lists.map(l => ({ ...l, role: role as never })) });
  it('leitor não gera operações', () => {
    expect(diffToOps(sharedAs('viewer'), mark(sharedAs('viewer'), 'a'), 'B', v)).toEqual([]);
  });
  it('editor que apaga a lista só sai dela; não muda nome/visualização do dono', () => {
    const s = sharedAs('editor');
    const renamed = { ...s, lists: s.lists.map(l => ({ ...l, name: 'Outro', sortMode: 'alpha' as const })) };
    expect(diffToOps(s, renamed, 'B', v)).toEqual([]);
    expect(diffToOps(s, { ...s, lists: [] }, 'B', v).map(o => o.kind)).toEqual(['list_leave']);
  });
});

describe('Bloco 9: autoria da marcação pendente', () => {
  const base: Snapshot = { version: 5, activeListId: 'l', priceHistory: {}, purchases: [], lists: [{ id: 'l', name: 'L', emoji: '🛒', createdAt: 1,
    items: [{ id: 'a', name: 'Arroz', quantity: 1, purchased: true, markedBy: 'ana', markedAt: 10, createdAt: 1, order: 0 },
            { id: 'b', name: 'Feijão', quantity: 1, purchased: false, createdAt: 1, order: 1 }] }] };
  const mark = (id: string, marked: boolean, userId: string): Op => ({ id: 'op-' + id + marked, userId, listId: 'l', entity: 'item', entityId: id,
    kind: 'item_mark', payload: { marked }, baseVersion: 1, state: 'pending', attempts: 0, nextAt: 0, createdAt: 99, seq: 0 });
  const item = (s: Snapshot, id: string) => s.lists[0].items.find(i => i.id === id)!;

  it('marcar atribui a quem marcou neste aparelho', () => {
    expect(item(applyOps(base, [mark('b', true, 'carlos')], new Set()), 'b').markedBy).toBe('carlos');
  });
  it('marcar de novo um item já marcado não troca o autor', () => {
    expect(item(applyOps(base, [mark('a', true, 'carlos')], new Set()), 'a').markedBy).toBe('ana');
  });
  it('desmarcar limpa a atribuição', () => {
    const r = item(applyOps(base, [mark('a', false, 'carlos')], new Set()), 'a');
    expect(r.markedBy).toBeUndefined();
    expect(r.markedAt).toBeUndefined();
  });
});
