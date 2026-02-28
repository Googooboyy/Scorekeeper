-- Migration 023: Create entry_participants table for games-played tracking
--
-- Tracks which meeples participated in each game (not just the winner).
-- Used for: games played per player, win %, leaderboard tie-breakers.
-- MVP: meeples only; guests deferred.
-- Idempotent: safe to re-run if table already exists.

CREATE TABLE IF NOT EXISTS entry_participants (
    entry_id  UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (entry_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_participants_player ON entry_participants(player_id);

ALTER TABLE entry_participants ENABLE ROW LEVEL SECURITY;

-- Members can CRUD via playgroup membership through the entry
DROP POLICY IF EXISTS "entry_participants_select" ON entry_participants;
CREATE POLICY "entry_participants_select" ON entry_participants
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND is_playgroup_member(e.playgroup_id, auth.uid()))
    );
DROP POLICY IF EXISTS "entry_participants_insert" ON entry_participants;
CREATE POLICY "entry_participants_insert" ON entry_participants
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND is_playgroup_member(e.playgroup_id, auth.uid()))
    );
DROP POLICY IF EXISTS "entry_participants_update" ON entry_participants;
CREATE POLICY "entry_participants_update" ON entry_participants
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND is_playgroup_member(e.playgroup_id, auth.uid()))
    );
DROP POLICY IF EXISTS "entry_participants_delete" ON entry_participants;
CREATE POLICY "entry_participants_delete" ON entry_participants
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM entries e WHERE e.id = entry_id AND is_playgroup_member(e.playgroup_id, auth.uid()))
    );

-- Anon read for public share (consistent with entries)
DROP POLICY IF EXISTS "entry_participants_anon_select" ON entry_participants;
CREATE POLICY "entry_participants_anon_select" ON entry_participants
    FOR SELECT TO anon USING (true);
