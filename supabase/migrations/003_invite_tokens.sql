-- Invite tokens for playgroup sharing
-- Run after 001 and 002

CREATE TABLE invite_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playgroup_id UUID NOT NULL REFERENCES playgroups(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INT NOT NULL DEFAULT 1,
    use_count INT NOT NULL DEFAULT 0,
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invite_tokens_token ON invite_tokens(token);
CREATE INDEX idx_invite_tokens_playgroup ON invite_tokens(playgroup_id);

ALTER TABLE invite_tokens ENABLE ROW LEVEL SECURITY;

-- Only playgroup owners can read their playgroup's tokens
CREATE POLICY "invite_tokens_select" ON invite_tokens
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid() AND pm.role = 'owner')
    );

-- Only playgroup owners can insert tokens
CREATE POLICY "invite_tokens_insert" ON invite_tokens
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid() AND pm.role = 'owner')
    );

-- Only playgroup owners can delete tokens
CREATE POLICY "invite_tokens_delete" ON invite_tokens
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid() AND pm.role = 'owner')
    );

-- Create invite token: only owners, returns token string
CREATE OR REPLACE FUNCTION create_invite_token(p_playgroup_id UUID, p_expires_hours INT DEFAULT 168, p_max_uses INT DEFAULT 10)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_token TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = p_playgroup_id AND user_id = v_user_id AND role = 'owner') THEN
        RAISE EXCEPTION 'Only playgroup owners can create invite links';
    END IF;

    v_token := encode(gen_random_bytes(24), 'base64url');
    INSERT INTO invite_tokens (playgroup_id, token, expires_at, max_uses, created_by)
    VALUES (p_playgroup_id, v_token, NOW() + (p_expires_hours || ' hours')::INTERVAL, p_max_uses, v_user_id);
    RETURN v_token;
END;
$$;

-- Redeem invite token: add current user to playgroup, return playgroup info
CREATE OR REPLACE FUNCTION redeem_invite_token(p_token TEXT)
RETURNS TABLE(playgroup_id UUID, playgroup_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_rec RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT it.id, it.playgroup_id, it.max_uses, it.use_count, pg.name
    INTO v_rec
    FROM invite_tokens it
    JOIN playgroups pg ON pg.id = it.playgroup_id
    WHERE it.token = p_token AND it.expires_at > NOW();

    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'Invalid or expired invite link';
    END IF;
    IF v_rec.use_count >= v_rec.max_uses THEN
        RAISE EXCEPTION 'This invite link has reached its maximum uses';
    END IF;
    IF EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = v_rec.playgroup_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'You are already a member of this playgroup';
    END IF;

    UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = v_rec.id;
    INSERT INTO playgroup_members (playgroup_id, user_id, role) VALUES (v_rec.playgroup_id, v_user_id, 'member');

    playgroup_id := v_rec.playgroup_id;
    playgroup_name := v_rec.name;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION create_invite_token(UUID, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION redeem_invite_token(TEXT) TO authenticated;
