-- Enable pgcrypto for gen_random_bytes (used by create_invite_token)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
