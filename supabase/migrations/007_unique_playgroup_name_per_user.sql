-- Prevent users from creating playgroups with duplicate names
-- Uniqueness is per-user: among playgroups the user is a member of, names must be unique (case-insensitive)
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

    IF EXISTS (
        SELECT 1 FROM playgroups p
        JOIN playgroup_members pm ON pm.playgroup_id = p.id AND pm.user_id = v_user_id
        WHERE LOWER(p.name) = LOWER(v_name_trimmed)
    ) THEN
        RAISE EXCEPTION 'You already have a playgroup named "%"', v_name_trimmed;
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
