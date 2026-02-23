import { getSupabase } from './auth.js';

/**
 * Fetch all playgroups the current user is a member of (with role)
 */
export async function fetchPlaygroups() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data: memberships } = await supabase
        .from('playgroup_members')
        .select('playgroup_id, role')
        .eq('user_id', user.id);

    if (!memberships?.length) return [];

    const ids = memberships.map(m => m.playgroup_id);
    const roleByPg = Object.fromEntries(memberships.map(m => [m.playgroup_id, m.role]));

    const { data: playgroups, error } = await supabase
        .from('playgroups')
        .select('*')
        .in('id', ids)
        .order('created_at', { ascending: false });

    if (error) throw error;
    return (playgroups || []).map(pg => ({ ...pg, role: roleByPg[pg.id] || 'member' }));
}

/**
 * Create an invite token for a playgroup. Returns the token string.
 */
export async function createInviteToken(playgroupId, expiresHours = 168, maxUses = 10) {
    const { data, error } = await getSupabase()
        .rpc('create_invite_token', {
            p_playgroup_id: playgroupId,
            p_expires_hours: expiresHours,
            p_max_uses: maxUses
        });
    if (error) throw error;
    return data;
}

/**
 * Redeem an invite token. Adds current user to playgroup. Returns { playgroup_id, playgroup_name }.
 */
export async function redeemInviteToken(token) {
    const { data, error } = await getSupabase()
        .rpc('redeem_invite_token', { p_token: token });
    if (error) throw error;
    return data?.[0] || null;
}

/**
 * Create a new playgroup and add the creator as owner
 */
export async function createPlaygroup(name) {
    const supabase = getSupabase();
    const { data: playgroup, error } = await supabase
        .rpc('create_playgroup_with_owner', { p_name: name });

    if (error) throw error;
    return playgroup;
}

/**
 * Fetch games for a playgroup
 */
export async function fetchGames(playgroupId) {
    const { data, error } = await getSupabase()
        .from('games')
        .select('id, name')
        .eq('playgroup_id', playgroupId)
        .order('name');

    if (error) throw error;
    return data || [];
}

/**
 * Fetch players for a playgroup
 */
export async function fetchPlayers(playgroupId) {
    const { data, error } = await getSupabase()
        .from('players')
        .select('id, name, user_id')
        .eq('playgroup_id', playgroupId)
        .order('name');

    if (error) throw error;
    return data || [];
}

/**
 * Fetch a single player by ID (includes user_id for profile linking)
 */
export async function fetchPlayerById(playerId) {
    const { data, error } = await getSupabase()
        .from('players')
        .select('id, name, playgroup_id, user_id')
        .eq('id', playerId)
        .single();

    if (error) throw error;
    return data;
}

/**
 * Claim a player record — links it to the current user's account.
 * Only succeeds if the player is currently unclaimed (user_id IS NULL).
 * The DB unique index also enforces one claim per campaign per user.
 */
export async function claimPlayer(playerId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
        .from('players')
        .update({ user_id: user.id })
        .eq('id', playerId)
        .is('user_id', null)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Unlink a player record from the current user's account.
 * Only the user who originally linked it can unlink it (user_id = auth.uid()).
 */
export async function unclaimPlayer(playerId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
        .from('players')
        .update({ user_id: null })
        .eq('id', playerId)
        .eq('user_id', user.id)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Fetch cross-campaign stats for a linked player (by their user_id).
 * Returns per-campaign summary rows.
 */
export async function fetchCrossCampaignStats(userId) {
    const { data, error } = await getSupabase()
        .rpc('get_cross_campaign_player_stats', { p_user_id: userId });

    if (error) throw error;
    return data || [];
}

/**
 * Fetch a user's profile (e.g. favourite game). Returns { favourite_game } or null.
 */
export async function fetchUserProfile(userId) {
    const { data, error } = await getSupabase()
        .from('user_profile')
        .select('favourite_game')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

/**
 * Set or clear a user's favourite game. Only the current user can update their own profile.
 */
export async function upsertUserProfile(userId, favouriteGame) {
    const { error } = await getSupabase()
        .from('user_profile')
        .upsert(
            { user_id: userId, favourite_game: favouriteGame || null },
            { onConflict: 'user_id' }
        );

    if (error) throw error;
}

/**
 * Fetch cross-campaign game breakdown for a linked player (by their user_id).
 */
export async function fetchCrossCampaignGameBreakdown(userId) {
    const { data, error } = await getSupabase()
        .rpc('get_cross_campaign_game_breakdown', { p_user_id: userId });

    if (error) throw error;
    return data || [];
}

/**
 * Fetch recent entries for a player across all campaigns (cross-campaign profile view).
 * Returns the 20 most recent win entries.
 */
export async function fetchPlayerRecentEntries(userId, limit = 20) {
    const supabase = getSupabase();
    // First get all player IDs for this user
    const { data: players, error: plErr } = await supabase
        .from('players')
        .select('id, name, playgroup_id')
        .eq('user_id', userId);

    if (plErr) throw plErr;
    if (!players?.length) return [];

    const playerIds = players.map(p => p.id);

    const { data: entries, error: entErr } = await supabase
        .from('entries')
        .select(`
            id,
            date,
            created_at,
            games!inner(name),
            playgroups!inner(name)
        `)
        .in('player_id', playerIds)
        .order('date', { ascending: false })
        .limit(limit);

    if (entErr) throw entErr;

    return (entries || []).map(row => ({
        id: row.id,
        date: row.date,
        created_at: row.created_at,
        game: row.games?.name || '',
        campaign: row.playgroups?.name || ''
    }));
}

/**
 * Fetch entries for a playgroup (with game and player names joined, including audit fields)
 */
export async function fetchEntries(playgroupId) {
    const { data, error } = await getSupabase()
        .from('entries')
        .select(`
            id,
            date,
            created_at,
            updated_at,
            created_by_name,
            updated_by_name,
            games!inner(name),
            players!inner(name)
        `)
        .eq('playgroup_id', playgroupId)
        .order('date', { ascending: false });

    if (error) throw error;

    return (data || []).map(row => ({
        id: row.id,
        date: row.date,
        created_at: row.created_at || null,
        updated_at: row.updated_at || null,
        created_by_name: row.created_by_name || null,
        updated_by_name: row.updated_by_name || null,
        game: row.games?.name || '',
        player: row.players?.name || ''
    }));
}

/**
 * Fetch game metadata (images)
 */
export async function fetchGameMetadata(gameIds) {
    if (!gameIds?.length) return {};
    const { data, error } = await getSupabase()
        .from('game_metadata')
        .select('game_id, image')
        .in('game_id', gameIds);

    if (error) throw error;
    const out = {};
    (data || []).forEach(r => { out[r.game_id] = { image: r.image }; });
    return out;
}

/**
 * Fetch player metadata
 */
export async function fetchPlayerMetadata(playerIds) {
    if (!playerIds?.length) return {};
    const { data, error } = await getSupabase()
        .from('player_metadata')
        .select('player_id, image, color')
        .in('player_id', playerIds);

    if (error) throw error;
    const out = {};
    (data || []).forEach(r => { out[r.player_id] = { image: r.image, color: r.color }; });
    return out;
}

/**
 * Load full playgroup data into the app's data shape
 */
export async function loadPlaygroupData(playgroupId) {
    const [games, players, entries] = await Promise.all([
        fetchGames(playgroupId),
        fetchPlayers(playgroupId),
        fetchEntries(playgroupId)
    ]);

    const gameIds = games.map(g => g.id);
    const playerIds = players.map(p => p.id);
    const [gameMeta, playerMeta] = await Promise.all([
        fetchGameMetadata(gameIds),
        fetchPlayerMetadata(playerIds)
    ]);

    const nameById = { games: {}, players: {} };
    games.forEach(g => { nameById.games[g.id] = g.name; });
    players.forEach(p => { nameById.players[p.id] = p.name; });

    const gameData = {};
    games.forEach(g => {
        const m = gameMeta[g.id];
        if (m?.image) gameData[g.name] = { image: m.image };
    });

    const playerData = {};
    players.forEach(p => {
        const m = playerMeta[p.id];
        if (m) playerData[p.name] = { image: m.image, color: m.color };
    });

    // Merge user_id into playerData so profile modal can access it
    players.forEach(p => {
        if (!playerData[p.name]) playerData[p.name] = {};
        playerData[p.name].userId = p.user_id || null;
    });

    return {
        players: players.map(p => p.name),
        games: games.map(g => g.name),
        entries: entries,
        gameData,
        playerData,
        _gameIdByName: Object.fromEntries(games.map(g => [g.name, g.id])),
        _playerIdByName: Object.fromEntries(players.map(p => [p.name, p.id]))
    };
}

/**
 * Insert a new game
 */
export async function insertGame(playgroupId, name) {
    const { data, error } = await getSupabase()
        .from('games')
        .insert({ playgroup_id: playgroupId, name })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Insert a new player
 */
export async function insertPlayer(playgroupId, name) {
    const { data, error } = await getSupabase()
        .from('players')
        .insert({ playgroup_id: playgroupId, name })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Get the current user's display name for audit trail purposes.
 * Uses Google full_name if available, falls back to email.
 */
async function getCurrentUserName() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return user.user_metadata?.full_name || user.email || null;
}

/**
 * Insert a new entry (win record)
 */
export async function insertEntry(playgroupId, gameId, playerId, date) {
    const createdByName = await getCurrentUserName();
    const { data, error } = await getSupabase()
        .from('entries')
        .insert({
            playgroup_id: playgroupId,
            game_id: gameId,
            player_id: playerId,
            date,
            created_by_name: createdByName
        })
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Update an entry
 */
export async function updateEntry(entryId, gameId, playerId, date) {
    const updatedByName = await getCurrentUserName();
    const { data, error } = await getSupabase()
        .from('entries')
        .update({
            game_id: gameId,
            player_id: playerId,
            date,
            updated_at: new Date().toISOString(),
            updated_by_name: updatedByName
        })
        .eq('id', entryId)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Delete an entry
 */
export async function deleteEntry(entryId) {
    const { error } = await getSupabase().from('entries').delete().eq('id', entryId);
    if (error) throw error;
}

/**
 * Delete a game (cascades to entries and game_metadata)
 */
export async function deleteGameById(gameId) {
    const { error } = await getSupabase().from('games').delete().eq('id', gameId);
    if (error) throw error;
}

/**
 * Delete a player
 */
export async function deletePlayerById(playerId) {
    const { error } = await getSupabase().from('players').delete().eq('id', playerId);
    if (error) throw error;
}

/**
 * Upsert game metadata
 */
export async function upsertGameMetadata(gameId, image) {
    const { error } = await getSupabase()
        .from('game_metadata')
        .upsert({ game_id: gameId, image }, { onConflict: 'game_id' });

    if (error) throw error;
}

/**
 * Upsert player metadata
 */
export async function upsertPlayerMetadata(playerId, image, color) {
    const { error } = await getSupabase()
        .from('player_metadata')
        .upsert({ player_id: playerId, image: image || null, color: color || '#6366f1' }, { onConflict: 'player_id' });

    if (error) throw error;
}

/**
 * Fetch a single playgroup's name by ID — works for anon users (public read).
 * Used to show the campaign name in the guest banner.
 */
export async function fetchPlaygroupName(playgroupId) {
    const { data, error } = await getSupabase()
        .from('playgroups')
        .select('name')
        .eq('id', playgroupId)
        .single();

    if (error) throw error;
    return data?.name || null;
}

/**
 * Leave a playgroup (removes current user from playgroup_members)
 */
export async function leavePlaygroup(playgroupId) {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error } = await supabase
        .from('playgroup_members')
        .delete()
        .eq('playgroup_id', playgroupId)
        .eq('user_id', user.id);
    if (error) throw error;
}

/**
 * Clear all data for a playgroup (entries, games, players - metadata cascades)
 */
export async function clearPlaygroupData(playgroupId) {
    const supabase = getSupabase();
    await supabase.from('entries').delete().eq('playgroup_id', playgroupId);
    await supabase.from('games').delete().eq('playgroup_id', playgroupId);
    await supabase.from('players').delete().eq('playgroup_id', playgroupId);
}

/**
 * Import data into a playgroup (replaces existing)
 */
export async function importPlaygroupData(playgroupId, imported) {
    await clearPlaygroupData(playgroupId);
    const gameIds = {};
    const playerIds = {};
    for (const name of imported.games || []) {
        const row = await insertGame(playgroupId, name);
        gameIds[name] = row.id;
    }
    for (const name of imported.players || []) {
        const row = await insertPlayer(playgroupId, name);
        playerIds[name] = row.id;
    }
    const gData = imported.gameData || {};
    const pData = imported.playerData || {};
    for (const [name, meta] of Object.entries(gData)) {
        if (meta?.image && gameIds[name]) {
            await upsertGameMetadata(gameIds[name], meta.image);
        }
    }
    for (const [name, meta] of Object.entries(pData)) {
        if (playerIds[name] && (meta?.image || meta?.color)) {
            await upsertPlayerMetadata(playerIds[name], meta.image, meta.color);
        }
    }
    for (const entry of imported.entries || []) {
        const gid = gameIds[entry.game];
        const pid = playerIds[entry.player];
        if (gid && pid && entry.date) {
            await insertEntry(playgroupId, gid, pid, entry.date);
        }
    }
}
