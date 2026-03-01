-- Migration 031: Admin-configurable tier definitions
-- Replaces hardcoded limits in get_user_tier_limit() with tier_definitions table.
-- Admin Tiers tab can edit display_name, max_campaigns, max_meeples, can_upload_image, can_set_color.

-- ============================================================
-- 1. Create tier_definitions table
-- ============================================================
CREATE TABLE IF NOT EXISTS tier_definitions (
    tier INTEGER PRIMARY KEY CHECK (tier IN (1, 2, 3)),
    display_name TEXT NOT NULL DEFAULT 'Commoner',
    max_campaigns INT NOT NULL DEFAULT 2,
    max_meeples INT NOT NULL DEFAULT 5,
    can_upload_image BOOLEAN NOT NULL DEFAULT false,
    can_set_color BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE tier_definitions ENABLE ROW LEVEL SECURITY;

-- Anyone can read (for UI limits, avatar gating)
CREATE POLICY "tier_definitions_select" ON tier_definitions
    FOR SELECT USING (true);

-- Only service_role can modify (admin page uses service_role)
CREATE POLICY "tier_definitions_service_role" ON tier_definitions
    FOR ALL USING (auth.role() = 'service_role');

-- Seed defaults: Commoner (1), Noble (2), Royal (3)
INSERT INTO tier_definitions (tier, display_name, max_campaigns, max_meeples, can_upload_image, can_set_color)
VALUES
    (1, 'Commoner', 2, 5, false, true),
    (2, 'Noble', 4, 10, true, true),
    (3, 'Royal', 999999, 999999, true, true)
ON CONFLICT (tier) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    max_campaigns = EXCLUDED.max_campaigns,
    max_meeples = EXCLUDED.max_meeples,
    can_upload_image = EXCLUDED.can_upload_image,
    can_set_color = EXCLUDED.can_set_color,
    updated_at = now();

-- ============================================================
-- 2. Replace get_user_tier_limit to read from tier_definitions
-- ============================================================
CREATE OR REPLACE FUNCTION get_user_tier_limit(uid UUID)
RETURNS TABLE(max_campaigns INT, max_meeples INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        COALESCE((SELECT max_campaigns FROM tier_definitions WHERE tier = COALESCE((SELECT tier FROM user_tiers WHERE user_id = uid), 1)), 2),
        COALESCE((SELECT max_meeples FROM tier_definitions WHERE tier = COALESCE((SELECT tier FROM user_tiers WHERE user_id = uid), 1)), 5);
$$;

-- ============================================================
-- 3. RPC: Get tier definition (for admin and client)
-- ============================================================
CREATE OR REPLACE FUNCTION get_tier_definition(p_tier INT)
RETURNS TABLE(
    display_name TEXT,
    max_campaigns INT,
    max_meeples INT,
    can_upload_image BOOLEAN,
    can_set_color BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT td.display_name, td.max_campaigns, td.max_meeples, td.can_upload_image, td.can_set_color
    FROM tier_definitions td
    WHERE td.tier = COALESCE(p_tier, 1)
    LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_tier_definition(INT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tier_definition(INT) TO anon;

-- ============================================================
-- 4. RPC: Get all tier definitions (for admin)
-- ============================================================
CREATE OR REPLACE FUNCTION get_all_tier_definitions()
RETURNS TABLE(
    tier INT,
    display_name TEXT,
    max_campaigns INT,
    max_meeples INT,
    can_upload_image BOOLEAN,
    can_set_color BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT td.tier, td.display_name, td.max_campaigns, td.max_meeples, td.can_upload_image, td.can_set_color
    FROM tier_definitions td
    ORDER BY td.tier;
$$;

GRANT EXECUTE ON FUNCTION get_all_tier_definitions() TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_tier_definitions() TO anon;
