-- Bloco 9 tests: stable colors, first mark wins, edits keep the check, revocation blocks reads/writes.
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

\set A '''00000000-0000-0000-0000-0000000000a9'''
\set B '''00000000-0000-0000-0000-0000000000b9'''
\set C '''00000000-0000-0000-0000-0000000000c9'''
\set L '''e9a00000-0000-0000-0000-000000000001'''
\set M '''e9a00000-0000-0000-0000-000000000002'''
\set I '''e9b00000-0000-0000-0000-000000000001'''
\set J '''e9b00000-0000-0000-0000-000000000002'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :L, 'list_create', NULL, NULL, '{"name":"Feira"}');
SELECT public.apply_list_op(gen_random_uuid(), :M, 'list_create', NULL, NULL, '{"name":"Privada"}');
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_create', :I, NULL, '{"name":"Arroz","quantity":1}');
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_create', :J, NULL, '{"name":"Feijão","quantity":1}');
SELECT (public.create_list_invite_v2(:L, 'editor')->>'token') AS tb \gset
SELECT (public.create_list_invite_v2(:L, 'editor')->>'token') AS tc \gset
SELECT pg_temp.act(:B);
SELECT public.accept_list_invite_v2(:'tb', 'Carlos');
SELECT pg_temp.act(:C);
SELECT public.accept_list_invite_v2(:'tc', 'Dani');

SELECT pg_temp.ok((SELECT count(DISTINCT color) = 3 FROM public.list_members WHERE list_id = :L), 'cada participante tem cor própria na lista');
SELECT pg_temp.ok((SELECT color FROM public.list_members WHERE list_id = :L AND user_id = :A) = '#1D4ED8'
  AND (SELECT color FROM public.list_members WHERE list_id = :L AND user_id = :B) = '#0F766E', 'cor pela ordem de entrada: azul, depois teal');
SELECT pg_temp.act(:B);
SELECT public.set_my_display_name(:L, 'Carlos S.');
RESET ROLE;
UPDATE public.list_members SET color = '#000000' WHERE list_id = :L AND user_id = :B;
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT color FROM public.list_members WHERE list_id = :L AND user_id = :B) = '#0F766E', 'cor guardada não muda depois');

-- simultaneous mark: both saw version 1
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((public.set_item_marked(gen_random_uuid(), :I, 1, true)->>'status') = 'ok', 'primeira marcação vence');
SELECT pg_temp.act(:C);
SELECT public.set_item_marked(gen_random_uuid(), :I, 1, true) AS r2 \gset
SELECT pg_temp.ok((:'r2'::jsonb->>'status') = 'already' AND (:'r2'::jsonb->>'marked_by') = :B, 'segunda recebe estado atual e autor');
SELECT pg_temp.ok((SELECT marked_by FROM public.list_items WHERE id = :I) = :B, 'autoria não é substituída');
SELECT pg_temp.ok((public.set_item_marked(gen_random_uuid(), :I, 1, false)->>'status') = 'conflict'
  AND (SELECT purchased FROM public.list_items WHERE id = :I), 'desmarcar sobre versão antiga não desmarca');

-- edit after mark: price/quantity never touch the check
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_update', :I, (SELECT version FROM public.list_items WHERE id = :I), '{"name":"Arroz","quantity":2,"price_cents":2590}');
SELECT pg_temp.ok((SELECT purchased AND marked_by = :B AND quantity = 2 FROM public.list_items WHERE id = :I), 'editar preço e quantidade preserva o check');
SELECT pg_temp.ok((SELECT position FROM public.list_items WHERE id = :I) = 0, 'marcar não mexe no roteiro');

-- unmark clears current attribution, operation record stays
SELECT pg_temp.act(:B);
SELECT public.set_item_marked('e9f00000-0000-0000-0000-000000000009', :I, (SELECT version FROM public.list_items WHERE id = :I), false);
SELECT pg_temp.ok((SELECT NOT purchased AND marked_by IS NULL AND marked_at IS NULL FROM public.list_items WHERE id = :I), 'desmarcar limpa a atribuição');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.list_operations WHERE operation_id = 'e9f00000-0000-0000-0000-000000000009' AND user_id = :B), 'registro mínimo da operação preservado');

-- unauthorized list: nothing readable (Realtime uses the same RLS)
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = :M), 'B não lê lista não autorizada');

-- revocation
SELECT pg_temp.act(:A);
SELECT public.remove_list_member(:L, :C);
SELECT pg_temp.act(:C);
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.list_items WHERE list_id = :L), 'revogado não lê itens');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_item_marked(gen_random_uuid(), %L, 99, true)', :'J')), 'revogado não marca');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, NULL, ''{"name":"x"}'')', :'L', :'J')), 'revogado não edita');
RESET ROLE;
SELECT pg_temp.ok(public.collab_schema_version() = '9.1', 'versão do esquema 9.1');
\echo 'TESTES 9 PASSARAM'
