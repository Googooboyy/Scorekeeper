import { data, saveData } from './data.js';
import { showModal, showNotification } from './modals.js';
import { getActivePlaygroup } from './playgroups.js';
import { showLoginPrompt } from './auth-ui.js';
import { deletePlayerById, deleteGameById, deleteEntry } from './supabase.js';

/** Perform the actual player deletion (no confirmation). Used by deletePlayer and auto-removal of 0-win meeples. */
async function performDeletePlayer(player) {
    const playerId = data._playerIdByName?.[player];
    if (!playerId) return;
    await deletePlayerById(playerId);
    data.players = data.players.filter(p => p !== player);
    data.entries = data.entries.filter(e => e.player !== player);
    if (data.playerData[player]) delete data.playerData[player];
    delete data._playerIdByName?.[player];
    saveData();
}

export function deletePlayer(player) {
    if (!getActivePlaygroup()) { showLoginPrompt(); return; }
    const playerEntries = data.entries.filter(e => e.player === player);
    const entryCount = playerEntries.length;
    let message = 'Are you sure you want to delete "' + player + '"?';
    if (entryCount > 0) {
        message += '<br><br>This will also delete <strong>' + entryCount + ' win record(s)</strong> associated with this player.<br>This action cannot be undone.';
    }
    showModal('Delete Player?', message, async function () {
        try {
            await performDeletePlayer(player);
            showNotification('Player "' + player + '" deleted');
        } catch (err) {
            showNotification('Error deleting player: ' + (err.message || err));
        }
    }, 'Delete');
}

export function deleteGame(game) {
    if (!getActivePlaygroup()) { showLoginPrompt(); return; }
    const gameEntries = data.entries.filter(e => e.game === game);
    const entryCount = gameEntries.length;

    let message = 'Are you sure you want to delete "' + game + '"?';
    if (entryCount > 0) {
        message += '<br><br>This will also delete <strong>' + entryCount + ' win record(s)</strong> associated with this game.<br>This action cannot be undone.';
    }

    showModal('Delete Game?', message, async function () {
        const gameId = data._gameIdByName?.[game];
        if (!gameId) return;
        try {
            await deleteGameById(gameId);
            data.games = data.games.filter(g => g !== game);
            data.entries = data.entries.filter(e => e.game !== game);
            if (data.gameData[game]) delete data.gameData[game];
            delete data._gameIdByName?.[game];
            saveData();
            showNotification('Game "' + game + '" deleted');
        } catch (err) {
            showNotification('Error deleting game: ' + (err.message || err));
        }
    }, 'Delete');
}

export function deleteEntryById(id) {
    if (!getActivePlaygroup()) { showLoginPrompt(); return; }
    const entry = data.entries.find(e => e.id === id);
    const playerName = entry?.player;
    showModal('Delete Entry?', 'Are you sure you want to delete this win record?', async function () {
        try {
            await deleteEntry(id);
            data.entries = data.entries.filter(e => e.id !== id);
            saveData();
            // Auto-remove meeple if they now have 0 wins
            if (playerName && data.players.includes(playerName)) {
                const remainingWins = data.entries.filter(e => e.player === playerName).length;
                if (remainingWins === 0) {
                    await performDeletePlayer(playerName);
                    showNotification('Entry deleted. "' + playerName + '" was removed (0 wins).');
                    return;
                }
            }
            showNotification('Entry deleted');
        } catch (err) {
            showNotification('Error deleting entry: ' + (err.message || err));
        }
    }, 'Delete');
}
