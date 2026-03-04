-- ═══════════════════════════════════════════════════════════════
-- Wholet – Profile Statistics Columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS games_played integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS games_won    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_score  integer NOT NULL DEFAULT 0;

-- Function to increment stats after a match ends
-- Called by application server using service-role key
CREATE OR REPLACE FUNCTION public.record_match_result(
  p_winner_id   uuid,
  p_player_ids  uuid[],
  p_scores      jsonb    -- { "user_id": score_delta, ... }
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid;
  v_score int;
BEGIN
  -- Increment games_played for all participants
  UPDATE public.profiles
  SET games_played = games_played + 1
  WHERE id = ANY(p_player_ids);

  -- Increment games_won for winner
  UPDATE public.profiles
  SET games_won = games_won + 1
  WHERE id = p_winner_id;

  -- Add round scores
  FOR v_uid, v_score IN SELECT key::uuid, value::int FROM jsonb_each_text(p_scores)
  LOOP
    UPDATE public.profiles
    SET total_score = total_score + v_score
    WHERE id = v_uid;
  END LOOP;
END;
$$;
