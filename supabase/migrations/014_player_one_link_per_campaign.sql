-- Migration 014: Enforce one player link per campaign + allow self-unlinking

-- 1. Unique partial index: a user can only be linked to ONE player per campaign.
--    NULL values are excluded automatically so unlinked players don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS idx_players_unique_user_per_campaign
    ON players(playgroup_id, user_id)
    WHERE user_id IS NOT NULL;

-- 2. Allow a user to unlink their own player record (set user_id back to NULL).
--    USING: only the user who is currently linked can trigger this update.
--    WITH CHECK: they must be setting it back to NULL (no re-pointing to another user).
CREATE POLICY "players_unlink_self" ON players
    FOR UPDATE USING (
        user_id = auth.uid()
    )
    WITH CHECK (
        user_id IS NULL
    );
