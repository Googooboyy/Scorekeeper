import {
    data,
    setModalCallback,
    uiState,
    saveData,
    escapeHtml,
    formatDate
} from './data.js';
import { getActivePlaygroup } from './playgroups.js';
import { showLoginPrompt } from './auth-ui.js';
import {
    upsertGameMetadata,
    upsertPlayerMetadata,
    updateEntry,
    fetchPlayerById,
    claimPlayer,
    unclaimPlayer,
    fetchCrossCampaignStats,
    fetchCrossCampaignGameBreakdown,
    fetchPlayerRecentEntries,
    fetchUserProfile,
    upsertUserProfile,
    insertPlayer
} from './supabase.js';
import { getSupabase } from './auth.js';

export function showModal(title, message, onConfirm, confirmLabel = 'OK') {
    setModalCallback(onConfirm);
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalMessage').innerHTML = message;
    document.getElementById('modalConfirm').textContent = confirmLabel;
    document.getElementById('modalOverlay').classList.add('active');
}

export function hideModal() {
    document.getElementById('modalOverlay').classList.remove('active');
    setModalCallback(null);
}

export function openGameImageModal(game) {
    uiState.currentGameForImage = game;
    document.getElementById('gameImageGameName').textContent = game;
    const currentImage = data.gameData && data.gameData[game] ? data.gameData[game].image : '';

    const preview = document.getElementById('gameImagePreview');
    if (currentImage) {
        preview.src = currentImage;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }

    uiState.tempGameImage = currentImage;
    const saveBtn = document.getElementById('gameImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    document.getElementById('gameImageModal').classList.add('active');
}

export function closeGameImageModal() {
    document.getElementById('gameImageModal').classList.remove('active');
    const saveBtn = document.getElementById('gameImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    uiState.currentGameForImage = null;
    uiState.tempGameImage = null;
}

export async function saveGameImage() {
    if (!uiState.currentGameForImage) return;
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const gameId = data._gameIdByName?.[uiState.currentGameForImage];
    if (!gameId) return;
    const btn = document.getElementById('gameImageSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
        await upsertGameMetadata(gameId, uiState.tempGameImage || null);
        if (!data.gameData) data.gameData = {};
        if (!data.gameData[uiState.currentGameForImage]) data.gameData[uiState.currentGameForImage] = {};
        if (uiState.tempGameImage) {
            data.gameData[uiState.currentGameForImage].image = uiState.tempGameImage;
            showNotification('Image set for "' + uiState.currentGameForImage + '"');
        } else {
            delete data.gameData[uiState.currentGameForImage].image;
            showNotification('Image removed from "' + uiState.currentGameForImage + '"');
        }
        saveData();
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        alert('Error saving image: ' + (err.message || err));
        return;
    }
    closeGameImageModal();
}

export function openPlayerImageModal(player) {
    uiState.currentPlayerForImage = player;
    document.getElementById('playerImagePlayerName').textContent = player;

    const playerData = data.playerData && data.playerData[player] ? data.playerData[player] : {};
    const currentImage = playerData.image || '';
    const currentColor = playerData.color || '#6366f1';

    const preview = document.getElementById('playerImagePreview');
    if (currentImage) {
        preview.src = currentImage;
        preview.style.display = 'block';
    } else {
        preview.style.display = 'none';
    }

    uiState.selectedColor = currentColor;
    document.querySelectorAll('#colorPicker .color-option').forEach(btn => {
        btn.classList.toggle('selected', btn.getAttribute('data-color') === currentColor);
    });

    uiState.tempPlayerImage = currentImage;
    const saveBtn = document.getElementById('playerImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    document.getElementById('playerImageModal').classList.add('active');
}

export function closePlayerImageModal() {
    document.getElementById('playerImageModal').classList.remove('active');
    const saveBtn = document.getElementById('playerImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    uiState.currentPlayerForImage = null;
    uiState.tempPlayerImage = null;
}

export async function savePlayerImage() {
    if (!uiState.currentPlayerForImage) return;
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const playerId = data._playerIdByName?.[uiState.currentPlayerForImage];
    if (!playerId) return;
    const btn = document.getElementById('playerImageSave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
        await upsertPlayerMetadata(playerId, uiState.tempPlayerImage || null, uiState.selectedColor);
        if (!data.playerData) data.playerData = {};
        if (!data.playerData[uiState.currentPlayerForImage]) data.playerData[uiState.currentPlayerForImage] = {};
        if (uiState.tempPlayerImage) {
            data.playerData[uiState.currentPlayerForImage].image = uiState.tempPlayerImage;
        } else {
            delete data.playerData[uiState.currentPlayerForImage].image;
        }
        data.playerData[uiState.currentPlayerForImage].color = uiState.selectedColor;
        saveData();
        showNotification('Customization saved for "' + uiState.currentPlayerForImage + '"');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        alert('Error saving customization: ' + (err.message || err));
        return;
    }
    closePlayerImageModal();
}

export async function resetPlayerCustomization() {
    if (!uiState.currentPlayerForImage) return;
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const playerId = data._playerIdByName?.[uiState.currentPlayerForImage];
    if (!playerId) { closePlayerImageModal(); return; }
    try {
        await upsertPlayerMetadata(playerId, null, '#6366f1');
        if (data.playerData && data.playerData[uiState.currentPlayerForImage]) {
            delete data.playerData[uiState.currentPlayerForImage];
            saveData();
            showNotification('Reset customization for "' + uiState.currentPlayerForImage + '"');
        }
    } catch (err) {
        alert('Error resetting: ' + (err.message || err));
    }
    closePlayerImageModal();
}

export function handleImageFileSelect(file, previewId, callback) {
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        alert('Image too large. Please choose an image under 2MB.');
        return;
    }

    const reader = new FileReader();
    reader.onload = function (e) {
        const result = e.target.result;
        const preview = document.getElementById(previewId);
        if (preview) {
            preview.src = result;
            preview.style.display = 'block';
        }
        if (callback) callback(result);
    };
    reader.readAsDataURL(file);
}

export function openEditEntryModal(id) {
    const entry = data.entries.find(e => e.id === id);
    if (!entry) return;

    uiState.currentEditId = id;

    const gameSelect = document.getElementById('editGameSelect');
    gameSelect.innerHTML = data.games.map(g =>
        '<option value="' + escapeHtmlForExport(g) + '"' + (g === entry.game ? ' selected' : '') + '>' + escapeHtmlForExport(g) + '</option>'
    ).join('');

    const playerSelect = document.getElementById('editPlayerSelect');
    playerSelect.innerHTML = data.players.map(p =>
        '<option value="' + escapeHtmlForExport(p) + '"' + (p === entry.player ? ' selected' : '') + '>' + escapeHtmlForExport(p) + '</option>'
    ).join('');

    document.getElementById('editDateInput').value = entry.date;

    const saveBtn = document.getElementById('editEntrySave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
    document.getElementById('editEntryModal').classList.add('active');
}

export function closeEditEntryModal() {
    document.getElementById('editEntryModal').classList.remove('active');
    const saveBtn = document.getElementById('editEntrySave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
    uiState.currentEditId = null;
}

export async function saveEditedEntry() {
    if (!uiState.currentEditId) return;
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const newGame = document.getElementById('editGameSelect').value;
    const newPlayer = document.getElementById('editPlayerSelect').value;
    const newDate = document.getElementById('editDateInput').value;
    if (!newGame || !newPlayer || !newDate) {
        alert('Please fill all fields');
        return;
    }
    const gameId = data._gameIdByName?.[newGame];
    const playerId = data._playerIdByName?.[newPlayer];
    if (!gameId || !playerId) { alert('Invalid game or meeple'); return; }
    const entryIndex = data.entries.findIndex(e => e.id === uiState.currentEditId);
    if (entryIndex === -1) return;
    const btn = document.getElementById('editEntrySave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
        const updated = await updateEntry(uiState.currentEditId, gameId, playerId, newDate);
        const { data: { user } } = await getSupabase().auth.getUser();
        const updatedByName = user
            ? (user.user_metadata?.full_name || user.email || null)
            : null;
        data.entries[entryIndex] = {
            ...data.entries[entryIndex],
            game: newGame,
            player: newPlayer,
            date: newDate,
            updated_at: updated?.updated_at || new Date().toISOString(),
            updated_by_name: updatedByName
        };
        saveData();
        closeEditEntryModal();
        showNotification('Entry updated');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
        alert('Error updating entry: ' + (err.message || err));
    }
}

function escapeHtmlForExport(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Favourite Game Picker ───────────────────────────────────────────────────

let _faveGameCleanup = null;

function _openFavouriteGamePicker(userId, gameBreakdown, userProfile, computedTopGame, onSave) {
    const modal = document.getElementById('favouriteGameModal');
    const select = document.getElementById('favouriteGameSelect');
    const cancelBtn = document.getElementById('favouriteGameCancel');
    const saveBtn = document.getElementById('favouriteGameSave');

    const allGames = [...new Set([
        ...(data.games || []),
        ...(gameBreakdown || []).map(g => g.game_name || g.game)
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b));
    select.innerHTML = '<option value="">Auto (by wins)</option>' +
        allGames.map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('');
    select.value = userProfile?.favourite_game || '';

    const close = () => {
        modal.classList.remove('active');
        if (_faveGameCleanup) { _faveGameCleanup(); _faveGameCleanup = null; }
    };

    const onCancel = () => close();
    const onSaveClick = async () => {
        const value = select.value;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
            await upsertUserProfile(userId, value || null);
            onSave(value ? value : computedTopGame);
            showNotification('Favourite game updated');
            close();
        } catch (err) {
            showNotification('Could not update: ' + (err.message || err));
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    };

    cancelBtn.addEventListener('click', onCancel);
    saveBtn.addEventListener('click', onSaveClick);
    const onOverlay = (e) => { if (e.target === modal) close(); };
    modal.addEventListener('click', onOverlay);

    _faveGameCleanup = () => {
        cancelBtn.removeEventListener('click', onCancel);
        saveBtn.removeEventListener('click', onSaveClick);
        modal.removeEventListener('click', onOverlay);
    };

    modal.classList.add('active');
}

// ─── Player Profile Modal ────────────────────────────────────────────────────

let _profileCleanup = null;

export function closePlayerProfileModal() {
    document.getElementById('playerProfileModal').classList.remove('active');
    if (_profileCleanup) { _profileCleanup(); _profileCleanup = null; }
}

/**
 * Open the player profile modal for the given player name.
 * Looks up the player ID from the current campaign data, then fetches
 * linked cross-campaign stats if the player has been claimed by a user.
 */
export async function openPlayerProfileModal(playerName) {
    const playerId = data._playerIdByName?.[playerName];
    if (!playerId) return;

    const modal = document.getElementById('playerProfileModal');
    modal.classList.add('active');

    // Close button
    const closeBtn = document.getElementById('playerProfileClose');
    const onClose = () => closePlayerProfileModal();
    closeBtn.addEventListener('click', onClose);
    const onOverlay = (e) => { if (e.target === modal) closePlayerProfileModal(); };
    modal.addEventListener('click', onOverlay);
    _profileCleanup = () => {
        closeBtn.removeEventListener('click', onClose);
        modal.removeEventListener('click', onOverlay);
    };

    // Show loading state
    _renderProfileLoading(playerName);

    try {
        const player = await fetchPlayerById(playerId);
        const playerMeta = data.playerData?.[playerName] || {};
        const supabase = getSupabase();
        const { data: { user } } = await supabase.auth.getUser();

        if (player.user_id) {
            // Player is linked — fetch cross-campaign data and user profile (favourite game)
            const [campaignStats, gameBreakdown, recentEntries, userProfile] = await Promise.all([
                fetchCrossCampaignStats(player.user_id),
                fetchCrossCampaignGameBreakdown(player.user_id),
                fetchPlayerRecentEntries(player.user_id, 10),
                fetchUserProfile(player.user_id)
            ]);
            _renderProfileLinked(player, playerMeta, campaignStats, gameBreakdown, recentEntries, user, userProfile);
        } else {
            // Player is not linked — show current-campaign stats only
            const currentEntries = data.entries.filter(e => e.player === playerName);
            _renderProfileUnlinked(player, playerName, playerMeta, currentEntries, user);
        }

        // Claim button handler
        const claimBtn = document.getElementById('profileClaimBtn');
        claimBtn.onclick = async () => {
            if (claimBtn.disabled) return;
            claimBtn.disabled = true;
            claimBtn.textContent = 'Linking…';
            try {
                await claimPlayer(playerId);
                if (!data.playerData[playerName]) data.playerData[playerName] = {};
                const { data: { user: me } } = await getSupabase().auth.getUser();
                data.playerData[playerName].userId = me?.id || null;
                showNotification('Meeple linked to your account!');
                closePlayerProfileModal();
                await openPlayerProfileModal(playerName);
            } catch (err) {
                claimBtn.disabled = false;
                claimBtn.textContent = 'This is me — link my account';
                showNotification('Could not link meeple: ' + (err.message || err));
            }
        };

        // Unlink button handler
        const unlinkBtn = document.getElementById('profileUnlinkBtn');
        unlinkBtn.onclick = async () => {
            unlinkBtn.disabled = true;
            unlinkBtn.textContent = 'Unlinking…';
            try {
                await unclaimPlayer(playerId);
                if (data.playerData[playerName]) {
                    data.playerData[playerName].userId = null;
                }
                showNotification('Account unlinked from this meeple.');
                closePlayerProfileModal();
                await openPlayerProfileModal(playerName);
            } catch (err) {
                unlinkBtn.disabled = false;
                unlinkBtn.textContent = 'Unlink my account';
                showNotification('Could not unlink: ' + (err.message || err));
            }
        };

    } catch (err) {
        document.getElementById('profileName').textContent = playerName;
        document.getElementById('profileMeta').textContent = 'Could not load profile: ' + (err.message || err);
    }
}

function _renderProfileLoading(playerName) {
    document.getElementById('profileName').textContent = playerName;
    document.getElementById('profileMeta').textContent = 'Loading…';
    document.getElementById('profileAvatarImg').style.display = 'none';
    document.getElementById('profileAvatarPlaceholder').style.display = 'flex';
    document.getElementById('profileClaimBtn').style.display = 'none';
    document.getElementById('profileUnlinkBtn').style.display = 'none';
    document.getElementById('profileTotalWins').textContent = '—';
    document.getElementById('profileCampaignCount').textContent = '—';
    document.getElementById('profileFaveGame').textContent = '—';
    document.getElementById('profileCampaignSection').style.display = 'none';
    document.getElementById('profileCampaignList').innerHTML = '';
    document.getElementById('profileGameList').innerHTML = '';
    document.getElementById('profileHistoryList').innerHTML = '';
    // Always hide the favourite-game edit button while loading —
    // it will only be re-shown by _renderProfileLinked when isOwnProfile is confirmed true
    const faveCard = document.getElementById('profileFaveGameCard');
    if (faveCard) {
        const existingEditBtn = faveCard.querySelector('.profile-fave-edit-btn');
        if (existingEditBtn) existingEditBtn.style.display = 'none';
    }
}

function _setAvatar(meta) {
    const img = document.getElementById('profileAvatarImg');
    const placeholder = document.getElementById('profileAvatarPlaceholder');
    const wrap = document.getElementById('profileAvatarWrap');
    if (meta.image) {
        img.src = meta.image;
        img.style.display = 'block';
        placeholder.style.display = 'none';
    } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
    }
    if (meta.color) {
        wrap.style.setProperty('--profile-color', meta.color);
        wrap.classList.add('has-color');
    } else {
        wrap.classList.remove('has-color');
    }
}

function _renderProfileLinked(player, meta, campaignStats, gameBreakdown, recentEntries, currentUser, userProfile) {
    _setAvatar(meta);

    const totalWins = campaignStats.reduce((s, r) => s + Number(r.total_wins), 0);
    const campaignCount = campaignStats.length;
    const topCount = gameBreakdown[0]?.total_wins != null ? Number(gameBreakdown[0].total_wins) : 0;
    const tied = gameBreakdown[1] && Number(gameBreakdown[1].total_wins) === topCount;
    const computedTopGame = topCount === 0 ? '—' : tied
        ? [gameBreakdown[0].game_name, gameBreakdown[1].game_name].join(', ')
        : (gameBreakdown[0]?.game_name || '—');
    const displayFave = userProfile?.favourite_game || computedTopGame;

    document.getElementById('profileName').textContent = player.name;
    document.getElementById('profileMeta').textContent = campaignCount + ' campaign' + (campaignCount !== 1 ? 's' : '');
    document.getElementById('profileTotalWins').textContent = totalWins;
    document.getElementById('profileCampaignCount').textContent = campaignCount;
    document.getElementById('profileFaveGame').textContent = displayFave;
    document.getElementById('profileCampaignStatCard').style.display = '';

    // Favourite game edit: show only when viewing own profile
    const isOwnProfile = currentUser && player.user_id === currentUser.id;
    const faveCard = document.getElementById('profileFaveGameCard');
    if (faveCard) {
        let editBtn = faveCard.querySelector('.profile-fave-edit-btn');
        if (isOwnProfile) {
            if (!editBtn) {
                editBtn = document.createElement('button');
                editBtn.className = 'profile-fave-edit-btn';
                editBtn.setAttribute('type', 'button');
                editBtn.setAttribute('aria-label', 'Change favourite game');
                editBtn.title = 'Change favourite game';
                editBtn.textContent = '✎';
                faveCard.appendChild(editBtn);
            }
            editBtn.style.display = 'inline-flex';
            editBtn.onclick = () => _openFavouriteGamePicker(player.user_id, gameBreakdown, userProfile, computedTopGame, (newDisplayValue) => {
                document.getElementById('profileFaveGame').textContent = newDisplayValue;
            });
        } else if (editBtn) {
            editBtn.style.display = 'none';
        }
    }

    // Claim btn: always hidden when already linked
    document.getElementById('profileClaimBtn').style.display = 'none';

    // Unlink btn: show only to the user who owns this link
    const unlinkBtn = document.getElementById('profileUnlinkBtn');
    unlinkBtn.style.display = (currentUser && player.user_id === currentUser.id) ? 'inline-flex' : 'none';
    unlinkBtn.disabled = false;
    unlinkBtn.textContent = 'Unlink my account';

    // Campaign breakdown
    document.getElementById('profileCampaignSection').style.display = '';
    document.getElementById('profileCampaignList').innerHTML = campaignStats.map(row => {
        const wins = Number(row.total_wins);
        return '<div class="profile-campaign-row">' +
            '<div class="profile-campaign-name">' + escapeHtml(row.playgroup_name) + '</div>' +
            '<div class="profile-campaign-detail">' +
            (row.top_game ? escapeHtml(row.top_game) + ' · ' : '') +
            '<strong>' + wins + '</strong> win' + (wins !== 1 ? 's' : '') +
            '</div>' +
            '</div>';
    }).join('') || '<div class="profile-empty">No wins yet.</div>';

    // Game breakdown
    document.getElementById('profileGameSectionTitle').textContent = 'Wins by Game (all campaigns)';
    document.getElementById('profileGameList').innerHTML = _renderGameBreakdownHtml(gameBreakdown.map(r => ({
        game: r.game_name, count: Number(r.total_wins)
    })));

    // Recent history
    document.getElementById('profileHistoryList').innerHTML = _renderRecentHistoryHtml(recentEntries, true);
}

function _renderProfileUnlinked(player, playerName, meta, currentEntries, currentUser) {
    _setAvatar(meta);

    const totalWins = currentEntries.length;

    // Game breakdown from current campaign
    const gameCounts = {};
    currentEntries.forEach(e => { gameCounts[e.game] = (gameCounts[e.game] || 0) + 1; });
    const gameBreakdown = Object.entries(gameCounts)
        .map(([game, count]) => ({ game, count }))
        .sort((a, b) => b.count - a.count);
    const topCount = gameBreakdown[0]?.count ?? 0;
    const tied = gameBreakdown[1] && gameBreakdown[1].count === topCount;
    const topGame = topCount === 0 ? '—' : tied
        ? [gameBreakdown[0].game, gameBreakdown[1].game].join(', ')
        : (gameBreakdown[0]?.game || '—');

    document.getElementById('profileName').textContent = playerName;
    document.getElementById('profileMeta').textContent = 'This campaign only';
    document.getElementById('profileTotalWins').textContent = totalWins;
    document.getElementById('profileCampaignStatCard').style.display = 'none';
    document.getElementById('profileFaveGame').textContent = topGame;

    // Claim button: show only if logged in, player is unclaimed,
    // AND user doesn't already have a linked player in this campaign
    const claimBtn = document.getElementById('profileClaimBtn');
    const unlinkBtn2 = document.getElementById('profileUnlinkBtn');
    unlinkBtn2.style.display = 'none';

    if (currentUser) {
        const alreadyLinkedInCampaign = Object.values(data.playerData || {})
            .some(pd => pd.userId && pd.userId === currentUser.id);
        if (alreadyLinkedInCampaign) {
            // User is already linked to a different player in this campaign
            claimBtn.style.display = 'inline-flex';
            claimBtn.disabled = true;
            claimBtn.textContent = 'You\'re already linked to a meeple in this campaign';
        } else {
            claimBtn.style.display = 'inline-flex';
            claimBtn.disabled = false;
            claimBtn.textContent = 'This is me — link my account';
        }
    } else {
        claimBtn.style.display = 'none';
    }

    // Campaign section: hidden
    document.getElementById('profileCampaignSection').style.display = 'none';

    // Game breakdown (current campaign)
    document.getElementById('profileGameSectionTitle').textContent = 'Wins by Game';
    document.getElementById('profileGameList').innerHTML = _renderGameBreakdownHtml(gameBreakdown);

    // Recent history (current campaign)
    const recentEntries = [...currentEntries]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10)
        .map(e => ({ date: e.date, game: e.game, campaign: null }));
    document.getElementById('profileHistoryList').innerHTML = _renderRecentHistoryHtml(recentEntries, false);
}

function _renderGameBreakdownHtml(gameBreakdown) {
    if (!gameBreakdown.length) return '<div class="profile-empty">No wins recorded yet.</div>';
    const max = gameBreakdown[0].count;
    return gameBreakdown.map(g => {
        const pct = max > 0 ? Math.round((g.count / max) * 100) : 0;
        return '<div class="profile-game-row">' +
            '<div class="profile-game-name">' + escapeHtml(g.game) + '</div>' +
            '<div class="profile-game-bar-wrap">' +
            '<div class="profile-game-bar" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<div class="profile-game-count">' + g.count + '</div>' +
            '</div>';
    }).join('');
}

function _renderRecentHistoryHtml(entries, showCampaign) {
    if (!entries.length) return '<div class="profile-empty">No recent wins.</div>';
    return entries.map(e => {
        const campaignBadge = showCampaign && e.campaign
            ? '<span class="profile-history-campaign">' + escapeHtml(e.campaign) + '</span>'
            : '';
        return '<div class="profile-history-row">' +
            '<span class="profile-history-game">' + escapeHtml(e.game) + '</span>' +
            campaignBadge +
            '<span class="profile-history-date">' + formatDate(e.date) + '</span>' +
            '</div>';
    }).join('');
}

// ─── End Player Profile Modal ────────────────────────────────────────────────

// ─── Score Tabulator ─────────────────────────────────────────────────────────

let _tallyState = null;
let _tallyCleanup = null;

export function openScoreTabulator() {
    const modal = document.getElementById('scoreTallyModal');
    if (!modal) return;

    _tallyState = {
        game: null,
        participants: [], // { name, isTemp }
        roundCount: 3,
        scores: []        // [roundIndex][participantIndex]
    };

    // Populate game dropdown
    const gameSelect = document.getElementById('tallyGameSelect');
    gameSelect.innerHTML = '<option value="">Select a game…</option>' +
        (data.games || []).map(g => '<option value="' + escapeHtml(g) + '">' + escapeHtml(g) + '</option>').join('');
    gameSelect.value = '';

    // Render meeple chips from campaign
    _renderTallyChips();

    // Clear temp fields
    document.getElementById('tallyTempList').innerHTML = '';
    document.getElementById('tallyTempName').value = '';

    // Show stage 1
    _tallyShowStage(1);
    document.getElementById('tallyTitle').textContent = 'Tally Scores';
    document.getElementById('tallySubtitle').textContent = 'Set up your game';
    document.getElementById('tallyWinnerBar').innerHTML = '';
    _updateTallyStartBtn();

    // ── Event handlers ──
    const onClose    = () => closeScoreTabulator();
    const onOverlay  = (e) => { if (e.target === modal) closeScoreTabulator(); };

    const onGameChange = () => {
        _tallyState.game = gameSelect.value || null;
        _updateTallyStartBtn();
    };

    const onAddTemp = () => _tallyAddTempMeeple();
    const onTempKey = (e) => { if (e.key === 'Enter') _tallyAddTempMeeple(); };

    const onStart = () => {
        if (!_tallyState.game || _tallyState.participants.length < 2) return;
        _initScoreTable();
        _tallyShowStage(2);
        document.getElementById('tallyTitle').textContent = _tallyState.game;
        document.getElementById('tallySubtitle').textContent = 'Enter scores for each round';
    };

    const onBack = () => {
        _tallyShowStage(1);
        document.getElementById('tallyTitle').textContent = 'Tally Scores';
        document.getElementById('tallySubtitle').textContent = 'Set up your game';
    };

    const onAddRound = () => {
        _tallyState.roundCount++;
        _tallyState.scores.push(new Array(_tallyState.participants.length).fill(null));
        _renderScoreTableBody();
        _updateTotals();
    };

    const onRecord = () => _tallyRecordWin();

    const closeBtn    = document.getElementById('tallyClose');
    const cancelBtn   = document.getElementById('tallyCancelBtn');
    const startBtn    = document.getElementById('tallyStartBtn');
    const addTempBtn  = document.getElementById('tallyAddTempBtn');
    const tempNameIn  = document.getElementById('tallyTempName');
    const backBtn     = document.getElementById('tallyBackBtn');
    const addRoundBtn = document.getElementById('tallyAddRoundBtn');
    const recordBtn   = document.getElementById('tallyRecordBtn');

    closeBtn.addEventListener('click', onClose);
    cancelBtn.addEventListener('click', onClose);
    gameSelect.addEventListener('change', onGameChange);
    addTempBtn.addEventListener('click', onAddTemp);
    tempNameIn.addEventListener('keypress', onTempKey);
    startBtn.addEventListener('click', onStart);
    backBtn.addEventListener('click', onBack);
    addRoundBtn.addEventListener('click', onAddRound);
    recordBtn.addEventListener('click', onRecord);
    modal.addEventListener('click', onOverlay);

    _tallyCleanup = () => {
        closeBtn.removeEventListener('click', onClose);
        cancelBtn.removeEventListener('click', onClose);
        gameSelect.removeEventListener('change', onGameChange);
        addTempBtn.removeEventListener('click', onAddTemp);
        tempNameIn.removeEventListener('keypress', onTempKey);
        startBtn.removeEventListener('click', onStart);
        backBtn.removeEventListener('click', onBack);
        addRoundBtn.removeEventListener('click', onAddRound);
        recordBtn.removeEventListener('click', onRecord);
        modal.removeEventListener('click', onOverlay);
    };

    modal.classList.add('active');
}

export function closeScoreTabulator() {
    const modal = document.getElementById('scoreTallyModal');
    if (modal) modal.classList.remove('active');
    if (_tallyCleanup) { _tallyCleanup(); _tallyCleanup = null; }
    _tallyState = null;
}

function _tallyShowStage(n) {
    document.querySelectorAll('.tally-stage').forEach(s => s.classList.remove('active'));
    document.getElementById('tallyStage' + n).classList.add('active');
}

function _renderTallyChips() {
    const container = document.getElementById('tallyMeepleChips');
    if (!_tallyState) return;
    container.innerHTML = (data.players || []).map(p => {
        const sel = _tallyState.participants.some(x => x.name === p && !x.isTemp);
        return '<button class="tally-chip' + (sel ? ' selected' : '') + '" data-name="' + escapeHtml(p) + '" type="button">' + escapeHtml(p) + '</button>';
    }).join('');

    container.querySelectorAll('.tally-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.getAttribute('data-name');
            const idx = _tallyState.participants.findIndex(x => x.name === name && !x.isTemp);
            if (idx >= 0) {
                _tallyState.participants.splice(idx, 1);
                btn.classList.remove('selected');
            } else {
                _tallyState.participants.push({ name, isTemp: false });
                btn.classList.add('selected');
            }
            _updateTallyStartBtn();
        });
    });
}

function _tallyAddTempMeeple() {
    const input = document.getElementById('tallyTempName');
    const name = input.value.trim();
    if (!name) return;
    const dup = _tallyState.participants.some(x => x.name.toLowerCase() === name.toLowerCase());
    if (dup) { input.value = ''; return; }
    _tallyState.participants.push({ name, isTemp: true });
    input.value = '';
    _renderTallyTempList();
    _updateTallyStartBtn();
}

function _renderTallyTempList() {
    const list = document.getElementById('tallyTempList');
    const temps = _tallyState.participants.filter(x => x.isTemp);
    list.innerHTML = temps.map(p =>
        '<span class="tally-temp-tag">' + escapeHtml(p.name) +
        ' <button class="tally-temp-remove" data-name="' + escapeHtml(p.name) + '" type="button" aria-label="Remove">×</button></span>'
    ).join('');
    list.querySelectorAll('.tally-temp-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const name = btn.getAttribute('data-name');
            _tallyState.participants = _tallyState.participants.filter(x => !(x.name === name && x.isTemp));
            _renderTallyTempList();
            _updateTallyStartBtn();
        });
    });
}

function _updateTallyStartBtn() {
    const btn = document.getElementById('tallyStartBtn');
    if (!btn) return;
    btn.disabled = !(_tallyState?.game && _tallyState?.participants.length >= 2);
}

function _initScoreTable() {
    const n = _tallyState.participants.length;
    _tallyState.scores = Array.from({ length: _tallyState.roundCount }, () => new Array(n).fill(null));
    _renderScoreTableHead();
    _renderScoreTableBody();
    _updateTotals();
}

function _renderScoreTableHead() {
    const head = document.getElementById('scoreTableHead');
    head.innerHTML = '<tr><th class="score-th-round"></th>' +
        _tallyState.participants.map(p =>
            '<th class="score-th-player' + (p.isTemp ? ' is-temp' : '') + '">' +
            escapeHtml(p.name) +
            (p.isTemp ? ' <span class="tally-guest-badge">guest</span>' : '') +
            '</th>'
        ).join('') + '</tr>';
}

function _renderScoreTableBody() {
    const body = document.getElementById('scoreTableBody');
    body.innerHTML = _tallyState.scores.map((row, ri) =>
        '<tr><td class="score-td-round">Rnd ' + (ri + 1) + '</td>' +
        row.map((val, ci) =>
            '<td class="score-td"><input type="number" class="score-input" data-ri="' + ri + '" data-ci="' + ci + '" value="' + (val !== null ? val : '') + '" min="0" placeholder="0" inputmode="decimal"></td>'
        ).join('') + '</tr>'
    ).join('');

    body.querySelectorAll('.score-input').forEach(input => {
        input.addEventListener('input', () => {
            const ri = parseInt(input.dataset.ri);
            const ci = parseInt(input.dataset.ci);
            _tallyState.scores[ri][ci] = parseFloat(input.value) || 0;
            _updateTotals();
        });
    });
}

function _updateTotals() {
    const n = _tallyState.participants.length;
    const totals = new Array(n).fill(0);
    _tallyState.scores.forEach(row => {
        row.forEach((val, ci) => { totals[ci] += (parseFloat(val) || 0); });
    });
    const maxTotal = Math.max(...totals);
    const winnerIdxs = totals.map((t, i) => t === maxTotal ? i : -1).filter(i => i >= 0);

    const foot = document.getElementById('scoreTableFoot');
    foot.innerHTML = '<tr><td class="score-td-round score-total-label">Total</td>' +
        totals.map((t, i) => {
            const isWin = winnerIdxs.includes(i) && maxTotal > 0;
            return '<td class="score-td score-total' + (isWin ? ' score-winner' : '') + '">' + t + (isWin ? ' 👑' : '') + '</td>';
        }).join('') + '</tr>';

    _updateWinnerBar(winnerIdxs, totals, maxTotal);
}

function _updateWinnerBar(winnerIdxs, totals, maxTotal) {
    const bar = document.getElementById('tallyWinnerBar');
    const recordBtn = document.getElementById('tallyRecordBtn');

    if (!maxTotal) {
        bar.innerHTML = '';
        recordBtn.textContent = 'Record This Win 🎉';
        recordBtn.disabled = false;
        return;
    }

    const isTied = winnerIdxs.length > 1;
    const hasTemp = !isTied && _tallyState.participants[winnerIdxs[0]]?.isTemp;
    const winnerNames = winnerIdxs.map(i => escapeHtml(_tallyState.participants[i].name));
    const pts = totals[winnerIdxs[0]];

    let html = '';
    if (isTied) {
        html = '<div class="tally-winner-info tally-tied">🤝 Tied: <strong>' + winnerNames.join(' &amp; ') + '</strong> (' + pts + ' pts each)</div>';
        recordBtn.textContent = 'Record a Win';
        recordBtn.disabled = false;
    } else {
        const p = _tallyState.participants[winnerIdxs[0]];
        html = '<div class="tally-winner-info' + (hasTemp ? ' tally-guest-win' : '') + '">👑 Leading: <strong>' + escapeHtml(p.name) + '</strong> (' + pts + ' pts)' +
               (hasTemp ? ' <span class="tally-guest-badge">guest</span>' : '') + '</div>';
        if (hasTemp) {
            html += '<div class="tally-temp-warning">⚠️ <strong>' + escapeHtml(p.name) + '</strong> is a guest meeple. Tap below to add them to your campaign and record the win.</div>';
            recordBtn.textContent = 'Add to Campaign & Record 🎉';
        } else {
            recordBtn.textContent = 'Record This Win 🎉';
        }
        recordBtn.disabled = false;
    }

    bar.innerHTML = html;
}

async function _tallyRecordWin() {
    if (!_tallyState) return;

    const n = _tallyState.participants.length;
    const totals = new Array(n).fill(0);
    _tallyState.scores.forEach(row => {
        row.forEach((val, ci) => { totals[ci] += (parseFloat(val) || 0); });
    });
    const maxTotal = Math.max(...totals);
    const winnerIdxs = totals.map((t, i) => t === maxTotal ? i : -1).filter(i => i >= 0);

    const gameName = _tallyState.game;

    // Tie — close and let them pick manually
    if (winnerIdxs.length > 1) {
        const names = winnerIdxs.map(i => _tallyState.participants[i].name).join(' & ');
        closeScoreTabulator();
        showNotification("It's a tie between " + names + "! Record the win manually.");
        return;
    }

    const winner = _tallyState.participants[winnerIdxs[0]];

    // Temp meeple won — add them to campaign first
    if (winner.isTemp) {
        const { getActivePlaygroup } = await import('./playgroups.js');
        const pg = getActivePlaygroup();
        if (!pg) { showNotification('No active campaign.'); return; }

        const recordBtn = document.getElementById('tallyRecordBtn');
        recordBtn.disabled = true;
        recordBtn.textContent = 'Adding…';
        try {
            const row = await insertPlayer(pg.id, winner.name);
            data.players.push(winner.name);
            data._playerIdByName[winner.name] = row.id;
            winner.isTemp = false;
            showNotification(winner.name + ' added to campaign!');
        } catch (err) {
            recordBtn.disabled = false;
            recordBtn.textContent = 'Add to Campaign & Record 🎉';
            showNotification('Could not add meeple: ' + (err.message || err));
            return;
        }
    }

    closeScoreTabulator();
    // Bridge to events.js via custom event (avoids circular import with render.js)
    window.dispatchEvent(new CustomEvent('tallyComplete', {
        detail: { game: gameName, winner: winner.name }
    }));
}

// ─── End Score Tabulator ──────────────────────────────────────────────────────

export function fireConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    const colors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#fbbf24', '#ef4444', '#3b82f6', '#ec4899', '#06b6d4'];
    const pieces = Array.from({ length: 120 }, () => ({
        x: Math.random() * canvas.width,
        y: -20 - Math.random() * 120,
        w: 6 + Math.random() * 8,
        h: 4 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        tiltAngle: Math.random() * Math.PI * 2,
        tiltSpeed: 0.08 + Math.random() * 0.15,
        speed: 2 + Math.random() * 3.5,
        opacity: 1,
        shape: Math.random() > 0.4 ? 'rect' : 'circle',
    }));
    let frame = 0;
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        frame++;
        let alive = false;
        for (const p of pieces) {
            p.y += p.speed;
            p.tiltAngle += p.tiltSpeed;
            if (frame > 80) p.opacity = Math.max(0, p.opacity - 0.02);
            if (p.opacity > 0 && p.y < canvas.height + 20) alive = true;
            ctx.save();
            ctx.globalAlpha = p.opacity;
            ctx.fillStyle = p.color;
            ctx.translate(p.x + Math.sin(p.tiltAngle) * 8, p.y);
            ctx.rotate(p.tiltAngle);
            if (p.shape === 'rect') {
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            } else {
                ctx.beginPath();
                ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        if (alive) requestAnimationFrame(animate);
        else canvas.remove();
    }
    animate();
}

export function showNotification(message) {
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--bg-card); color: var(--text-primary); padding: 16px 24px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.5); z-index: 1000; animation: slideUp 0.3s ease; font-weight: 500;';
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}
