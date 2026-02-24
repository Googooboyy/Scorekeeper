-- Migration 020: Add favourite_quote to user_profile (leaderboard quote preference)
ALTER TABLE user_profile
    ADD COLUMN IF NOT EXISTS favourite_quote TEXT;
