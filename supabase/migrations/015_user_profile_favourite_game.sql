-- Migration 015: User profile with favourite game
-- Lets linked users set a favourite game that displays on their profile

CREATE TABLE user_profile (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    favourite_game TEXT
);

-- Helper: can viewer see this user's profile? (self or shares a campaign)
CREATE OR REPLACE FUNCTION shares_playgroup_with(p_other_user_id UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM playgroup_members m1
        JOIN playgroup_members m2 ON m1.playgroup_id = m2.playgroup_id AND m2.user_id = p_other_user_id
        WHERE m1.user_id = auth.uid()
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

ALTER TABLE user_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profile_select" ON user_profile
    FOR SELECT USING (auth.uid() = user_id OR shares_playgroup_with(user_id));

CREATE POLICY "user_profile_insert_own" ON user_profile
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_profile_update_own" ON user_profile
    FOR UPDATE USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
