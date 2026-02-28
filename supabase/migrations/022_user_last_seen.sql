-- Migration 022: User last seen (admin page visits)
-- Tracks when admins last loaded the admin page (throttled to once per day per user).
-- Used for pruning inactive users.

CREATE TABLE user_last_seen (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_last_seen ENABLE ROW LEVEL SECURITY;

-- Users can upsert their own row (for update_last_seen RPC)
CREATE POLICY "user_last_seen_insert_own" ON user_last_seen
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_last_seen_update_own" ON user_last_seen
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Service role can read all (admin dashboard)
CREATE POLICY "user_last_seen_select_service_role" ON user_last_seen
    FOR SELECT USING (auth.role() = 'service_role');

-- Upsert last_seen_at for the current user. Only updates if last_seen_at is NULL
-- or older than 24 hours (throttle: once per day).
CREATE OR REPLACE FUNCTION update_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_last_seen (user_id, last_seen_at)
    VALUES (auth.uid(), NOW())
    ON CONFLICT (user_id) DO UPDATE
    SET last_seen_at = NOW()
    WHERE user_last_seen.last_seen_at IS NULL
       OR user_last_seen.last_seen_at < NOW() - interval '1 day';
END;
$$;
