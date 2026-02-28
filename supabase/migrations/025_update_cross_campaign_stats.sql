-- Migration 025: Add total_games_played to get_cross_campaign_player_stats
--
-- Enables games played and win % in player profile modal for linked players.
-- Must DROP first because return type (new column) cannot be changed with CREATE OR REPLACE.

DROP FUNCTION IF EXISTS get_cross_campaign_player_stats(UUID);

CREATE FUNCTION get_cross_campaign_player_stats(p_user_id UUID)
RETURNS TABLE (
    playgroup_id        UUID,
    playgroup_name      TEXT,
    player_id           UUID,
    player_name         TEXT,
    player_color        TEXT,
    player_image        TEXT,
    total_wins          BIGINT,
    total_games_played  BIGINT,
    top_game            TEXT,
    top_game_wins       BIGINT
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
        COUNT(DISTINCT e.id)          AS total_wins,
        GREATEST(COALESCE((
            SELECT COUNT(*) FROM entry_participants ep
            JOIN entries ee ON ee.id = ep.entry_id AND ee.playgroup_id = pg.id
            WHERE ep.player_id = pl.id
        ), 0), COUNT(DISTINCT e.id))  AS total_games_played,
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

-- Re-grant execute to anon (public share) — dropped with DROP FUNCTION
GRANT EXECUTE ON FUNCTION get_cross_campaign_player_stats(UUID) TO anon;
