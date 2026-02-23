-- Migration 012: Link player records to auth users
-- Adds user_id to players table so cross-campaign stats can be aggregated per person

-- 1. Add the column (nullable — existing players and non-account players remain unlinked)
ALTER TABLE players
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Index for lookups by user
CREATE INDEX IF NOT EXISTS idx_players_user_id ON players(user_id);

-- 3. Extra RLS: let a user SELECT their own player records from any playgroup
--    (The base policy already allows members to read their own playgroup's players,
--     but this extends read access so a user can see their records in campaigns
--     they share with other viewers of this profile.)
CREATE POLICY "players_select_own" ON players
    FOR SELECT USING (user_id = auth.uid());

-- 4. Allow a logged-in member to "claim" an unclaimed player in their playgroup:
--    UPDATE sets user_id = auth.uid() only when user_id IS NULL and they are a member.
--    The existing players_update policy covers owners; this handles the self-claiming case.
CREATE POLICY "players_claim_self" ON players
    FOR UPDATE USING (
        user_id IS NULL
        AND is_playgroup_member(playgroup_id, auth.uid())
    )
    WITH CHECK (
        user_id = auth.uid()
    );

-- 5. DB helper function: get cross-campaign player stats for a given user
--    Returns one row per playgroup the player has records in, with aggregate counts.
--    Only returns playgroups that the calling user is ALSO a member of (RLS enforced).
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
        -- Caller must be a member of the playgroup to see its data
        AND is_playgroup_member(pl.playgroup_id, auth.uid())
    GROUP BY pg.id, pg.name, pl.id, pl.name, pm.color, pm.image
    ORDER BY total_wins DESC;
$$;

-- 6. Separate function to get per-game breakdown for a user across all shared campaigns
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
        g.name                AS game_name,
        COUNT(e.id)           AS total_wins,
        COUNT(DISTINCT e.playgroup_id) AS campaigns
    FROM entries e
    JOIN games g ON g.id = e.game_id
    JOIN players pl ON pl.id = e.player_id
    WHERE
        pl.user_id = p_user_id
        AND is_playgroup_member(e.playgroup_id, auth.uid())
    GROUP BY g.name
    ORDER BY total_wins DESC;
$$;
