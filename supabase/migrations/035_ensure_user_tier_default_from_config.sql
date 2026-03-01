-- Migration 035: ensure_user_tier uses default_user_tier from app_config
-- When inserting a new user_tiers row, use app_config.default_user_tier if set (1=Commoner, 2=Noble, 3=Royal).

CREATE OR REPLACE FUNCTION ensure_user_tier()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_default_tier INT := 1;
    v_config_val TEXT;
BEGIN
    SELECT value INTO v_config_val FROM app_config WHERE key = 'default_user_tier' LIMIT 1;
    IF v_config_val IS NOT NULL AND trim(v_config_val) ~ '^[123]$' THEN
        v_default_tier := v_config_val::INT;
    END IF;

    INSERT INTO user_tiers (user_id, tier)
    VALUES (auth.uid(), v_default_tier)
    ON CONFLICT (user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_user_tier() TO authenticated;
