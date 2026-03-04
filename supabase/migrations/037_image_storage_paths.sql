-- Migration 037: Add storage path columns for images
-- Introduces separate columns to hold Supabase Storage paths for
-- game images, player avatars, and preset avatars.
-- Existing image/image_url columns remain for backwards compatibility
-- and will be backfilled and deprecated in later steps.

-- ============================================================
-- 1. Game metadata: storage path
-- ============================================================
ALTER TABLE game_metadata
ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

-- ============================================================
-- 2. Player metadata: storage path
-- ============================================================
ALTER TABLE player_metadata
ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

-- ============================================================
-- 3. Preset avatars: storage path
-- ============================================================
ALTER TABLE preset_avatars
ADD COLUMN IF NOT EXISTS image_storage_path TEXT;

