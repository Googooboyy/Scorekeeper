import {
    data,
    currentEntry,
    showAllGames,
    showAllHistory,
    showAllPlayers,
    uiState,
    toggleShowAllGames,
    toggleShowAllHistory,
    toggleShowAllPlayers,
    escapeHtml,
    formatDate
} from './data.js';
import { deletePlayer, deleteGame, deleteEntryById } from './actions.js';
import { openPlayerImageModal, openGameImageModal, openEditEntryModal, openPlayerProfileModal } from './modals.js';

const DEFAULT_LEADERBOARD_QUOTES = [
    'Roll with it.',
    'Winning is just the beginning.',
    'May the dice be ever in your favor.',
    'One more game? Always.',
    'Board games > boring games.'
];

function getLeaderboardQuotes() {
    const q = typeof window !== 'undefined' && window._scorekeeperLeaderboardQuotes;
    return (Array.isArray(q) && q.length > 0) ? q : DEFAULT_LEADERBOARD_QUOTES;
}

function pickRandomQuote() {
    const quotes = getLeaderboardQuotes();
    return quotes[Math.floor(Math.random() * quotes.length)];
}

export function renderAll() {
    renderPlayers();
    renderGames();
    renderGameSelection();
    renderPlayerSelection();
    renderHistory();
}

function calculateGameBreakdown(player) {
    const playerEntries = data.entries.filter(e => e.player === player);
    const gameCounts = {};
    playerEntries.forEach(entry => {
        gameCounts[entry.game] = (gameCounts[entry.game] || 0) + 1;
    });
    const sorted = Object.entries(gameCounts)
        .map(([game, count]) => ({ game: game, count: count }))
        .sort((a, b) => b.count - a.count);
    const maxCount = sorted.length > 0 ? sorted[0].count : 0;
    return sorted.map(g => ({ game: g.game, count: g.count, isTop: g.count === maxCount && g.count > 0 }));
}

function renderGameBreakdown(breakdown) {
    if (breakdown.length === 0) {
        return '<span class="no-games-msg">No victories yet... time to play! 🎲</span>';
    }
    return breakdown.map(g => {
        const topClass = g.isTop ? 'top-game' : '';
        return '<div class="player-game-tag ' + topClass + '" title="' + escapeHtml(g.game) + ': ' + g.count + ' win' + (g.count !== 1 ? 's' : '') + '">' +
            '<span class="player-game-name">' + escapeHtml(g.game) + '</span>' +
            '<span class="player-game-count">' + g.count + '</span>' +
            '</div>';
    }).join('');
}

export function toggleVictoryRoster(player) {
    const roster = document.getElementById('roster-' + player);
    const toggle = document.getElementById('toggle-' + player);
    const header = toggle?.closest('.victory-roster-header');
    const label = header?.querySelector('.victory-roster-label');

    if (roster && roster.classList.contains('expanded')) {
        roster.classList.remove('expanded');
        if (toggle) toggle.classList.remove('expanded');
        if (label) label.textContent = 'more';
    } else if (roster && toggle) {
        roster.classList.add('expanded');
        toggle.classList.add('expanded');
        if (label) label.textContent = 'less';
    }
}

export function renderPlayers() {
    const container = document.getElementById('playersContainer');
    const toggleBtn = document.getElementById('playersToggleBtn');
    const toggleText = document.getElementById('playersToggleText');
    const toggleIcon = document.getElementById('playersToggleIcon');

    if (data.players.length === 0) {
        if (!data.currentUserId) {
            container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><button class="about-cta-btn" id="dashboardSignInBtn">Log in to add wins, players and games!</button></div>';
            const signInBtn = document.getElementById('dashboardSignInBtn');
            if (signInBtn) signInBtn.addEventListener('click', () => document.getElementById('loginBtn')?.click());
        } else {
            container.innerHTML = '' +
                '<div class="empty-state" style="grid-column: 1/-1;">' +
                '<div class="empty-state-icon">👥</div>' +
                '<p style="margin-bottom: 10px;">No meeples yet for this campaign.</p>' +
                '<button class="about-cta-btn about-cta-btn--ghost about-cta-btn--small" id="emptyAddWinBtn">+ Add a game win</button>' +
                '</div>';
            const addWinBtn = document.getElementById('emptyAddWinBtn');
            if (addWinBtn) {
                addWinBtn.addEventListener('click', () => {
                    document.dispatchEvent(new Event('scorekeeper:openAddGame'));
                });
            }
        }
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    let playerStats = data.players.map(player => {
        const playerEntries = data.entries.filter(e => e.player === player);
        const wins = playerEntries.length;
        const gameBreakdown = calculateGameBreakdown(player);
        const lastPlayedDate = playerEntries.reduce((latest, entry) => {
            if (!entry.date) return latest;
            if (!latest) return entry.date;
            return new Date(entry.date) > new Date(latest) ? entry.date : latest;
        }, null);
        const playerData = data.playerData && data.playerData[player] ? data.playerData[player] : {};
        return {
            player: player,
            wins: wins,
            gameBreakdown: gameBreakdown,
            lastPlayedDate: lastPlayedDate,
            image: playerData.image,
            color: playerData.color,
            userId: playerData.userId || null
        };
    }).sort((a, b) => b.wins - a.wins);

    const totalPlayers = playerStats.length;
    const hasMorePlayers = totalPlayers > 4;

    if (toggleBtn) toggleBtn.style.display = hasMorePlayers ? 'flex' : 'none';

    if (showAllPlayers) {
        if (toggleText) toggleText.textContent = 'Less';
        if (toggleIcon) toggleIcon.classList.add('expanded');
    } else {
        if (toggleText) toggleText.textContent = 'More';
        if (toggleIcon) toggleIcon.classList.remove('expanded');
    }

    if (!showAllPlayers && hasMorePlayers) {
        playerStats = playerStats.slice(0, 4);
    }

    const currentUserId = data.currentUserId;
    container.innerHTML = playerStats.map((stat, index) => {
        const playerDataObj = data.playerData && data.playerData[stat.player] ? data.playerData[stat.player] : {};
        const isMyAccount = !!(currentUserId && playerDataObj.userId && playerDataObj.userId === currentUserId);
        const linkedClass = isMyAccount ? ' is-my-account' : '';
        const hasPlayerColorClass = stat.color ? ' has-player-color' : '';
        const playerCardStyle = stat.color ? '--player-card-color: ' + stat.color + ';' : '';
        const isFirst = index === 0;
        const crownHtml = isFirst ? '<div class="player-crown">👑</div>' : '';
        const youBadge = isMyAccount ? '<span class="player-you-badge" title="Your linked account">You</span>' : '';
        const isUnclaimedMeeple = !!currentUserId && !stat.userId;
        const meepleUnclaimedBadge = isUnclaimedMeeple
            ? '<span class="meeple-unclaimed-badge" title="This meeple hasn&#39;t been claimed yet">Unclaimed</span>'
            : '';
        const imageHtml = stat.image ?
            '<div class="player-card-image-container">' + crownHtml + '<img src="' + escapeHtml(stat.image) + '" alt="' + escapeHtml(stat.player) + '" class="player-card-image" onerror="this.style.display=\'none\'; this.parentElement.querySelector(\'.player-card-image-placeholder\').style.display=\'flex\';"><div class="player-card-image-placeholder" style="display: none;">👤</div></div>' :
            '<div class="player-card-image-container">' + crownHtml + '<div class="player-card-image-placeholder">👤</div></div>';
        const colorIndicator = stat.color ? '<span class="player-color-indicator" style="background: ' + stat.color + ';"></span>' : '';

        return '<div class="player-card' + hasPlayerColorClass + linkedClass + '" data-player="' + escapeHtml(stat.player) + '" style="' + playerCardStyle + '">' +
            '<div class="player-header">' +
            '<div class="player-info-section player-profile-trigger" data-player="' + escapeHtml(stat.player) + '" title="View profile" style="cursor:pointer;">' + imageHtml +
            '<div class="player-name-section">' +
            '<div class="player-name">' + escapeHtml(stat.player) + colorIndicator + youBadge + meepleUnclaimedBadge + '</div>' +
            '<div class="win-label">Rank #' + (index + 1) + ' <span class="player-profile-hint"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></span></div>' +
            '</div>' +
            '</div>' +
            '<div class="win-count-section">' +
            '<div class="win-count">' + stat.wins + '</div>' +
            '<div class="win-label">Wins</div>' +
            '</div>' +
            '</div>' +
            '<div class="victory-roster-header" onclick="window.toggleVictoryRoster(\'' + escapeHtml(stat.player).replace(/'/g, "\\'") + '\')">' +
            '<div class="victory-roster-title" style="text-transform: none;">' + escapeHtml(
                (currentUserId && stat.userId === currentUserId && data.currentUserFavouriteQuote)
                    ? data.currentUserFavouriteQuote
                    : pickRandomQuote()
            ) + '</div>' +
            '<div class="victory-roster-toggle-group">' +
            '<span class="victory-roster-label">more</span>' +
            '<span class="victory-roster-toggle" id="toggle-' + escapeHtml(stat.player) + '">▼</span>' +
            '</div>' +
            '</div>' +
            '<div class="player-game-stats" id="roster-' + escapeHtml(stat.player) + '">' +
            '<div class="player-games-list">' + renderGameBreakdown(stat.gameBreakdown) + '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    container.querySelectorAll('.player-profile-trigger').forEach(el => {
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            openPlayerProfileModal(this.getAttribute('data-player'));
        });
    });
}

export function renderGames() {
    const container = document.getElementById('gamesContainer');
    const toggleBtn = document.getElementById('gamesToggleBtn');
    const toggleText = document.getElementById('gamesToggleText');
    const toggleIcon = document.getElementById('gamesToggleIcon');

    if (data.games.length === 0) {
        if (!data.currentUserId) {
            container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-state-icon">🎲</div><h3>No Games Yet</h3><p>Add games in the "Add a Game Win" section</p></div>';
        } else {
            container.innerHTML = '' +
                '<div class="empty-state" style="grid-column: 1/-1;">' +
                '<div class="empty-state-icon">🎲</div>' +
                '<p style="margin-bottom: 10px;">No games yet for this campaign.</p>' +
                '<button class="about-cta-btn about-cta-btn--ghost about-cta-btn--small" id="emptyAddGameBtn">+ Add a game win</button>' +
                '</div>';
            const addGameBtn = document.getElementById('emptyAddGameBtn');
            if (addGameBtn) {
                addGameBtn.addEventListener('click', () => {
                    document.dispatchEvent(new Event('scorekeeper:openAddGame'));
                });
            }
        }
        toggleBtn.style.display = 'none';
        return;
    }

    let gameStats = data.games.map(game => {
        const wins = data.entries.filter(e => e.game === game).length;
        const lastPlayed = data.entries
            .filter(e => e.game === game)
            .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        const gameData = data.gameData && data.gameData[game] ? data.gameData[game] : {};
        const gameHistory = data.entries
            .filter(e => e.game === game)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        return { game: game, wins: wins, lastPlayed: lastPlayed ? lastPlayed.date : null, image: gameData.image, history: gameHistory };
    }).sort((a, b) => b.wins - a.wins);

    const totalGames = gameStats.length;
    const hasMoreGames = totalGames > 4;
    toggleBtn.style.display = hasMoreGames ? 'flex' : 'none';

    if (showAllGames) {
        toggleText.textContent = 'Less';
        toggleIcon.classList.add('expanded');
    } else {
        toggleText.textContent = 'More';
        toggleIcon.classList.remove('expanded');
    }

    if (!showAllGames && hasMoreGames) {
        gameStats = gameStats.slice(0, 4);
    }

    container.innerHTML = gameStats.map((stat) => {
        const imageHtml = stat.image ?
            '<img src="' + escapeHtml(stat.image) + '" alt="' + escapeHtml(stat.game) + '" class="game-card-image" onerror="this.style.display=\'none\'; this.nextElementSibling.style.display=\'flex\';"><div class="game-card-image-placeholder" style="display: none;">🎲</div>' :
            '<div class="game-card-image-placeholder">🎲</div>';
        const lastPlayedText = stat.lastPlayed ? 'Last: ' + formatDate(stat.lastPlayed) : 'Never played';
        const historyHtml = stat.history.length > 0 ?
            stat.history.map(h => '<div class="game-history-item"><span class="game-history-winner">🏆 ' + escapeHtml(h.player) + '</span><span class="game-history-date">' + formatDate(h.date) + '</span></div>').join('') :
            '<div style="text-align: center; color: var(--text-muted); padding: 20px;">No games played yet</div>';

        return '<div class="game-card-wrapper" data-game="' + escapeHtml(stat.game) + '">' +
            '<div class="game-card">' + imageHtml +
            '<div class="game-card-info">' +
            '<h3>' + escapeHtml(stat.game) + '</h3>' +
            '<div class="game-card-meta">' + lastPlayedText + '</div>' +
            '</div>' +
            '<div class="game-card-stats">' +
            '<div class="game-card-number">' + stat.wins + '</div>' +
            '<div class="game-card-label">Wins</div>' +
            '</div>' +
            '<div class="game-card-actions">' +
            '<button class="edit-game-btn" data-game="' + escapeHtml(stat.game) + '" title="Set image">⚙️</button>' +
            '<button class="toggle-history-btn" data-game="' + escapeHtml(stat.game) + '" title="Show history">▼</button>' +
            '<button class="delete-game-btn" data-game="' + escapeHtml(stat.game) + '" title="Delete game">🗑️</button>' +
            '</div>' +
            '</div>' +
            '<div class="game-history-panel" id="history-panel-' + escapeHtml(stat.game) + '">' +
            '<div class="game-history-list">' + historyHtml + '</div>' +
            '</div>' +
            '</div>';
    }).join('');

    container.querySelectorAll('.delete-game-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteGame(this.getAttribute('data-game'));
        });
    });

    container.querySelectorAll('.edit-game-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openGameImageModal(this.getAttribute('data-game'));
        });
    });

    container.querySelectorAll('.toggle-history-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggleGameHistory(this.getAttribute('data-game'), this);
        });
    });
}

export function toggleGameHistory(game, btn) {
    const panel = document.getElementById('history-panel-' + game);
    if (panel.classList.contains('expanded')) {
        panel.classList.remove('expanded');
        btn.classList.remove('active');
        btn.innerHTML = '▼';
        btn.title = 'Show history';
    } else {
        document.querySelectorAll('.game-history-panel').forEach(p => p.classList.remove('expanded'));
        document.querySelectorAll('.toggle-history-btn').forEach(b => {
            b.classList.remove('active');
            b.innerHTML = '▼';
            b.title = 'Show history';
        });

        panel.classList.add('expanded');
        btn.classList.add('active');
        btn.innerHTML = '▲';
        btn.title = 'Hide history';
    }
}

export function toggleGamesDisplay() {
    toggleShowAllGames();
    renderGames();
}

export function togglePlayersDisplay() {
    toggleShowAllPlayers();
    renderPlayers();
}

export function renderGameSelection() {
    const container = document.getElementById('gameSelection');
    const addBtn   = container.querySelector('.add-new-btn');
    const tallyBtn = container.querySelector('.tally-grid-btn');
    container.innerHTML = '';
    container.appendChild(addBtn);
    if (tallyBtn) container.appendChild(tallyBtn);

    if (data.games.length === 0) {
        return;
    }

    const sortedGames = [...data.games].sort((a, b) => a.localeCompare(b));

    sortedGames.forEach(game => {
        const div = document.createElement('div');
        div.className = 'selection-item' + (currentEntry.game === game ? ' selected' : '');
        div.setAttribute('data-game', game);
        div.textContent = game;
        div.addEventListener('click', function () {
            selectGame(this.getAttribute('data-game'));
        });
        container.appendChild(div);
    });
}

export function renderPlayerSelection() {
    const container = document.getElementById('playerSelection');
    if (data.players.length === 0) {
        container.innerHTML = '<p style="color: var(--text-muted); text-align: center; grid-column: 1/-1;">No players yet. Add your first player below.</p>';
        return;
    }

    const sortedPlayers = [...data.players].sort((a, b) => a.localeCompare(b));

    container.innerHTML = sortedPlayers.map(player => {
        const selectedClass = currentEntry.player === player ? 'selected' : '';
        return '<div class="selection-item ' + selectedClass + '" data-player="' + escapeHtml(player) + '">' + escapeHtml(player) + '</div>';
    }).join('');

    container.querySelectorAll('.selection-item').forEach(item => {
        item.addEventListener('click', function () {
            selectPlayer(this.getAttribute('data-player'));
        });
    });
}

function relativeTime(isoString) {
    if (!isoString) return '';
    const now = Date.now();
    const then = new Date(isoString).getTime();
    const diff = now - then;
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'just now';
    if (mins < 60) return mins + ' minutes ago';
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hour' + (hrs !== 1 ? 's' : '') + ' ago';
    const days = Math.floor(hrs / 24);
    if (days < 7) return days + ' day' + (days !== 1 ? 's' : '') + ' ago';
    return formatDate(isoString);
}

export function renderHistory() {
    const container = document.getElementById('historyContainer');
    const toggleBtn = document.getElementById('historyToggleBtn');
    const toggleText = document.getElementById('historyToggleText');
    const toggleIcon = document.getElementById('historyToggleIcon');

    if (data.entries.length === 0) {
        container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><div class="empty-state-icon">📜</div><h3>No History Yet</h3><p>Your game history will appear here</p></div>';
        toggleBtn.style.display = 'none';
        return;
    }

    const sortedEntries = [...data.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
    const totalEntries = sortedEntries.length;
    const defaultHistoryCount = 6;
    const hasMore = totalEntries > defaultHistoryCount;
    toggleBtn.style.display = hasMore ? 'flex' : 'none';

    if (showAllHistory) {
        toggleText.textContent = 'Show Last ' + defaultHistoryCount;
        toggleIcon.classList.add('expanded');
    } else {
        toggleText.textContent = 'Show All (' + totalEntries + ')';
        toggleIcon.classList.remove('expanded');
    }

    let displayEntries = sortedEntries;
    if (!showAllHistory && hasMore) {
        displayEntries = sortedEntries.slice(0, defaultHistoryCount);
    }

    container.innerHTML = displayEntries.map(entry => {
        let auditText = '';
        if (entry.updated_by_name) {
            auditText = 'Edited by ' + entry.updated_by_name + ' · ' + relativeTime(entry.updated_at);
        } else if (entry.created_by_name) {
            auditText = 'Added by ' + entry.created_by_name + ' · ' + relativeTime(entry.created_at);
        }
        const auditHtml = auditText
            ? '<div class="history-card-audit">' + escapeHtml(auditText) + '</div>'
            : '';

        const gameImage = data.gameData && data.gameData[entry.game] && data.gameData[entry.game].image
            ? data.gameData[entry.game].image : null;
        const gameThumbHtml = gameImage
            ? '<img src="' + escapeHtml(gameImage) + '" alt="" class="history-card-game-thumb" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline\'"><span style="display:none">🎲</span>'
            : '<span>🎲</span>';

        return '<div class="history-card" data-id="' + entry.id + '">' +
            '<div class="history-card-info">' +
            '<div class="history-card-game">' + gameThumbHtml + ' ' + escapeHtml(entry.game) + '</div>' +
            '<div class="history-card-details">🏆 ' + escapeHtml(entry.player) + ' • 📅 ' + formatDate(entry.date) + '</div>' +
            auditHtml +
            '</div>' +
            '<div class="history-card-actions">' +
            '<button class="history-edit-btn" data-id="' + entry.id + '" title="Edit entry">⚙️</button>' +
            '<button class="history-delete-btn" data-id="' + entry.id + '" title="Delete entry">🗑️</button>' +
            '</div>' +
            '</div>';
    }).join('');

    container.querySelectorAll('.history-edit-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            openEditEntryModal(this.getAttribute('data-id'));
        });
    });
    container.querySelectorAll('.history-delete-btn').forEach(btn => {
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            deleteEntryById(this.getAttribute('data-id'));
        });
    });
}

export function toggleHistoryDisplay() {
    toggleShowAllHistory();
    renderHistory();
}

// These are called from events.js - need to export for use in events
export function selectGame(game) {
    currentEntry.game = game;
    renderGameSelection();
    setTimeout(() => nextStep(2), 150);
}

export function selectPlayer(player) {
    currentEntry.player = player;
    renderPlayerSelection();
    setTimeout(() => nextStep(3), 150);
}

export function nextStep(step) {
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById('step' + step).classList.add('active');
    if (step === 3) document.getElementById('winDate').valueAsDate = new Date();
}

export function prevStep(step) {
    nextStep(step);
}

export function resetEntryFlow() {
    currentEntry.game = null;
    currentEntry.player = null;
    currentEntry.date = null;
    document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
    document.getElementById('step1').classList.add('active');
    document.getElementById('newGameInput').classList.remove('active');
    document.getElementById('newPlayerInput').classList.remove('active');
    document.getElementById('newGameName').value = '';
    document.getElementById('newPlayerName').value = '';
    document.getElementById('newGameImagePreview').style.display = 'none';
    document.getElementById('newPlayerImagePreview').style.display = 'none';
    const _giUrl = document.getElementById('newGameImageUrl');
    const _piUrl = document.getElementById('newPlayerImageUrl');
    if (_giUrl) _giUrl.value = '';
    if (_piUrl) _piUrl.value = '';
    uiState.tempGameImage = null;
    uiState.tempPlayerImage = null;
    renderGameSelection();
    renderPlayerSelection();
}
