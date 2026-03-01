-- Migration 030: RPC to fetch players with tier for campaign (for tier pill on player cards)

CREATE OR REPLACE FUNCTION get_playgroup_players_with_tiers(p_playgroup_id UUID)
RETURNS TABLE(
    id UUID,
    name TEXT,
    user_id UUID,
    tier INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        p.id,
        p.name,
        p.user_id,
        COALESCE(ut.tier, 1)::INT
    FROM players p
    LEFT JOIN user_tiers ut ON p.user_id = ut.user_id
    WHERE p.playgroup_id = p_playgroup_id
    AND (auth.uid() IS NULL OR is_playgroup_member(p_playgroup_id, auth.uid()));
$$;

GRANT EXECUTE ON FUNCTION get_playgroup_players_with_tiers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_playgroup_players_with_tiers(UUID) TO anon;
