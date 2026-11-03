-- Unidades simplificadas (un/kg + apresentação). Runs after 60/70 on the same database.
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

\set A '''00000000-0000-0000-0000-0000000009a1'''
\set E '''00000000-0000-0000-0000-0000000009e1'''
\set K '''00000000-0000-0000-0000-0000000009c1'''
\set L '''f9a00000-0000-0000-0000-000000000001'''
\set ARROZ '''f9b00000-0000-0000-0000-000000000001'''
\set CARNE '''f9b00000-0000-0000-0000-000000000002'''
\set REFRI '''f9b00000-0000-0000-0000-000000000003'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :L, 'list_create', NULL, NULL, '{"name":"Unidades"}');
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_create', :ARROZ, NULL,
  '{"name":"Arroz","quantity":2,"unit":"un","price_basis":"un","price_cents":2890,"presentation":"  Pacote 5 kg  "}');
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_create', :CARNE, NULL,
  '{"name":"Carne","quantity":1.750,"unit":"kg","price_basis":"kg","price_cents":3990}');
-- legacy row (old client): still accepted, the app marks it for review
SELECT public.apply_list_op(gen_random_uuid(), :L, 'item_create', :REFRI, NULL,
  '{"name":"Refrigerante","quantity":2,"unit":"L","price_basis":"L","price_cents":450}');
SELECT pg_temp.ok((SELECT presentation FROM public.list_items WHERE id = :ARROZ) = 'Pacote 5 kg', 'U01 apresentação gravada sem espaços');
SELECT pg_temp.ok((SELECT quantity FROM public.list_items WHERE id = :CARNE) = 1.750, 'U02 kg com 3 casas exato (numeric)');
SELECT pg_temp.ok((SELECT unit FROM public.list_items WHERE id = :REFRI) = 'L', 'U03 linha legada preservada, sem conversão');

SELECT (public.create_list_invite_v2(:L, 'editor')->>'token') AS te \gset
SELECT (public.create_list_invite_v2(:L, 'checker')->>'token') AS tk \gset
SELECT pg_temp.act(:E);
SELECT public.accept_list_invite_v2(:'te', 'Edu') AS re \gset
SELECT pg_temp.ok((:'re'::jsonb->>'status') IN ('ok','accepted','member'), 'editor aceita: ' || :'re');
SELECT pg_temp.act(:K);
SELECT public.accept_list_invite_v2(:'tk', 'Kati');

-- T15 editor edits unit; checker cannot
SELECT pg_temp.act(:E);
SELECT pg_temp.ok((public.apply_list_op(gen_random_uuid(), :L, 'item_update', :REFRI, (SELECT version FROM public.list_items WHERE id = :REFRI),
  '{"name":"Refrigerante","quantity":1,"unit":"un","price_basis":"un","price_cents":890,"presentation":"Garrafa 2 L"}')->>'status') = 'ok', 'T15 editor revisa a unidade');
SELECT pg_temp.ok((SELECT unit = 'un' AND quantity = 1 AND presentation = 'Garrafa 2 L' FROM public.list_items WHERE id = :REFRI), 'T15 revisão gravada');
SELECT pg_temp.act(:K);
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, ''item_update'', %L, %s, ''{"name":"Carne","quantity":1,"unit":"un"}'')',
  :'L', :'CARNE', (SELECT version FROM public.list_items WHERE id = :CARNE))), 'T15 checker não altera unidade por chamada direta');
SELECT pg_temp.ok((SELECT unit FROM public.list_items WHERE id = :CARNE) = 'kg', 'T15 unidade intacta após tentativa do checker');

-- stale client: never turns a simplified product back into an obsolete unit
SELECT pg_temp.act(:E);
SELECT pg_temp.ok((public.apply_list_op(gen_random_uuid(), :L, 'item_update', :CARNE, (SELECT version FROM public.list_items WHERE id = :CARNE),
  '{"name":"Carne","quantity":1750,"unit":"g","price_basis":"kg","price_cents":3990}')->>'status') = 'conflict', 'U04 versão antiga com g vira conflito');
SELECT pg_temp.ok((SELECT unit = 'kg' AND quantity = 1.750 FROM public.list_items WHERE id = :CARNE), 'U04 produto continua em kg');
-- old client without the presentation key keeps the stored presentation
SELECT pg_temp.ok((public.apply_list_op(gen_random_uuid(), :L, 'item_update', :ARROZ, (SELECT version FROM public.list_items WHERE id = :ARROZ),
  '{"name":"Arroz","quantity":3,"unit":"un","price_basis":"un","price_cents":2890}')->>'status') = 'ok', 'U05 atualização sem apresentação');
SELECT pg_temp.ok((SELECT presentation FROM public.list_items WHERE id = :ARROZ) = 'Pacote 5 kg', 'U05 apresentação não é apagada por cliente antigo');
RESET ROLE;
SELECT 'TESTES DE UNIDADES PASSARAM';
