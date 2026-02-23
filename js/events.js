import {
    data,
    currentEntry,
    getModalCallback,
    uiState,
    loadData,
    saveData,
    escapeCsv
} from './data.js';
import { getActivePlaygroup } from './playgroups.js';
import { showLoginPrompt } from './auth-ui.js';
import {
    insertGame,
    insertPlayer,
    insertEntry,
    clearPlaygroupData,
    importPlaygroupData,
    upsertGameMetadata,
    upsertPlayerMetadata
} from './supabase.js';
import { showModal, hideModal, handleImageFileSelect, showNotification, fireConfetti, closeGameImageModal, closePlayerImageModal, resetPlayerCustomization, closeEditEntryModal, saveGameImage, savePlayerImage, saveEditedEntry, closePlayerProfileModal, openScoreTabulator } from './modals.js';
import {
    renderGameSelection,
    renderPlayerSelection,
    selectGame,
    selectPlayer,
    nextStep,
    prevStep,
    resetEntryFlow,
    toggleGamesDisplay,
    toggleHistoryDisplay,
    togglePlayersDisplay
} from './render.js';

export function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            showSection(this.getAttribute('data-section'));
        });
    });
}

function setupFooterLinks() {
    document.querySelectorAll('.footer-col a[data-section]').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const section = this.getAttribute('data-section');
            if (section) showSection(section);
        });
    });
    document.querySelectorAll('.footer-col a[data-coming-soon]').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            showModal('Coming soon..', 'This feature is not yet available.', () => {}, 'OK');
        });
    });
    document.querySelectorAll('.footer-social a').forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            showModal('Coming soon..', 'This feature is not yet available.', () => {}, 'OK');
        });
    });
    const exportLink = document.getElementById('footerExportLink');
    if (exportLink) {
        exportLink.addEventListener('click', function (e) {
            e.preventDefault();
            document.getElementById('exportBtn')?.click();
        });
    }
}

export function showSection(sectionName) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(sectionName).classList.add('active');
    document.querySelector('[data-section="' + sectionName + '"]').classList.add('active');
    if (sectionName === 'add') resetEntryFlow();
}

export function setupEventListeners() {
    setupNavigation();
    setupFooterLinks();

    document.getElementById('modalCancel').addEventListener('click', hideModal);
    document.getElementById('modalConfirm').addEventListener('click', function () {
        const cb = getModalCallback();
        if (cb) {
            cb();
            hideModal();
        }
    });
    document.getElementById('modalOverlay').addEventListener('click', function (e) {
        if (e.target === document.getElementById('modalOverlay')) hideModal();
    });

    // Score Tabulator launch
    document.getElementById('tallyLaunchBtn').addEventListener('click', () => openScoreTabulator());

    // tallyComplete — fired by modals.js when a winner is confirmed; bridge to render flow
    window.addEventListener('tallyComplete', (e) => {
        const { game, winner } = e.detail;
        showSection('add');
        // selectGame advances to step 2, selectPlayer advances to step 3
        setTimeout(() => selectGame(game), 80);
        setTimeout(() => selectPlayer(winner), 320);
    });

    document.getElementById('showNewGameBtn').addEventListener('click', showNewGameInput);
    document.getElementById('addGameBtn').addEventListener('click', addNewGame);
    document.getElementById('newGameName').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addNewGame();
    });

    document.getElementById('showNewPlayerBtn').addEventListener('click', showNewPlayerInput);
    document.getElementById('addPlayerBtn').addEventListener('click', addNewPlayer);
    document.getElementById('newPlayerName').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addNewPlayer();
    });

    document.getElementById('backToStep1').addEventListener('click', function () { prevStep(1); });
    document.getElementById('backToStep2').addEventListener('click', function () { prevStep(2); });
    document.getElementById('saveEntryBtn').addEventListener('click', saveEntry);

    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    [exportBtn, importBtn].forEach(btn => {
        if (!btn) return;
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.title = 'Coming soon';
    });
    exportBtn?.addEventListener('click', () => showModal('Coming Soon', 'Export & Import are temporarily disabled. Check back soon!', () => {}));
    importBtn?.addEventListener('click', () => showModal('Coming Soon', 'Export & Import are temporarily disabled. Check back soon!', () => {}));
    document.getElementById('importFileInput').addEventListener('change', handleFileImport);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
    document.getElementById('gamesToggleBtn').addEventListener('click', toggleGamesDisplay);
    document.getElementById('historyToggleBtn').addEventListener('click', toggleHistoryDisplay);
    document.getElementById('playersToggleBtn').addEventListener('click', togglePlayersDisplay);

    document.getElementById('gameImageCancel').addEventListener('click', closeGameImageModal);
    document.getElementById('gameImageSave').addEventListener('click', saveGameImage);
    document.getElementById('gameImageRemove').addEventListener('click', function () {
        uiState.tempGameImage = null;
        document.getElementById('gameImagePreview').style.display = 'none';
        saveGameImage();
    });
    document.getElementById('gameImageModal').addEventListener('click', function (e) {
        if (e.target === document.getElementById('gameImageModal')) closeGameImageModal();
    });

    document.getElementById('gameImageFileInput').addEventListener('change', function (e) {
        handleImageFileSelect(e.target.files[0], 'gameImagePreview', function (result) {
            uiState.tempGameImage = result;
        });
    });

    document.getElementById('playerImageCancel').addEventListener('click', closePlayerImageModal);
    document.getElementById('playerImageSave').addEventListener('click', savePlayerImage);
    document.getElementById('playerImageRemove').addEventListener('click', resetPlayerCustomization);
    document.getElementById('playerImageModal').addEventListener('click', function (e) {
        if (e.target === document.getElementById('playerImageModal')) closePlayerImageModal();
    });

    document.getElementById('playerImageFileInput').addEventListener('change', function (e) {
        handleImageFileSelect(e.target.files[0], 'playerImagePreview', function (result) {
            uiState.tempPlayerImage = result;
        });
    });

    document.querySelectorAll('#colorPicker .color-option').forEach(btn => {
        btn.addEventListener('click', function () {
            document.querySelectorAll('#colorPicker .color-option').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
            uiState.selectedColor = this.getAttribute('data-color');
        });
    });

    document.getElementById('newGameImage').addEventListener('change', function (e) {
        handleImageFileSelect(e.target.files[0], 'newGameImagePreview', function (result) {
            uiState.tempGameImage = result;
        });
    });

    document.getElementById('newPlayerImage').addEventListener('change', function (e) {
        handleImageFileSelect(e.target.files[0], 'newPlayerImagePreview', function (result) {
            uiState.tempPlayerImage = result;
        });
    });

    document.getElementById('editEntryCancel').addEventListener('click', closeEditEntryModal);
    document.getElementById('editEntrySave').addEventListener('click', saveEditedEntry);
    document.getElementById('editEntryModal').addEventListener('click', function (e) {
        if (e.target === document.getElementById('editEntryModal')) closeEditEntryModal();
    });

    // About page CTA buttons — scroll to top and open login
    ['aboutGetStartedBtn', 'aboutGetStartedBtn2'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', function () {
                const loginBtn = document.getElementById('loginBtn');
                if (loginBtn && loginBtn.offsetParent !== null) {
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    setTimeout(() => loginBtn.click(), 400);
                } else {
                    // Already logged in — go to dashboard
                    showSection('dashboard');
                }
            });
        }
    });

    // Close player profile panel on Escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            const profileModal = document.getElementById('playerProfileModal');
            if (profileModal?.classList.contains('active')) closePlayerProfileModal();
        }
    });
}

function showNewGameInput() {
    document.getElementById('newGameInput').classList.add('active');
    document.getElementById('newGameName').focus();
}

async function addNewGame() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const input = document.getElementById('newGameName');
    const name = input.value.trim();
    if (!name) { alert('Please enter a game name'); return; }
    if (data.games.includes(name)) { alert('This game already exists'); return; }

    try {
        const row = await insertGame(pg.id, name);
        data.games.push(name);
        data._gameIdByName[name] = row.id;
        if (uiState.tempGameImage) {
            await upsertGameMetadata(row.id, uiState.tempGameImage);
            if (!data.gameData) data.gameData = {};
            data.gameData[name] = { image: uiState.tempGameImage };
        }
        saveData();
        input.value = '';
        document.getElementById('newGameInput').classList.remove('active');
        document.getElementById('newGameImagePreview').style.display = 'none';
        uiState.tempGameImage = null;
        selectGame(name);
    } catch (err) {
        alert('Error adding game: ' + (err.message || err));
    }
}

function showNewPlayerInput() {
    document.getElementById('newPlayerInput').classList.add('active');
    document.getElementById('newPlayerName').focus();
}

async function addNewPlayer() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const input = document.getElementById('newPlayerName');
    const name = input.value.trim();
    if (!name) { alert('Please enter a meeple name'); return; }
    if (data.players.includes(name)) { alert('This meeple already exists'); return; }
    if (data.players.length >= 4) {
        showModal('Meeple limit reached', 'This campaign supports up to 4 meeples on the current plan.', () => {});
        return;
    }

    try {
        const row = await insertPlayer(pg.id, name);
        data.players.push(name);
        data._playerIdByName[name] = row.id;
        const img = uiState.tempPlayerImage;
        const color = uiState.selectedColor;
        if (img || color) {
            await upsertPlayerMetadata(row.id, img, color);
            if (!data.playerData) data.playerData = {};
            data.playerData[name] = {};
            if (img) data.playerData[name].image = img;
            if (color) data.playerData[name].color = color;
        }
        saveData();
        input.value = '';
        document.getElementById('newPlayerInput').classList.remove('active');
        document.getElementById('newPlayerImagePreview').style.display = 'none';
        uiState.tempPlayerImage = null;
        selectPlayer(name);
    } catch (err) {
        alert('Error adding meeple: ' + (err.message || err));
    }
}

async function saveEntry() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const dateInput = document.getElementById('winDate');
    const date = dateInput.value;
    if (!date) { alert('Please select a date'); return; }
    currentEntry.date = date;
    const gameId = data._gameIdByName[currentEntry.game];
    const playerId = data._playerIdByName[currentEntry.player];
    if (!gameId || !playerId) { alert('Invalid game or meeple'); return; }

    const btn = document.getElementById('saveEntryBtn');
    const originalText = btn.innerHTML;
    btn.textContent = 'Saving…';
    btn.disabled = true;

    try {
        const row = await insertEntry(pg.id, gameId, playerId, date);
        data.entries.push({
            id: row.id,
            game: currentEntry.game,
            player: currentEntry.player,
            date: currentEntry.date,
            created_at: row.created_at || new Date().toISOString(),
            created_by_name: row.created_by_name || null,
            updated_at: row.updated_at || null,
            updated_by_name: row.updated_by_name || null
        });
        const addedGame = currentEntry.game;
        saveData();
        btn.innerHTML = originalText;
        btn.disabled = false;
        showNotification('🎉 ' + currentEntry.player + ' won at ' + currentEntry.game + '!');
        resetEntryFlow();
        showSection('dashboard');
        fireConfetti();
        requestAnimationFrame(() => {
            document.querySelectorAll('.game-card-wrapper').forEach(w => {
                if (w.dataset.game === addedGame) {
                    const num = w.querySelector('.game-card-number');
                    if (num) {
                        num.classList.add('win-count-highlight');
                        setTimeout(() => num.classList.remove('win-count-highlight'), 2500);
                    }
                }
            });
        });
    } catch (err) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        alert('Error saving win: ' + (err.message || err));
    }
}

function exportData() {
    const pg = getActivePlaygroup();
    if (!pg) { showNotification('Select a campaign to export'); return; }
    const exportObj = {
        version: 1,
        exportedAt: new Date().toISOString(),
        data: {
            players: data.players,
            games: data.games,
            entries: data.entries,
            gameData: data.gameData,
            playerData: data.playerData
        }
    };
    const dataStr = JSON.stringify(exportObj, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = 'board-game-tracker-backup-' + new Date().toISOString().split('T')[0] + '.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Data exported successfully! 📥');
}

function importData() {
    if (!getActivePlaygroup()) { showLoginPrompt(); return; }
    document.getElementById('importFileInput').click();
}

function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported.data || !imported.data.players || !imported.data.games || !imported.data.entries) {
                throw new Error('Invalid file format');
            }
            showModal(
                'Import Data?',
                'This will replace all current campaign data with the imported file.<br><br>' +
                'Meeples: ' + imported.data.players.length + '<br>' +
                'Games: ' + imported.data.games.length + '<br>' +
                'Entries: ' + imported.data.entries.length + '<br><br>' +
                'Your current data will be overwritten.',
                async function () {
                    const pg = getActivePlaygroup();
                    if (!pg) { showLoginPrompt(); return; }
                    try {
                        await importPlaygroupData(pg.id, imported.data);
                        await loadData(pg.id);
                        showNotification('Data imported successfully! 📤');
                    } catch (err) {
                        alert('Error importing: ' + (err.message || err));
                    }
                },
                'Import'
            );
        } catch (err) {
            alert('Error importing file: ' + err.message);
        }
        event.target.value = '';
    };
    reader.readAsText(file);
}

function clearAllData() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    showModal(
        'Clear All Data?',
        'This will permanently delete all meeples, games, and history in this campaign.<br>This action cannot be undone.',
        async function () {
            try {
                await clearPlaygroupData(pg.id);
                await loadData(pg.id);
                showNotification('All data cleared 🗑️');
            } catch (err) {
                alert('Error clearing: ' + (err.message || err));
            }
        },
        'Clear All'
    );
}
