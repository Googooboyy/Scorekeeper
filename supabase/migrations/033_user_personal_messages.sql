-- Migration 033: user_personal_messages
-- Admins can send personal messages to users. Messages appear above the nav bar when logged in.
-- Persist for a configurable number of days (stored as expires_at).

CREATE TABLE IF NOT EXISTS user_personal_messages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL,
    created_by  UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_personal_messages_user_expires
    ON user_personal_messages (user_id, expires_at);

ALTER TABLE user_personal_messages ENABLE ROW LEVEL SECURITY;

-- Users can read only their own messages
CREATE POLICY "Users can read own personal messages"
    ON user_personal_messages FOR SELECT
    USING (auth.uid() = user_id);

-- Only service_role (admin) can insert/update/delete
CREATE POLICY "Service role manages personal messages"
    ON user_personal_messages FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
