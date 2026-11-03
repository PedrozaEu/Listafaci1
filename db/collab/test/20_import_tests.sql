-- 6B import tests: idempotency, resume, isolation. Run after 6A + 6B on a throwaway database.
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
\set lists '{"lists":[{"legacy_id":"9a000000-0000-0000-0000-000000000001","name":"Mercado","emoji":"🛒","budget_cents":15000,"sort_mode":"custom","created_at_ms":1700000000000},{"legacy_id":"lista-antiga-2","name":"Vazia","emoji":"📦","created_at_ms":1700000000000,"source_legacy_id":"9a000000-0000-0000-0000-000000000001"}]}'
\set items '{"items":[{"legacy_id":"9b000000-0000-0000-0000-000000000001","list_legacy_id":"9a000000-0000-0000-0000-000000000001","name":"Arroz","quantity":1.5,"unit":"kg","price_cents":0,"price_basis":"kg","position":1,"purchased":true,"created_at_ms":1700000000000},{"legacy_id":"item-x","list_legacy_id":"9a000000-0000-0000-0000-000000000001","name":"Sal","quantity":2,"position":0,"purchased":false,"created_at_ms":1700000000000,"note":"fino"}]}'
\set rest '{"purchases":[{"legacy_id":"p-1","list_legacy_id":"apagada","purchased_on":"2026-01-10","snapshot":{"id":"p-1"}}],"price_history":[{"key":"arroz","month":"2026-01","cents":2500}]}'
\set expected '{"lists":2,"items":2,"checked":1,"priced":1,"price_cents_sum":0,"quantity_milli_sum":3500,"purchases":1,"price_history":1,"sequence":{"9a000000-0000-0000-0000-000000000001":["item-x","9b000000-0000-0000-0000-000000000001"],"lista-antiga-2":[]}}'

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT (public.begin_legacy_import('account', 'checksum-aaaa', 5, :'expected')->>'import_id') AS imp \gset
SELECT pg_temp.ok((public.begin_legacy_import('account', 'checksum-aaaa', 5, :'expected')->>'import_id') = :'imp', 'mesma origem e conteúdo reabre a mesma importação');

-- interrupted after the first chunk
SELECT public.import_legacy_chunk(:'imp', :'lists');
SELECT pg_temp.ok((public.finalize_legacy_import(:'imp')->>'ok')::boolean = false, 'importação parcial não é verificada');
-- resume: lists chunk again (retry) + the rest
SELECT pg_temp.ok((public.import_legacy_chunk(:'imp', :'lists')->>'added')::int = 0, 'reenvio de lote não duplica');
SELECT public.import_legacy_chunk(:'imp', :'items');
SELECT public.import_legacy_chunk(:'imp', :'rest');
SELECT pg_temp.ok((public.finalize_legacy_import(:'imp')->>'state') = 'verified', 'retomada fecha e verifica');
SELECT pg_temp.ok((SELECT count(*) FROM public.shared_lists WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 3, 'duas listas + arquivo de compras antigas');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_items WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 2, 'itens sem duplicar');
SELECT pg_temp.ok(EXISTS (SELECT 1 FROM public.shared_lists WHERE id = '9a000000-0000-0000-0000-000000000001'), 'uuid legado preservado');
SELECT pg_temp.ok((SELECT price_cents = 0 AND quantity = 1.5 AND purchased FROM public.list_items WHERE id = '9b000000-0000-0000-0000-000000000001'), 'preço zero, 1,5 kg e check preservados');
SELECT pg_temp.ok((SELECT price_cents IS NULL AND note = 'fino' FROM public.list_items WHERE name = 'Sal'), 'preço ausente continua ausente');
SELECT pg_temp.ok((SELECT source_list_id = '9a000000-0000-0000-0000-000000000001' FROM public.shared_lists WHERE name = 'Vazia'), 'lista vazia e origem preservadas');
SELECT pg_temp.ok((SELECT budget_cents = 15000 AND sort_mode = 'custom' FROM public.shared_lists WHERE name = 'Mercado'), 'orçamento e visualização preservados');

-- the whole migration again: nothing duplicated
SELECT public.import_legacy_chunk(:'imp', :'items');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_items WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 2 AND (SELECT count(*) FROM public.shared_purchases WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 1, 'segunda migração não duplica');
SELECT pg_temp.ok((public.finalize_legacy_import(:'imp')->>'ok')::boolean, 'conferência continua igual');

-- switch and rollback
SELECT public.set_legacy_import_state(:'imp', 'active');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_legacy_import_state(%L, %L)', :'imp', 'started')), 'transição inválida rejeitada');
SELECT public.set_legacy_import_state(:'imp', 'rolled_back');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_items WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 2, 'retorno não apaga nada');

-- purchase record idempotent
SELECT public.save_purchase_record('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', '2026-02-01', '{"a":1}');
SELECT public.save_purchase_record('9c000000-0000-0000-0000-000000000001', '9a000000-0000-0000-0000-000000000001', '2026-02-01', '{"a":1}');
SELECT pg_temp.ok((SELECT count(*) FROM public.shared_purchases WHERE id = '9c000000-0000-0000-0000-000000000001') = 1, 'compra salva uma vez só');

-- account B: same legacy ids get new ids, sees nothing of A
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((SELECT count(*) FROM public.legacy_imports) = 0, 'B não vê importações de A');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.import_legacy_chunk(%L, %L)', :'imp', :'items')), 'B não usa importação de A');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.save_purchase_record(gen_random_uuid(), %L, current_date, %L)', '9a000000-0000-0000-0000-000000000001', '{}')), 'B não grava compra na lista de A');
SELECT (public.begin_legacy_import('guest', 'checksum-bbbb', 5, '{}')->>'import_id') AS impb \gset
SELECT public.import_legacy_chunk(:'impb', :'lists');
SELECT pg_temp.ok((SELECT count(*) FROM public.shared_lists WHERE id IN (SELECT new_id FROM public.legacy_id_map)) = 2, 'B tem só as próprias listas');
SELECT pg_temp.ok(NOT EXISTS (SELECT 1 FROM public.shared_lists WHERE id = '9a000000-0000-0000-0000-000000000001'), 'id já usado ganha id novo (mapa)');

RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.fails($$SELECT * FROM public.legacy_imports$$), 'anônimo sem acesso');
RESET ROLE;
SELECT pg_temp.ok(public.collab_schema_version() = '6B.1', 'versão 6B.1');
\echo TODOS_OS_TESTES_6B_PASSARAM
