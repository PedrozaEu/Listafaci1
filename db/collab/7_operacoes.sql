-- Bloco 7: one idempotent entry point for queued device operations (create/update/archive lists, create/update/delete items).
-- Marks, reorder and purchases keep their own RPCs (already deduplicated by operation id).
-- Identity always comes from auth.uid(); nothing in the payload can replace it.

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '7.1' $$;

CREATE OR REPLACE FUNCTION public.apply_list_op(
  _operation_id uuid, _list_id uuid, _kind text, _entity_id uuid, _base_version integer, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  _uid uuid := auth.uid(); _prev jsonb; _list public.shared_lists; _item public.list_items; _p jsonb := coalesce(_payload, '{}');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  IF _kind NOT IN ('list_create', 'list_update', 'list_archive', 'item_create', 'item_update', 'item_delete') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  IF _kind = 'list_create' THEN
    SELECT * INTO _list FROM public.shared_lists WHERE id = _list_id;
    IF NOT FOUND THEN
      INSERT INTO public.shared_lists (id, owner_id, name, emoji, budget_cents)
      VALUES (_list_id, _uid, left(coalesce(nullif(_p->>'name', ''), 'Lista'), 120), coalesce(_p->>'emoji', '🛒'), (_p->>'budget_cents')::int);
      UPDATE public.shared_lists SET sort_mode = _p->>'sort_mode',
        source_list_id = CASE WHEN public.is_list_member((_p->>'source_list_id')::uuid) THEN (_p->>'source_list_id')::uuid END
      WHERE id = _list_id RETURNING * INTO _list;
    ELSIF _list.owner_id <> _uid THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    _prev := public.collab_begin_op(_operation_id, _list_id, _kind);
    IF _prev IS NOT NULL THEN RETURN _prev; END IF;
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _list.version, 'route_version', _list.route_version));
  END IF;

  IF _kind IN ('list_update', 'list_archive') THEN
    IF public.list_role(_list_id) IS DISTINCT FROM 'owner' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  ELSIF NOT public.can_edit_list(_list_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  _prev := public.collab_begin_op(_operation_id, _list_id, _kind);
  IF _prev IS NOT NULL THEN RETURN _prev; END IF;
  SELECT * INTO _list FROM public.shared_lists WHERE id = _list_id FOR UPDATE;

  IF _kind = 'list_update' THEN
    IF _base_version IS NOT NULL AND _list.version <> _base_version THEN
      RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'conflict', 'version', _list.version));
    END IF;
    UPDATE public.shared_lists SET
      name = left(coalesce(nullif(_p->>'name', ''), name), 120), emoji = coalesce(_p->>'emoji', emoji),
      budget_cents = (_p->>'budget_cents')::int, sort_mode = _p->>'sort_mode'
    WHERE id = _list_id RETURNING * INTO _list;
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _list.version));
  END IF;

  IF _kind = 'list_archive' THEN
    UPDATE public.shared_lists SET status = 'archived' WHERE id = _list_id RETURNING * INTO _list;
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _list.version));
  END IF;

  SELECT * INTO _item FROM public.list_items WHERE id = _entity_id FOR UPDATE;
  IF FOUND AND _item.list_id <> _list_id THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  IF _kind = 'item_create' THEN
    IF NOT FOUND THEN
      INSERT INTO public.list_items (id, list_id, name, category, note, quantity, unit, pack_size, pack_unit,
        price_cents, price_basis, price_estimated, control_portion)
      VALUES (_entity_id, _list_id, left(_p->>'name', 200), _p->>'category', _p->>'note', (_p->>'quantity')::numeric,
        coalesce(_p->>'unit', 'un'), (_p->>'pack_size')::numeric, _p->>'pack_unit', (_p->>'price_cents')::int,
        coalesce(_p->>'price_basis', 'un'), coalesce((_p->>'price_estimated')::boolean, false), (_p->>'control_portion')::numeric)
      RETURNING * INTO _item;
    END IF;
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _item.version));
  END IF;

  IF NOT FOUND THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'conflict', 'deleted', true));
  END IF;

  IF _kind = 'item_delete' THEN
    -- tombstone: the row stays, deleted_at prevents resurrection by late updates
    IF _item.deleted_at IS NULL THEN
      UPDATE public.list_items SET deleted_at = now() WHERE id = _entity_id RETURNING * INTO _item;
    END IF;
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _item.version, 'deleted', true));
  END IF;

  -- item_update
  IF _item.deleted_at IS NOT NULL OR (_base_version IS NOT NULL AND _item.version <> _base_version) THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object(
      'status', 'conflict', 'version', _item.version, 'deleted', _item.deleted_at IS NOT NULL));
  END IF;
  UPDATE public.list_items SET
    name = left(coalesce(nullif(_p->>'name', ''), name), 200), category = _p->>'category', note = _p->>'note',
    quantity = coalesce((_p->>'quantity')::numeric, quantity), unit = coalesce(_p->>'unit', unit),
    pack_size = (_p->>'pack_size')::numeric, pack_unit = _p->>'pack_unit', price_cents = (_p->>'price_cents')::int,
    price_basis = coalesce(_p->>'price_basis', price_basis), price_estimated = coalesce((_p->>'price_estimated')::boolean, false),
    control_portion = (_p->>'control_portion')::numeric
  WHERE id = _entity_id RETURNING * INTO _item;
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _item.version));
END $$;

REVOKE ALL ON FUNCTION public.apply_list_op(uuid, uuid, text, uuid, integer, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_list_op(uuid, uuid, text, uuid, integer, jsonb) TO authenticated;
