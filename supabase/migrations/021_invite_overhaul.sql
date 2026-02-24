-- Invite overhaul: one token per campaign, no expiry/limits, same link for guest view and join.
-- Removes share as separate concept; invite link serves both. Old tokens are removed.

-- 1. Remove all existing invite tokens (full migration)
DELETE FROM invite_tokens;

-- 2. Drop expiry/limit columns and enforce one token per campaign
ALTER TABLE invite_tokens
    DROP COLUMN IF EXISTS expires_at,
    DROP COLUMN IF EXISTS max_uses;

-- use_count kept for admin display (optional); default 0
ALTER TABLE invite_tokens
    ALTER COLUMN use_count SET DEFAULT 0;

-- One token per campaign
ALTER TABLE invite_tokens
    ADD CONSTRAINT invite_tokens_playgroup_id_key UNIQUE (playgroup_id);

-- 3. Get-or-create invite token (members only). Returns token string.
CREATE OR REPLACE FUNCTION create_invite_token(p_playgroup_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_token TEXT;
    v_existing TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = p_playgroup_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'You must be a member of the playgroup to get the invite link';
    END IF;

    SELECT token INTO v_existing FROM invite_tokens WHERE playgroup_id = p_playgroup_id LIMIT 1;
    IF v_existing IS NOT NULL THEN
        RETURN v_existing;
    END IF;

    v_token := md5(random()::text || clock_timestamp()::text || random()::text);
    INSERT INTO invite_tokens (playgroup_id, token, created_by)
    VALUES (p_playgroup_id, v_token, v_user_id)
    ON CONFLICT (playgroup_id) DO NOTHING;

    SELECT it.token INTO v_token FROM invite_tokens it WHERE it.playgroup_id = p_playgroup_id LIMIT 1;
    RETURN v_token;
END;
$$;

-- 4. Resolve invite token to campaign (for guest view). Callable by anon.
CREATE OR REPLACE FUNCTION resolve_invite_token(p_token TEXT)
RETURNS TABLE(playgroup_id UUID, playgroup_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT it.playgroup_id, pg.name
    FROM invite_tokens it
    JOIN playgroups pg ON pg.id = it.playgroup_id
    WHERE it.token = p_token;
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_invite_token(TEXT) TO anon;
GRANT EXECUTE ON FUNCTION resolve_invite_token(TEXT) TO authenticated;

-- 5. Redeem invite token: add current user to playgroup. No expiry/max_uses checks.
CREATE OR REPLACE FUNCTION redeem_invite_token(p_token TEXT)
RETURNS TABLE(playgroup_id UUID, playgroup_name TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_rec RECORD;
    v_already_member BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    SELECT it.id, it.playgroup_id, pg.name
    INTO v_rec
    FROM invite_tokens it
    JOIN playgroups pg ON pg.id = it.playgroup_id
    WHERE it.token = p_token;

    IF v_rec IS NULL THEN
        RAISE EXCEPTION 'Invalid invite link';
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM playgroup_members pm
        WHERE pm.playgroup_id = v_rec.playgroup_id AND pm.user_id = v_user_id
    ) INTO v_already_member;

    IF NOT v_already_member THEN
        UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = v_rec.id;
        INSERT INTO playgroup_members (playgroup_id, user_id, role)
        VALUES (v_rec.playgroup_id, v_user_id, 'member')
        ON CONFLICT ON CONSTRAINT playgroup_members_pkey DO NOTHING;
    END IF;

    playgroup_id := v_rec.playgroup_id;
    playgroup_name := v_rec.name;
    RETURN NEXT;
END;
$$;

-- 6. Replace invite token (admin): deprecate old, create new. Used by admin only (service_role).
CREATE OR REPLACE FUNCTION replace_invite_token(p_playgroup_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_token TEXT;
BEGIN
    DELETE FROM invite_tokens WHERE invite_tokens.playgroup_id = p_playgroup_id;
    v_token := md5(random()::text || clock_timestamp()::text || random()::text);
    INSERT INTO invite_tokens (playgroup_id, token, created_by)
    VALUES (p_playgroup_id, v_token, NULL);
    RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION create_invite_token(UUID) TO authenticated;
-- redeem already granted in earlier migrations; ensure it's there
GRANT EXECUTE ON FUNCTION redeem_invite_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_invite_token(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION replace_invite_token(UUID) TO service_role;

-- 7. Create playgroup: also create the invite token so it's always available
CREATE OR REPLACE FUNCTION create_playgroup_with_owner(p_name TEXT)
RETURNS playgroups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_playgroup playgroups;
    v_name_trimmed TEXT;
    v_token TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_name_trimmed := TRIM(p_name);
    IF v_name_trimmed = '' THEN
        RAISE EXCEPTION 'Playgroup name cannot be empty';
    END IF;

    IF EXISTS (
        SELECT 1 FROM playgroups
        WHERE LOWER(name) = LOWER(v_name_trimmed)
    ) THEN
        RAISE EXCEPTION 'A playgroup named "%" already exists', v_name_trimmed;
    END IF;

    IF (
        SELECT COUNT(*) FROM playgroup_members
        WHERE user_id = v_user_id AND role = 'owner'
    ) >= 4 THEN
        RAISE EXCEPTION 'You can only own 4 campaigns on the current plan';
    END IF;

    INSERT INTO playgroups (name, created_by)
    VALUES (v_name_trimmed, v_user_id)
    RETURNING * INTO v_playgroup;

    INSERT INTO playgroup_members (playgroup_id, user_id, role)
    VALUES (v_playgroup.id, v_user_id, 'owner');

    -- One invite token per campaign, created with the campaign
    v_token := md5(random()::text || clock_timestamp()::text || random()::text);
    INSERT INTO invite_tokens (playgroup_id, token, created_by)
    VALUES (v_playgroup.id, v_token, v_user_id);

    RETURN v_playgroup;
END;
$$;

-- 8. Backfill: one token per existing playgroup (those that have none after we added UNIQUE)
INSERT INTO invite_tokens (playgroup_id, token, created_by)
SELECT id, md5(random()::text || id::text || clock_timestamp()::text), created_by
FROM playgroups
WHERE NOT EXISTS (SELECT 1 FROM invite_tokens it WHERE it.playgroup_id = playgroups.id)
ON CONFLICT (playgroup_id) DO NOTHING;
