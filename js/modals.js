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
    fetchCrossCampaignGamesPlayed,
    fetchPlayerRecentEntries,
    fetchUserProfile,
    upsertUserProfile,
    insertPlayer,
    fetchGamesFromOtherCampaigns,
    insertGame
} from './supabase.js';
import { getSupabase } from './auth.js';
import { renderGames, renderGameSelection, renderAll } from './render.js';
import { deletePlayer } from './actions.js';

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
    const urlInput = document.getElementById('gameImageUrlInput');
    if (urlInput) urlInput.value = '';
    const saveBtn = document.getElementById('gameImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    document.getElementById('gameImageModal').classList.add('active');
}

export function closeGameImageModal() {
    document.getElementById('gameImageModal').classList.remove('active');
    const saveBtn = document.getElementById('gameImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    const urlInput = document.getElementById('gameImageUrlInput');
    if (urlInput) urlInput.value = '';
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
        renderGames();
        renderGameSelection();
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
        showNotification('Error saving image: ' + (err.message || err));
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
    const removeImageBtn = document.getElementById('playerImageRemoveInSection');
    if (currentImage) {
        preview.src = currentImage;
        preview.style.display = 'block';
        if (removeImageBtn) removeImageBtn.style.display = 'inline-block';
    } else {
        preview.style.display = 'none';
        if (removeImageBtn) removeImageBtn.style.display = 'none';
    }

    const fileInput = document.getElementById('playerImageFileInput');
    if (fileInput) fileInput.value = '';

    uiState.selectedColor = currentColor;
    document.querySelectorAll('#colorPicker .color-option').forEach(btn => {
        btn.classList.toggle('selected', btn.getAttribute('data-color') === currentColor);
    });

    uiState.tempPlayerImage = currentImage;
    const saveBtn = document.getElementById('playerImageSave');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }

    // Favourite quote selection (only for own linked meeple)
    const quoteSection = document.getElementById('playerFavouriteQuoteSection');
    const quoteSelect = document.getElementById('playerFavouriteQuoteSelect');
    const isOwnMeeple = !!(data.currentUserId && playerData.userId && playerData.userId === data.currentUserId);
    if (quoteSection && quoteSelect) {
        if (isOwnMeeple) {
            const quotes = getLeaderboardQuotesForModal();
            quoteSelect.innerHTML = '<option value=\"\">Random</option>' +
                quotes.map(q => '<option value=\"' + escapeHtml(q) + '\">' + escapeHtml(q) + '</option>').join('');
            quoteSelect.value = data.currentUserFavouriteQuote || '';
            quoteSection.style.display = '';
        } else {
            quoteSection.style.display = 'none';
        }
    }

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
        showNotification('Error saving customization: ' + (err.message || err));
        return;
    }

    // Update favourite quote if applicable (only for own linked meeple)
    try {
        const quoteSelect = document.getElementById('playerFavouriteQuoteSelect');
        const playerName = uiState.currentPlayerForImage;
        const playerMeta = data.playerData && data.playerData[playerName];
        const isOwnMeeple = !!(data.currentUserId && playerMeta?.userId && playerMeta.userId === data.currentUserId);
        if (quoteSelect && isOwnMeeple) {
            const selected = (quoteSelect.value || '').trim() || null;
            const userId = playerMeta.userId;
            await upsertUserProfile(userId, undefined, selected);
            if (data.currentUserId === userId) {
                data.currentUserFavouriteQuote = selected;
                renderAll();
            }
        }
    } catch (err) {
        showNotification('Could not update favourite quote: ' + (err.message || err));
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
        showNotification('Error resetting: ' + (err.message || err));
    }
    closePlayerImageModal();
}

export function handleImageFileSelect(file, previewId, callback) {
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
        showNotification('Image too large. Please choose an image under 2MB.');
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
    const participants = entry.participants && entry.participants.length > 0
        ? [...entry.participants]
        : [entry.player];

    const gameSelect = document.getElementById('editGameSelect');
    gameSelect.innerHTML = data.games.map(g =>
        '<option value="' + escapeHtmlForExport(g) + '"' + (g === entry.game ? ' selected' : '') + '>' + escapeHtmlForExport(g) + '</option>'
    ).join('');

    const playerSelect = document.getElementById('editPlayerSelect');
    playerSelect.innerHTML = data.players.map(p =>
        '<option value="' + escapeHtmlForExport(p) + '"' + (p === entry.player ? ' selected' : '') + '>' + escapeHtmlForExport(p) + '</option>'
    ).join('');

    const participantsContainer = document.getElementById('editEntryParticipants');
    if (participantsContainer) {
        participantsContainer.innerHTML = '';
        (data.players || []).sort((a, b) => a.localeCompare(b)).forEach(p => {
            const selected = participants.includes(p);
            const playerData = data.playerData && data.playerData[p] ? data.playerData[p] : {};
            const image = playerData.image || null;
            const imgHtml = image
                ? '<img src="' + escapeHtmlForExport(image) + '" alt="" class="selection-item-meeple-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><div class="selection-item-meeple-placeholder" style="display:none;">👤</div>'
                : '<div class="selection-item-meeple-placeholder">👤</div>';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'selection-item selection-item-meeple' + (selected ? ' selected' : '');
            btn.setAttribute('data-player', p);
            btn.innerHTML = '<div class="selection-item-meeple-img-wrap">' + imgHtml + '</div><span class="selection-item-meeple-name">' + escapeHtmlForExport(p) + '</span>';
            btn.addEventListener('click', () => {
                const idx = participants.indexOf(p);
                if (idx >= 0) {
                    if (participants.length > 1) participants.splice(idx, 1);
                } else {
                    participants.push(p);
                }
                btn.classList.toggle('selected', participants.includes(p));
            });
            participantsContainer.appendChild(btn);
        });
        uiState.editEntryParticipants = participants;
    }

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
    uiState.editEntryParticipants = null;
}

export async function saveEditedEntry() {
    if (!uiState.currentEditId) return;
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const newGame = document.getElementById('editGameSelect').value;
    const newPlayer = document.getElementById('editPlayerSelect').value;
    const newDate = document.getElementById('editDateInput').value;
    if (!newGame || !newPlayer || !newDate) {
        showNotification('Please fill all fields');
        return;
    }
    const gameId = data._gameIdByName?.[newGame];
    const playerId = data._playerIdByName?.[newPlayer];
    if (!gameId || !playerId) { showNotification('Invalid game or meeple'); return; }
    const participants = [...new Set([newPlayer, ...(uiState.editEntryParticipants || [])])];
    const participantIds = participants
        .map(name => data._playerIdByName[name])
        .filter(Boolean);
    const uniqueParticipantIds = participantIds.length > 0 ? [...new Set(participantIds)] : null;
    const entryIndex = data.entries.findIndex(e => e.id === uiState.currentEditId);
    if (entryIndex === -1) return;
    const btn = document.getElementById('editEntrySave');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    try {
        const updated = await updateEntry(uiState.currentEditId, gameId, playerId, newDate, uniqueParticipantIds);
        const { data: { user } } = await getSupabase().auth.getUser();
        const updatedByName = user
            ? (user.user_metadata?.full_name || user.email || null)
            : null;
        data.entries[entryIndex] = {
            ...data.entries[entryIndex],
            game: newGame,
            player: newPlayer,
            date: newDate,
            participants: participants,
            updated_at: updated?.updated_at || new Date().toISOString(),
            updated_by_name: updatedByName
        };
        saveData();
        closeEditEntryModal();
        showNotification('Entry updated');
    } catch (err) {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Changes'; }
        showNotification('Error updating entry: ' + (err.message || err));
    }
}

function escapeHtmlForExport(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Leaderboard quotes (for dropdown) ───────────────────────────────────────

const DEFAULT_LEADERBOARD_QUOTES = [
    'Roll with it.',
    'Winning is just the beginning.',
    'May the dice be ever in your favor.',
    'One more game? Always.',
    'Board games > boring games.'
];

function getLeaderboardQuotesForModal() {
    const q = typeof window !== 'undefined' && window._scorekeeperLeaderboardQuotes;
    return (Array.isArray(q) && q.length > 0) ? q : DEFAULT_LEADERBOARD_QUOTES;
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
            await upsertUserProfile(userId, value || null, userProfile?.favourite_quote ?? undefined);
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
            const [campaignStats, gameBreakdown, gamesPlayedBreakdown, recentEntries, userProfile] = await Promise.all([
                fetchCrossCampaignStats(player.user_id),
                fetchCrossCampaignGameBreakdown(player.user_id),
                fetchCrossCampaignGamesPlayed(player.user_id),
                fetchPlayerRecentEntries(player.user_id, 10),
                fetchUserProfile(player.user_id)
            ]);
            _renderProfileLinked(player, playerMeta, campaignStats, gameBreakdown, gamesPlayedBreakdown, recentEntries, user, userProfile);
        } else {
            // Player is not linked — show current-campaign stats only
            const currentEntries = data.entries.filter(e => e.player === playerName);
            _renderProfileUnlinked(player, playerName, playerMeta, currentEntries, user);
        }

        // Customize meeple & Delete player (same rules as leaderboard card)
        const actionsRow = document.getElementById('profileActionsRow');
        const customizeBtn = document.getElementById('profileCustomizeBtn');
        const deleteBtn = document.getElementById('profileDeleteBtn');
        const canEdit = !!getActivePlaygroup();
        const isOwnLinked = user && player.user_id === user.id;
        const isUnclaimed = !player.user_id;
        const canDelete = isOwnLinked || (!user && isUnclaimed);
        if (actionsRow && customizeBtn && deleteBtn) {
            actionsRow.style.display = (canEdit || canDelete) ? 'flex' : 'none';
            customizeBtn.style.display = canEdit ? 'inline-flex' : 'none';
            deleteBtn.style.display = canDelete ? 'inline-flex' : 'none';
            customizeBtn.onclick = () => {
                openPlayerImageModal(playerName);
            };
            deleteBtn.onclick = () => {
                closePlayerProfileModal();
                deletePlayer(playerName);
            };
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
                saveData(); // refresh player cards so "YOU" badge appears
                showNotification('Meeple linked to your account!');
                closePlayerProfileModal();
                await openPlayerProfileModal(playerName);
            } catch (err) {
                claimBtn.disabled = false;
                claimBtn.textContent = 'This is me — link my account';
                const msg = (err && err.message) ? err.message : String(err);
                const friendly = /not authenticated/i.test(msg)
                    ? 'Sign in to link this meeple to your account.'
                    : 'Could not link meeple: ' + msg;
                showNotification(friendly);
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
                saveData(); // refresh player cards so "YOU" badge disappears
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
    const actionsRowLoading = document.getElementById('profileActionsRow');
    if (actionsRowLoading) actionsRowLoading.style.display = 'none';
    document.getElementById('profileTotalWins').textContent = '—';
    document.getElementById('profileCampaignCount').textContent = '—';
    document.getElementById('profileFaveGame').textContent = '—';
    const gpElL = document.getElementById('profileGamesPlayed');
    const wrElL = document.getElementById('profileWinRate');
    if (gpElL) gpElL.textContent = '—';
    if (wrElL) wrElL.textContent = '—';
    const faveGameImg = document.getElementById('profileFaveGameImg');
    const faveGamePlaceholder = document.getElementById('profileFaveGamePlaceholder');
    if (faveGameImg) { faveGameImg.style.display = 'none'; faveGameImg.removeAttribute('src'); }
    if (faveGamePlaceholder) faveGamePlaceholder.style.display = 'flex';
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
    const quoteCard = document.getElementById('profileFaveQuoteCard');
    if (quoteCard) quoteCard.style.display = 'none';
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

function _renderProfileLinked(player, meta, campaignStats, gameBreakdown, gamesPlayedBreakdown, recentEntries, currentUser, userProfile) {
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
    const profileMetaEl = document.getElementById('profileMeta');
    if (campaignCount === 0) {
        profileMetaEl.textContent = 'Meeple yet to join campaign';
        profileMetaEl.classList.add('profile-meta-muted');
    } else {
        profileMetaEl.textContent = campaignCount + ' campaign' + (campaignCount !== 1 ? 's' : '');
        profileMetaEl.classList.remove('profile-meta-muted');
    }
    const totalGamesPlayed = campaignStats.reduce((s, r) => s + Number(r.total_games_played || r.total_wins || 0), 0);
    const winPct = totalGamesPlayed > 0 ? ((totalWins / totalGamesPlayed) * 100).toFixed(1) + '%' : '—';

    document.getElementById('profileTotalWins').textContent = totalWins;
    document.getElementById('profileCampaignCount').textContent = campaignCount;
    document.getElementById('profileFaveGame').textContent = displayFave;
    const gpEl = document.getElementById('profileGamesPlayed');
    const wrEl = document.getElementById('profileWinRate');
    if (gpEl) gpEl.textContent = totalGamesPlayed;
    if (wrEl) wrEl.textContent = winPct;
    const faveImg = document.getElementById('profileFaveGameImg');
    const favePlaceholder = document.getElementById('profileFaveGamePlaceholder');
    const faveGameImageUrl = displayFave && data.gameData?.[displayFave]?.image;
    if (faveImg && favePlaceholder) {
        if (faveGameImageUrl) {
            faveImg.src = faveGameImageUrl;
            faveImg.style.display = 'block';
            favePlaceholder.style.display = 'none';
        } else {
            faveImg.style.display = 'none';
            faveImg.removeAttribute('src');
            favePlaceholder.style.display = 'flex';
        }
    }
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
            editBtn.onclick = () => _openFavouriteGamePicker(player.user_id, merged, userProfile, computedTopGame, (newDisplayValue) => {
                document.getElementById('profileFaveGame').textContent = newDisplayValue;
                const img = document.getElementById('profileFaveGameImg');
                const ph = document.getElementById('profileFaveGamePlaceholder');
                const url = newDisplayValue && data.gameData?.[newDisplayValue]?.image;
                if (img && ph) {
                    if (url) {
                        img.src = url;
                        img.style.display = 'block';
                        ph.style.display = 'none';
                    } else {
                        img.style.display = 'none';
                        img.removeAttribute('src');
                        ph.style.display = 'flex';
                    }
                }
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

    // Campaign breakdown: campaign name, wins/games played, win %
    document.getElementById('profileCampaignSection').style.display = '';
    document.getElementById('profileCampaignList').innerHTML = campaignStats.map(row => {
        const wins = Number(row.total_wins);
        const played = Number(row.total_games_played || wins) || 0;
        const pct = played > 0 ? Math.round((wins / played) * 100) : 0;
        const detail = played > 0
            ? wins + '/' + played + ' wins (' + pct + '%)'
            : wins + ' win' + (wins !== 1 ? 's' : '');
        return '<div class="profile-campaign-row">' +
            '<div class="profile-campaign-name">' + escapeHtml(row.playgroup_name) + '</div>' +
            '<div class="profile-campaign-detail">' + detail + '</div>' +
            '</div>';
    }).join('') || '<div class="profile-empty">No wins yet.</div>';

    // Games Win Rate: merge wins + games played, sort by wins > games played > alphabetical
    const winsByGame = {};
    (gameBreakdown || []).forEach(r => { winsByGame[r.game_name || r.game] = Number(r.total_wins || 0); });
    const gamesByGame = {};
    (gamesPlayedBreakdown || []).forEach(r => { gamesByGame[r.game_name || r.game] = Number(r.total_games_played || 0); });
    const allGames = new Set([...Object.keys(winsByGame), ...Object.keys(gamesByGame)]);
    const merged = Array.from(allGames)
        .map(game => ({
            game,
            wins: winsByGame[game] || 0,
            gamesPlayed: gamesByGame[game] || 0
        }))
        .filter(r => r.gamesPlayed > 0)
        .sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed || (a.game || '').localeCompare(b.game || ''));
    document.getElementById('profileGameSectionTitle').textContent = 'Games Win Rate (all campaigns)';
    document.getElementById('profileGameList').innerHTML = _renderGamesWinRateHtml(merged);

    // Recent history
    document.getElementById('profileHistoryList').innerHTML = _renderRecentHistoryHtml(recentEntries, true);
}

function _renderProfileUnlinked(player, playerName, meta, currentEntries, currentUser) {
    _setAvatar(meta);

    const participated = (e, p) =>
        (e.participants && e.participants.includes(p)) || (!e.participants && e.player === p);
    const participatedEntries = data.entries.filter(e => participated(e, playerName));
    const totalWins = currentEntries.length;
    const totalGamesPlayed = participatedEntries.length;
    const winPct = totalGamesPlayed > 0 ? ((totalWins / totalGamesPlayed) * 100).toFixed(1) + '%' : '—';

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
    document.getElementById('profileMeta').classList.remove('profile-meta-muted');
    document.getElementById('profileTotalWins').textContent = totalWins;
    document.getElementById('profileCampaignStatCard').style.display = 'none';
    document.getElementById('profileFaveGame').textContent = topGame;
    const gpElU = document.getElementById('profileGamesPlayed');
    const wrElU = document.getElementById('profileWinRate');
    if (gpElU) gpElU.textContent = totalGamesPlayed;
    if (wrElU) wrElU.textContent = winPct;
    const faveImgU = document.getElementById('profileFaveGameImg');
    const favePhU = document.getElementById('profileFaveGamePlaceholder');
    const topGameImageUrl = topGame && data.gameData?.[topGame]?.image;
    if (faveImgU && favePhU) {
        if (topGameImageUrl) {
            faveImgU.src = topGameImageUrl;
            faveImgU.style.display = 'block';
            favePhU.style.display = 'none';
        } else {
            faveImgU.style.display = 'none';
            faveImgU.removeAttribute('src');
            favePhU.style.display = 'flex';
        }
    }

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

    // Games Win Rate (unlinked: merge wins + games played, sort by wins > games played > alphabetical)
    const gamesPlayedCounts = {};
    participatedEntries.forEach(e => {
        gamesPlayedCounts[e.game] = (gamesPlayedCounts[e.game] || 0) + 1;
    });
    const mergedUnlinked = Object.keys(gamesPlayedCounts).map(game => ({
        game,
        wins: gameCounts[game] || 0,
        gamesPlayed: gamesPlayedCounts[game] || 0
    })).sort((a, b) => b.wins - a.wins || b.gamesPlayed - a.gamesPlayed || (a.game || '').localeCompare(b.game || ''));
    document.getElementById('profileGameSectionTitle').textContent = 'Games Win Rate';
    document.getElementById('profileGameList').innerHTML = _renderGamesWinRateHtml(mergedUnlinked);

    // Recent history (current campaign)
    const recentEntries = [...currentEntries]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10)
        .map(e => ({ date: e.date, game: e.game, campaign: null }));
    document.getElementById('profileHistoryList').innerHTML = _renderRecentHistoryHtml(recentEntries, false);
}

function _renderGamesWinRateHtml(rows) {
    if (!rows.length) return '<div class="profile-empty">No games played yet.</div>';
    const MIN_BAR_PCT = 3; // minimum bar width for 0% win rate (aesthetics)
    return rows.map(r => {
        const winRate = r.gamesPlayed > 0 ? (r.wins / r.gamesPlayed) * 100 : 0;
        const barPct = Math.max(winRate, winRate === 0 ? MIN_BAR_PCT : 0);
        return '<div class="profile-game-row">' +
            '<div class="profile-game-name">' + escapeHtml(r.game) + '</div>' +
            '<div class="profile-game-bar-wrap">' +
            '<div class="profile-game-bar" style="width:' + barPct + '%"></div>' +
            '</div>' +
            '<div class="profile-game-count">' + r.wins + '/' + r.gamesPlayed + '</div>' +
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
let _tallyShowOtherCampaigns = false;

export function openScoreTabulator(preselectGame = null) {
    const modal = document.getElementById('scoreTallyModal');
    if (!modal) return;

    _tallyShowOtherCampaigns = false;
    _tallyState = {
        game: preselectGame || null,
        participants: [], // { name, isTemp }
        roundCount: 0,
        roundNames: [],   // editable label per round
        scores: []        // [roundIndex][participantIndex]
    };

    // Populate game selection grid (image-based, like Add a Win) and show empty state when no games
    const gameSelectWrap = document.getElementById('tallyGameSelectWrap');
    const gameEmptyState = document.getElementById('tallyGameEmptyState');
    const games = data.games || [];
    _renderTallyGameSelection(preselectGame);

    if (games.length === 0) {
        if (gameSelectWrap) gameSelectWrap.hidden = true;
        if (gameEmptyState) gameEmptyState.hidden = false;
    } else {
        if (gameSelectWrap) gameSelectWrap.hidden = false;
        if (gameEmptyState) gameEmptyState.hidden = true;
    }

    // Render meeple chips from campaign
    _renderTallyChips();

    // Clear temp fields
    document.getElementById('tallyTempList').innerHTML = '';
    document.getElementById('tallyTempName').value = '';
    const _rc = document.getElementById('tallyRoundCustom');
    if (_rc) { _rc.hidden = true; }
    const _rci = document.getElementById('tallyRoundCustomName');
    if (_rci) { _rci.value = ''; }

    // Show stage 1
    _tallyShowStage(1);
    document.getElementById('tallyTitle').textContent = 'Tally Scores';
    document.getElementById('tallySubtitle').textContent = 'Set up your game';
    document.getElementById('tallyWinnerBar').innerHTML = '';
    _updateTallyStartBtn();

    // ── Event handlers ──
    const onClose = () => closeScoreTabulator();

    const onGameSelectClick = (e) => {
        const item = e.target.closest('.selection-item-game');
        if (!item) return;
        const game = item.getAttribute('data-game');
        if (!game) return;
        _tallyState.game = game;
        document.querySelectorAll('#tallyGameSelection .selection-item-game').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        _updateTallyStartBtn();
    };

    const onAddFirstGame = () => {
        closeScoreTabulator();
        document.dispatchEvent(new CustomEvent('scorekeeper:openAddGame'));
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

    // ── Round-type picker (always visible on Stage 2) ─────────────────────────
    const customWrap  = document.getElementById('tallyRoundCustom');
    const customInput = document.getElementById('tallyRoundCustomName');

    const _commitRound = (name) => {
        customWrap.hidden = true;
        customInput.value = '';
        _tallyState.roundCount++;
        _tallyState.roundNames.push(name || ('Rnd ' + _tallyState.roundCount));
        _tallyState.scores.push(new Array(_tallyState.participants.length).fill(null));
        _renderScoreTableBody();
        _updateTotals();
        const wrap = document.querySelector('.tally-table-wrap');
        if (wrap) setTimeout(() => { wrap.scrollTop = wrap.scrollHeight; }, 30);
    };

    const onRoundOptClick = (e) => {
        const btn = e.target.closest('.tally-round-opt');
        if (!btn) return;
        const type = btn.dataset.type;
        if (type === '__custom__') {
            customWrap.hidden = false;
            customInput.focus();
        } else {
            _commitRound(type);
        }
    };

    const onRoundConfirm = () => {
        const name = customInput.value.trim();
        _commitRound(name || 'Others');
    };

    const onRoundCustomKey = (e) => { if (e.key === 'Enter') onRoundConfirm(); };

    // ── Stage 3 (confirm date & save) ─────────────────────────────────────────
    const onBackToScores = () => {
        _tallyShowStage(2);
        document.getElementById('tallyTitle').textContent = _tallyState.game;
        document.getElementById('tallySubtitle').textContent = 'Enter scores for each round';
    };

    const onSaveWin = () => _tallySaveWin();

    const onRecord = () => _tallyRecordWin();

    const closeBtn          = document.getElementById('tallyClose');
    const cancelBtn         = document.getElementById('tallyCancelBtn');
    const startBtn          = document.getElementById('tallyStartBtn');
    const addFirstGameBtn   = document.getElementById('tallyAddFirstGameBtn');
    const addNewGameBtn     = document.getElementById('tallyAddNewGameBtn');
    const addTempBtn        = document.getElementById('tallyAddTempBtn');
    const tempNameIn        = document.getElementById('tallyTempName');
    const backBtn           = document.getElementById('tallyBackBtn');
    const roundOptContainer = document.getElementById('tallyRoundPicker');
    const roundConfirmBtn   = document.getElementById('tallyRoundConfirmBtn');
    const recordBtn         = document.getElementById('tallyRecordBtn');
    const backToScoresBtn   = document.getElementById('tallyBackToScoresBtn');
    const saveWinBtn        = document.getElementById('tallySaveWinBtn');

    const gameSelectionEl = document.getElementById('tallyGameSelection');
    closeBtn.addEventListener('click', onClose);
    cancelBtn.addEventListener('click', onClose);
    if (gameSelectionEl) gameSelectionEl.addEventListener('click', onGameSelectClick);
    if (addFirstGameBtn) addFirstGameBtn.addEventListener('click', onAddFirstGame);
    if (addNewGameBtn) addNewGameBtn.addEventListener('click', onAddFirstGame);
    addTempBtn.addEventListener('click', onAddTemp);
    tempNameIn.addEventListener('keypress', onTempKey);
    startBtn.addEventListener('click', onStart);
    backBtn.addEventListener('click', onBack);
    roundOptContainer.addEventListener('click', onRoundOptClick);
    roundConfirmBtn.addEventListener('click', onRoundConfirm);
    customInput.addEventListener('keypress', onRoundCustomKey);
    recordBtn.addEventListener('click', onRecord);
    backToScoresBtn.addEventListener('click', onBackToScores);
    saveWinBtn.addEventListener('click', onSaveWin);

    _tallyCleanup = () => {
        closeBtn.removeEventListener('click', onClose);
        cancelBtn.removeEventListener('click', onClose);
        if (gameSelectionEl) gameSelectionEl.removeEventListener('click', onGameSelectClick);
        if (addFirstGameBtn) addFirstGameBtn.removeEventListener('click', onAddFirstGame);
        if (addNewGameBtn) addNewGameBtn.removeEventListener('click', onAddFirstGame);
        addTempBtn.removeEventListener('click', onAddTemp);
        tempNameIn.removeEventListener('keypress', onTempKey);
        startBtn.removeEventListener('click', onStart);
        backBtn.removeEventListener('click', onBack);
        roundOptContainer.removeEventListener('click', onRoundOptClick);
        roundConfirmBtn.removeEventListener('click', onRoundConfirm);
        customInput.removeEventListener('keypress', onRoundCustomKey);
        recordBtn.removeEventListener('click', onRecord);
        backToScoresBtn.removeEventListener('click', onBackToScores);
        saveWinBtn.removeEventListener('click', onSaveWin);
    };

    modal.classList.add('active');
    _playTallyFanfare();
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

function _renderTallyGameSelection(preselectGame) {
    const container = document.getElementById('tallyGameSelection');
    if (!container || !_tallyState) return;
    const addBtn = container.querySelector('.add-new-btn');
    container.innerHTML = '';
    if (addBtn) container.appendChild(addBtn);

    const games = data.games || [];
    const selectedGame = preselectGame && games.includes(preselectGame) ? preselectGame : _tallyState.game;

    // Sort by last played (most recent first), then by name
    const gameLastPlayed = {};
    (data.entries || []).forEach(e => {
        const d = e.date ? new Date(e.date).getTime() : 0;
        if (!gameLastPlayed[e.game] || gameLastPlayed[e.game] < d) gameLastPlayed[e.game] = d;
    });
    const sortedGames = [...games].sort((a, b) => {
        const da = gameLastPlayed[a] || 0;
        const db = gameLastPlayed[b] || 0;
        if (db !== da) return db - da;
        return a.localeCompare(b);
    });

    sortedGames.forEach(game => {
        const gameImage = data.gameData && data.gameData[game] && data.gameData[game].image;
        const div = document.createElement('div');
        div.className = 'selection-item selection-item-game' + (game === selectedGame ? ' selected' : '');
        div.setAttribute('data-game', game);
        div.setAttribute('title', game);
        if (gameImage) {
            const img = document.createElement('img');
            img.src = gameImage;
            img.alt = game;
            img.className = 'selection-item-game-img';
            img.onerror = function () {
                this.style.display = 'none';
                const fallback = div.querySelector('.selection-item-game-fallback');
                if (fallback) fallback.style.display = 'flex';
            };
            div.appendChild(img);
            const fallback = document.createElement('span');
            fallback.className = 'selection-item-game-fallback';
            fallback.style.display = 'none';
            fallback.textContent = game;
            div.appendChild(fallback);
        } else {
            const fallback = document.createElement('span');
            fallback.className = 'selection-item-game-fallback';
            fallback.textContent = game;
            div.appendChild(fallback);
        }
        const tooltip = document.createElement('span');
        tooltip.className = 'selection-item-game-tooltip';
        tooltip.textContent = game;
        div.appendChild(tooltip);
        container.appendChild(div);
    });

    if (selectedGame && games.includes(selectedGame)) {
        _tallyState.game = selectedGame;
    }

    _loadOtherCampaignGamesForTally();
}

async function _loadOtherCampaignGamesForTally() {
    const wrap = document.getElementById('tallyGameSelectionOtherWrap');
    const section = document.getElementById('tallyGameSelectionOtherSection');
    const otherGrid = document.getElementById('tallyGameSelectionOther');
    const toggleBtn = document.getElementById('tallyShowOtherCampaignsBtn');
    if (!wrap || !otherGrid || !_tallyState) return;
    const pg = getActivePlaygroup();
    if (!pg || !data.games) {
        wrap.style.display = 'none';
        return;
    }
    try {
        const otherGames = await fetchGamesFromOtherCampaigns(pg.id, data.games);
        if (!otherGames.length) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = '';
        if (toggleBtn) {
            toggleBtn.style.display = '';
            toggleBtn.textContent = _tallyShowOtherCampaigns ? 'Hide more games' : 'More games from other campaigns';
            toggleBtn.onclick = () => {
                _tallyShowOtherCampaigns = !_tallyShowOtherCampaigns;
                if (section) section.style.display = _tallyShowOtherCampaigns ? '' : 'none';
                toggleBtn.textContent = _tallyShowOtherCampaigns ? 'Hide more games' : 'More games from other campaigns';
            };
        }
        if (section) section.style.display = _tallyShowOtherCampaigns ? '' : 'none';
        otherGrid.innerHTML = '';
        otherGames.forEach(({ name, image }) => {
            const div = document.createElement('div');
            div.className = 'selection-item selection-item-game' + (name === _tallyState.game ? ' selected' : '');
            div.setAttribute('data-game', name);
            div.setAttribute('title', name);
            if (image) {
                const img = document.createElement('img');
                img.src = image;
                img.alt = name;
                img.className = 'selection-item-game-img';
                img.onerror = function () {
                    this.style.display = 'none';
                    const fb = div.querySelector('.selection-item-game-fallback');
                    if (fb) fb.style.display = 'flex';
                };
                div.appendChild(img);
                const fallback = document.createElement('span');
                fallback.className = 'selection-item-game-fallback';
                fallback.style.display = 'none';
                fallback.textContent = name;
                div.appendChild(fallback);
            } else {
                const fallback = document.createElement('span');
                fallback.className = 'selection-item-game-fallback';
                fallback.textContent = name;
                div.appendChild(fallback);
            }
            const tooltip = document.createElement('span');
            tooltip.className = 'selection-item-game-tooltip';
            tooltip.textContent = name;
            div.appendChild(tooltip);
            div.addEventListener('click', async function () {
                const gameName = this.getAttribute('data-game');
                if (data.games.includes(gameName)) {
                    _tallyState.game = gameName;
                    _renderTallyGameSelection(gameName);
                    _updateTallyStartBtn();
                    return;
                }
                try {
                    const row = await insertGame(pg.id, gameName);
                    const other = otherGames.find(g => g.name === gameName);
                    if (other?.image) {
                        await upsertGameMetadata(row.id, other.image);
                    }
                    data.games.push(gameName);
                    data._gameIdByName[gameName] = row.id;
                    if (other?.image) {
                        if (!data.gameData) data.gameData = {};
                        data.gameData[gameName] = { image: other.image };
                    }
                    saveData();
                    _tallyState.game = gameName;
                    _renderTallyGameSelection(gameName);
                    _updateTallyStartBtn();
                } catch (err) {
                    showNotification('Could not add game: ' + (err.message || err));
                }
            });
            otherGrid.appendChild(div);
        });
    } catch {
        wrap.style.display = 'none';
    }
}

function _renderTallyChips() {
    const container = document.getElementById('tallyMeepleChips');
    if (!_tallyState) return;
    const players = data.players || [];
    let html = '';
    players.forEach(p => {
        const sel = _tallyState.participants.some(x => x.name === p && !x.isTemp);
        const playerData = data.playerData && data.playerData[p] ? data.playerData[p] : {};
        const image = playerData.image || null;
        const imgHtml = image
            ? '<img src="' + escapeHtml(image) + '" alt="' + escapeHtml(p) + '" class="selection-item-meeple-img" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><div class="selection-item-meeple-placeholder" style="display:none;">👤</div>'
            : '<div class="selection-item-meeple-placeholder">👤</div>';
        html += '<button class="selection-item selection-item-meeple tally-chip' + (sel ? ' selected' : '') + '" data-name="' + escapeHtml(p) + '" type="button">' +
            '<div class="selection-item-meeple-img-wrap">' + imgHtml + '</div>' +
            '<span class="selection-item-meeple-name">' + escapeHtml(p) + '</span></button>';
    });
    container.innerHTML = html;

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

function _playTallyFanfare() {
    const modal = document.getElementById('scoreTallyModal');
    if (!modal) return;
    const m = modal.querySelector('.tally-modal');
    if (!m) return;
    m.classList.remove('tally-grand-open');
    void m.offsetWidth; // force reflow so animation replays
    m.classList.add('tally-grand-open');
    m.addEventListener('animationend', () => m.classList.remove('tally-grand-open'), { once: true });
}

function _initScoreTable() {
    _tallyState.roundCount = 0;
    _tallyState.roundNames = [];
    _tallyState.scores = [];
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
            '</th>'
        ).join('') + '</tr>';
}

function _renderScoreTableBody() {
    const body = document.getElementById('scoreTableBody');
    if (_tallyState.scores.length === 0) {
        const colSpan = 1 + _tallyState.participants.length;
        body.innerHTML = '<tr><td colspan="' + colSpan + '" class="score-empty-state">Add a scoring round below to start counting</td></tr>';
        return;
    }
    body.innerHTML = _tallyState.scores.map((row, ri) =>
        '<tr>' +
        '<td class="score-td-round"><span class="score-round-cell"><input class="score-round-name" type="text" data-ri="' + ri + '" value="' + escapeHtml(_tallyState.roundNames[ri] || ('Rnd ' + (ri + 1))) + '" maxlength="18" placeholder="Rnd ' + (ri + 1) + '"><button class="score-round-remove" data-ri="' + ri + '" type="button" aria-label="Remove row">×</button></span></td>' +
        row.map((val, ci) =>
            '<td class="score-td"><input type="number" class="score-input" data-ri="' + ri + '" data-ci="' + ci + '" value="' + (val !== null ? val : '') + '" placeholder="0" inputmode="decimal"></td>'
        ).join('') + '</tr>'
    ).join('');

    body.querySelectorAll('.score-input').forEach(input => {
        input.addEventListener('input', () => {
            const ri = parseInt(input.dataset.ri);
            const ci = parseInt(input.dataset.ci);
            _tallyState.scores[ri][ci] = parseFloat(input.value) || 0;
            _updateTotals();
        });
        input.addEventListener('wheel', (e) => {
            e.preventDefault();
            const ri = parseInt(input.dataset.ri);
            const ci = parseInt(input.dataset.ci);
            const current = parseFloat(input.value) || 0;
            const delta = e.deltaY < 0 ? 1 : -1;
            const newVal = current + delta;
            input.value = newVal;
            _tallyState.scores[ri][ci] = newVal;
            _updateTotals();
        }, { passive: false });
    });

    body.querySelectorAll('.score-round-name').forEach(input => {
        input.addEventListener('input', () => {
            _tallyState.roundNames[parseInt(input.dataset.ri)] = input.value;
        });
    });

    body.querySelectorAll('.score-round-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            const ri = parseInt(btn.dataset.ri);
            _tallyState.roundNames.splice(ri, 1);
            _tallyState.scores.splice(ri, 1);
            _renderScoreTableBody();
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
        recordBtn.textContent = 'Review win and set date';
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
            recordBtn.textContent = 'Review win and set date';
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

    // ── "Recording…" feedback, then advance to Stage 3 ───────────────────────
    const recordBtn = document.getElementById('tallyRecordBtn');
    recordBtn.disabled = true;
    recordBtn.textContent = 'Recording…';

    // Store for Stage 3
    const winnerIdx = winnerIdxs[0];
    _tallyState._pendingWinner = winner;
    _tallyState._pendingGame   = gameName;
    _tallyState._pendingPts    = totals[winnerIdx];

    setTimeout(() => {
        if (!_tallyState) return; // modal was closed in the meantime
        document.getElementById('tallyCelebName').textContent = winner.name;
        document.getElementById('tallyCelebSub').textContent =
            'wins ' + gameName + ' with ' + _tallyState._pendingPts + ' pts';
        document.getElementById('tallyWinDate').value = new Date().toISOString().split('T')[0];
        document.getElementById('tallyTitle').textContent = '🎉 Winner!';
        document.getElementById('tallySubtitle').textContent = 'Confirm and save the win';
        recordBtn.disabled = false;
        recordBtn.textContent = 'Review win and set date';
        _tallyShowStage(3);
    }, 1400);
}

function _tallySaveWin() {
    if (!_tallyState) return;
    const date = document.getElementById('tallyWinDate').value;
    if (!date) { showNotification('Please pick a date'); return; }
    const game   = _tallyState._pendingGame || _tallyState.game;
    const winner = _tallyState._pendingWinner;
    const participants = (_tallyState.participants || []).filter(p => !p.isTemp).map(p => p.name);
    closeScoreTabulator();
    window.dispatchEvent(new CustomEvent('tallyComplete', {
        detail: { game, winner: winner.name, date, participants }
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

/** Play a short victory trumpet-style fanfare (C5 → E5 → G5 → G5 → E5 → C5) using Web Audio API. */
export function playVictoryFanfare() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const playNote = (frequency, startTime, duration) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.setValueAtTime(frequency, startTime);
            gain.gain.setValueAtTime(0.12, startTime);
            gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration);
            osc.start(startTime);
            osc.stop(startTime + duration);
        };
        const C5 = 523.25, E5 = 659.25, G5 = 783.99;
        const step = 0.22;
        playNote(C5, 0, step);
        playNote(E5, step, step);
        playNote(G5, step * 2, step);
        playNote(G5, step * 3, step);
        playNote(E5, step * 4, step);
        playNote(C5, step * 5, step * 1.2);
    } catch (_) {}
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
