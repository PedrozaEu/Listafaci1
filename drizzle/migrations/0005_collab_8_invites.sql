-- Bloco 8: invite lifecycle with clear answers. Additive: 6A functions stay as they were.
-- Token: 244 random bits, only its sha256 is stored. Opening a link never consumes it; only an explicit accept does.

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '8.1' $$;

-- Owner only. Default: editor, one acceptance, 24 hours (1 to 720 hours).
CREATE OR REPLACE FUNCTION public.create_list_invite_v2(_list_id uuid, _role text DEFAULT 'editor', _hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); _row public.list_invites;
BEGIN
  IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _role NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.list_invites (list_id, token_hash, role, created_by, expires_at)
  VALUES (_list_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _role, auth.uid(),
          now() + make_interval(hours => least(greatest(coalesce(_hours, 24), 1), 720)))
  RETURNING * INTO _row;
  RETURN jsonb_build_object('invite_id', _row.id, 'token', _token, 'role', _row.role, 'expires_at', _row.expires_at);
END $$;

-- Read-only look at an invite for the signed-in recipient. Never consumes it.
CREATE OR REPLACE FUNCTION public.peek_list_invite(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid(); _name text; _owner text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF EXISTS (SELECT 1 FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid) THEN
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id);
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF _inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'consumed'); END IF;
  IF _inv.expires_at < now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  SELECT l.name INTO _name FROM public.shared_lists l WHERE l.id = _inv.list_id;
  SELECT m.display_name INTO _owner FROM public.list_members m WHERE m.list_id = _inv.list_id AND m.role = 'owner';
  RETURN jsonb_build_object('status', 'valid', 'list_name', _name, 'owner_name', _owner, 'role', _inv.role, 'expires_at', _inv.expires_at);
END $$;

-- Transactional single use. Reopening by a current member leads back to the list.
CREATE OR REPLACE FUNCTION public.accept_list_invite_v2(_token text, _display_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites
  WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF EXISTS (SELECT 1 FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid) THEN
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id);
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF _inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'consumed'); END IF;
  IF _inv.expires_at < now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  INSERT INTO public.list_members (list_id, user_id, role, display_name, color)
  VALUES (_inv.list_id, _uid, _inv.role, left(coalesce(nullif(btrim(_display_name), ''), 'Participante'), 60), public.member_color(_uid));
  UPDATE public.list_invites SET accepted_by = _uid, accepted_at = now() WHERE id = _inv.id;
  RETURN jsonb_build_object('status', 'ok', 'list_id', _inv.list_id, 'role', _inv.role);
END $$;

REVOKE ALL ON FUNCTION public.create_list_invite_v2(uuid, text, integer), public.peek_list_invite(text),
  public.accept_list_invite_v2(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_list_invite_v2(uuid, text, integer), public.peek_list_invite(text),
  public.accept_list_invite_v2(text, text) TO authenticated;
