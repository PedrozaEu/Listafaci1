-- Access and integrity tests for 6A. Run against a throwaway database only.
-- A = owner, B = editor, C = viewer, D = stranger.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;

CREATE OR REPLACE FUNCTION pg_temp.act(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid, ''), false);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(_cond boolean, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _name; END IF;
  RAISE NOTICE 'ok: %', _name;
END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;
SET client_min_messages = notice;

\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''

SET ROLE authenticated;

-- Owner creates a list; the client-sent owner_id is ignored.
SELECT pg_temp.act(:A);
INSERT INTO public.shared_lists (id, owner_id, name, budget_cents)
VALUES ('11111111-1111-1111-1111-111111111111', :D, 'Casa', 30000);
SELECT pg_temp.ok((SELECT owner_id = :A::uuid FROM public.shared_lists), 'owner_id vem da sessão, não do cliente');
SELECT pg_temp.ok((SELECT role = 'owner' AND display_name = 'Ana Dona' FROM public.list_members WHERE user_id = :A::uuid), 'proprietário vira membro owner automaticamente');

-- Second list owned by D, used for listId swap attempts.
SELECT pg_temp.act(:D);
INSERT INTO public.shared_lists (id, owner_id, name) VALUES ('22222222-2222-2222-2222-222222222222', :D, 'Lista do D');
INSERT INTO public.list_items (id, list_id, name) VALUES ('d0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Item do D');

-- Invites
SELECT pg_temp.act(:A);
SELECT (public.create_list_invite('11111111-1111-1111-1111-111111111111', 'editor')->>'token') AS tok_b \gset
SELECT (public.create_list_invite('11111111-1111-1111-1111-111111111111', 'viewer')->>'token') AS tok_c \gset
SELECT pg_temp.ok((SELECT count(*) = 2 FROM public.list_invites), 'proprietário vê os convites');
SELECT pg_temp.ok((SELECT bool_and(token_hash <> :'tok_b' AND token_hash <> :'tok_c') FROM public.list_invites), 'token guardado só como hash');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.create_list_invite('11111111-1111-1111-1111-111111111111', 'owner')$$), 'convite não pode dar papel owner');

SELECT pg_temp.act(:B);
SELECT pg_temp.ok((public.accept_list_invite(:'tok_b', 'Beto')->>'status') = 'ok', 'B aceita convite de editor');
SELECT pg_temp.act(:D);
SELECT pg_temp.ok((public.accept_list_invite(:'tok_b', 'Davi')->>'status') = 'invalid', 'convite usado não serve para outra pessoa');
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.accept_list_invite(:'tok_c', 'Carla')->>'status') = 'ok', 'C aceita convite de leitor');

-- Stranger D sees nothing of list A.
SELECT pg_temp.act(:D);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.shared_lists WHERE id = '11111111-1111-1111-1111-111111111111'), 'estranho não lê a lista');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_members WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'estranho não lê nomes de participantes');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_invites WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'estranho não lê convites');
SELECT pg_temp.ok(pg_temp.fails($$INSERT INTO public.list_items (list_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'invasão')$$), 'estranho não insere item');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.create_list_invite('11111111-1111-1111-1111-111111111111', 'editor')$$), 'estranho não cria convite');
SELECT pg_temp.ok(pg_temp.fails($$INSERT INTO public.list_members (list_id, user_id, role, display_name, color) VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000d', 'editor', 'x', '#000')$$), 'estranho não se adiciona como membro');

-- Editor B edits items.
SELECT pg_temp.act(:B);
INSERT INTO public.list_items (id, list_id, name, position, added_by, purchased, marked_by)
VALUES ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Açúcar', 0, :D, true, :D),
       ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Água', 1, NULL, false, NULL),
       ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Arroz', 2, NULL, false, NULL);
SELECT pg_temp.ok((SELECT bool_and(added_by = :B::uuid AND NOT purchased AND marked_by IS NULL) FROM public.list_items WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'autoria e marcação não vêm do cliente');
UPDATE public.list_items SET quantity = 10, price_cents = 600 WHERE id = 'a0000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT quantity = 10 AND version = 2 FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'editor edita item e versão sobe');
SELECT pg_temp.ok(pg_temp.fails($$UPDATE public.list_items SET purchased = true WHERE id = 'a0000000-0000-0000-0000-000000000001'$$), 'marcação direta bloqueada (só RPC)');
SELECT pg_temp.ok(pg_temp.fails($$UPDATE public.list_items SET list_id = '22222222-2222-2222-2222-222222222222' WHERE id = 'a0000000-0000-0000-0000-000000000001'$$), 'troca de listId do item bloqueada');
UPDATE public.list_items SET name = 'hack' WHERE id = 'd0000000-0000-0000-0000-000000000001';
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_items WHERE name = 'hack'), 'editor não altera item de outra lista');
SELECT pg_temp.ok(pg_temp.fails($$INSERT INTO public.list_items (list_id, name) VALUES ('22222222-2222-2222-2222-222222222222', 'x')$$), 'editor não insere em lista alheia');
-- Self-elevation attempts
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.set_member_role('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000b', 'owner')$$), 'editor não vira owner');
SELECT pg_temp.ok(pg_temp.fails($$UPDATE public.list_members SET role = 'owner' WHERE user_id = '00000000-0000-0000-0000-00000000000b'$$) OR (SELECT role = 'editor' FROM public.list_members WHERE user_id = :B::uuid AND list_id = '11111111-1111-1111-1111-111111111111'), 'editor não altera o próprio papel diretamente');
UPDATE public.shared_lists SET owner_id = :B WHERE id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok((SELECT owner_id = :A::uuid FROM public.shared_lists WHERE id = '11111111-1111-1111-1111-111111111111'), 'editor não altera ownerId');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.create_list_invite('11111111-1111-1111-1111-111111111111', 'editor')$$), 'editor não gerencia convites');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_invites), 'editor não lê convites');

-- Mark with explicit state + expected version + operation id.
SELECT pg_temp.ok((public.set_item_marked('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2, true)->>'status') = 'ok', 'marcar com versão correta');
SELECT pg_temp.ok((SELECT purchased AND marked_by = :B::uuid AND marked_at IS NOT NULL AND version = 3 FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'markedBy vem da sessão');
SELECT pg_temp.ok((public.set_item_marked('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 2, true)->>'duplicate') = 'true', 'repetir operationId devolve o mesmo resultado sem reaplicar');
SELECT pg_temp.ok((SELECT version = 3 FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'repetição não altera versão');
SELECT pg_temp.ok((public.set_item_marked('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 2, false)->>'status') = 'conflict', 'versão antiga devolve conflito');
SELECT pg_temp.ok((SELECT purchased FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'conflito não sobrescreve');
SELECT pg_temp.ok((public.set_item_marked('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 3, true)->>'status') = 'ok', 'marcar de novo com estado explícito é idempotente');
SELECT pg_temp.ok((SELECT purchased FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000001'), 'estado explícito: continua marcado, sem toggle');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.set_item_marked('f0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 1, true)$$), 'editor não marca item de outra lista');

-- Reorder
SELECT pg_temp.ok((public.reorder_items('f0000000-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111', 0,
  ARRAY['a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001']::uuid[])->>'status') = 'ok', 'reordenar com versão do roteiro');
SELECT pg_temp.ok((SELECT string_agg(name, ',' ORDER BY position) = 'Arroz,Água,Açúcar' FROM public.list_items WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'nova ordem aplicada');
SELECT pg_temp.ok((public.reorder_items('f0000000-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111', 0,
  ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000003']::uuid[])->>'status') = 'conflict', 'roteiro antigo devolve conflito');
SELECT pg_temp.ok((public.reorder_items('f0000000-0000-0000-0000-000000000012', '11111111-1111-1111-1111-111111111111', 1,
  ARRAY['a0000000-0000-0000-0000-000000000001','d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000003']::uuid[])->>'status') = 'invalid', 'reorder com item de outra lista é recusado');
SELECT pg_temp.ok((SELECT string_agg(name, ',' ORDER BY position) = 'Arroz,Água,Açúcar' FROM public.list_items WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'recusas não mexem na ordem');

-- Viewer C only reads.
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((SELECT count(*) = 3 FROM public.list_items WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'leitor lê itens');
SELECT pg_temp.ok((SELECT count(*) = 3 FROM public.list_members WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'leitor vê nomes dos participantes');
UPDATE public.list_items SET name = 'leitor' WHERE list_id = '11111111-1111-1111-1111-111111111111';
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_items WHERE name = 'leitor'), 'leitor não edita');
SELECT pg_temp.ok(pg_temp.fails($$INSERT INTO public.list_items (list_id, name) VALUES ('11111111-1111-1111-1111-111111111111', 'x')$$), 'leitor não insere');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.set_item_marked('f0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000002', 1, true)$$), 'leitor não marca');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.complete_shared_purchase('f0000000-0000-0000-0000-000000000021', '11111111-1111-1111-1111-111111111111', current_date, ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[], ARRAY[3], '{}')$$), 'leitor não conclui compra');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.set_member_role('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000c', 'editor')$$), 'leitor não se promove');

-- Complete purchase (atomic, versioned, idempotent).
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((public.complete_shared_purchase('f0000000-0000-0000-0000-000000000030', '11111111-1111-1111-1111-111111111111', current_date,
  ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002']::uuid[], ARRAY[5, 2], '{}')->>'status') = 'conflict', 'concluir com item pendente devolve conflito');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.shared_purchases) AND (SELECT count(*) = 0 FROM public.list_items WHERE deleted_at IS NOT NULL), 'conflito não grava nada (atomicidade)');
SELECT pg_temp.ok((public.complete_shared_purchase('f0000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', current_date,
  ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[], ARRAY[5], '{}')->>'status') = 'ok', 'concluir compra');
SELECT pg_temp.ok((public.complete_shared_purchase('f0000000-0000-0000-0000-000000000031', '11111111-1111-1111-1111-111111111111', current_date,
  ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[], ARRAY[5], '{}')->>'duplicate') = 'true', 'toque repetido não duplica compra');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.shared_purchases), 'uma compra só');
SELECT pg_temp.ok((SELECT snapshot->'lines'->0->>'name' = 'Açúcar' AND completed_by = :B::uuid FROM public.shared_purchases), 'snapshot feito no servidor com autoria da sessão');
UPDATE public.list_items SET name = 'renomeado' WHERE id = 'a0000000-0000-0000-0000-000000000002';
SELECT pg_temp.ok((SELECT snapshot->'lines'->0->>'name' = 'Açúcar' FROM public.shared_purchases), 'editar lista não altera a compra');
SELECT pg_temp.ok(pg_temp.fails($$UPDATE public.shared_purchases SET purchased_on = current_date - 1$$) OR (SELECT purchased_on = current_date FROM public.shared_purchases), 'compra concluída é imutável');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.complete_shared_purchase('f0000000-0000-0000-0000-000000000031', '22222222-2222-2222-2222-222222222222', current_date, ARRAY['d0000000-0000-0000-0000-000000000001']::uuid[], ARRAY[1], '{}')$$), 'operationId não serve para outra lista');

-- Owner removes editor; access disappears immediately.
SELECT pg_temp.act(:A);
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.remove_list_member('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-00000000000a')$$), 'proprietário não pode ser removido');
SELECT public.remove_list_member('11111111-1111-1111-1111-111111111111', :B);
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.list_items WHERE list_id = '11111111-1111-1111-1111-111111111111'), 'após remoção B não lê itens');
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.shared_purchases), 'após remoção B não lê compras');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.set_item_marked('f0000000-0000-0000-0000-000000000040', 'a0000000-0000-0000-0000-000000000002', 3, true)$$), 'após remoção B não marca');
SELECT pg_temp.ok((public.accept_list_invite(:'tok_b', 'Beto')->>'status') = 'invalid', 'convite antigo não readmite');

-- Owner demotes viewer/editor rules
SELECT pg_temp.act(:A);
SELECT public.set_member_role('11111111-1111-1111-1111-111111111111', :C, 'editor');
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.set_item_marked('f0000000-0000-0000-0000-000000000050', 'a0000000-0000-0000-0000-000000000002', (SELECT version FROM public.list_items WHERE id = 'a0000000-0000-0000-0000-000000000002'), true)->>'status') = 'ok', 'promovido a editor passa a marcar');
SELECT public.remove_list_member('11111111-1111-1111-1111-111111111111', :C);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.shared_lists WHERE id = '11111111-1111-1111-1111-111111111111'), 'quem sai perde acesso');

-- Anonymous: nothing.
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.fails($$SELECT * FROM public.shared_lists$$), 'anônimo sem acesso às tabelas');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.accept_list_invite('x', 'y')$$), 'anônimo não executa funções');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 4 FROM public.profiles), 'tabela legada intacta');
SELECT pg_temp.ok(public.collab_schema_version() = '6A.1', 'versão do esquema registrada');
\echo TODOS_OS_TESTES_PASSARAM
