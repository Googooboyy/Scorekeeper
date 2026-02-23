-- Allow any playgroup member (not just owners) to create invite links

DROP POLICY IF EXISTS "invite_tokens_select" ON invite_tokens;
DROP POLICY IF EXISTS "invite_tokens_insert" ON invite_tokens;
DROP POLICY IF EXISTS "invite_tokens_delete" ON invite_tokens;

-- Any playgroup member can read their playgroup's tokens
CREATE POLICY "invite_tokens_select" ON invite_tokens
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid())
    );

-- Any playgroup member can insert tokens
CREATE POLICY "invite_tokens_insert" ON invite_tokens
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid())
    );

-- Any playgroup member can delete tokens
CREATE POLICY "invite_tokens_delete" ON invite_tokens
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = invite_tokens.playgroup_id AND pm.user_id = auth.uid())
    );

-- Create invite token: any playgroup member, returns token string
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
    IF NOT EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = p_playgroup_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'You must be a member of the playgroup to create invite links';
    END IF;

    v_token := encode(gen_random_bytes(24), 'base64url');
    INSERT INTO invite_tokens (playgroup_id, token, expires_at, max_uses, created_by)
    VALUES (p_playgroup_id, v_token, NOW() + (p_expires_hours || ' hours')::INTERVAL, p_max_uses, v_user_id);
    RETURN v_token;
END;
$$;
