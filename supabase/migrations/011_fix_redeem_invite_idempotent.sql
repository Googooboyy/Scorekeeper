-- Make redeem_invite_token idempotent: if the user is already a member,
-- just return the playgroup info rather than raising an error.
-- This handles cases where onAuthStateChange fires multiple times after
-- an OAuth redirect, causing tryRedeemInvite to run concurrently.

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

    SELECT EXISTS (
        SELECT 1 FROM playgroup_members pm
        WHERE pm.playgroup_id = v_rec.playgroup_id AND pm.user_id = v_user_id
    ) INTO v_already_member;

    IF NOT v_already_member THEN
        UPDATE invite_tokens SET use_count = use_count + 1 WHERE id = v_rec.id;
        INSERT INTO playgroup_members (playgroup_id, user_id, role)
        VALUES (v_rec.playgroup_id, v_user_id, 'member')
        ON CONFLICT (playgroup_id, user_id) DO NOTHING;
    END IF;

    playgroup_id := v_rec.playgroup_id;
    playgroup_name := v_rec.name;
    RETURN NEXT;
END;
$$;
