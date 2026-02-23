-- Fix playgroups INSERT RLS via SECURITY DEFINER function
-- Creates playgroup + owner membership in one transaction, bypassing RLS for this operation
CREATE OR REPLACE FUNCTION create_playgroup_with_owner(p_name TEXT)
RETURNS playgroups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_playgroup playgroups;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    INSERT INTO playgroups (name, created_by)
    VALUES (p_name, v_user_id)
    RETURNING * INTO v_playgroup;

    INSERT INTO playgroup_members (playgroup_id, user_id, role)
    VALUES (v_playgroup.id, v_user_id, 'owner');

    RETURN v_playgroup;
END;
$$;

GRANT EXECUTE ON FUNCTION create_playgroup_with_owner(TEXT) TO authenticated;
