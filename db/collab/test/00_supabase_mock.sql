-- Minimal stand-in for the managed platform, used only in the local test database.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
-- legacy table as it exists in the project
CREATE TABLE public.profiles (id uuid PRIMARY KEY, display_name text, avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.profiles (id, display_name) VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Ana Dona'),
  ('00000000-0000-0000-0000-00000000000b', 'Beto'),
  ('00000000-0000-0000-0000-00000000000c', 'Carla'),
  ('00000000-0000-0000-0000-00000000000d', 'Davi');
