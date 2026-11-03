-- Bloco 9.1 tests: sharing is per list, roles editor / checker, legacy viewer in review.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', coalesce(_uid, ''), false); END $$;
CREATE OR REPLACE FUNCTION pg_temp.fails(_sql text) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN EXECUTE _sql; RETURN false; EXCEPTION WHEN OTHERS THEN RETURN true; END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(_cond boolean, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _name; END IF; RAISE NOTICE 'ok: %', _name; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;
SET client_min_messages = notice;

\set A '''00000000-0000-0000-0000-0000000001a1'''
\set B '''00000000-0000-0000-0000-0000000001b1'''
\set C '''00000000-0000-0000-0000-0000000001c1'''
\set D '''00000000-0000-0000-0000-0000000001d1'''
\set MER '''f1a00000-0000-0000-0000-000000000001'''
\set FAR '''f1a00000-0000-0000-0000-000000000002'''
\set PRI '''f1a00000-0000-0000-0000-000000000003'''
\set LB '''f1a00000-0000-0000-0000-000000000004'''
\set LC '''f1a00000-0000-0000-0000-000000000005'''
\set NEW '''f1a00000-0000-0000-0000-000000000006'''
\set I1 '''f1b00000-0000-0000-0000-000000000001'''
\set I2 '''f1b00000-0000-0000-0000-000000000002'''
\set IP '''f1b00000-0000-0000-0000-000000000003'''
\set IB '''f1b00000-0000-0000-0000-000000000004'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :MER, 'list_create', NULL, NULL, '{"name":"Mercado"}');
SELECT public.apply_list_op(gen_random_uuid(), :FAR, 'list_create', NULL, NULL, '{"name":"Farmácia"}');
SELECT public.apply_list_op(gen_random_uuid(), :PRI, 'list_create', NULL, NULL, '{"name":"Lista privada"}');
SELECT public.apply_list_op(gen_random_uuid(), :MER, 'item_create', :I1, NULL, '{"name":"Arroz","quantity":1,"price_cents":1000}');
SELECT public.apply_list_op(gen_random_uuid(), :MER, 'item_create', :I2, NULL, '{"name":"Feijão","quantity":1}');
SELECT public.apply_list_op(gen_random_uuid(), :PRI, 'item_create', :IP, NULL, '{"name":"Segredo","quantity":1}');
-- a purchase of Mercado made by A before any guest joined
SELECT public.save_purchase_record(gen_random_uuid(), :MER, current_date, '{"total":1000}');
SELECT pg_temp.ok((public.create_list_invite_v2(:MER)->>'role') = 'checker', 'convite novo nasce como Apenas marcar');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.create_list_invite_v2(%L, ''viewer'')', :'MER')), 'perfil leitor não é mais oferecido');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.create_list_invite_v2(%L, ''owner'')', :'MER')), 'convite não cria dono');
SELECT (public.create_list_invite_v2(:MER, 'editor')->>'token') AS tb \gset
SELECT (public.create_list_invite_v2(:MER, 'checker')->>'token') AS tc \gset
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.create_list_invite(%L, ''editor'', 7)', :'MER')), 'convite antigo v1 fechado');

SELECT pg_temp.act(:B);
SELECT public.apply_list_op(gen_random_uuid(), :LB, 'list_create', NULL, NULL, '{"name":"Lista do B"}');
SELECT public.apply_list_op(gen_random_uuid(), :LB, 'item_create', :IB, NULL, '{"name":"Café","quantity":1}');
SELECT public.accept_list_invite_v2(:'tb', 'Bruno') AS rb \gset
SELECT pg_temp.ok((:'rb'::jsonb ?& ARRAY['status','list_id','role']) AND (SELECT count(*) FROM jsonb_object_keys(:'rb'::jsonb)) = 3, 'aceite devolve só o necessário para abrir');
SELECT pg_temp.act(:C);
SELECT public.apply_list_op(gen_random_uuid(), :LC, 'list_create', NULL, NULL, '{"name":"Lista do C"}');
SELECT public.accept_list_invite_v2(:'tc', 'Clara');

-- T01 / T02 / T03: scope
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((SELECT array_agg(id ORDER BY id) FROM public.shared_lists) = ARRAY[:MER, :LB]::uuid[], 'T01 B vê só Mercado e a própria lista');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id IN (:FAR, :PRI)), 'T01 B não lê itens de outras listas de A');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_purchases), 'T01 B não vê compras antigas de A');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.list_operations WHERE user_id = :A), 'T01 B não lê o registro de operações de A');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.list_invites), 'T01 convidado não vê convites');
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((SELECT array_agg(id ORDER BY id) FROM public.shared_lists) = ARRAY[:MER, :LC]::uuid[], 'T01 C vê só Mercado e a própria lista');
SELECT pg_temp.act(:A);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id IN (:LB, :LC)), 'T02 A não recebe listas de B e C por reciprocidade');
SELECT pg_temp.act(:D);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = :MER) AND NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id = :MER), 'T03 D não lê Mercado');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_item_marked(gen_random_uuid(), %L, 1, true)', :'I1')), 'T03 D não marca');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, 1, ''{"name":"x"}'')', :'MER', :'I1')), 'T03 D não edita');

-- T04 editor
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((public.apply_list_op(gen_random_uuid(), :MER, 'item_create', 'f1b00000-0000-0000-0000-0000000000b2', NULL, '{"name":"Leite","quantity":2}')->>'status') = 'ok', 'T04 editor adiciona item');
SELECT pg_temp.ok((public.apply_list_op(gen_random_uuid(), :MER, 'item_update', :I2, (SELECT version FROM public.list_items WHERE id = :I2), '{"name":"Feijão preto","quantity":2}')->>'status') = 'ok', 'T04 editor edita item');
SELECT pg_temp.ok((public.reorder_items(gen_random_uuid(), :MER, (SELECT route_version FROM public.shared_lists WHERE id = :MER),
  ARRAY(SELECT id FROM public.list_items WHERE list_id = :MER AND deleted_at IS NULL ORDER BY position DESC, id DESC))->>'status') = 'ok', 'T04 editor inverte o roteiro');
SELECT pg_temp.ok((public.set_item_marked(gen_random_uuid(), :I2, (SELECT version FROM public.list_items WHERE id = :I2), true)->>'status') = 'ok', 'T04 editor marca');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_member_role(%L, %L, ''editor'')', :'MER', :'C')), 'T04 editor não administra membros');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.create_list_invite_v2(%L, ''editor'')', :'MER')), 'T04 editor não convida');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''list_archive'', NULL, NULL, ''{}'')', :'MER')), 'T04 editor não arquiva a lista');
SELECT pg_temp.ok(pg_temp.fails(format('UPDATE public.list_members SET role = ''owner'' WHERE list_id = %L AND user_id = %L', :'MER', :'B'))
  OR (SELECT role FROM public.list_members WHERE list_id = :MER AND user_id = :B) = 'editor', 'T04 editor não se promove');

-- T05 checker
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.set_item_marked(gen_random_uuid(), :I1, (SELECT version FROM public.list_items WHERE id = :I1), true)->>'status') = 'ok', 'T05 checker marca');
SELECT pg_temp.ok((SELECT marked_by FROM public.list_items WHERE id = :I1) = :C, 'T05 autoria do checker vem da sessão');
SELECT pg_temp.ok((public.set_item_marked(gen_random_uuid(), :I2, (SELECT version FROM public.list_items WHERE id = :I2), false)->>'status') = 'ok', 'T05 checker desmarca marcação de outro');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, %s, ''{"name":"x","price_cents":1}'')', :'MER', :'I1', (SELECT version FROM public.list_items WHERE id = :I1))), 'T05 checker não edita por RPC');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_create'', gen_random_uuid(), NULL, ''{"name":"x"}'')', :'MER')), 'T05 checker não adiciona');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_delete'', %L, NULL, ''{}'')', :'MER', :'I1')), 'T05 checker não exclui');
UPDATE public.list_items SET name = 'x', price_cents = 1 WHERE id = :I1;
UPDATE public.list_items SET purchased = false, name = 'x' WHERE id = :I1;
SELECT pg_temp.ok(pg_temp.fails(format('INSERT INTO public.list_items (list_id, name) VALUES (%L, ''x'')', :'MER')), 'T05 checker não insere direto');
SELECT pg_temp.ok((SELECT name = 'Arroz' AND price_cents = 1000 AND purchased FROM public.list_items WHERE id = :I1)
  AND NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id = :MER AND name = 'x'), 'T05 UPDATE/INSERT direto do checker não altera nada (incluindo payload misto)');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.reorder_items(gen_random_uuid(), %L, 99, ARRAY[%L]::uuid[])', :'MER', :'I1')), 'T05 checker não reorganiza');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.save_purchase_record(gen_random_uuid(), %L, current_date, ''{}'')', :'MER')), 'T05 checker não conclui a compra');

-- T06 id substitution
SELECT pg_temp.act(:B);
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, 1, ''{"name":"x"}'')', :'MER', :'IP')), 'T06 item privado com lista autorizada é negado');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_item_marked(gen_random_uuid(), %L, 1, true)', :'IP')), 'T06 marcar item privado é negado');
SELECT pg_temp.ok(pg_temp.fails(format('INSERT INTO public.list_items (list_id, name) VALUES (%L, ''x'')', :'PRI')), 'T06 inserir em lista privada é negado');
SELECT pg_temp.act(:A);
SELECT pg_temp.ok((SELECT name = 'Segredo' AND NOT purchased FROM public.list_items WHERE id = :IP), 'T06 item privado intacto');

-- T07 different roles per list
SELECT (public.create_list_invite_v2(:FAR, 'checker')->>'token') AS tf \gset
SELECT pg_temp.act(:B);
SELECT public.accept_list_invite_v2(:'tf', 'Bruno');
SELECT pg_temp.ok(public.list_role(:FAR) = 'checker' AND public.list_role(:MER) = 'editor' AND public.list_role(:PRI) IS NULL, 'T07 papel é por lista');

-- T08 new list not shared
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :NEW, 'list_create', NULL, NULL, '{"name":"Próxima compra"}');
SELECT pg_temp.act(:B);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = :NEW), 'T08 nova lista de A não é compartilhada');

-- T09 repeated / tampered invites
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tb', 'Bruno')->>'status') = 'already_member' AND public.list_role(:MER) = 'editor', 'T09 aceite repetido não muda papel');
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tb' || 'x', 'Bruno')->>'status') = 'invalid', 'T09 token adulterado é inválido');
SELECT pg_temp.act(:D);
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tb', 'Davi')->>'status') = 'consumed' AND NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = :MER), 'T09 convite usado não abre acesso a terceiros');

-- T11 downgrade and revocation
SELECT pg_temp.act(:A);
SELECT public.set_member_role(:MER, :B, 'checker');
SELECT pg_temp.act(:B);
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, %s, ''{"name":"offline"}'')', :'MER', :'I2', (SELECT version FROM public.list_items WHERE id = :I2))), 'T11 rebaixado para checker não edita (inclusive reenvio offline)');
SELECT pg_temp.act(:A);
SELECT public.remove_list_member(:MER, :C);
SELECT pg_temp.act(:C);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id = :MER), 'T11 removido não lê');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_item_marked(gen_random_uuid(), %L, 99, true)', :'I1')), 'T11 removido não marca');
SELECT pg_temp.ok((SELECT count(*) FROM public.shared_lists WHERE id = :LC) = 1, 'T13 lista própria de C intacta após remoção');

-- legacy viewer: review, no access, owner decides
RESET ROLE;
SELECT set_config('app.collab_rpc', '1', false);
INSERT INTO public.list_members (list_id, user_id, role, display_name, color, status) VALUES (:MER, :D, 'viewer', 'Davi', '#000000', 'review');
SET ROLE authenticated;
SELECT pg_temp.act(:D);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = :MER), 'leitor antigo fica em revisão sem acesso');
SELECT pg_temp.act(:A);
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.list_members WHERE list_id = :MER AND user_id = :D AND status = 'review'), 'dono vê o vínculo em revisão');
SELECT public.set_member_role(:MER, :D, 'checker');
SELECT pg_temp.act(:D);
SELECT pg_temp.ok(public.list_role(:MER) = 'checker', 'dono define Apenas marcar e o acesso volta');
RESET ROLE;
SELECT pg_temp.ok(public.collab_schema_version() = '9.2', 'versão do esquema 9.2');
\echo 'TESTES 9.1 PASSARAM'
