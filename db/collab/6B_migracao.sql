-- Bloco 6B.1: legacy import bookkeeping (additive). Legacy user_state is never touched.

ALTER TABLE public.shared_lists ADD COLUMN IF NOT EXISTS sort_mode text
  CHECK (sort_mode IS NULL OR sort_mode IN ('custom', 'category', 'alpha', 'created'));
ALTER TABLE public.shared_lists ADD COLUMN IF NOT EXISTS source_list_id uuid;
ALTER TABLE public.shared_lists ADD COLUMN IF NOT EXISTS legacy_created_at timestamptz;
ALTER TABLE public.list_items ADD COLUMN IF NOT EXISTS legacy_created_at timestamptz;

CREATE TABLE public.legacy_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('account', 'guest', 'legacy-stash', 'backup')),
  checksum text NOT NULL CHECK (char_length(checksum) BETWEEN 8 AND 128),
  schema_version integer NOT NULL,
  state text NOT NULL DEFAULT 'started' CHECK (state IN ('started', 'verified', 'active', 'rolled_back')),
  expected jsonb NOT NULL,
  actual jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, source, checksum)
);

CREATE TABLE public.legacy_id_map (
  owner_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('list', 'item', 'purchase', 'holder')),
  legacy_id text NOT NULL,
  new_id uuid NOT NULL,
  import_id uuid NOT NULL REFERENCES public.legacy_imports(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_id, kind, legacy_id)
);
CREATE INDEX legacy_id_map_import ON public.legacy_id_map (import_id, kind);

CREATE TABLE public.legacy_price_history (
  owner_id uuid NOT NULL,
  item_key text NOT NULL,
  month text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  cents integer NOT NULL CHECK (cents >= 0),
  import_id uuid NOT NULL REFERENCES public.legacy_imports(id) ON DELETE CASCADE,
  PRIMARY KEY (owner_id, item_key, month)
);
COMMENT ON TABLE public.legacy_price_history IS 'Legacy unit price history imported from the device. Not a paid purchase.';

GRANT SELECT ON public.legacy_imports, public.legacy_id_map, public.legacy_price_history TO authenticated;
GRANT ALL ON public.legacy_imports, public.legacy_id_map, public.legacy_price_history TO service_role;
ALTER TABLE public.legacy_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_id_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legacy_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owner reads imports" ON public.legacy_imports FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owner reads id map" ON public.legacy_id_map FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owner reads price history" ON public.legacy_price_history FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '6B.1' $$;

-- Returns the mapped id, creating the mapping once. A legacy uuid is kept when nobody uses it yet.
CREATE OR REPLACE FUNCTION public.legacy_map_id(_import uuid, _kind text, _legacy text, _taken boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _id uuid;
BEGIN
  SELECT new_id INTO _id FROM public.legacy_id_map WHERE owner_id = _uid AND kind = _kind AND legacy_id = _legacy;
  IF _id IS NOT NULL THEN RETURN _id; END IF;
  IF NOT _taken AND _legacy ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    _id := _legacy::uuid;
  ELSE
    _id := gen_random_uuid();
  END IF;
  INSERT INTO public.legacy_id_map (owner_id, kind, legacy_id, new_id, import_id) VALUES (_uid, _kind, _legacy, _id, _import);
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.begin_legacy_import(_source text, _checksum text, _schema_version integer, _expected jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _uid uuid := auth.uid(); _row public.legacy_imports;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.legacy_imports (owner_id, source, checksum, schema_version, expected)
  VALUES (_uid, _source, _checksum, _schema_version, _expected)
  ON CONFLICT (owner_id, source, checksum) DO UPDATE SET updated_at = now()
  RETURNING * INTO _row;
  RETURN jsonb_build_object('import_id', _row.id, 'state', _row.state);
END $$;

CREATE OR REPLACE FUNCTION public.import_legacy_chunk(_import_id uuid, _payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
        price_cents, price_basis, price_estimated, control_portion)
      VALUES (_id, _list, left(_r->>'name', 200), _r->>'category', _r->>'note', (_r->>'quantity')::numeric,
        coalesce(_r->>'unit', 'un'), (_r->>'pack_size')::numeric, _r->>'pack_unit', (_r->>'price_cents')::int,
        coalesce(_r->>'price_basis', 'un'), coalesce((_r->>'price_estimated')::boolean, false), (_r->>'control_portion')::numeric);
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
END $$;

-- Server-side recount of what this import produced; verified only when it matches the device count.
CREATE OR REPLACE FUNCTION public.legacy_import_summary(_import_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH m AS (SELECT kind, legacy_id, new_id FROM public.legacy_id_map WHERE import_id = _import_id AND owner_id = auth.uid()),
  it AS (SELECT i.* FROM public.list_items i JOIN m ON m.kind = 'item' AND m.new_id = i.id WHERE i.deleted_at IS NULL)
  SELECT jsonb_build_object(
    'lists', (SELECT count(*) FROM m WHERE kind = 'list'),
    'items', (SELECT count(*) FROM it),
    'checked', (SELECT count(*) FROM it WHERE purchased),
    'priced', (SELECT count(*) FROM it WHERE price_cents IS NOT NULL),
    'price_cents_sum', (SELECT coalesce(sum(price_cents), 0) FROM it),
    'quantity_milli_sum', (SELECT coalesce(sum(round(quantity * 1000)), 0)::bigint FROM it),
    'purchases', (SELECT count(*) FROM m WHERE kind = 'purchase'),
    'price_history', (SELECT count(*) FROM public.legacy_price_history WHERE import_id = _import_id AND owner_id = auth.uid()),
    'sequence', (SELECT coalesce(jsonb_object_agg(l.legacy_id, coalesce((
        SELECT jsonb_agg(mi.legacy_id ORDER BY i.position, mi.legacy_id)
        FROM it i JOIN m mi ON mi.kind = 'item' AND mi.new_id = i.id WHERE i.list_id = l.new_id), '[]'::jsonb)), '{}'::jsonb)
      FROM m l WHERE l.kind = 'list')
  )
$$;

CREATE OR REPLACE FUNCTION public.finalize_legacy_import(_import_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _imp public.legacy_imports; _actual jsonb;
BEGIN
  SELECT * INTO _imp FROM public.legacy_imports WHERE id = _import_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = '42501'; END IF;
  _actual := public.legacy_import_summary(_import_id);
  IF _imp.state = 'started' AND _actual = _imp.expected THEN
    UPDATE public.legacy_imports SET state = 'verified', actual = _actual, updated_at = now() WHERE id = _import_id;
    RETURN jsonb_build_object('ok', true, 'state', 'verified', 'actual', _actual);
  END IF;
  UPDATE public.legacy_imports SET actual = _actual, updated_at = now() WHERE id = _import_id;
  RETURN jsonb_build_object('ok', _actual = _imp.expected, 'state', _imp.state, 'actual', _actual, 'expected', _imp.expected);
END $$;

-- verified -> active (switch), active -> rolled_back (return to legacy storage). Nothing is deleted.
CREATE OR REPLACE FUNCTION public.set_legacy_import_state(_import_id uuid, _state text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _cur text;
BEGIN
  SELECT state INTO _cur FROM public.legacy_imports WHERE id = _import_id AND owner_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'import_not_found' USING ERRCODE = '42501'; END IF;
  IF NOT ((_cur = 'verified' AND _state = 'active') OR (_cur = 'active' AND _state = 'rolled_back')
       OR (_cur = 'rolled_back' AND _state = 'active') OR _cur = _state) THEN
    RAISE EXCEPTION 'invalid_import_transition' USING ERRCODE = '22023';
  END IF;
  UPDATE public.legacy_imports SET state = _state, updated_at = now() WHERE id = _import_id;
END $$;

-- Private purchase record saved by the device after the switch, idempotent by record id.
CREATE OR REPLACE FUNCTION public.save_purchase_record(_id uuid, _list_id uuid, _purchased_on date, _snapshot jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.can_edit_list(_list_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.shared_purchases (id, list_id, completed_by, purchased_on, snapshot)
  VALUES (_id, _list_id, auth.uid(), _purchased_on, _snapshot)
  ON CONFLICT (id) DO NOTHING;
END $$;

REVOKE ALL ON FUNCTION public.legacy_map_id(uuid, text, text, boolean), public.begin_legacy_import(text, text, integer, jsonb),
  public.import_legacy_chunk(uuid, jsonb), public.legacy_import_summary(uuid), public.finalize_legacy_import(uuid),
  public.set_legacy_import_state(uuid, text), public.save_purchase_record(uuid, uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_legacy_import(text, text, integer, jsonb), public.import_legacy_chunk(uuid, jsonb),
  public.legacy_import_summary(uuid), public.finalize_legacy_import(uuid), public.set_legacy_import_state(uuid, text),
  public.save_purchase_record(uuid, uuid, date, jsonb) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.legacy_map_id(uuid, text, text, boolean) FROM authenticated;
