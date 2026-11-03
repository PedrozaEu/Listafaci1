CREATE TABLE public.user_state_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_state_history TO authenticated;
GRANT ALL ON public.user_state_history TO service_role;
ALTER TABLE public.user_state_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own history" ON public.user_state_history
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX user_state_history_user_created_idx ON public.user_state_history (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.archive_user_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF OLD.data IS DISTINCT FROM NEW.data AND OLD.data <> '{}'::jsonb THEN
    INSERT INTO public.user_state_history (user_id, data, created_at)
    VALUES (OLD.user_id, OLD.data, OLD.updated_at);
    DELETE FROM public.user_state_history h
    WHERE h.user_id = OLD.user_id
      AND h.id NOT IN (
        SELECT id FROM public.user_state_history
        WHERE user_id = OLD.user_id
        ORDER BY created_at DESC
        LIMIT 30
      );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_state_archive
BEFORE UPDATE ON public.user_state
FOR EACH ROW EXECUTE FUNCTION public.archive_user_state();