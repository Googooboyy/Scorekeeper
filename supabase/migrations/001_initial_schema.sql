-- The Scorekeeper: Supabase schema with RLS
-- Run this in Supabase SQL Editor or via Supabase CLI

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Playgroups (workspaces)
CREATE TABLE playgroups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Playgroup membership
CREATE TABLE playgroup_members (
    playgroup_id UUID NOT NULL REFERENCES playgroups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
    PRIMARY KEY (playgroup_id, user_id)
);

-- Games (per playgroup)
CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playgroup_id UUID NOT NULL REFERENCES playgroups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(playgroup_id, name)
);

-- Players (per playgroup)
CREATE TABLE players (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playgroup_id UUID NOT NULL REFERENCES playgroups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(playgroup_id, name)
);

-- Win entries
CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    playgroup_id UUID NOT NULL REFERENCES playgroups(id) ON DELETE CASCADE,
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    date DATE NOT NULL
);

-- Game metadata (images, etc.)
CREATE TABLE game_metadata (
    game_id UUID PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
    image TEXT
);

-- Player metadata (images, colors)
CREATE TABLE player_metadata (
    player_id UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    image TEXT,
    color TEXT DEFAULT '#6366f1'
);

-- Indexes for common queries
CREATE INDEX idx_playgroup_members_user ON playgroup_members(user_id);
CREATE INDEX idx_games_playgroup ON games(playgroup_id);
CREATE INDEX idx_players_playgroup ON players(playgroup_id);
CREATE INDEX idx_entries_playgroup ON entries(playgroup_id);
CREATE INDEX idx_entries_date ON entries(date DESC);

-- Row Level Security (RLS)

ALTER TABLE playgroups ENABLE ROW LEVEL SECURITY;
ALTER TABLE playgroup_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_metadata ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is member of playgroup
CREATE OR REPLACE FUNCTION is_playgroup_member(pg_id UUID, uid UUID)
RETURNS BOOLEAN AS $$
    SELECT EXISTS (
        SELECT 1 FROM playgroup_members
        WHERE playgroup_id = pg_id AND user_id = uid
    );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- playgroups: members can read; owners can update/delete; members can insert (for creating)
CREATE POLICY "playgroups_select" ON playgroups
    FOR SELECT USING (is_playgroup_member(id, auth.uid()));

CREATE POLICY "playgroups_insert" ON playgroups
    FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "playgroups_update" ON playgroups
    FOR UPDATE USING (
        is_playgroup_member(id, auth.uid()) AND
        EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = id AND user_id = auth.uid() AND role = 'owner')
    );

CREATE POLICY "playgroups_delete" ON playgroups
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM playgroup_members WHERE playgroup_id = id AND user_id = auth.uid() AND role = 'owner')
    );

-- playgroup_members: members can read
CREATE POLICY "playgroup_members_select" ON playgroup_members
    FOR SELECT USING (user_id = auth.uid() OR is_playgroup_member(playgroup_id, auth.uid()));

-- Only owners or self can insert (add member)
CREATE POLICY "playgroup_members_insert" ON playgroup_members
    FOR INSERT WITH CHECK (
        user_id = auth.uid() OR
        EXISTS (SELECT 1 FROM playgroup_members pm WHERE pm.playgroup_id = playgroup_id AND pm.user_id = auth.uid() AND pm.role = 'owner')
    );

CREATE POLICY "playgroup_members_delete" ON playgroup_members
    FOR DELETE USING (user_id = auth.uid() OR is_playgroup_member(playgroup_id, auth.uid()));

-- games, players, entries, game_metadata, player_metadata: members can CRUD
CREATE POLICY "games_select" ON games FOR SELECT USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "games_insert" ON games FOR INSERT WITH CHECK (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "games_update" ON games FOR UPDATE USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "games_delete" ON games FOR DELETE USING (is_playgroup_member(playgroup_id, auth.uid()));

CREATE POLICY "players_select" ON players FOR SELECT USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "players_insert" ON players FOR INSERT WITH CHECK (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "players_update" ON players FOR UPDATE USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "players_delete" ON players FOR DELETE USING (is_playgroup_member(playgroup_id, auth.uid()));

CREATE POLICY "entries_select" ON entries FOR SELECT USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "entries_insert" ON entries FOR INSERT WITH CHECK (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "entries_update" ON entries FOR UPDATE USING (is_playgroup_member(playgroup_id, auth.uid()));
CREATE POLICY "entries_delete" ON entries FOR DELETE USING (is_playgroup_member(playgroup_id, auth.uid()));

CREATE POLICY "game_metadata_select" ON game_metadata
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM games g WHERE g.id = game_id AND is_playgroup_member(g.playgroup_id, auth.uid()))
    );
CREATE POLICY "game_metadata_insert" ON game_metadata
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM games g WHERE g.id = game_id AND is_playgroup_member(g.playgroup_id, auth.uid()))
    );
CREATE POLICY "game_metadata_update" ON game_metadata
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM games g WHERE g.id = game_id AND is_playgroup_member(g.playgroup_id, auth.uid()))
    );
CREATE POLICY "game_metadata_delete" ON game_metadata
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM games g WHERE g.id = game_id AND is_playgroup_member(g.playgroup_id, auth.uid()))
    );

CREATE POLICY "player_metadata_select" ON player_metadata
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND is_playgroup_member(p.playgroup_id, auth.uid()))
    );
CREATE POLICY "player_metadata_insert" ON player_metadata
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND is_playgroup_member(p.playgroup_id, auth.uid()))
    );
CREATE POLICY "player_metadata_update" ON player_metadata
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND is_playgroup_member(p.playgroup_id, auth.uid()))
    );
CREATE POLICY "player_metadata_delete" ON player_metadata
    FOR DELETE USING (
        EXISTS (SELECT 1 FROM players p WHERE p.id = player_id AND is_playgroup_member(p.playgroup_id, auth.uid()))
    );
