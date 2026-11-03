-- Bloco 9.1: sharing is strictly per list; guest roles are editor and checker ("apenas marcar").
-- Additive: legacy viewer links stay stored but inactive ("review") until the owner picks editor or checker.

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '9.2' $$;

-- Roles: checker added; viewer kept only for legacy rows waiting for the owner's decision.
ALTER TABLE public.list_members DROP CONSTRAINT IF EXISTS list_members_role_check;
ALTER TABLE public.list_members ADD CONSTRAINT list_members_role_check
  CHECK (role IN ('owner', 'editor', 'checker', 'viewer'));
ALTER TABLE public.list_invites DROP CONSTRAINT IF EXISTS list_invites_role_check;
ALTER TABLE public.list_invites ADD CONSTRAINT list_invites_role_check
  CHECK (role IN ('editor', 'checker', 'viewer'));
ALTER TABLE public.list_members ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
UPDATE public.list_members SET status = 'review' WHERE role = 'viewer' AND status <> 'review';
ALTER TABLE public.list_members DROP CONSTRAINT IF EXISTS list_members_status_check;
ALTER TABLE public.list_members ADD CONSTRAINT list_members_status_check
  CHECK (status IN ('active', 'review') AND (role <> 'viewer' OR status = 'review'));
COMMENT ON COLUMN public.list_members.status IS 'active grants access; review = legacy viewer waiting for the owner to choose editor or checker (no access).';

-- Single source of truth for access: only ACTIVE links with a current role count.
CREATE OR REPLACE FUNCTION public.list_role(_list_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.list_members m
  WHERE m.list_id = _list_id AND m.user_id = auth.uid()
    AND m.status = 'active' AND m.role IN ('owner', 'editor', 'checker')
$$;

-- Marking is allowed to every active participant of the list, including checkers.
CREATE OR REPLACE FUNCTION public.can_mark_list(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.list_role(_list_id) IN ('owner', 'editor', 'checker'), false)
    AND EXISTS (SELECT 1 FROM public.shared_lists l WHERE l.id = _list_id AND l.status = 'active')
$$;

-- Marking: same rules as 9.1 (explicit state, first valid operation wins) with checker access.
CREATE OR REPLACE FUNCTION public.set_item_marked(_operation_id uuid, _item_id uuid, _expected_version integer, _marked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _item public.list_items; _prev jsonb;
BEGIN
  IF auth.uid() IS NULL OR _marked IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _item FROM public.list_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_mark_list(_item.list_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  _prev := public.collab_begin_op(_operation_id, _item.list_id, 'mark');
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  IF _item.deleted_at IS NULL AND _item.purchased = _marked THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
      'status', 'already', 'item_id', _item.id, 'version', _item.version,
      'purchased', _item.purchased, 'marked_by', _item.marked_by));
  END IF;
  IF _item.deleted_at IS NOT NULL OR _item.version <> _expected_version THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
      'status', 'conflict', 'item_id', _item.id, 'version', _item.version,
      'purchased', _item.purchased, 'marked_by', _item.marked_by, 'deleted', _item.deleted_at IS NOT NULL));
  END IF;
  PERFORM set_config('app.collab_rpc', '1', true);
  UPDATE public.list_items SET purchased = _marked,
    marked_by = CASE WHEN _marked THEN auth.uid() END,
    marked_at = CASE WHEN _marked THEN now() END
  WHERE id = _item_id RETURNING * INTO _item;
  PERFORM set_config('app.collab_rpc', '', true);
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
    'status', 'ok', 'item_id', _item.id, 'version', _item.version, 'purchased', _item.purchased, 'marked_by', _item.marked_by));
END $$;

-- Invites: only editor or checker; checker is the default.
CREATE OR REPLACE FUNCTION public.create_list_invite_v2(_list_id uuid, _role text DEFAULT 'checker', _hours integer DEFAULT 24)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); _row public.list_invites;
BEGIN
  IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _role IS NULL OR _role NOT IN ('editor', 'checker') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.list_invites (list_id, token_hash, role, created_by, expires_at)
  VALUES (_list_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _role, auth.uid(),
          now() + make_interval(hours => least(greatest(coalesce(_hours, 24), 1), 720)))
  RETURNING * INTO _row;
  RETURN jsonb_build_object('invite_id', _row.id, 'token', _token, 'role', _row.role, 'expires_at', _row.expires_at);
END $$;

-- Read-only look; list id and role come only from the stored invite. Pending viewer invites are discontinued.
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
  IF _inv.role NOT IN ('editor', 'checker') THEN RETURN jsonb_build_object('status', 'discontinued'); END IF;
  SELECT l.name INTO _name FROM public.shared_lists l WHERE l.id = _inv.list_id;
  SELECT m.display_name INTO _owner FROM public.list_members m WHERE m.list_id = _inv.list_id AND m.role = 'owner';
  RETURN jsonb_build_object('status', 'valid', 'list_name', _name, 'owner_name', _owner, 'role', _inv.role, 'expires_at', _inv.expires_at);
END $$;

-- Accept creates only the link (list + user + role from the invite). Returns just what is needed to open the list.
CREATE OR REPLACE FUNCTION public.accept_list_invite_v2(_token text, _display_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites
  WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'invalid'); END IF;
  IF EXISTS (SELECT 1 FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid) THEN
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id); -- never changes the existing role
  END IF;
  IF _inv.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'revoked'); END IF;
  IF _inv.accepted_at IS NOT NULL THEN RETURN jsonb_build_object('status', 'consumed'); END IF;
  IF _inv.expires_at < now() THEN RETURN jsonb_build_object('status', 'expired'); END IF;
  IF _inv.role NOT IN ('editor', 'checker') THEN RETURN jsonb_build_object('status', 'discontinued'); END IF;
  INSERT INTO public.list_members (list_id, user_id, role, display_name, color)
  VALUES (_inv.list_id, _uid, _inv.role, left(coalesce(nullif(btrim(_display_name), ''), 'Participante'), 60), public.member_color(_uid));
  UPDATE public.list_invites SET accepted_by = _uid, accepted_at = now() WHERE id = _inv.id;
  RETURN jsonb_build_object('status', 'ok', 'list_id', _inv.list_id, 'role', _inv.role);
END $$;

-- Owner sets editor or checker; this also resolves a legacy link in review.
CREATE OR REPLACE FUNCTION public.set_member_role(_list_id uuid, _user_id uuid, _role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _role IS NULL OR _role NOT IN ('editor', 'checker') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  UPDATE public.list_members SET role = _role, status = 'active'
  WHERE list_id = _list_id AND user_id = _user_id AND role <> 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002'; END IF;
END $$;

-- Purchase history of a list: the owner sees all; a guest sees only purchases they completed.
-- Purchases the owner made before (or without) the guest are private.
DROP POLICY IF EXISTS "Members read purchases" ON public.shared_purchases;
CREATE POLICY "Owner or completer reads purchases" ON public.shared_purchases FOR SELECT TO authenticated
  USING (public.list_role(list_id) = 'owner' OR (completed_by = auth.uid() AND public.is_list_member(list_id)));

-- Operation log: owner sees the list log; others only their own operations.
DROP POLICY IF EXISTS "Members read operations" ON public.list_operations;
CREATE POLICY "Owner or author reads operations" ON public.list_operations FOR SELECT TO authenticated
  USING (public.list_role(list_id) = 'owner' OR (user_id = auth.uid() AND public.is_list_member(list_id)));

-- Old v1 invite RPCs (7-day, viewer) are an alternative path: closed.
REVOKE ALL ON FUNCTION public.create_list_invite(uuid, text, integer), public.accept_list_invite(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.can_mark_list(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_mark_list(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.set_item_marked(uuid, uuid, integer, boolean), public.create_list_invite_v2(uuid, text, integer),
  public.peek_list_invite(text), public.accept_list_invite_v2(text, text), public.set_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_marked(uuid, uuid, integer, boolean), public.create_list_invite_v2(uuid, text, integer),
  public.peek_list_invite(text), public.accept_list_invite_v2(text, text), public.set_member_role(uuid, uuid, text) TO authenticated;
