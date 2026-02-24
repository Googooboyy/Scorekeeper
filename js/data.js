// Data Management
export let data = {
    players: [],
    games: [],
    entries: [],
    gameData: {},
    playerData: {},
    _gameIdByName: {},
    _playerIdByName: {},
    currentUserId: null,  // Set from auth — used to highlight linked player card
    currentUserFavouriteQuote: null  // Set when logged-in user profile is loaded; used on leaderboard card
};

export let currentEntry = {
    game: null,
    player: null,
    date: null
};

let _modalCallback = null;
export function getModalCallback() { return _modalCallback; }
export function setModalCallback(cb) { _modalCallback = cb; }

export const uiState = {
    currentGameForImage: null,
    currentPlayerForImage: null,
    tempGameImage: null,
    tempPlayerImage: null,
    selectedColor: '#6366f1',
    currentEditId: null
};

export let showAllGames = false;
export let showAllHistory = false;
export let showAllPlayers = false;

export function toggleShowAllGames() { showAllGames = !showAllGames; }
export function toggleShowAllHistory() { showAllHistory = !showAllHistory; }
export function toggleShowAllPlayers() { showAllPlayers = !showAllPlayers; }

let renderCallback = null;

export function setRenderCallback(fn) {
    renderCallback = fn;
}

export function resetData() {
    data.players = [];
    data.games = [];
    data.entries = [];
    data.gameData = {};
    data.playerData = {};
    data._gameIdByName = {};
    data._playerIdByName = {};
    data.currentUserFavouriteQuote = null;
}

export async function loadData(playgroupId) {
    if (!playgroupId) {
        resetData();
        if (renderCallback) renderCallback();
        return;
    }
    const { loadPlaygroupData } = await import('./supabase.js');
    const pgData = await loadPlaygroupData(playgroupId);
    data.players = pgData.players;
    data.games = pgData.games;
    data.entries = (pgData.entries || []).map(e => {
        if (!e.id) e.id = 'entry-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        return e;
    });
    data.gameData = pgData.gameData || {};
    data.playerData = pgData.playerData || {};
    data._gameIdByName = pgData._gameIdByName || {};
    data._playerIdByName = pgData._playerIdByName || {};
    if (renderCallback) renderCallback();
}

export function saveData() {
    if (renderCallback) renderCallback();
}

export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

export function formatDate(dateStr) {
    const date = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

export function escapeCsv(text) {
    if (!text) return '';
    return text.replace(/"/g, '""');
}
