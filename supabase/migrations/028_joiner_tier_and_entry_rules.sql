-- Migration 028: Joiner-tier logic + campaign entry requirements
-- Passport: joiner's tier vs linked (active) player count + entry requirements
-- Unlinked players: no limit. Linked: check entry requirements + size limit.
-- Legacy: existing members grandfathered; checked only on re-join.

-- ============================================================
-- 1. Add join_allowed_tiers to playgroups
-- ============================================================
ALTER TABLE playgroups
    ADD COLUMN IF NOT EXISTS join_allowed_tiers INTEGER[] DEFAULT ARRAY[1, 2, 3];

-- Default {1,2,3} = all tiers (no restriction). Owners can narrow to e.g. {2} (Noble only).

-- ============================================================
-- 2. Helper: format tier labels for error messages
-- ============================================================
CREATE OR REPLACE FUNCTION format_tier_labels(tiers INTEGER[])
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT string_agg(
        CASE t
            WHEN 1 THEN 'Free'
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
-- 3. Replace check_player_limit: joiner-tier logic (INSERT)
-- Unlinked inserts: no limit. Linked inserts: check entry + size.
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
    -- Unlinked insert: no limit
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

    -- Entry requirements: joiner's tier must be in allowed
    IF NOT (v_joiner_tier = ANY(v_allowed_tiers)) THEN
        RAISE EXCEPTION 'Halt! The winds of fate have deemed this journey unjust. This campaign only accepts %. You are on tier %.',
            format_tier_labels(v_allowed_tiers),
            CASE v_joiner_tier WHEN 1 THEN 'Free' WHEN 2 THEN 'Noble' WHEN 3 THEN 'Royal' ELSE 'Unknown' END;
    END IF;

    -- Size limit: linked count (after this insert) must not exceed joiner's limit
    IF (v_linked_count + 1) > v_joiner_limit THEN
        RAISE EXCEPTION 'Your plan allows joining campaigns with up to % active (claimed) meeples. This campaign has % active meeples.',
            v_joiner_limit, v_linked_count + 1;
    END IF;

    RETURN NEW;
END;
$$;

-- ============================================================
-- 4. Trigger for claim (UPDATE): user_id null -> non-null
-- ============================================================
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
    -- Only run when user_id changes from null to non-null (claim)
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

    -- Linked count after this claim (this row becomes linked; OLD.user_id was null)
    SELECT COUNT(*) INTO v_linked_count
    FROM players
    WHERE playgroup_id = NEW.playgroup_id AND user_id IS NOT NULL;
    v_linked_count := v_linked_count + 1;

    IF NOT (v_joiner_tier = ANY(v_allowed_tiers)) THEN
        RAISE EXCEPTION 'Halt! The winds of fate have deemed this journey unjust. This campaign only accepts %. You are on tier %.',
            format_tier_labels(v_allowed_tiers),
            CASE v_joiner_tier WHEN 1 THEN 'Free' WHEN 2 THEN 'Noble' WHEN 3 THEN 'Royal' ELSE 'Unknown' END;
    END IF;

    IF v_linked_count > v_joiner_limit THEN
        RAISE EXCEPTION 'Your plan allows joining campaigns with up to % active (claimed) meeples. This campaign has % active meeples.',
            v_joiner_limit, v_linked_count;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_player_limit ON players;
CREATE TRIGGER enforce_player_limit
BEFORE INSERT ON players
FOR EACH ROW EXECUTE FUNCTION check_player_limit();

DROP TRIGGER IF EXISTS enforce_player_claim ON players;
CREATE TRIGGER enforce_player_claim
BEFORE UPDATE ON players
FOR EACH ROW EXECUTE FUNCTION check_player_claim();

-- ============================================================
-- 5. RPC: Get campaign join info (linked count, allowed tiers, user's tier/limit)
-- Callable by authenticated and anon (for invite page)
-- ============================================================
CREATE OR REPLACE FUNCTION get_campaign_join_info(p_playgroup_id UUID)
RETURNS TABLE(
    linked_count INT,
    allowed_tiers INTEGER[],
    owner_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT
        (SELECT COUNT(*)::INT FROM players WHERE playgroup_id = p.id AND user_id IS NOT NULL),
        COALESCE(p.join_allowed_tiers, ARRAY[1,2,3]),
        p.created_by
    FROM playgroups p
    WHERE p.id = p_playgroup_id;
$$;

GRANT EXECUTE ON FUNCTION get_campaign_join_info(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_campaign_join_info(UUID) TO anon;

-- playgroups needs anon read for resolve_invite_token; check if join_allowed_tiers is exposed
-- Playgroups select policies: members can read. Anon can read via resolve_invite_token which
-- only returns id and name. For invite page we use get_campaign_join_info (SECURITY DEFINER)
-- which reads playgroups directly. Good.
