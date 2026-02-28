-- Migration 026: Add get_cross_campaign_games_played RPC for per-game play counts
--
-- Returns games played per game (from entry_participants) for linked players
-- across all campaigns. Enables consistent "Games Played" section in profile modal
-- (per-game breakdown) for both linked and unlinked views.

CREATE OR REPLACE FUNCTION get_cross_campaign_games_played(p_user_id UUID)
RETURNS TABLE (
    game_name           TEXT,
    total_games_played  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        g.name                         AS game_name,
        COUNT(ep.entry_id)             AS total_games_played
    FROM entry_participants ep
    JOIN entries e ON e.id = ep.entry_id
    JOIN games g ON g.id = e.game_id
    JOIN players pl ON pl.id = ep.player_id
    WHERE
        pl.user_id = p_user_id
        AND (
            auth.uid() IS NULL
            OR is_playgroup_member(e.playgroup_id, auth.uid())
        )
    GROUP BY g.name
    ORDER BY total_games_played DESC;
$$;

GRANT EXECUTE ON FUNCTION get_cross_campaign_games_played(UUID) TO anon;
