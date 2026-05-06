
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile select" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Workflows
CREATE TABLE public.workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'draft',
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  app_targets TEXT[] NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  run_count INT NOT NULL DEFAULT 0,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workflows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workflows select" ON public.workflows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own workflows insert" ON public.workflows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own workflows update" ON public.workflows FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own workflows delete" ON public.workflows FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX workflows_user_idx ON public.workflows(user_id, updated_at DESC);

-- Runs
CREATE TABLE public.workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES public.workflows ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  mode TEXT NOT NULL DEFAULT 'auto',
  inputs JSONB NOT NULL DEFAULT '{}'::jsonb,
  logs JSONB NOT NULL DEFAULT '[]'::jsonb,
  current_step INT NOT NULL DEFAULT 0,
  total_steps INT NOT NULL DEFAULT 0,
  error TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs select" ON public.workflow_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own runs insert" ON public.workflow_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own runs update" ON public.workflow_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own runs delete" ON public.workflow_runs FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX runs_workflow_idx ON public.workflow_runs(workflow_id, started_at DESC);

-- Chat messages
CREATE TABLE public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  conversation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own chat select" ON public.chat_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own chat insert" ON public.chat_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own chat delete" ON public.chat_messages FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX chat_user_idx ON public.chat_messages(user_id, conversation_id, created_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER workflows_touch BEFORE UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email,'@',1)));
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
