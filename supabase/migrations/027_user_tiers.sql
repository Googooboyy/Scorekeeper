-- Migration 027: User tiers for tiered membership (Phase 1)
-- Tier 1 (Free): 2 campaigns, 5 meeples
-- Tier 2 (Noble): 4 campaigns, 10 meeples
-- Tier 3 (Royal): unlimited

-- ============================================================
-- 1. Create user_tiers table
-- ============================================================
CREATE TABLE IF NOT EXISTS user_tiers (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier INTEGER NOT NULL DEFAULT 1 CHECK (tier IN (1, 2, 3)),
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by UUID REFERENCES auth.users(id)
);

ALTER TABLE user_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_tiers_select_own" ON user_tiers
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "user_tiers_service_role" ON user_tiers
    FOR ALL USING (auth.role() = 'service_role');

-- Allow users to insert their own tier row (for new signups)
CREATE POLICY "user_tiers_insert_own" ON user_tiers
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Backfill existing users as Tier 1
INSERT INTO user_tiers (user_id, tier)
SELECT id, 1 FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- ============================================================
-- 2. Helper: get max campaigns and meeples for a user's tier
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_tier_limit(uid UUID)
RETURNS TABLE(max_campaigns INT, max_meeples INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        CASE COALESCE((SELECT tier FROM user_tiers WHERE user_id = uid), 1)
            WHEN 1 THEN 2
            WHEN 2 THEN 4
            WHEN 3 THEN 999999
            ELSE 2
        END,
        CASE COALESCE((SELECT tier FROM user_tiers WHERE user_id = uid), 1)
            WHEN 1 THEN 5
            WHEN 2 THEN 10
            WHEN 3 THEN 999999
            ELSE 5
        END;
$$;

-- ============================================================
-- 3. Campaign ownership limit: tier-aware
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
    v_max_campaigns INT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_name_trimmed := TRIM(p_name);
    IF v_name_trimmed = '' THEN
        RAISE EXCEPTION 'Playgroup name cannot be empty';
    END IF;

    -- Global uniqueness
    IF EXISTS (
        SELECT 1 FROM playgroups
        WHERE LOWER(name) = LOWER(v_name_trimmed)
    ) THEN
        RAISE EXCEPTION 'A playgroup named "%" already exists', v_name_trimmed;
    END IF;

    -- Tier-aware campaign ownership limit
    SELECT l.max_campaigns INTO v_max_campaigns
    FROM get_user_tier_limit(v_user_id) l;
    v_max_campaigns := COALESCE(v_max_campaigns, 2);

    IF (
        SELECT COUNT(*) FROM playgroup_members
        WHERE user_id = v_user_id AND role = 'owner'
    ) >= v_max_campaigns THEN
        RAISE EXCEPTION 'You can only own % campaign(s) on the current plan', v_max_campaigns;
    END IF;

    INSERT INTO playgroups (name, created_by)
    VALUES (v_name_trimmed, v_user_id)
    RETURNING * INTO v_playgroup;

    INSERT INTO playgroup_members (playgroup_id, user_id, role)
    VALUES (v_playgroup.id, v_user_id, 'owner');

    RETURN v_playgroup;
END;
$$;

-- ============================================================
-- 4. Player limit: tier-aware (campaign owner's tier)
-- ============================================================
CREATE OR REPLACE FUNCTION check_player_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_owner_id UUID;
    v_max_meeples INT;
    v_current_count INT;
BEGIN
    -- Get campaign owner
    SELECT created_by INTO v_owner_id
    FROM playgroups
    WHERE id = NEW.playgroup_id;

    -- If no owner (shouldn't happen), use default 5
    IF v_owner_id IS NULL THEN
        v_max_meeples := 5;
    ELSE
        SELECT l.max_meeples INTO v_max_meeples
        FROM get_user_tier_limit(v_owner_id) l;
        v_max_meeples := COALESCE(v_max_meeples, 5);
    END IF;

    SELECT COUNT(*) INTO v_current_count
    FROM players
    WHERE playgroup_id = NEW.playgroup_id;

    IF v_current_count >= v_max_meeples THEN
        RAISE EXCEPTION 'This campaign has reached the maximum of % players', v_max_meeples;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_player_limit ON players;
CREATE TRIGGER enforce_player_limit
BEFORE INSERT ON players
FOR EACH ROW EXECUTE FUNCTION check_player_limit();

-- ============================================================
-- 5. RPC: Get campaign owner's tier and limits (for UI)
-- Callable by anyone who can see the campaign (members/anon via share)
-- ============================================================
CREATE OR REPLACE FUNCTION get_campaign_owner_limits(p_playgroup_id UUID)
RETURNS TABLE(owner_tier INT, max_campaigns INT, max_meeples INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COALESCE((SELECT tier FROM user_tiers WHERE user_id = p.created_by), 1)::INT,
        (SELECT max_campaigns FROM get_user_tier_limit(p.created_by) LIMIT 1),
        (SELECT max_meeples FROM get_user_tier_limit(p.created_by) LIMIT 1)
    FROM playgroups p
    WHERE p.id = p_playgroup_id;
$$;

-- Grant to authenticated and anon (for share links)
GRANT EXECUTE ON FUNCTION get_campaign_owner_limits(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaign_owner_limits(UUID) TO anon;

-- ============================================================
-- 6. RPC: Ensure current user has a tier row (for new signups)
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_user_tier()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO user_tiers (user_id, tier)
    VALUES (auth.uid(), 1)
    ON CONFLICT (user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_user_tier() TO authenticated;
