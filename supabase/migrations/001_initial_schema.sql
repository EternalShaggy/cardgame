-- ═══════════════════════════════════════════════════════════════
-- Wholet – Initial Database Schema
-- ═══════════════════════════════════════════════════════════════

-- ─── profiles ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.profiles (
  id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text       NOT NULL,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

-- Auto-create profile on sign-up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ─── lobbies ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lobbies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  join_code       text        UNIQUE NOT NULL,
  host_user_id    uuid        NOT NULL REFERENCES public.profiles(id),
  max_players     int         NOT NULL CHECK (max_players BETWEEN 2 AND 10),
  is_public       boolean     NOT NULL DEFAULT true,
  allow_spectators boolean    NOT NULL DEFAULT true,
  ruleset_config  jsonb       NOT NULL,
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open','starting','in_match','closed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS lobbies_join_code_idx ON public.lobbies (join_code);
CREATE INDEX IF NOT EXISTS lobbies_browse_idx ON public.lobbies (is_public, status, created_at DESC);

ALTER TABLE public.lobbies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lobbies_select_public"
  ON public.lobbies FOR SELECT
  TO authenticated
  USING (is_public = true);

CREATE POLICY "lobbies_select_member"
  ON public.lobbies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lobby_members lm
      WHERE lm.lobby_id = lobbies.id AND lm.user_id = auth.uid()
    )
  );

CREATE POLICY "lobbies_insert_authenticated"
  ON public.lobbies FOR INSERT
  TO authenticated
  WITH CHECK (host_user_id = auth.uid());

CREATE POLICY "lobbies_update_host"
  ON public.lobbies FOR UPDATE
  TO authenticated
  USING (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

-- ─── lobby_members ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.lobby_members (
  lobby_id     uuid        REFERENCES public.lobbies(id) ON DELETE CASCADE,
  user_id      uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('host','player','spectator')),
  is_ready     boolean     NOT NULL DEFAULT false,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, user_id)
);

CREATE INDEX IF NOT EXISTS lobby_members_lobby_idx ON public.lobby_members(lobby_id);
CREATE INDEX IF NOT EXISTS lobby_members_user_idx  ON public.lobby_members(user_id);
CREATE INDEX IF NOT EXISTS lobby_members_role_idx  ON public.lobby_members(lobby_id, role);

ALTER TABLE public.lobby_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lobby_members_select_member"
  ON public.lobby_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.lobby_members lm2
      WHERE lm2.lobby_id = lobby_members.lobby_id AND lm2.user_id = auth.uid()
    )
  );

CREATE POLICY "lobby_members_insert_self"
  ON public.lobby_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "lobby_members_update_own"
  ON public.lobby_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "lobby_members_delete_host_or_self"
  ON public.lobby_members FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.lobbies l
      WHERE l.id = lobby_members.lobby_id AND l.host_user_id = auth.uid()
    )
  );

-- ─── RPC: join_lobby (atomic capacity + ban check) ───────────

CREATE OR REPLACE FUNCTION public.join_lobby(
  p_lobby_id uuid,
  p_role     text DEFAULT 'player'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lobby   public.lobbies;
  v_count   int;
BEGIN
  -- Lock the lobby row
  SELECT * INTO v_lobby FROM public.lobbies WHERE id = p_lobby_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lobby_not_found');
  END IF;

  IF v_lobby.status NOT IN ('open') THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lobby_not_open');
  END IF;

  -- Count current players (not spectators)
  SELECT COUNT(*) INTO v_count
  FROM public.lobby_members
  WHERE lobby_id = p_lobby_id AND role IN ('host','player');

  IF p_role = 'player' AND v_count >= v_lobby.max_players THEN
    RETURN jsonb_build_object('success', false, 'reason', 'lobby_full');
  END IF;

  IF NOT v_lobby.allow_spectators AND p_role = 'spectator' THEN
    RETURN jsonb_build_object('success', false, 'reason', 'spectators_not_allowed');
  END IF;

  -- Insert (idempotent)
  INSERT INTO public.lobby_members (lobby_id, user_id, role)
  VALUES (p_lobby_id, auth.uid(), p_role)
  ON CONFLICT (lobby_id, user_id) DO UPDATE SET role = p_role, last_seen_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ─── matches ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.matches (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id              uuid        REFERENCES public.lobbies(id),
  ruleset_config        jsonb       NOT NULL,
  status                text        NOT NULL DEFAULT 'active'
                                    CHECK (status IN ('active','ended','abandoned')),
  version               bigint      NOT NULL DEFAULT 0,
  current_turn_user_id  uuid        REFERENCES public.profiles(id),
  direction             int         NOT NULL DEFAULT 1 CHECK (direction IN (1, -1)),
  host_instance_id      text,
  host_last_heartbeat   timestamptz,
  started_at            timestamptz DEFAULT now(),
  ended_at              timestamptz
);

CREATE INDEX IF NOT EXISTS matches_status_idx  ON public.matches (status, started_at DESC);
CREATE INDEX IF NOT EXISTS matches_lobby_idx   ON public.matches (lobby_id);

ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "matches_select_participant"
  ON public.matches FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = matches.id AND mp.user_id = auth.uid()
    )
  );

-- ─── match_players ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.match_players (
  match_id        uuid        REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id         uuid        REFERENCES public.profiles(id) ON DELETE CASCADE,
  seat            int         NOT NULL,
  role            text        NOT NULL CHECK (role IN ('player','spectator')),
  joined_at       timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  PRIMARY KEY (match_id, user_id),
  UNIQUE (match_id, seat)
);

CREATE INDEX IF NOT EXISTS match_players_match_idx ON public.match_players(match_id);
CREATE INDEX IF NOT EXISTS match_players_user_idx  ON public.match_players(user_id);

ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_players_select_participant"
  ON public.match_players FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.match_players mp2
      WHERE mp2.match_id = match_players.match_id AND mp2.user_id = auth.uid()
    )
  );

-- ─── match_snapshots ─────────────────────────────────────────
-- Server-written only; clients read via WebSocket, not direct DB

CREATE TABLE IF NOT EXISTS public.match_snapshots (
  match_id     uuid    REFERENCES public.matches(id) ON DELETE CASCADE,
  version      bigint  NOT NULL,
  public_state jsonb   NOT NULL,
  private_state jsonb  NOT NULL,   -- hands + draw pile (server-only)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, version)
);

CREATE INDEX IF NOT EXISTS match_snapshots_latest_idx
  ON public.match_snapshots (match_id, version DESC);

ALTER TABLE public.match_snapshots ENABLE ROW LEVEL SECURITY;

-- Clients cannot read private_state; backend uses service role key
CREATE POLICY "match_snapshots_no_client_select"
  ON public.match_snapshots FOR SELECT
  TO authenticated
  USING (false);  -- only service role can read

-- ─── match_hands_private ────────────────────────────────────
-- Per-player hand rows; player can read their own via supabase-js

CREATE TABLE IF NOT EXISTS public.match_hands_private (
  match_id   uuid  REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id    uuid  REFERENCES public.profiles(id) ON DELETE CASCADE,
  cards      jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

ALTER TABLE public.match_hands_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY "match_hands_select_own"
  ON public.match_hands_private FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ─── chat_messages ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id         bigint  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scope      text    NOT NULL CHECK (scope IN ('lobby','match')),
  lobby_id   uuid    REFERENCES public.lobbies(id),
  match_id   uuid    REFERENCES public.matches(id),
  user_id    uuid    REFERENCES public.profiles(id),
  message    text    NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_lobby_idx ON public.chat_messages(lobby_id, created_at);
CREATE INDEX IF NOT EXISTS chat_match_idx ON public.chat_messages(match_id, created_at);

ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_select_lobby_member"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (
    (scope = 'lobby' AND EXISTS (
      SELECT 1 FROM public.lobby_members lm
      WHERE lm.lobby_id = chat_messages.lobby_id AND lm.user_id = auth.uid()
    ))
    OR
    (scope = 'match' AND EXISTS (
      SELECT 1 FROM public.match_players mp
      WHERE mp.match_id = chat_messages.match_id AND mp.user_id = auth.uid()
    ))
  );

CREATE POLICY "chat_insert_lobby_member"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (
      (scope = 'lobby' AND EXISTS (
        SELECT 1 FROM public.lobby_members lm
        WHERE lm.lobby_id = chat_messages.lobby_id AND lm.user_id = auth.uid()
      ))
      OR
      (scope = 'match' AND EXISTS (
        SELECT 1 FROM public.match_players mp
        WHERE mp.match_id = chat_messages.match_id AND mp.user_id = auth.uid()
      ))
    )
  );

-- ─── matchmaking_queue ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.matchmaking_queue (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ruleset_config jsonb       NOT NULL,
  region         text        NOT NULL DEFAULT 'global',
  enqueued_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)  -- one queue entry per user
);

ALTER TABLE public.matchmaking_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "queue_select_own"
  ON public.matchmaking_queue FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "queue_insert_own"
  ON public.matchmaking_queue FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "queue_delete_own"
  ON public.matchmaking_queue FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ─── Realtime authorization ─────────────────────────────────
-- Allow lobby members to use Supabase Realtime Broadcast/Presence
-- Topic convention: 'lobby:<lobbyId>'

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "realtime_lobby_broadcast_select"
  ON realtime.messages FOR SELECT
  TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.lobby_members lm
      JOIN public.lobbies l ON l.id = lm.lobby_id
      WHERE lm.user_id = auth.uid()
        AND ('lobby:' || l.id::text) = realtime.topic()
    )
  );

CREATE POLICY "realtime_lobby_broadcast_insert"
  ON realtime.messages FOR INSERT
  TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND EXISTS (
      SELECT 1
      FROM public.lobby_members lm
      JOIN public.lobbies l ON l.id = lm.lobby_id
      WHERE lm.user_id = auth.uid()
        AND ('lobby:' || l.id::text) = realtime.topic()
    )
  );
