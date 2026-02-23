-- Fix "column reference playgroup_id is ambiguous" in playgroup_members INSERT policy
-- The policy's subquery had playgroup_id in both the new row and the joined table
-- Restructure to remove ambiguity: use playgroups as intermediate so playgroup_id
-- unambiguously refers to the row being inserted
DROP POLICY IF EXISTS "playgroup_members_insert" ON playgroup_members;
CREATE POLICY "playgroup_members_insert" ON playgroup_members
    FOR INSERT WITH CHECK (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1
            FROM playgroups pg
            WHERE pg.id = playgroup_id
            AND EXISTS (
                SELECT 1 FROM playgroup_members pm
                WHERE pm.playgroup_id = pg.id
                  AND pm.user_id = auth.uid()
                  AND pm.role = 'owner'
            )
        )
    );
