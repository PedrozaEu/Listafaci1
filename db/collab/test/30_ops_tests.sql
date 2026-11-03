-- Bloco 7 tests: deduplication, conflicts, tombstones, revoked access, identity from session.
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

\set A '''00000000-0000-0000-0000-00000000000a'''
\set B '''00000000-0000-0000-0000-00000000000b'''
\set L '''7a000000-0000-0000-0000-000000000001'''
\set I '''7b000000-0000-0000-0000-000000000001'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000001', :L, 'list_create', NULL, NULL, '{"name":"Offline","owner_id":"00000000-0000-0000-0000-00000000000b"}');
SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000001', :L, 'list_create', NULL, NULL, '{"name":"Offline"}');
SELECT pg_temp.ok((SELECT count(*) = 1 AND bool_and(owner_id = '00000000-0000-0000-0000-00000000000a') FROM public.shared_lists WHERE id = :L), 'criação repetida não duplica; dono vem da sessão');

SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000002', :L, 'item_create', :I, NULL, '{"name":"Leite","quantity":2,"price_cents":0}');
SELECT pg_temp.ok((public.apply_list_op('7f000000-0000-0000-0000-000000000002', :L, 'item_create', :I, NULL, '{"name":"Leite","quantity":2}')->>'duplicate')::boolean, 'reenvio devolve o resultado guardado');
SELECT pg_temp.ok((SELECT added_by = '00000000-0000-0000-0000-00000000000a' AND price_cents = 0 FROM public.list_items WHERE id = :I), 'autoria da sessão e preço zero');

SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000003', :L, 'item_update', :I, 1, '{"name":"Leite","quantity":3}');
SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000003', :L, 'item_update', :I, 1, '{"name":"Leite","quantity":3}');
SELECT pg_temp.ok((SELECT version = 2 AND quantity = 3 FROM public.list_items WHERE id = :I), 'reenvio não repete incremento');
SELECT pg_temp.ok((public.apply_list_op('7f000000-0000-0000-0000-000000000004', :L, 'item_update', :I, 1, '{"name":"Velho","quantity":9}')->>'status') = 'conflict', 'versão-base antiga vira conflito');
SELECT pg_temp.ok((SELECT name = 'Leite' FROM public.list_items WHERE id = :I), 'conflito não altera');

SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000005', :L, 'item_delete', :I, NULL, '{}');
SELECT pg_temp.ok((public.apply_list_op('7f000000-0000-0000-0000-000000000006', :L, 'item_update', :I, NULL, '{"name":"Volta"}')->>'status') = 'conflict', 'item excluído não ressuscita');
SELECT pg_temp.ok((public.apply_list_op('7f000000-0000-0000-0000-000000000007', :L, 'item_create', :I, NULL, '{"name":"Volta","quantity":1}')->>'status') = 'ok'
  AND (SELECT deleted_at IS NOT NULL FROM public.list_items WHERE id = :I), 'recriar com o mesmo id não ressuscita');

SELECT pg_temp.act(:B);
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000008', '7a000000-0000-0000-0000-000000000001', 'item_create', gen_random_uuid(), NULL, '{"name":"x","quantity":1}')$$), 'sem acesso: permissão negada');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000003', '7a000000-0000-0000-0000-000000000001', 'item_update', '7b000000-0000-0000-0000-000000000001', 1, '{}')$$), 'operationId de outra conta rejeitado');
SELECT pg_temp.ok(pg_temp.fails($$SELECT public.apply_list_op('7f000000-0000-0000-0000-000000000009', '7a000000-0000-0000-0000-000000000001', 'list_create', NULL, NULL, '{}')$$), 'B não assume lista de A');
RESET ROLE;
SELECT pg_temp.ok(public.collab_schema_version() >= '7.1', 'versão 7.1');
\echo TODOS_OS_TESTES_7_PASSARAM
