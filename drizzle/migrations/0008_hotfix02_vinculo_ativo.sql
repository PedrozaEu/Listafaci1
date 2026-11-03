-- Hotfix 02: an existing link is not an active link. Only an active link with an allowed role on an
-- available list returns already_member; links in review, removed or on archived lists get their own status.
CREATE OR REPLACE FUNCTION public.invite_link_status(_list_id uuid, _uid uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN m.user_id IS NULL THEN NULL
    WHEN l.status IS DISTINCT FROM 'active' THEN 'list_unavailable'
    WHEN m.status = 'review' THEN 'review'
    WHEN m.status = 'active' AND m.role IN ('owner', 'editor', 'checker') THEN 'already_member'
    ELSE 'removed'
  END
  FROM (SELECT 1) one
  LEFT JOIN public.list_members m ON m.list_id = _list_id AND m.user_id = _uid
  LEFT JOIN public.shared_lists l ON l.id = _list_id
$$;
REVOKE ALL ON FUNCTION public.invite_link_status(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.peek_list_invite(_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid(); _name text; _owner text; _link text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex');
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  _link := public.invite_link_status(_inv.list_id, _uid);
  IF _link = 'already_member' THEN
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id,
      'role', (SELECT role FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid));
  ELSIF _link IS NOT NULL THEN
    RETURN jsonb_build_object('status', _link);
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF _inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'consumed'); END IF;
  IF _inv.expires_at < now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF _inv.role NOT IN ('editor', 'checker') THEN RETURN jsonb_build_object('status', 'discontinued'); END IF;
  SELECT l.name INTO _name FROM public.shared_lists l WHERE l.id = _inv.list_id;
  SELECT m.display_name INTO _owner FROM public.list_members m WHERE m.list_id = _inv.list_id AND m.role = 'owner';
  RETURN jsonb_build_object('status', 'valid', 'list_name', _name, 'owner_name', _owner, 'role', _inv.role, 'expires_at', _inv.expires_at);
END $$;

CREATE OR REPLACE FUNCTION public.accept_list_invite_v2(_token text, _display_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid(); _link text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites
  WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  _link := public.invite_link_status(_inv.list_id, _uid);
  IF _link = 'already_member' THEN -- never consumes again nor changes the existing role
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id,
      'role', (SELECT role FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid));
  ELSIF _link IS NOT NULL THEN
    RETURN jsonb_build_object('status', _link);
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF _inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'consumed'); END IF;
  IF _inv.expires_at < now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF _inv.role NOT IN ('editor', 'checker') THEN RETURN jsonb_build_object('status', 'discontinued'); END IF;
  IF (SELECT status FROM public.shared_lists WHERE id = _inv.list_id) IS DISTINCT FROM 'active' THEN
    RETURN jsonb_build_object('status', 'list_unavailable');
  END IF;
  INSERT INTO public.list_members (list_id, user_id, role, display_name, color)
  VALUES (_inv.list_id, _uid, _inv.role, left(coalesce(nullif(btrim(_display_name), ''), 'Participante'), 60), public.member_color(_uid));
  UPDATE public.list_invites SET accepted_by = _uid, accepted_at = now() WHERE id = _inv.id;
  RETURN jsonb_build_object('status', 'ok', 'list_id', _inv.list_id, 'role', _inv.role);
END $$;
