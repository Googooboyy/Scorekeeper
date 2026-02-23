-- Migration 013: Add audit trail columns to entries
-- Tracks who created/last-edited each win record and when

ALTER TABLE entries
    ADD COLUMN IF NOT EXISTS created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS created_by_name TEXT,
    ADD COLUMN IF NOT EXISTS updated_by_name TEXT;

-- Index so history can be sorted by created_at efficiently
CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at DESC);
