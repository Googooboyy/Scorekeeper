-- Migration 034: announcements expires_at
-- Add optional expiry for global announcements. Null = no expiry.

ALTER TABLE announcements
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Existing announcements keep showing (null = no expiry)
COMMENT ON COLUMN announcements.expires_at IS 'Optional expiry. Null = show until deactivated.';
