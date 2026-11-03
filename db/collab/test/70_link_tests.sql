-- Hotfix 02: already_member only for an active link; review and archived lists have their own status.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', coalesce(_uid, ''), false); END $$;
CREATE OR REPLACE FUNCTION pg_temp.ok(_cond boolean, _name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF _cond IS NOT TRUE THEN RAISE EXCEPTION 'FALHOU: %', _name; END IF; RAISE NOTICE 'ok: %', _name; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pg_temp TO authenticated, anon;
SET client_min_messages = notice;

\set A '''00000000-0000-0000-0000-0000000002a1'''
\set B '''00000000-0000-0000-0000-0000000002b1'''
\set L '''f2a00000-0000-0000-0000-000000000001'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op(gen_random_uuid(), :L, 'list_create', NULL, NULL, '{"name":"Mercado"}');
SELECT (public.create_list_invite_v2(:L, 'checker')->>'token') AS tok \gset
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'B')->>'status') = 'ok', 'aceite cria vínculo');
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'B')->>'role') = 'checker', 'reabrir convite aceito devolve o papel sem consumir de novo');
SELECT pg_temp.ok((SELECT count(*) FROM public.list_members WHERE list_id = :L) = 2, 'reabrir não duplica vínculo');
RESET ROLE;
UPDATE public.list_members SET status = 'review' WHERE list_id = :L AND user_id = :B::uuid;
SET ROLE authenticated;
SELECT pg_temp.ok((public.peek_list_invite(:'tok')->>'status') = 'review', 'vínculo em revisão não é vínculo ativo');
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'B')->>'list_id') IS NULL, 'revisão não libera destino');
RESET ROLE;
UPDATE public.list_members SET status = 'active' WHERE list_id = :L AND user_id = :B::uuid;
UPDATE public.shared_lists SET status = 'archived' WHERE id = :L;
SET ROLE authenticated;
SELECT pg_temp.ok((public.peek_list_invite(:'tok')->>'status') = 'list_unavailable', 'lista arquivada tem estado próprio');
RESET ROLE;
\echo 'TESTES HOTFIX 02 PASSARAM'
