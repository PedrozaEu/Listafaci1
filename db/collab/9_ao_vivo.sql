-- Bloco 9: live collaboration on the existing shared list.
-- Realtime only notifies persisted, RLS-authorized changes (Postgres Changes); writes stay in the RPCs and the outbox.

CREATE OR REPLACE FUNCTION public.collab_schema_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '9.1' $$;

-- Member colors: readable with white initials in both themes (WCAG AA >= 4.5:1), assigned once per list.
CREATE OR REPLACE FUNCTION public.collab_palette()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY['#1D4ED8','#0F766E','#B45309','#BE185D','#6D28D9','#15803D','#B91C1C','#0E7490']
$$;

-- First palette color not used yet in the list; stored on the member row, never derived from connection order.
CREATE OR REPLACE FUNCTION public.list_members_color()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _c text;
BEGIN
  SELECT c INTO _c FROM unnest(public.collab_palette()) WITH ORDINALITY AS p(c, n)
  WHERE NOT EXISTS (SELECT 1 FROM public.list_members m WHERE m.list_id = NEW.list_id AND m.color = p.c)
  ORDER BY n LIMIT 1;
  NEW.color := coalesce(_c, (public.collab_palette())[1 + abs(hashtext(NEW.user_id::text)) % 8]);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS list_members_color ON public.list_members;
CREATE TRIGGER list_members_color BEFORE INSERT ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION public.list_members_color();

-- Color changes only through the trigger above.
CREATE OR REPLACE FUNCTION public.list_members_color_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.color IS DISTINCT FROM OLD.color AND coalesce(current_setting('app.collab_rpc', true), '') <> '1' THEN
    NEW.color := OLD.color;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS list_members_color_lock ON public.list_members;
CREATE TRIGGER list_members_color_lock BEFORE UPDATE ON public.list_members
  FOR EACH ROW EXECUTE FUNCTION public.list_members_color_lock();

-- Backfill: existing members get distinct readable colors per list, by join order.
SELECT set_config('app.collab_rpc', '1', true);
UPDATE public.list_members m SET color = (public.collab_palette())[1 + ((r.n - 1) % 8)]
FROM (SELECT list_id, user_id, row_number() OVER (PARTITION BY list_id ORDER BY created_at, user_id) AS n
      FROM public.list_members) r
WHERE m.list_id = r.list_id AND m.user_id = r.user_id;
SELECT set_config('app.collab_rpc', '', true);

-- Marking: explicit state (never a toggle). The first valid operation over the expected version wins;
-- a later one that asks for the state already in place changes nothing and reports who did it.
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

REVOKE ALL ON FUNCTION public.list_members_color(), public.list_members_color_lock() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_item_marked(uuid, uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_item_marked(uuid, uuid, integer, boolean) TO authenticated;

-- Realtime: change notifications for the three tables a shared list is made of (RLS decides who receives them).
DO $$
DECLARE _t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH _t IN ARRAY ARRAY['list_items', 'list_members', 'shared_lists'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = _t) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', _t);
      END IF;
    END LOOP;
  END IF;
END $$;
