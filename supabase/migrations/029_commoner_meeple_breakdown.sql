-- Migration 029: Rename Free → Commoner; extend campaign join info with travellers + tier breakdown

-- ============================================================
-- 1. Update format_tier_labels to use Commoner
-- ============================================================
CREATE OR REPLACE FUNCTION format_tier_labels(tiers INTEGER[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT string_agg(
        CASE t
            WHEN 1 THEN 'Commoner'
            WHEN 2 THEN 'Noble'
            WHEN 3 THEN 'Royal'
            ELSE 'Unknown'
        END,
        ', '
        ORDER BY t
    )
    FROM unnest(COALESCE(tiers, ARRAY[1,2,3])) AS t;
$$;

-- ============================================================
-- 2. Update error messages in check_player_limit and check_player_claim
-- ============================================================
CREATE OR REPLACE FUNCTION check_player_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_allowed_tiers INTEGER[];
    v_joiner_tier INT;
    v_joiner_limit INT;
    v_linked_count INT;
BEGIN
    IF NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(pg.join_allowed_tiers, ARRAY[1,2,3])
    INTO v_allowed_tiers
    FROM playgroups pg
    WHERE pg.id = NEW.playgroup_id;

    SELECT COALESCE((SELECT tier FROM user_tiers WHERE user_id = NEW.user_id), 1)
    INTO v_joiner_tier;

    SELECT l.max_meeples INTO v_joiner_limit
    FROM get_user_tier_limit(NEW.user_id) l;
    v_joiner_limit := COALESCE(v_joiner_limit, 5);

    SELECT COUNT(*) INTO v_linked_count
    FROM players
    WHERE playgroup_id = NEW.playgroup_id AND user_id IS NOT NULL;

    IF NOT (v_joiner_tier = ANY(v_allowed_tiers)) THEN
        RAISE EXCEPTION 'Halt! The winds of fate have deemed this journey unjust. This campaign only accepts %. You are on tier %.',
            format_tier_labels(v_allowed_tiers),
            CASE v_joiner_tier WHEN 1 THEN 'Commoner' WHEN 2 THEN 'Noble' WHEN 3 THEN 'Royal' ELSE 'Unknown' END;
    END IF;

    IF (v_linked_count + 1) > v_joiner_limit THEN
        RAISE EXCEPTION 'Your plan allows joining campaigns with up to % active (claimed) meeples. This campaign has % active meeples.',
            v_joiner_limit, v_linked_count + 1;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION check_player_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_allowed_tiers INTEGER[];
    v_joiner_tier INT;
    v_joiner_limit INT;
    v_linked_count INT;
BEGIN
    IF OLD.user_id IS NOT NULL OR NEW.user_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT COALESCE(pg.join_allowed_tiers, ARRAY[1,2,3])
    INTO v_allowed_tiers
    FROM playgroups pg
    WHERE pg.id = NEW.playgroup_id;

    SELECT COALESCE((SELECT tier FROM user_tiers WHERE user_id = NEW.user_id), 1)
    INTO v_joiner_tier;

    SELECT l.max_meeples INTO v_joiner_limit
    FROM get_user_tier_limit(NEW.user_id) l;
    v_joiner_limit := COALESCE(v_joiner_limit, 5);

    SELECT COUNT(*) INTO v_linked_count
    FROM players
    WHERE playgroup_id = NEW.playgroup_id AND user_id IS NOT NULL;
    v_linked_count := v_linked_count + 1;

    IF NOT (v_joiner_tier = ANY(v_allowed_tiers)) THEN
        RAISE EXCEPTION 'Halt! The winds of fate have deemed this journey unjust. This campaign only accepts %. You are on tier %.',
            format_tier_labels(v_allowed_tiers),
            CASE v_joiner_tier WHEN 1 THEN 'Commoner' WHEN 2 THEN 'Noble' WHEN 3 THEN 'Royal' ELSE 'Unknown' END;
    END IF;

    IF v_linked_count > v_joiner_limit THEN
        RAISE EXCEPTION 'Your plan allows joining campaigns with up to % active (claimed) meeples. This campaign has % active meeples.',
            v_joiner_limit, v_linked_count;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================
-- 3. Extend get_campaign_join_info: add travellers + tier breakdown
-- (Must DROP first: return type changed)
-- ============================================================
DROP FUNCTION IF EXISTS get_campaign_join_info(UUID);

CREATE FUNCTION get_campaign_join_info(p_playgroup_id UUID)
RETURNS TABLE(
    linked_count INT,
    allowed_tiers INTEGER[],
    owner_id UUID,
    travellers INT,
    tier_1_count INT,
    tier_2_count INT,
    tier_3_count INT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*)::INT FROM players WHERE playgroup_id = p.id AND user_id IS NOT NULL),
        COALESCE(p.join_allowed_tiers, ARRAY[1,2,3]),
        p.created_by,
        (SELECT COUNT(*)::INT FROM players WHERE playgroup_id = p.id AND user_id IS NULL),
        (SELECT COUNT(*)::INT FROM players pl
         WHERE pl.playgroup_id = p.id AND pl.user_id IS NOT NULL
         AND COALESCE((SELECT tier FROM user_tiers WHERE user_id = pl.user_id LIMIT 1), 1) = 1),
        (SELECT COUNT(*)::INT FROM players pl
         JOIN user_tiers ut ON pl.user_id = ut.user_id AND ut.tier = 2
         WHERE pl.playgroup_id = p.id),
        (SELECT COUNT(*)::INT FROM players pl
         JOIN user_tiers ut ON pl.user_id = ut.user_id AND ut.tier = 3
         WHERE pl.playgroup_id = p.id)
    FROM playgroups p
    WHERE p.id = p_playgroup_id;
$$;

GRANT EXECUTE ON FUNCTION get_campaign_join_info(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaign_join_info(UUID) TO anon;
