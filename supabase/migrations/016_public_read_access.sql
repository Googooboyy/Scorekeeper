-- Migration 016: Allow public (unauthenticated) read access to campaign data
--
-- Campaign UUIDs are 128-bit random values — unguessable without being told the ID.
-- This lets anyone with a share link view a leaderboard without signing in.
-- Write operations (INSERT / UPDATE / DELETE) remain fully auth-gated.

CREATE POLICY "playgroups_anon_select" ON playgroups
    FOR SELECT TO anon USING (true);

CREATE POLICY "games_anon_select" ON games
    FOR SELECT TO anon USING (true);

CREATE POLICY "players_anon_select" ON players
    FOR SELECT TO anon USING (true);

CREATE POLICY "entries_anon_select" ON entries
    FOR SELECT TO anon USING (true);

CREATE POLICY "game_metadata_anon_select" ON game_metadata
    FOR SELECT TO anon USING (true);

CREATE POLICY "player_metadata_anon_select" ON player_metadata
    FOR SELECT TO anon USING (true);
