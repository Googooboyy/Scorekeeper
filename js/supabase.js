import { getSupabase } from './auth.js';
import { isAdminMode } from './admin.js';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL } from './config.js';

let _adminClient = null;

/** Returns a Supabase client with the service role key (bypasses all RLS).
 *  persistSession/autoRefreshToken must be false so the client never picks up
 *  the logged-in user's JWT from localStorage and overrides the service role key. */
function getAdminClient() {
    const serviceKey = (typeof window !== 'undefined' && window.SCOREKEEPER_SERVICE_ROLE_KEY) || null;
    if (!serviceKey) return null;
    if (!_adminClient) {
        _adminClient = createClient(SUPABASE_URL, serviceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
        });
    }
    return _adminClient;
}

export function resetAdminClient() {
    _adminClient = null;
}

/** Returns the admin client when in admin mode, otherwise the regular authenticated client. */
function getActiveClient() {
    if (isAdminMode()) {
        const ac = getAdminClient();
        if (ac) return ac;
    }
    return getSupabase();
}

/**
 * Fetch playgroups. In admin mode, returns ALL campaigns in the system.
 * Otherwise returns only campaigns the current user is a member of.
 */
export async function fetchPlaygroups() {
    if (isAdminMode()) {
        const { data, error } = await getActiveClient()
            .from('playgroups')
            .select('*')
            .order('name', { ascending: true });
        if (error) throw error;
        return (data || []).map(pg => ({ ...pg, role: 'admin' }));
    }

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
 * Get or create the invite token for a playgroup (one per campaign). Returns the token string.
 * Always uses the regular authenticated client so auth.uid() inside the RPC sees the real user,
 * even when admin mode (service role client) is active elsewhere.
 */
export async function getOrCreateInviteToken(playgroupId) {
    const supabase = getSupabase();
    const { data, error } = await supabase
        .rpc('create_invite_token', { p_playgroup_id: playgroupId });
    if (error) throw error;
    return data;
}

/**
 * Resolve an invite token to campaign id and name (for guest view). Callable by anon.
 */
export async function resolveInviteToken(token) {
    const client = getSupabase();
    const { data, error } = await client
        .rpc('resolve_invite_token', { p_token: token });
    if (error) throw error;
    return data?.[0] || null;
}

/**
 * Redeem an invite token. Adds current user to playgroup. Returns { playgroup_id, playgroup_name }.
 */
export async function redeemInviteToken(token) {
    const { data, error } = await getActiveClient()
        .rpc('redeem_invite_token', { p_token: token });
    if (error) throw error;
    return data?.[0] || null;
}

/**
 * Replace invite token for a campaign (admin). Deprecates old token, returns new token string.
 */
export async function replaceInviteToken(playgroupId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.rpc('replace_invite_token', { p_playgroup_id: playgroupId });
    if (error) throw error;
    return data;
}

/**
 * Create a new playgroup and add the creator as owner
 */
export async function createPlaygroup(name) {
    const supabase = getActiveClient();
    const { data: playgroup, error } = await supabase
        .rpc('create_playgroup_with_owner', { p_name: name });

    if (error) throw error;
    return playgroup;
}

/**
 * Fetch games for a playgroup
 */
export async function fetchGames(playgroupId) {
    const { data, error } = await getActiveClient()
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
    const { data, error } = await getActiveClient()
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
    const { data, error } = await getActiveClient()
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
 * Always uses the regular authenticated client so the operation runs as the logged-in user.
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
 * Always uses the regular authenticated client so the operation runs as the logged-in user.
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
    const { data, error } = await getActiveClient()
        .rpc('get_cross_campaign_player_stats', { p_user_id: userId });

    if (error) throw error;
    return data || [];
}

/**
 * Fetch a user's profile (e.g. favourite game, favourite quote). Returns { favourite_game, favourite_quote } or null.
 */
export async function fetchUserProfile(userId) {
    const { data, error } = await getActiveClient()
        .from('user_profile')
        .select('favourite_game, favourite_quote')
        .eq('user_id', userId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

/**
 * Set or clear a user's favourite game and/or favourite quote. Only the current user can update their own profile.
 * Pass undefined for a field to leave it unchanged when updating existing row (use null to clear).
 */
export async function upsertUserProfile(userId, favouriteGame, favouriteQuote) {
    const payload = { user_id: userId };
    if (favouriteGame !== undefined) payload.favourite_game = favouriteGame || null;
    if (favouriteQuote !== undefined) payload.favourite_quote = favouriteQuote || null;
    const { error } = await getActiveClient()
        .from('user_profile')
        .upsert(payload, { onConflict: 'user_id' });

    if (error) throw error;
}

/**
 * Fetch cross-campaign game breakdown for a linked player (by their user_id).
 */
export async function fetchCrossCampaignGameBreakdown(userId) {
    const { data, error } = await getActiveClient()
        .rpc('get_cross_campaign_game_breakdown', { p_user_id: userId });

    if (error) throw error;
    return data || [];
}

/**
 * Fetch recent entries for a player across all campaigns (cross-campaign profile view).
 * Returns the 20 most recent win entries.
 */
export async function fetchPlayerRecentEntries(userId, limit = 20) {
    const supabase = getActiveClient();
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
    const { data, error } = await getActiveClient()
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
    const { data, error } = await getActiveClient()
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
    const { data, error } = await getActiveClient()
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
export async function insertGame(playgroupId, name, globalGameId = null) {
    const row = { playgroup_id: playgroupId, name };
    if (globalGameId) row.global_game_id = globalGameId;
    const { data, error } = await getActiveClient()
        .from('games')
        .insert(row)
        .select()
        .single();

    if (error) throw error;
    return data;
}

/**
 * Insert a new player
 */
export async function insertPlayer(playgroupId, name) {
    const { data, error } = await getActiveClient()
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
    const supabase = getActiveClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    return user.user_metadata?.full_name || user.email || null;
}

/**
 * Insert a new entry (win record)
 */
export async function insertEntry(playgroupId, gameId, playerId, date) {
    const createdByName = await getCurrentUserName();
    const { data, error } = await getActiveClient()
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
    const { data, error } = await getActiveClient()
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
    const { error } = await getActiveClient().from('entries').delete().eq('id', entryId);
    if (error) throw error;
}

/**
 * Delete a game (cascades to entries and game_metadata)
 */
export async function deleteGameById(gameId) {
    const { error } = await getActiveClient().from('games').delete().eq('id', gameId);
    if (error) throw error;
}

/**
 * Delete a player
 */
export async function deletePlayerById(playerId) {
    const { error } = await getActiveClient().from('players').delete().eq('id', playerId);
    if (error) throw error;
}

/**
 * Upsert game metadata
 */
export async function upsertGameMetadata(gameId, image) {
    const { error } = await getActiveClient()
        .from('game_metadata')
        .upsert({ game_id: gameId, image }, { onConflict: 'game_id' });

    if (error) throw error;
}

/**
 * Upsert player metadata
 */
export async function upsertPlayerMetadata(playerId, image, color) {
    const { error } = await getActiveClient()
        .from('player_metadata')
        .upsert({ player_id: playerId, image: image || null, color: color || '#6366f1' }, { onConflict: 'player_id' });

    if (error) throw error;
}

/**
 * Fetch a single playgroup's name by ID — works for anon users (public read).
 * Used to show the campaign name in the guest banner.
 */
export async function fetchPlaygroupName(playgroupId) {
    const { data, error } = await getActiveClient()
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
    const supabase = getActiveClient();
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
    const supabase = getActiveClient();
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

// ── Admin Dashboard helpers ──────────────────────────────────────────────────

export async function fetchAllUsers() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data: { users }, error } = await ac.auth.admin.listUsers({ perPage: 1000 });
    if (error) throw error;
    return users || [];
}

export async function fetchAllPlaygroupMembers() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('playgroup_members').select('*');
    if (error) throw error;
    return data || [];
}

/**
 * Count how many meeples (players) are in a given playgroup.
 * Uses the players table so regular users can see the count.
 */
export async function fetchPlaygroupMemberCount(playgroupId) {
    if (!playgroupId) return 0;
    const { count, error } = await getActiveClient()
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('playgroup_id', playgroupId);
    if (error) throw error;
    return count || 0;
}

export async function fetchAppConfig() {
    const { data, error } = await getActiveClient()
        .from('app_config').select('key, value');
    if (error) throw error;
    return Object.fromEntries((data || []).map(r => [r.key, r.value]));
}

export async function setAppConfig(key, value) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('app_config').upsert(
        { key, value: String(value), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
    );
    if (error) throw error;
}

export async function fetchActiveAnnouncement() {
    const { data, error } = await getActiveClient()
        .from('announcements')
        .select('id, message, active, created_at')
        .eq('active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function fetchAllAnnouncements() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('announcements')
        .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function publishAnnouncement(message) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    await ac.from('announcements').update({ active: false }).eq('active', true);
    const { error } = await ac.from('announcements')
        .insert({ message, active: true });
    if (error) throw error;
}

export async function clearAnnouncement() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('announcements')
        .update({ active: false }).eq('active', true);
    if (error) throw error;
}

export async function deleteAnnouncement(id) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('announcements').delete().eq('id', id);
    if (error) throw error;
}

export async function reactivateAnnouncement(id) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    await ac.from('announcements').update({ active: false }).eq('active', true);
    const { error } = await ac.from('announcements').update({ active: true }).eq('id', id);
    if (error) throw error;
}

export async function fetchAllGames() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('games')
        .select('id, name, playgroup_id, global_game_id');
    if (error) throw error;
    return data || [];
}

export async function fetchAllPlayers() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('players')
        .select('id, name, playgroup_id, user_id');
    if (error) throw error;
    return data || [];
}

export async function fetchAllEntries() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('entries')
        .select('id, date, created_at, updated_at, created_by_name, updated_by_name, game_id, player_id, playgroup_id')
        .order('date', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function fetchAllInviteTokens() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('invite_tokens')
        .select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function deleteInviteToken(tokenId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('invite_tokens').delete().eq('id', tokenId);
    if (error) throw error;
}

export async function adminRemoveUserFromCampaigns(userId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('playgroup_members').delete().eq('user_id', userId);
    if (error) throw error;
}

export async function adminDeleteUserAccount(userId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.auth.admin.deleteUser(userId);
    if (error) throw error;
}

export async function deletePlaygroupAdmin(playgroupId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    await ac.from('entries').delete().eq('playgroup_id', playgroupId);
    await ac.from('games').delete().eq('playgroup_id', playgroupId);
    await ac.from('players').delete().eq('playgroup_id', playgroupId);
    await ac.from('playgroup_members').delete().eq('playgroup_id', playgroupId);
    await ac.from('invite_tokens').delete().eq('playgroup_id', playgroupId);
    const { error } = await ac.from('playgroups').delete().eq('id', playgroupId);
    if (error) throw error;
}

export async function fetchGlobalGames() {
    const { data, error } = await getActiveClient()
        .from('global_games').select('*').order('name');
    if (error) throw error;
    return data || [];
}

export async function upsertGlobalGame(bggId, name, yearPublished, thumbnailUrl) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('global_games')
        .upsert({ bgg_id: bggId, name, year_published: yearPublished, thumbnail_url: thumbnailUrl },
            { onConflict: 'bgg_id' })
        .select().single();
    if (error) throw error;
    return data;
}

export async function linkGameToGlobal(gameId, globalGameId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('games')
        .update({ global_game_id: globalGameId })
        .eq('id', gameId);
    if (error) throw error;
}

export async function fetchUnlinkedGames() {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { data, error } = await ac.from('games')
        .select('id, name, playgroup_id')
        .is('global_game_id', null)
        .order('name');
    if (error) throw error;
    return data || [];
}

export async function adminDeleteEntry(entryId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('entries').delete().eq('id', entryId);
    if (error) throw error;
}

export async function adminDeleteGame(gameId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('games').delete().eq('id', gameId);
    if (error) throw error;
}

export async function adminDeletePlayer(playerId) {
    const ac = getAdminClient();
    if (!ac) throw new Error('Admin client not available');
    const { error } = await ac.from('players').delete().eq('id', playerId);
    if (error) throw error;
}
