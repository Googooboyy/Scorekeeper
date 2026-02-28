-- Migration 024: Backfill entry_participants for historical entries
--
-- For each existing entry, add the winner as the sole participant.
-- Ensures legacy entries have gamesPlayed = wins until users edit and add others.
-- Idempotent: ON CONFLICT DO NOTHING.

INSERT INTO entry_participants (entry_id, player_id)
SELECT id, player_id FROM entries
ON CONFLICT (entry_id, player_id) DO NOTHING;
