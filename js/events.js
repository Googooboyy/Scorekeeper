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
    upsertPlayerMetadata,
    upsertGlobalGame,
    fetchAppConfig
} from './supabase.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { showModal, hideModal, handleImageFileSelect, showNotification, fireConfetti, playVictoryFanfare, closeGameImageModal, closePlayerImageModal, resetPlayerCustomization, closeEditEntryModal, saveGameImage, savePlayerImage, saveEditedEntry, closePlayerProfileModal, openScoreTabulator } from './modals.js';
import {
    renderGameSelection,
    renderPlayerSelection,
    renderPlayers,
    rollQuotesWave,
    selectGame,
    selectPlayer,
    nextStep,
    prevStep,
    resetEntryFlow,
    toggleGamesDisplay,
    toggleHistoryDisplay,
    togglePlayersDisplay
} from './render.js';

// Validates an image URL, shows a preview, and calls callback(url) on success.
// Uses debounce so it only fires 600 ms after the user stops typing.
const _imgUrlTimers = {};
function _handleImageUrl(url, previewId, callback) {
    clearTimeout(_imgUrlTimers[previewId]);
    const preview = document.getElementById(previewId);
    if (!url) {
        if (preview) { preview.src = ''; preview.style.display = 'none'; }
        callback(null);
        return;
    }
    _imgUrlTimers[previewId] = setTimeout(() => {
        if (!url.startsWith('http://') && !url.startsWith('https://')) return;
        const tester = new Image();
        tester.onload = () => {
            if (preview) { preview.src = url; preview.style.display = 'block'; }
            callback(url);
        };
        tester.onerror = () => { /* silently ignore while user is still typing */ };
        tester.src = url;
    }, 600);
}

export function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            const section = this.getAttribute('data-section');
            if (section) showSection(section);
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
    // Clear any special UI modes when switching sections
    document.body.classList.remove('tally-add-game-mode');

    let targetId = sectionName;
    // Fallback to in-app 404 section if an unknown section is requested
    if (!document.getElementById(targetId)) {
        targetId = 'not-found';
    }

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

    const targetSection = document.getElementById(targetId);
    if (targetSection) {
        targetSection.classList.add('active');
    }

    const targetTab = document.querySelector('[data-section="' + targetId + '"]');
    if (targetTab) {
        targetTab.classList.add('active');
    }

    if (targetId === 'add') resetEntryFlow();
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

    // Score Tabulator launch — guests/read-only cannot tally
    document.getElementById('tallyLaunchBtn').addEventListener('click', () => {
        if (document.body.classList.contains('read-only')) {
            showLoginPrompt();
            return;
        }
        openScoreTabulator();
    });
    document.addEventListener('scorekeeper:openAddGame', function onOpenAddGame() {
        showSection('add');
        document.body.classList.add('tally-add-game-mode');
        showNewGameInput();
    });

    // tallyComplete — fired by modals.js when Stage 3 "Save Win" is confirmed
    window.addEventListener('tallyComplete', async (e) => {
        const { game, winner, date } = e.detail;
        const pg = getActivePlaygroup();
        if (!pg) { showLoginPrompt(); return; }

        const gameId   = data._gameIdByName[game];
        const playerId = data._playerIdByName[winner];
        if (!gameId || !playerId) {
            showNotification('Could not save win — invalid game or meeple.');
            return;
        }

        try {
            const row = await insertEntry(pg.id, gameId, playerId, date);
            data.entries.push({
                id: row.id,
                game,
                player: winner,
                date,
                created_at: row.created_at || new Date().toISOString(),
                created_by_name: row.created_by_name || null,
                updated_at: row.updated_at || null,
                updated_by_name: row.updated_by_name || null
            });
            saveData();
            showNotification('🎉 ' + winner + ' won at ' + game + '!');
            showSection('dashboard');
            fireConfetti();
            requestAnimationFrame(() => {
                document.querySelectorAll('.game-card-wrapper').forEach(w => {
                    if (w.dataset.game === game) {
                        const num = w.querySelector('.game-card-number');
                        if (num) num.classList.add('win-flash');
                    }
                });
            });
        } catch (err) {
            showNotification('Could not save win: ' + (err.message || err));
        }
    });

    document.getElementById('showNewGameBtn').addEventListener('click', showNewGameInput);
    document.getElementById('addGameBtn').addEventListener('click', addNewGame);
    document.getElementById('newGameName').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') addNewGame();
    });
    setupBggTypeahead();

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
    if (exportBtn) {
        exportBtn.addEventListener('click', () => exportData());
    }
    if (importBtn) {
        importBtn.addEventListener('click', () => importData());
    }
    document.getElementById('importFileInput').addEventListener('change', handleFileImport);
    document.getElementById('clearAllBtn').addEventListener('click', clearAllData);
    document.getElementById('gamesToggleBtn').addEventListener('click', toggleGamesDisplay);
    document.getElementById('historyToggleBtn').addEventListener('click', toggleHistoryDisplay);
    document.getElementById('playersToggleBtn').addEventListener('click', togglePlayersDisplay);

    // Celebration pills (leaderboard section)
    const celebrationConfettiBtn = document.getElementById('celebrationConfettiBtn');
    const celebrationShakeBtn = document.getElementById('celebrationShakeBtn');
    const celebrationTrumpetBtn = document.getElementById('celebrationTrumpetBtn');
    if (celebrationConfettiBtn) {
        celebrationConfettiBtn.addEventListener('click', () => {
            const delays = [0, 500, 1000, 1500, 2000];
            delays.forEach(d => setTimeout(() => fireConfetti(), d));
        });
    }
    if (celebrationShakeBtn) {
        celebrationShakeBtn.addEventListener('click', () => {
            document.body.classList.add('screen-shake');
            setTimeout(() => document.body.classList.remove('screen-shake'), 2500);
        });
    }
    if (celebrationTrumpetBtn) {
        celebrationTrumpetBtn.addEventListener('click', () => playVictoryFanfare());
    }
    const celebrationRollQuotesBtn = document.getElementById('celebrationRollQuotesBtn');
    if (celebrationRollQuotesBtn) {
        celebrationRollQuotesBtn.addEventListener('click', () => {
            rollQuotesWave();
        });
    }

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
            document.getElementById('gameImageUrlInput').value = '';
        });
    });

    document.getElementById('gameImageUrlInput').addEventListener('input', function () {
        _handleImageUrl(this.value.trim(), 'gameImagePreview', function (url) {
            uiState.tempGameImage = url;
            document.getElementById('gameImageFileInput').value = '';
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
            const removeBtn = document.getElementById('playerImageRemoveInSection');
            if (removeBtn) removeBtn.style.display = 'inline-block';
        });
    });

    document.getElementById('playerImageRemoveInSection').addEventListener('click', function () {
        uiState.tempPlayerImage = null;
        const preview = document.getElementById('playerImagePreview');
        const fileInput = document.getElementById('playerImageFileInput');
        const removeBtn = document.getElementById('playerImageRemoveInSection');
        if (preview) { preview.style.display = 'none'; preview.removeAttribute('src'); }
        if (fileInput) fileInput.value = '';
        if (removeBtn) removeBtn.style.display = 'none';
        savePlayerImage();
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
            document.getElementById('newGameImageUrl').value = ''; // clear URL input
        });
    });

    document.getElementById('newGameImageUrl').addEventListener('input', function () {
        _handleImageUrl(this.value.trim(), 'newGameImagePreview', function (url) {
            uiState.tempGameImage = url;
            document.getElementById('newGameImage').value = ''; // clear file input
        });
    });

    document.getElementById('newPlayerImage').addEventListener('change', function (e) {
        handleImageFileSelect(e.target.files[0], 'newPlayerImagePreview', function (result) {
            uiState.tempPlayerImage = result;
            document.getElementById('newPlayerImageUrl').value = ''; // clear URL input
        });
    });

    document.getElementById('newPlayerImageUrl').addEventListener('input', function () {
        _handleImageUrl(this.value.trim(), 'newPlayerImagePreview', function (url) {
            uiState.tempPlayerImage = url;
            document.getElementById('newPlayerImage').value = ''; // clear file input
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
                    showSection('dashboard');
                }
            });
        }
    });

    // About page logged-in action buttons
    ['aboutHeroAddWinBtn', 'aboutBottomAddWinBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => {
            showSection('add');
            document.body.classList.add('tally-add-game-mode');
            showNewGameInput();
        });
    });

    ['aboutHeroHistoryBtn', 'aboutBottomHistoryBtn'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', () => showSection('history'));
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
    const hidden = document.getElementById('newGameGlobalId');
    if (hidden) hidden.value = '';
}

let _bggTimer = null;
function setupBggTypeahead() {
    const input = document.getElementById('newGameName');
    const dropdown = document.getElementById('bggSuggestions');
    if (!input || !dropdown) return;

    input.addEventListener('input', () => {
        clearTimeout(_bggTimer);
        const q = input.value.trim();
        const hidden = document.getElementById('newGameGlobalId');
        if (hidden) hidden.value = '';
        if (q.length < 3) { dropdown.style.display = 'none'; return; }
        _bggTimer = setTimeout(() => fetchBggSuggestions(q, dropdown, input), 500);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('#newGameInput')) dropdown.style.display = 'none';
    });
}

async function fetchBggSuggestions(query, dropdown, input) {
    try {
        const url = SUPABASE_URL + '/functions/v1/bgg-search?q=' + encodeURIComponent(query);
        const resp = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
        });
        if (!resp.ok) {
            const status = resp.status;
            const friendly = describeBggStatus(status);
            console.warn('BGG search failed:', status, friendly);
            dropdown.style.display = 'none';
            return;
        }
        const results = await resp.json();
        if (!results.length) { dropdown.style.display = 'none'; return; }

        dropdown.innerHTML = results.slice(0, 6).map(r => {
            const thumb = r.thumbnail_url
                ? `<img class="bgg-suggestion-thumb" src="${r.thumbnail_url}" alt="">`
                : `<div class="bgg-suggestion-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1rem;">🎲</div>`;
            return `<div class="bgg-suggestion" data-bgg='${JSON.stringify(r).replace(/'/g, '&#39;')}'>
                ${thumb}
                <span class="bgg-suggestion-name">${escHtml(r.name)}</span>
                ${r.year_published ? `<span class="bgg-suggestion-year">${r.year_published}</span>` : ''}
            </div>`;
        }).join('');
        dropdown.style.display = 'block';

        dropdown.querySelectorAll('.bgg-suggestion').forEach(el => {
            el.addEventListener('click', async () => {
                const bgg = JSON.parse(el.dataset.bgg);
                input.value = bgg.name;
                dropdown.style.display = 'none';
                try {
                    const globalGame = await upsertGlobalGame(bgg.bgg_id, bgg.name, bgg.year_published, bgg.thumbnail_url);
                    const hidden = document.getElementById('newGameGlobalId');
                    if (hidden) hidden.value = globalGame.id;
                    if (bgg.thumbnail_url && !uiState.tempGameImage) {
                        uiState.tempGameImage = bgg.thumbnail_url;
                        const preview = document.getElementById('newGameImagePreview');
                        if (preview) { preview.src = bgg.thumbnail_url; preview.style.display = 'block'; }
                    }
                } catch (e) { console.warn('Could not save global game:', e); }
            });
        });
    } catch (e) {
        dropdown.style.display = 'none';
    }
}

function escHtml(text) {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
}

function describeBggStatus(status) {
    switch (status) {
        case 429: return 'Too many requests / rate limited by BGG';
        case 500: return 'Server error on BGG';
        case 502: return 'Bad gateway between Supabase and BGG';
        case 503: return 'BGG temporarily unavailable';
        case 504: return 'BGG took too long to respond';
        default: return 'Unexpected response from BGG';
    }
}

async function addNewGame() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const input = document.getElementById('newGameName');
    const name = input.value.trim();
    if (!name) { showNotification('Please enter a game name'); return; }
    if (data.games.includes(name)) { showNotification('This game already exists'); return; }

    const globalGameId = document.getElementById('newGameGlobalId')?.value || null;

    try {
        const row = await insertGame(pg.id, name, globalGameId);
        data.games.push(name);
        data._gameIdByName[name] = row.id;
        if (uiState.tempGameImage) {
            await upsertGameMetadata(row.id, uiState.tempGameImage);
            if (!data.gameData) data.gameData = {};
            data.gameData[name] = { image: uiState.tempGameImage };
        }
        saveData();
        input.value = '';
        if (document.getElementById('newGameGlobalId')) document.getElementById('newGameGlobalId').value = '';
        document.getElementById('bggSuggestions').style.display = 'none';
        document.getElementById('newGameInput').classList.remove('active');
        document.getElementById('newGameImagePreview').style.display = 'none';
        document.getElementById('newGameImageUrl').value = '';
        uiState.tempGameImage = null;

        if (document.body.classList.contains('tally-add-game-mode')) {
            document.body.classList.remove('tally-add-game-mode');
            openScoreTabulator(name);
        } else {
            selectGame(name);
        }
    } catch (err) {
        showNotification('Error adding game: ' + (err.message || err));
    }
}

export function showNewPlayerInput() {
    document.getElementById('newPlayerInput').classList.add('active');
    document.getElementById('newPlayerName').focus();
}

async function addNewPlayer() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const input = document.getElementById('newPlayerName');
    const name = input.value.trim();
    if (!name) { showNotification('Please enter a meeple name'); return; }
    if (data.players.includes(name)) { showNotification('This meeple already exists'); return; }
    const maxMeeples = window._scorekeeperMaxMeeples || 4;
    if (data.players.length >= maxMeeples) {
        showModal('Meeple limit reached', `This campaign supports up to ${maxMeeples} meeples on the current plan.`, () => {});
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
        document.getElementById('newPlayerImageUrl').value = '';
        uiState.tempPlayerImage = null;
        selectPlayer(name);
    } catch (err) {
        showNotification('Error adding meeple: ' + (err.message || err));
    }
}

async function saveEntry() {
    const pg = getActivePlaygroup();
    if (!pg) { showLoginPrompt(); return; }
    const dateInput = document.getElementById('winDate');
    const date = dateInput.value;
    if (!date) { showNotification('Please select a date'); return; }
    currentEntry.date = date;
    const gameId = data._gameIdByName[currentEntry.game];
    const playerId = data._playerIdByName[currentEntry.player];
    if (!gameId || !playerId) { showNotification('Invalid game or meeple'); return; }

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
        showNotification('Error saving win: ' + (err.message || err));
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
                        showNotification('Error importing: ' + (err.message || err));
                    }
                },
                'Import'
            );
        } catch (err) {
            showNotification('Error importing file: ' + err.message);
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
                showNotification('Error clearing: ' + (err.message || err));
            }
        },
        'Clear All'
    );
}
