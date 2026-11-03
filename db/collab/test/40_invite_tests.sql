-- Bloco 8 tests: invite answers, single use, roles, removal is separate from expiry.
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
\set C '''00000000-0000-0000-0000-00000000000c'''
\set D '''00000000-0000-0000-0000-00000000000d'''
\set L '''8a000000-0000-0000-0000-000000000001'''

SET ROLE authenticated;
SELECT pg_temp.act(:A);
SELECT public.apply_list_op('8f000000-0000-0000-0000-000000000001', :L, 'list_create', NULL, NULL, '{"name":"Mercado do mês"}');
SELECT public.apply_list_op('8f000000-0000-0000-0000-000000000002', :L, 'item_create', '8b000000-0000-0000-0000-000000000001', NULL, '{"name":"Café","quantity":1}');
SELECT (public.create_list_invite_v2(:L)->>'token') AS tok \gset
SELECT pg_temp.ok((SELECT role = 'editor' AND expires_at <= now() + interval '24 hours 1 minute' FROM public.list_invites WHERE list_id = :L), 'padrão: editor, 24 horas');
SELECT pg_temp.ok(length(:'tok') = 64 AND NOT EXISTS (SELECT 1 FROM public.list_invites WHERE token_hash = :'tok'), 'token longo; só o hash fica no servidor');

SELECT pg_temp.act(:B);
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.create_list_invite_v2(%L)', :'L')), 'não proprietário não cria convite');
SELECT pg_temp.ok((public.peek_list_invite(:'tok')->>'list_name') = 'Mercado do mês', 'prévia mostra a lista');
SELECT pg_temp.ok((public.peek_list_invite(:'tok')->>'status') = 'valid', 'abrir a prévia não consome');
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'Beto')->>'status') = 'ok', 'B aceita');
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'Beto')->>'status') = 'already_member', 'reabrir leva à lista');
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.list_items WHERE list_id = :L), 'B vê os itens');
SELECT pg_temp.ok((public.set_item_marked('8f000000-0000-0000-0000-000000000003', '8b000000-0000-0000-0000-000000000001', 1, true)->>'status') = 'ok', 'editor continua a compra');

SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok', 'Carla')->>'status') = 'consumed', 'convite já usado: resposta clara');

SELECT pg_temp.act(:A);
SELECT (public.create_list_invite_v2(:L, 'viewer', 1)->>'invite_id') AS inv2 \gset
SELECT (public.create_list_invite_v2(:L, 'viewer', 1)->>'token') AS tok3 \gset
SELECT public.revoke_list_invite(:'inv2');
RESET ROLE;
UPDATE public.list_invites SET expires_at = now() - interval '1 minute' WHERE id <> :'inv2' AND accepted_at IS NULL AND list_id = :L;
SET ROLE authenticated;

SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok3', 'Carla')->>'status') = 'expired', 'convite expirado: resposta clara');
RESET ROLE;
SELECT pg_temp.act(:A);
SET ROLE authenticated;
SELECT (public.create_list_invite_v2(:L, 'viewer')->>'token') AS tok4 \gset
SELECT (public.create_list_invite_v2(:L, 'viewer')->>'invite_id') AS inv4 \gset
SELECT public.revoke_list_invite(id) FROM public.list_invites WHERE list_id = :L AND revoked_at IS NULL AND accepted_at IS NULL AND expires_at > now();
SELECT pg_temp.act(:C);
SELECT pg_temp.ok((public.accept_list_invite_v2(:'tok4', 'Carla')->>'status') = 'revoked', 'convite revogado: resposta clara');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.revoke_list_invite(%L)', :'inv4')), 'só o dono revoga');

-- expiry does not remove B; removal is a separate owner action
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((SELECT count(*) = 1 FROM public.shared_lists WHERE id = :L), 'expirar não remove quem entrou');
SELECT pg_temp.act(:A);
SELECT public.remove_list_member(:L, :B);
SELECT pg_temp.act(:B);
SELECT pg_temp.ok((SELECT count(*) = 0 FROM public.shared_lists WHERE id = :L), 'remoção pelo dono tira o acesso');

-- viewer cannot edit by changing the payload
SELECT pg_temp.act(:A);
SELECT (public.create_list_invite_v2(:L, 'viewer')->>'token') AS tok5 \gset
SELECT pg_temp.act(:D);
SELECT public.accept_list_invite_v2(:'tok5', 'Davi');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.apply_list_op(gen_random_uuid(), %L, %L, gen_random_uuid(), NULL, %L)', :'L', 'item_create', '{"name":"x","quantity":1,"role":"owner"}')), 'leitor não edita mudando o payload');
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.set_item_marked(gen_random_uuid(), %L, 2, false)', '8b000000-0000-0000-0000-000000000001')), 'leitor não marca');
RESET ROLE;
SET ROLE anon;
SELECT pg_temp.ok(pg_temp.fails(format('SELECT public.peek_list_invite(%L)', :'tok')), 'anônimo não espia convites');
RESET ROLE;
SELECT pg_temp.ok(public.collab_schema_version() = '8.1', 'versão 8.1');
\echo TODOS_OS_TESTES_8_PASSARAM
