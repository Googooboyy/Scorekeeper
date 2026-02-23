-- Enforce global uniqueness of playgroup names (case-insensitive)
-- No user can create a playgroup with a name that already exists in the database
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

    INSERT INTO playgroups (name, created_by)
    VALUES (v_name_trimmed, v_user_id)
    RETURNING * INTO v_playgroup;

    INSERT INTO playgroup_members (playgroup_id, user_id, role)
    VALUES (v_playgroup.id, v_user_id, 'owner');

    RETURN v_playgroup;
END;
$$;

GRANT EXECUTE ON FUNCTION create_playgroup_with_owner(TEXT) TO authenticated;
