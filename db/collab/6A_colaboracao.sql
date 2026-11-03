-- Bloco 6A: shared lists, members, invites, purchases and applied operations.
-- Additive only: legacy tables (profiles, user_state, user_state_history) are untouched.

-- ---------- Tables ----------
CREATE TABLE public.shared_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  emoji text NOT NULL DEFAULT '🛒',
  budget_cents integer CHECK (budget_cents IS NULL OR budget_cents >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  route_version integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.list_members (
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 60),
  color text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);
CREATE UNIQUE INDEX list_members_one_owner ON public.list_members (list_id) WHERE role = 'owner';
CREATE INDEX list_members_user ON public.list_members (user_id);

CREATE TABLE public.list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  category text,
  note text,
  quantity numeric(12,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'un' CHECK (unit IN ('un', 'pacote', 'kg', 'g', 'L', 'mL')),
  pack_size numeric(12,3) CHECK (pack_size IS NULL OR pack_size > 0),
  pack_unit text CHECK (pack_unit IS NULL OR pack_unit IN ('un', 'kg', 'g', 'L', 'mL')),
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  price_basis text NOT NULL DEFAULT 'un' CHECK (price_basis IN ('un', 'pacote', 'kg', 'L')),
  price_estimated boolean NOT NULL DEFAULT false,
  control_portion numeric(12,3) CHECK (control_portion IS NULL OR control_portion > 0),
  position integer NOT NULL DEFAULT 0,
  purchased boolean NOT NULL DEFAULT false,
  marked_by uuid,
  marked_at timestamptz,
  added_by uuid,
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX list_items_list ON public.list_items (list_id, position);

CREATE TABLE public.list_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.shared_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  completed_by uuid NOT NULL,
  purchased_on date NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.list_operations (
  operation_id uuid PRIMARY KEY,
  list_id uuid NOT NULL REFERENCES public.shared_lists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- Access helpers (SECURITY DEFINER: no recursive policies) ----------
CREATE OR REPLACE FUNCTION public.list_role(_list_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT m.role FROM public.list_members m
  WHERE m.list_id = _list_id AND m.user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_list_member(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.list_role(_list_id) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.can_edit_list(_list_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(public.list_role(_list_id) IN ('owner', 'editor'), false)
$$;

CREATE OR REPLACE FUNCTION public.member_color(_user_id uuid)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (ARRAY['#2563EB','#0D9488','#D97706','#DB2777','#7C3AED','#16A34A','#DC2626','#0891B2'])
    [1 + abs(hashtext(_user_id::text)) % 8]
$$;

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '6A.1' $$;

-- ---------- Integrity triggers ----------
CREATE OR REPLACE FUNCTION public.shared_lists_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := auth.uid();
    IF NEW.owner_id IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
    NEW.route_version := 0; NEW.version := 1; NEW.status := 'active';
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'owner_immutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.route_version IS DISTINCT FROM OLD.route_version
     AND coalesce(current_setting('app.collab_rpc', true), '') <> '1' THEN
    RAISE EXCEPTION 'route_version_rpc_only' USING ERRCODE = '42501';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER shared_lists_guard BEFORE INSERT OR UPDATE ON public.shared_lists
  FOR EACH ROW EXECUTE FUNCTION public.shared_lists_guard();

CREATE OR REPLACE FUNCTION public.shared_lists_add_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _name text;
BEGIN
  SELECT coalesce(nullif(p.display_name, ''), 'Proprietário') INTO _name FROM public.profiles p WHERE p.id = NEW.owner_id;
  INSERT INTO public.list_members (list_id, user_id, role, display_name, color)
  VALUES (NEW.id, NEW.owner_id, 'owner', left(coalesce(_name, 'Proprietário'), 60), public.member_color(NEW.owner_id));
  RETURN NEW;
END $$;
CREATE TRIGGER shared_lists_add_owner AFTER INSERT ON public.shared_lists
  FOR EACH ROW EXECUTE FUNCTION public.shared_lists_add_owner();

-- The owner row must always match shared_lists.owner_id; nobody else can be owner.
CREATE OR REPLACE FUNCTION public.list_members_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _owner uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT owner_id INTO _owner FROM public.shared_lists WHERE id = OLD.list_id;
    IF _owner = OLD.user_id THEN RAISE EXCEPTION 'cannot_remove_owner' USING ERRCODE = '42501'; END IF;
    RETURN OLD;
  END IF;
  SELECT owner_id INTO _owner FROM public.shared_lists WHERE id = NEW.list_id;
  IF (NEW.role = 'owner') <> (NEW.user_id = _owner) THEN
    RAISE EXCEPTION 'owner_role_mismatch' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.list_id <> OLD.list_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'member_identity_immutable' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER list_members_guard BEFORE INSERT OR UPDATE OR DELETE ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION public.list_members_guard();

-- Items: list never changes, authorship comes from the session, marking/position only through RPCs.
CREATE OR REPLACE FUNCTION public.list_items_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _rpc boolean := coalesce(current_setting('app.collab_rpc', true), '') = '1';
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.added_by := auth.uid();
    NEW.version := 1;
    NEW.purchased := false; NEW.marked_by := NULL; NEW.marked_at := NULL;
    NEW.deleted_at := NULL;
    NEW.created_at := now(); NEW.updated_at := now();
    RETURN NEW;
  END IF;
  IF NEW.list_id <> OLD.list_id OR NEW.id <> OLD.id
     OR NEW.added_by IS DISTINCT FROM OLD.added_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'item_identity_immutable' USING ERRCODE = '42501';
  END IF;
  IF NOT _rpc AND (NEW.purchased IS DISTINCT FROM OLD.purchased
     OR NEW.marked_by IS DISTINCT FROM OLD.marked_by OR NEW.marked_at IS DISTINCT FROM OLD.marked_at
     OR NEW.position IS DISTINCT FROM OLD.position) THEN
    RAISE EXCEPTION 'use_rpc_for_mark_or_reorder' USING ERRCODE = '42501';
  END IF;
  IF OLD.deleted_at IS NOT NULL AND NOT _rpc THEN
    RAISE EXCEPTION 'item_deleted' USING ERRCODE = '42501';
  END IF;
  NEW.version := OLD.version + 1;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER list_items_guard BEFORE INSERT OR UPDATE ON public.list_items
  FOR EACH ROW EXECUTE FUNCTION public.list_items_guard();

CREATE OR REPLACE FUNCTION public.shared_purchases_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'purchase_immutable' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER shared_purchases_immutable BEFORE UPDATE ON public.shared_purchases
  FOR EACH ROW EXECUTE FUNCTION public.shared_purchases_immutable();

-- ---------- Grants (minimal) ----------
REVOKE ALL ON public.shared_lists, public.list_members, public.list_items, public.list_invites,
  public.shared_purchases, public.list_operations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.shared_lists TO authenticated;
GRANT SELECT ON public.list_members TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.list_items TO authenticated;
GRANT SELECT ON public.list_invites TO authenticated;
GRANT SELECT ON public.shared_purchases TO authenticated;
GRANT SELECT ON public.list_operations TO authenticated;
GRANT ALL ON public.shared_lists, public.list_members, public.list_items, public.list_invites,
  public.shared_purchases, public.list_operations TO service_role;

-- ---------- RLS ----------
ALTER TABLE public.shared_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.list_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read list" ON public.shared_lists FOR SELECT TO authenticated
  USING (public.is_list_member(id));
CREATE POLICY "Signed-in users create own list" ON public.shared_lists FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owner updates list" ON public.shared_lists FOR UPDATE TO authenticated
  USING (public.list_role(id) = 'owner') WITH CHECK (public.list_role(id) = 'owner');

CREATE POLICY "Members read members" ON public.list_members FOR SELECT TO authenticated
  USING (public.is_list_member(list_id));

CREATE POLICY "Members read items" ON public.list_items FOR SELECT TO authenticated
  USING (public.is_list_member(list_id));
CREATE POLICY "Editors add items" ON public.list_items FOR INSERT TO authenticated
  WITH CHECK (public.can_edit_list(list_id));
CREATE POLICY "Editors update items" ON public.list_items FOR UPDATE TO authenticated
  USING (public.can_edit_list(list_id)) WITH CHECK (public.can_edit_list(list_id));

CREATE POLICY "Owner reads invites" ON public.list_invites FOR SELECT TO authenticated
  USING (public.list_role(list_id) = 'owner');

CREATE POLICY "Members read purchases" ON public.shared_purchases FOR SELECT TO authenticated
  USING (public.is_list_member(list_id));

CREATE POLICY "Members read operations" ON public.list_operations FOR SELECT TO authenticated
  USING (public.is_list_member(list_id));

-- ---------- RPCs ----------
-- Idempotency: returns the stored result when the operation id was already applied by the same user.
CREATE OR REPLACE FUNCTION public.collab_begin_op(_op uuid, _list uuid, _kind text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _row public.list_operations;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF _op IS NULL THEN RAISE EXCEPTION 'operation_id_required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.list_operations (operation_id, list_id, user_id, kind)
  VALUES (_op, _list, auth.uid(), _kind) ON CONFLICT (operation_id) DO NOTHING;
  IF FOUND THEN RETURN NULL; END IF;
  SELECT * INTO _row FROM public.list_operations WHERE operation_id = _op;
  IF _row.user_id <> auth.uid() OR _row.list_id <> _list OR _row.kind <> _kind THEN
    RAISE EXCEPTION 'operation_id_reused' USING ERRCODE = '22023';
  END IF;
  RETURN _row.result || jsonb_build_object('duplicate', true);
END $$;
REVOKE ALL ON FUNCTION public.collab_begin_op(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.collab_finish_op(_op uuid, _result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.list_operations SET result = _result WHERE operation_id = _op;
  RETURN _result;
END $$;
REVOKE ALL ON FUNCTION public.collab_finish_op(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Explicit mark state (never a blind toggle), with expected version.
CREATE OR REPLACE FUNCTION public.set_item_marked(_operation_id uuid, _item_id uuid, _expected_version integer, _marked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _item public.list_items; _prev jsonb;
BEGIN
  SELECT * INTO _item FROM public.list_items WHERE id = _item_id FOR UPDATE;
  IF NOT FOUND OR NOT public.can_edit_list(_item.list_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  _prev := public.collab_begin_op(_operation_id, _item.list_id, 'mark');
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  IF _item.deleted_at IS NOT NULL OR _item.version <> _expected_version THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
      'status', 'conflict', 'item_id', _item.id, 'version', _item.version,
      'purchased', _item.purchased, 'deleted', _item.deleted_at IS NOT NULL));
  END IF;
  PERFORM set_config('app.collab_rpc', '1', true);
  UPDATE public.list_items SET purchased = _marked,
    marked_by = CASE WHEN _marked THEN auth.uid() END,
    marked_at = CASE WHEN _marked THEN now() END
  WHERE id = _item_id RETURNING * INTO _item;
  PERFORM set_config('app.collab_rpc', '', true);
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
    'status', 'ok', 'item_id', _item.id, 'version', _item.version, 'purchased', _item.purchased));
END $$;

-- Reorder: full sequence of live items, guarded by the list route version.
CREATE OR REPLACE FUNCTION public.reorder_items(_operation_id uuid, _list_id uuid, _expected_route_version integer, _item_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _list public.shared_lists; _prev jsonb; _live integer;
BEGIN
  IF NOT public.can_edit_list(_list_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _list FROM public.shared_lists WHERE id = _list_id FOR UPDATE;
  _prev := public.collab_begin_op(_operation_id, _list_id, 'reorder');
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  SELECT count(*) INTO _live FROM public.list_items WHERE list_id = _list_id AND deleted_at IS NULL;
  IF _list.route_version <> _expected_route_version THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'conflict', 'route_version', _list.route_version));
  END IF;
  IF coalesce(array_length(_item_ids, 1), 0) <> _live
     OR (SELECT count(DISTINCT x) FROM unnest(_item_ids) x) <> _live
     OR EXISTS (SELECT 1 FROM unnest(_item_ids) x WHERE NOT EXISTS (
       SELECT 1 FROM public.list_items i WHERE i.id = x AND i.list_id = _list_id AND i.deleted_at IS NULL)) THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'invalid', 'route_version', _list.route_version));
  END IF;
  PERFORM set_config('app.collab_rpc', '1', true);
  UPDATE public.list_items i SET position = o.pos - 1
  FROM unnest(_item_ids) WITH ORDINALITY AS o(id, pos)
  WHERE i.id = o.id AND i.position IS DISTINCT FROM o.pos - 1;
  UPDATE public.shared_lists SET route_version = route_version + 1 WHERE id = _list_id
  RETURNING * INTO _list;
  PERFORM set_config('app.collab_rpc', '', true);
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'route_version', _list.route_version));
END $$;

-- Complete purchase: atomic snapshot built on the server from the marked items whose versions match.
CREATE OR REPLACE FUNCTION public.complete_shared_purchase(
  _operation_id uuid, _list_id uuid, _purchased_on date, _item_ids uuid[], _expected_versions integer[], _confirmed_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _prev jsonb; _bad jsonb; _snap jsonb; _pid uuid; _list public.shared_lists;
BEGIN
  IF NOT public.can_edit_list(_list_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _list FROM public.shared_lists WHERE id = _list_id FOR UPDATE;
  _prev := public.collab_begin_op(_operation_id, _list_id, 'complete');
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  IF coalesce(array_length(_item_ids, 1), 0) = 0
     OR array_length(_item_ids, 1) <> coalesce(array_length(_expected_versions, 1), 0) THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'invalid'));
  END IF;
  PERFORM 1 FROM public.list_items WHERE id = ANY(_item_ids) FOR UPDATE;
  SELECT jsonb_agg(jsonb_build_object('item_id', x.id, 'version', i.version, 'purchased', i.purchased))
  INTO _bad
  FROM unnest(_item_ids, _expected_versions) AS x(id, v)
  LEFT JOIN public.list_items i ON i.id = x.id AND i.list_id = _list_id
  WHERE i.id IS NULL OR i.deleted_at IS NOT NULL OR NOT i.purchased OR i.version <> x.v;
  IF _bad IS NOT NULL THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'conflict', 'items', _bad));
  END IF;
  SELECT jsonb_build_object(
    'format', 1, 'list_name', _list.name, 'purchased_on', _purchased_on,
    'lines', jsonb_agg(jsonb_build_object(
      'item_id', i.id, 'name', i.name, 'category', i.category, 'unit', i.unit, 'quantity', i.quantity,
      'pack_size', i.pack_size, 'pack_unit', i.pack_unit, 'price_cents', i.price_cents,
      'price_basis', i.price_basis, 'control_portion', i.control_portion,
      'price_status', CASE WHEN i.price_cents IS NULL THEN 'missing'
        WHEN i.price_estimated AND NOT (i.id = ANY(coalesce(_confirmed_ids, '{}'))) THEN 'estimated'
        ELSE 'confirmed' END,
      'position', i.position, 'marked_by', i.marked_by, 'marked_at', i.marked_at, 'author', i.added_by
    ) ORDER BY i.position, i.created_at DESC, i.id))
  INTO _snap
  FROM public.list_items i WHERE i.id = ANY(_item_ids);
  INSERT INTO public.shared_purchases (list_id, completed_by, purchased_on, snapshot)
  VALUES (_list_id, auth.uid(), _purchased_on, _snap) RETURNING id INTO _pid;
  PERFORM set_config('app.collab_rpc', '1', true);
  UPDATE public.list_items SET deleted_at = now() WHERE id = ANY(_item_ids);
  PERFORM set_config('app.collab_rpc', '', true);
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'purchase_id', _pid));
END $$;

-- Invites: only the owner; the raw token is returned once, only its hash is stored.
CREATE OR REPLACE FUNCTION public.create_list_invite(_list_id uuid, _role text, _days integer DEFAULT 7)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''); _id uuid;
BEGIN
  IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _role NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.list_invites (list_id, token_hash, role, created_by, expires_at)
  VALUES (_list_id, encode(sha256(convert_to(_token, 'UTF8')), 'hex'), _role, auth.uid(),
          now() + make_interval(days => least(greatest(coalesce(_days, 7), 1), 30)))
  RETURNING id INTO _id;
  RETURN jsonb_build_object('invite_id', _id, 'token', _token);
END $$;

CREATE OR REPLACE FUNCTION public.accept_list_invite(_token text, _display_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _inv public.list_invites; _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _inv FROM public.list_invites
  WHERE token_hash = encode(sha256(convert_to(coalesce(_token, ''), 'UTF8')), 'hex') FOR UPDATE;
  IF NOT FOUND OR _inv.revoked_at IS NOT NULL OR _inv.accepted_at IS NOT NULL OR _inv.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;
  IF EXISTS (SELECT 1 FROM public.list_members WHERE list_id = _inv.list_id AND user_id = _uid) THEN
    RETURN jsonb_build_object('status', 'already_member', 'list_id', _inv.list_id);
  END IF;
  INSERT INTO public.list_members (list_id, user_id, role, display_name, color)
  VALUES (_inv.list_id, _uid, _inv.role,
          left(coalesce(nullif(btrim(_display_name), ''), 'Participante'), 60), public.member_color(_uid));
  UPDATE public.list_invites SET accepted_by = _uid, accepted_at = now() WHERE id = _inv.id;
  RETURN jsonb_build_object('status', 'ok', 'list_id', _inv.list_id, 'role', _inv.role);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_list_invite(_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _list uuid;
BEGIN
  SELECT list_id INTO _list FROM public.list_invites WHERE id = _invite_id;
  IF _list IS NULL OR public.list_role(_list) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  UPDATE public.list_invites SET revoked_at = now() WHERE id = _invite_id AND revoked_at IS NULL;
END $$;

-- Members: owner changes roles (never to/from owner); owner removes others; anyone non-owner may leave.
CREATE OR REPLACE FUNCTION public.set_member_role(_list_id uuid, _user_id uuid, _role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF _role NOT IN ('editor', 'viewer') THEN RAISE EXCEPTION 'invalid_role' USING ERRCODE = '22023'; END IF;
  UPDATE public.list_members SET role = _role WHERE list_id = _list_id AND user_id = _user_id AND role <> 'owner';
  IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.remove_list_member(_list_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR (_user_id <> auth.uid() AND public.list_role(_list_id) IS DISTINCT FROM 'owner') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.list_members WHERE list_id = _list_id AND user_id = _user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'member_not_found' USING ERRCODE = 'P0002'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_my_display_name(_list_id uuid, _display_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  UPDATE public.list_members SET display_name = left(coalesce(nullif(btrim(_display_name), ''), 'Participante'), 60)
  WHERE list_id = _list_id AND user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
END $$;

-- Function permissions: nothing for anon; RPCs and helpers for signed-in users only.
REVOKE ALL ON FUNCTION public.list_role(uuid), public.is_list_member(uuid), public.can_edit_list(uuid),
  public.set_item_marked(uuid, uuid, integer, boolean), public.reorder_items(uuid, uuid, integer, uuid[]),
  public.complete_shared_purchase(uuid, uuid, date, uuid[], integer[], uuid[]),
  public.create_list_invite(uuid, text, integer), public.accept_list_invite(text, text),
  public.revoke_list_invite(uuid), public.set_member_role(uuid, uuid, text),
  public.remove_list_member(uuid, uuid), public.set_my_display_name(uuid, text),
  public.shared_lists_guard(), public.shared_lists_add_owner(), public.list_members_guard(),
  public.list_items_guard(), public.shared_purchases_immutable()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_role(uuid), public.is_list_member(uuid), public.can_edit_list(uuid),
  public.set_item_marked(uuid, uuid, integer, boolean), public.reorder_items(uuid, uuid, integer, uuid[]),
  public.complete_shared_purchase(uuid, uuid, date, uuid[], integer[], uuid[]),
  public.create_list_invite(uuid, text, integer), public.accept_list_invite(text, text),
  public.revoke_list_invite(uuid), public.set_member_role(uuid, uuid, text),
  public.remove_list_member(uuid, uuid), public.set_my_display_name(uuid, text)
  TO authenticated;
REVOKE EXECUTE ON FUNCTION public.shared_lists_guard(), public.shared_lists_add_owner(), public.list_members_guard(),
  public.list_items_guard(), public.shared_purchases_immutable() FROM authenticated;

COMMENT ON TABLE public.shared_lists IS 'Collaboration schema 6A.1 (see public.collab_schema_version()).';
