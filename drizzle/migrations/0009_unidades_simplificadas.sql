-- Simplified units (un/kg): optional free-text product presentation, e.g. "Pacote 5 kg".
-- Additive only: legacy units stay valid until every ambiguous row is reviewed.
ALTER TABLE public.list_items ADD COLUMN IF NOT EXISTS presentation text;
COMMENT ON COLUMN public.list_items.presentation IS 'Informative package/presentation text. Never used in calculations.';
COMMENT ON COLUMN public.list_items.pack_size IS 'DEPRECATED: replaced by presentation (kept for legacy rows).';
COMMENT ON COLUMN public.list_items.pack_unit IS 'DEPRECATED: replaced by presentation (kept for legacy rows).';

CREATE OR REPLACE FUNCTION public.apply_list_op(_operation_id uuid, _list_id uuid, _kind text, _entity_id uuid, _base_version integer, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        price_cents, price_basis, price_estimated, control_portion, presentation)
      VALUES (_entity_id, _list_id, left(_p->>'name', 200), _p->>'category', _p->>'note', (_p->>'quantity')::numeric,
        coalesce(_p->>'unit', 'un'), (_p->>'pack_size')::numeric, _p->>'pack_unit', (_p->>'price_cents')::int,
        coalesce(_p->>'price_basis', 'un'), coalesce((_p->>'price_estimated')::boolean, false), (_p->>'control_portion')::numeric, nullif(left(btrim(_p->>'presentation'), 80), ''))
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
  -- a stale client must never turn a simplified (un/kg) product back into an obsolete unit
  IF _item.unit IN ('un', 'kg') AND coalesce(_p->>'unit', _item.unit) NOT IN ('un', 'kg') THEN
    RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'conflict', 'version', _item.version, 'reason', 'obsolete_unit'));
  END IF;
  UPDATE public.list_items SET
    presentation = CASE WHEN _p ? 'presentation' THEN nullif(left(btrim(_p->>'presentation'), 80), '') ELSE presentation END,
    name = left(coalesce(nullif(_p->>'name', ''), name), 200), category = _p->>'category', note = _p->>'note',
    quantity = coalesce((_p->>'quantity')::numeric, quantity), unit = coalesce(_p->>'unit', unit),
    pack_size = (_p->>'pack_size')::numeric, pack_unit = _p->>'pack_unit', price_cents = (_p->>'price_cents')::int,
    price_basis = coalesce(_p->>'price_basis', price_basis), price_estimated = coalesce((_p->>'price_estimated')::boolean, false),
    control_portion = (_p->>'control_portion')::numeric
  WHERE id = _entity_id RETURNING * INTO _item;
  RETURN public.collab_finish_op(_operation_id, jsonb_build_object('status', 'ok', 'version', _item.version));
END $function$;

CREATE OR REPLACE FUNCTION public.import_legacy_chunk(_import_id uuid, _payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _uid uuid := auth.uid(); _imp public.legacy_imports; _r jsonb; _id uuid; _list uuid; _src uuid;
  _new boolean; _added int := 0; _skipped int := 0;
BEGIN
  SELECT * INTO _imp FROM public.legacy_imports WHERE id = _import_id AND owner_id = _uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = '42501'; END IF;
  IF _imp.state <> 'started' THEN RETURN jsonb_build_object('added', 0, 'skipped', 0, 'state', _imp.state); END IF;
  PERFORM set_config('app.collab_rpc', '1', true);

  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'lists', '[]')) LOOP
    _new := NOT EXISTS (SELECT 1 FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'list' AND legacy_id = _r->>'legacy_id');
    _id := public.legacy_map_id(_import_id, 'list', _r->>'legacy_id',
      EXISTS (SELECT 1 FROM public.shared_lists WHERE id::text = lower(_r->>'legacy_id')));
    IF _new THEN
      INSERT INTO public.shared_lists (id, owner_id, name, emoji, budget_cents)
      VALUES (_id, _uid, left(coalesce(nullif(_r->>'name', ''), 'Lista'), 120), coalesce(_r->>'emoji', '🛒'),
              (_r->>'budget_cents')::int);
      UPDATE public.shared_lists SET sort_mode = _r->>'sort_mode',
        legacy_created_at = to_timestamp((_r->>'created_at_ms')::bigint / 1000.0) WHERE id = _id;
      _added := _added + 1;
    ELSE _skipped := _skipped + 1; END IF;
  END LOOP;
  -- source links after all lists of the chunk exist
  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'lists', '[]')) WHERE value ? 'source_legacy_id' LOOP
    SELECT new_id INTO _src FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'list' AND legacy_id = _r->>'source_legacy_id';
    SELECT new_id INTO _id FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'list' AND legacy_id = _r->>'legacy_id';
    IF _src IS NOT NULL THEN
      UPDATE public.shared_lists SET source_list_id = _src WHERE id = _id AND source_list_id IS DISTINCT FROM _src;
    END IF;
  END LOOP;

  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'items', '[]')) LOOP
    SELECT new_id INTO _list FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'list' AND legacy_id = _r->>'list_legacy_id';
    IF _list IS NULL THEN RAISE EXCEPTION 'list_not_imported' USING ERRCODE = '22023'; END IF;
    _new := NOT EXISTS (SELECT 1 FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'item' AND legacy_id = _r->>'legacy_id');
    _id := public.legacy_map_id(_import_id, 'item', _r->>'legacy_id',
      EXISTS (SELECT 1 FROM public.list_items WHERE id::text = lower(_r->>'legacy_id')));
    IF _new THEN
      INSERT INTO public.list_items (id, list_id, name, category, note, quantity, unit, pack_size, pack_unit,
        price_cents, price_basis, price_estimated, control_portion, presentation)
      VALUES (_id, _list, left(_r->>'name', 200), _r->>'category', _r->>'note', (_r->>'quantity')::numeric,
        coalesce(_r->>'unit', 'un'), (_r->>'pack_size')::numeric, _r->>'pack_unit', (_r->>'price_cents')::int,
        coalesce(_r->>'price_basis', 'un'), coalesce((_r->>'price_estimated')::boolean, false), (_r->>'control_portion')::numeric, nullif(left(btrim(_r->>'presentation'), 80), ''));
      UPDATE public.list_items SET position = (_r->>'position')::int,
        purchased = coalesce((_r->>'purchased')::boolean, false),
        marked_at = CASE WHEN (_r->>'purchased')::boolean THEN now() END,
        legacy_created_at = to_timestamp((_r->>'created_at_ms')::bigint / 1000.0)
      WHERE id = _id;
      _added := _added + 1;
    ELSE _skipped := _skipped + 1; END IF;
  END LOOP;

  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'purchases', '[]')) LOOP
    SELECT new_id INTO _list FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'list' AND legacy_id = _r->>'list_legacy_id';
    IF _list IS NULL THEN
      -- purchase of a list that no longer exists: keep it under one archived holder list per account
      _new := NOT EXISTS (SELECT 1 FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'holder' AND legacy_id = 'purchases');
      _list := public.legacy_map_id(_import_id, 'holder', 'purchases', true);
      IF _new THEN
        INSERT INTO public.shared_lists (id, owner_id, name, emoji) VALUES (_list, _uid, 'Compras antigas', '🧾');
        UPDATE public.shared_lists SET status = 'archived' WHERE id = _list;
      END IF;
    END IF;
    _new := NOT EXISTS (SELECT 1 FROM public.legacy_id_map WHERE owner_id = _uid AND kind = 'purchase' AND legacy_id = _r->>'legacy_id');
    _id := public.legacy_map_id(_import_id, 'purchase', _r->>'legacy_id',
      EXISTS (SELECT 1 FROM public.shared_purchases WHERE id::text = lower(_r->>'legacy_id')));
    IF _new THEN
      INSERT INTO public.shared_purchases (id, list_id, completed_by, purchased_on, snapshot)
      VALUES (_id, _list, _uid, (_r->>'purchased_on')::date, _r->'snapshot');
      _added := _added + 1;
    ELSE _skipped := _skipped + 1; END IF;
  END LOOP;

  FOR _r IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'price_history', '[]')) LOOP
    INSERT INTO public.legacy_price_history (owner_id, item_key, month, cents, import_id)
    VALUES (_uid, _r->>'key', _r->>'month', (_r->>'cents')::int, _import_id)
    ON CONFLICT DO NOTHING;
    IF FOUND THEN _added := _added + 1; ELSE _skipped := _skipped + 1; END IF;
  END LOOP;

  UPDATE public.legacy_imports SET updated_at = now() WHERE id = _import_id;
  RETURN jsonb_build_object('added', _added, 'skipped', _skipped, 'state', 'started');
END $function$;