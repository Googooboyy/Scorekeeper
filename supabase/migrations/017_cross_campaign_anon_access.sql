-- Migration 017: Allow anon (public share) access to cross-campaign profile functions
--
-- The functions from migration 012 guard rows with:
--   AND is_playgroup_member(playgroup_id, auth.uid())
-- For unauthenticated visitors auth.uid() is NULL, so every row is filtered out,
-- producing 0 wins / 0 campaigns on a shared leaderboard profile.
--
-- Fix: replace the membership guard with:
--   (auth.uid() IS NULL OR is_playgroup_member(..., auth.uid()))
-- Anon viewers can see a linked player's full cross-campaign history.
-- This is safe because campaign UUIDs are unguessable and all table data
-- is already publicly readable (migration 016).

CREATE OR REPLACE FUNCTION get_cross_campaign_player_stats(p_user_id UUID)
RETURNS TABLE (
    playgroup_id   UUID,
    playgroup_name TEXT,
    player_id      UUID,
    player_name    TEXT,
    player_color   TEXT,
    player_image   TEXT,
    total_wins     BIGINT,
    top_game       TEXT,
    top_game_wins  BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        pg.id                         AS playgroup_id,
        pg.name                       AS playgroup_name,
        pl.id                         AS player_id,
        pl.name                       AS player_name,
        pm.color                      AS player_color,
        pm.image                      AS player_image,
        COUNT(e.id)                   AS total_wins,
        (
            SELECT g2.name
            FROM entries e2
            JOIN games g2 ON g2.id = e2.game_id
            WHERE e2.player_id = pl.id
            GROUP BY g2.name
            ORDER BY COUNT(*) DESC
            LIMIT 1
        )                             AS top_game,
        (
            SELECT COUNT(*)
            FROM entries e2
            JOIN games g2 ON g2.id = e2.game_id
            WHERE e2.player_id = pl.id
            GROUP BY g2.name
            ORDER BY COUNT(*) DESC
            LIMIT 1
        )                             AS top_game_wins
    FROM players pl
    JOIN playgroups pg ON pg.id = pl.playgroup_id
    LEFT JOIN entries e ON e.player_id = pl.id
    LEFT JOIN player_metadata pm ON pm.player_id = pl.id
    WHERE
        pl.user_id = p_user_id
        AND (
            auth.uid() IS NULL
            OR is_playgroup_member(pl.playgroup_id, auth.uid())
        )
    GROUP BY pg.id, pg.name, pl.id, pl.name, pm.color, pm.image
    ORDER BY total_wins DESC;
$$;

CREATE OR REPLACE FUNCTION get_cross_campaign_game_breakdown(p_user_id UUID)
RETURNS TABLE (
    game_name   TEXT,
    total_wins  BIGINT,
    campaigns   BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    SELECT
        g.name                         AS game_name,
        COUNT(e.id)                    AS total_wins,
        COUNT(DISTINCT e.playgroup_id) AS campaigns
    FROM entries e
    JOIN games g ON g.id = e.game_id
    JOIN players pl ON pl.id = e.player_id
    WHERE
        pl.user_id = p_user_id
        AND (
            auth.uid() IS NULL
            OR is_playgroup_member(e.playgroup_id, auth.uid())
        )
    GROUP BY g.name
    ORDER BY total_wins DESC;
$$;

-- Grant execute to unauthenticated (anon) callers
GRANT EXECUTE ON FUNCTION get_cross_campaign_player_stats(UUID) TO anon;
GRANT EXECUTE ON FUNCTION get_cross_campaign_game_breakdown(UUID) TO anon;
