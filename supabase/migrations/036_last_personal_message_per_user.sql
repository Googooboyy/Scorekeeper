-- Migration 036: RPC to get last personal message date per user (admin use)
-- Returns user_id and last_message_at for users who have received at least one personal message.

CREATE OR REPLACE FUNCTION get_last_personal_message_per_user()
RETURNS TABLE (user_id UUID, last_message_at TIMESTAMPTZ)
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT upm.user_id, MAX(upm.created_at) AS last_message_at
  FROM user_personal_messages upm
  GROUP BY upm.user_id;
$$;

COMMENT ON FUNCTION get_last_personal_message_per_user() IS
  'Admin: last personal message sent date per user. Used for Users table Last msg column.';
