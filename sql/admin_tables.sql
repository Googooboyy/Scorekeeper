-- ============================================================
-- Admin Dashboard tables — run in Supabase SQL Editor
-- ============================================================

-- 1. app_config: key/value store for live settings
CREATE TABLE IF NOT EXISTS app_config (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    updated_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read app_config"
    ON app_config FOR SELECT USING (true);

CREATE POLICY "Service role can manage app_config"
    ON app_config FOR ALL USING (auth.role() = 'service_role');

-- Seed defaults
INSERT INTO app_config (key, value) VALUES
    ('max_campaigns_per_user', '4'),
    ('max_meeples_per_campaign', '8'),
    ('leaderboard_quotes', '["Roll with it.","Winning is just the beginning.","May the dice be ever in your favor.","One more game? Always.","Board games > boring games."]')
ON CONFLICT (key) DO NOTHING;


-- 2. announcements: broadcast banner
CREATE TABLE IF NOT EXISTS announcements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message     TEXT NOT NULL,
    active      BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT now(),
    created_by  UUID REFERENCES auth.users(id)
);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read active announcements"
    ON announcements FOR SELECT USING (true);

CREATE POLICY "Service role can manage announcements"
    ON announcements FOR ALL USING (auth.role() = 'service_role');


-- 3. global_games: canonical game registry (BGG-sourced)
CREATE TABLE IF NOT EXISTS global_games (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bgg_id          INTEGER UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    year_published  INTEGER,
    thumbnail_url   TEXT,
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE global_games ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read global_games"
    ON global_games FOR SELECT USING (true);

CREATE POLICY "Service role can manage global_games"
    ON global_games FOR ALL USING (auth.role() = 'service_role');


-- 4. Add global_game_id FK to existing games table
ALTER TABLE games
    ADD COLUMN IF NOT EXISTS global_game_id UUID REFERENCES global_games(id);
