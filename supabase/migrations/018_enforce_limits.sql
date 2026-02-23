-- Enforce account-level campaign limit (2 per account) and per-campaign player limit (4)
-- These limits are intentionally simple constants to be relaxed when tiered memberships are introduced.

-- ============================================================
-- 1. Campaign ownership limit: max 2 owned campaigns per user
-- ============================================================
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
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_name_trimmed := TRIM(p_name);
    IF v_name_trimmed = '' THEN
        RAISE EXCEPTION 'Playgroup name cannot be empty';
    END IF;

    -- Global uniqueness: no playgroup with this name (case-insensitive) may exist
    IF EXISTS (
        SELECT 1 FROM playgroups
        WHERE LOWER(name) = LOWER(v_name_trimmed)
    ) THEN
        RAISE EXCEPTION 'A playgroup named "%" already exists', v_name_trimmed;
    END IF;

    -- Campaign ownership limit: each user may own at most 2 campaigns
    IF (
        SELECT COUNT(*) FROM playgroup_members
        WHERE user_id = v_user_id AND role = 'owner'
    ) >= 2 THEN
        RAISE EXCEPTION 'You can only own 2 campaigns on the current plan';
    END IF;

    INSERT INTO playgroups (name, created_by)
    VALUES (v_name_trimmed, v_user_id)
    RETURNING * INTO v_playgroup;

    INSERT INTO playgroup_members (playgroup_id, user_id, role)
    VALUES (v_playgroup.id, v_user_id, 'owner');

    RETURN v_playgroup;
END;
$$;

GRANT EXECUTE ON FUNCTION create_playgroup_with_owner(TEXT) TO authenticated;

-- ============================================================
-- 2. Player limit: max 4 players per campaign
-- ============================================================
CREATE OR REPLACE FUNCTION check_player_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF (SELECT COUNT(*) FROM players WHERE playgroup_id = NEW.playgroup_id) >= 4 THEN
        RAISE EXCEPTION 'This campaign has reached the maximum of 4 players';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_player_limit ON players;

CREATE TRIGGER enforce_player_limit
BEFORE INSERT ON players
FOR EACH ROW EXECUTE FUNCTION check_player_limit();
