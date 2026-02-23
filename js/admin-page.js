import { getSession, onAuthStateChange } from './auth.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
    isAdminConfigured, isAdminEmail, isAdminMode,
    activateAdminMode, deactivateAdminMode, showAdminPassphraseModal
} from './admin.js';
import {
    fetchPlaygroups, fetchAllUsers, fetchAllPlaygroupMembers,
    fetchAllGames, fetchAllPlayers, fetchAllEntries, fetchAllInviteTokens,
    fetchAppConfig, setAppConfig,
    fetchAllAnnouncements, publishAnnouncement, clearAnnouncement, fetchActiveAnnouncement,
    deleteAnnouncement, reactivateAnnouncement,
    fetchUnlinkedGames, fetchGlobalGames, upsertGlobalGame, linkGameToGlobal,
    deletePlaygroupAdmin, deleteInviteToken,
    adminDeleteEntry, adminDeleteGame, adminDeletePlayer
} from './supabase.js';
import { signOut } from './auth.js';

// ── Cached data ──────────────────────────────────────────────────────────────
let _playgroups = [], _users = [], _members = [], _games = [], _players = [];
let _entries = [], _invites = [], _config = {}, _globalGames = [];

const pgName = id => _playgroups.find(p => p.id === id)?.name || id?.slice(0, 8) || '—';
const userName = id => {
    const u = _users.find(u => u.id === id);
    return u?.email || id?.slice(0, 8) || '—';
};
const gameName = id => _games.find(g => g.id === id)?.name || '—';
const playerName = id => _players.find(p => p.id === id)?.name || '—';
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

// ── Access Gate ──────────────────────────────────────────────────────────────

function wipeAndRedirect() {
    deactivateAdminMode();
    const dash = document.getElementById('adminDashboard');
    if (dash) dash.innerHTML = '';
    window.location.replace('index.html');
}

async function boot() {
    const session = await getSession();
    if (!session) { wipeAndRedirect(); return; }

    const email = session.user?.email;
    document.getElementById('authEmail').textContent = email || '';
    document.getElementById('authUser').style.display = 'flex';
    document.getElementById('logoutBtn').addEventListener('click', () => signOut());

    if (!isAdminConfigured() || !isAdminEmail(email)) {
        document.getElementById('adminGate').style.display = 'none';
        document.getElementById('adminDenied').style.display = 'flex';
        return;
    }

    if (isAdminMode()) {
        showDashboard();
    } else {
        document.getElementById('adminGate').style.display = 'none';
        showAdminPassphraseModal(
            () => { activateAdminMode(); showDashboard(); },
            () => { window.location.replace('index.html'); }
        );
    }
}

onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { wipeAndRedirect(); return; }
    if (session && !isAdminEmail(session.user?.email)) { wipeAndRedirect(); }
});

// ── Dashboard init ───────────────────────────────────────────────────────────

function showDashboard() {
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminDenied').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
    setupTabs();
    loadOverview();
}

function guardAdmin() {
    if (!isAdminMode()) { wipeAndRedirect(); return false; }
    return true;
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs() {
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            if (!guardAdmin()) return;
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            onTabActivate(tab.dataset.tab);
        });
    });

    document.querySelectorAll('.admin-sub-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-sub-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-sub-panel').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('subtab-' + tab.dataset.subtab).classList.add('active');
        });
    });

    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    document.getElementById('publishAnnounceBtn').addEventListener('click', doPublishAnnouncement);
    document.getElementById('clearAnnounceBtn').addEventListener('click', doClearAnnouncement);

    document.getElementById('campaignSearch').addEventListener('input', renderCampaigns);
    document.getElementById('userSearch').addEventListener('input', renderUsers);
    document.getElementById('entryCampaignFilter').addEventListener('change', renderEntries);
}

function onTabActivate(tab) {
    const loaders = {
        overview: loadOverview,
        campaigns: loadCampaigns,
        users: loadUsers,
        entries: loadEntries,
        games: loadGamesPlayers,
        linking: loadLinking,
        invites: loadInvites,
        config: loadConfig,
        announcements: loadAnnouncements
    };
    if (loaders[tab]) loaders[tab]();
}

// ── Overview ─────────────────────────────────────────────────────────────────

async function loadOverview() {
    if (!guardAdmin()) return;
    try {
        [_playgroups, _users, _members, _games, _players, _entries, _globalGames] = await Promise.all([
            fetchPlaygroups(), fetchAllUsers(), fetchAllPlaygroupMembers(),
            fetchAllGames(), fetchAllPlayers(), fetchAllEntries(), fetchGlobalGames()
        ]);
    } catch (e) { console.error('Overview load error:', e); return; }

    document.getElementById('statCampaigns').textContent = _playgroups.length;
    document.getElementById('statUsers').textContent = _users.length;
    document.getElementById('statEntries').textContent = _entries.length;
    document.getElementById('statGames').textContent = _games.length;
    document.getElementById('statPlayers').textContent = _players.length;

    const linked = _games.filter(g => g.global_game_id).length;
    const pct = _games.length ? Math.round((linked / _games.length) * 100) : 0;
    document.getElementById('statLinked').textContent = pct + '%';

    renderTopGames();
    renderActivityChart();
}

function renderTopGames() {
    const winsByGame = {};
    _entries.forEach(e => {
        const game = _games.find(g => g.id === e.game_id);
        if (!game) return;
        const key = game.global_game_id || game.name;
        const label = game.global_game_id
            ? (_globalGames.find(gg => gg.id === game.global_game_id)?.name || game.name)
            : game.name;
        if (!winsByGame[key]) winsByGame[key] = { label, count: 0 };
        winsByGame[key].count++;
    });
    const top5 = Object.values(winsByGame).sort((a, b) => b.count - a.count).slice(0, 5);
    const max = top5[0]?.count || 1;
    const container = document.getElementById('topGamesChart');
    container.innerHTML = top5.length
        ? top5.map(g => `<div class="admin-bar-row">
            <span class="admin-bar-label">${esc(g.label)}</span>
            <div class="admin-bar-track"><div class="admin-bar-fill" style="width:${(g.count / max) * 100}%"></div></div>
            <span class="admin-bar-value">${g.count}</span>
        </div>`).join('')
        : '<p style="color:var(--text-muted);">No entries yet.</p>';
}

function renderActivityChart() {
    const now = new Date();
    const days = [];
    for (let i = 29; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().slice(0, 10));
    }
    const counts = {};
    days.forEach(d => counts[d] = 0);
    _entries.forEach(e => { if (counts[e.date] !== undefined) counts[e.date]++; });
    const max = Math.max(1, ...Object.values(counts));
    const container = document.getElementById('activityChart');
    container.innerHTML = days.map(d =>
        `<div class="admin-activity-bar" title="${d}: ${counts[d]} entries" style="height:${Math.max(2, (counts[d] / max) * 100)}%"></div>`
    ).join('');
}

// ── Campaigns ────────────────────────────────────────────────────────────────

async function loadCampaigns() {
    if (!guardAdmin()) return;
    if (!_playgroups.length) {
        [_playgroups, _members, _entries] = await Promise.all([
            fetchPlaygroups(), fetchAllPlaygroupMembers(), fetchAllEntries()
        ]);
    }
    populateCampaignFilter();
    renderCampaigns();
}

function populateCampaignFilter() {
    const sel = document.getElementById('entryCampaignFilter');
    const current = sel.value;
    sel.innerHTML = '<option value="">All campaigns</option>' +
        _playgroups.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    sel.value = current;
}

function renderCampaigns() {
    const q = (document.getElementById('campaignSearch').value || '').toLowerCase();
    const tbody = document.querySelector('#campaignsTable tbody');
    const filtered = _playgroups.filter(p => !q || p.name.toLowerCase().includes(q));
    tbody.innerHTML = filtered.map(p => {
        const owner = _members.find(m => m.playgroup_id === p.id && m.role === 'owner');
        const memberCount = _members.filter(m => m.playgroup_id === p.id).length;
        const entryCount = _entries.filter(e => e.playgroup_id === p.id).length;
        return `<tr data-id="${p.id}">
            <td><input type="checkbox" class="admin-row-check" data-table="campaigns" value="${p.id}"></td>
            <td>${esc(p.name)}</td>
            <td>${owner ? userName(owner.user_id) : '—'}</td>
            <td>${memberCount}</td>
            <td>${entryCount}</td>
            <td>${fmtDate(p.created_at)}</td>
            <td>
                <button class="admin-action-btn admin-action-danger" data-delete-campaign="${p.id}" title="Delete campaign">✕</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No campaigns found.</td></tr>';

    tbody.querySelectorAll('[data-delete-campaign]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.deleteCampaign;
            const name = _playgroups.find(p => p.id === id)?.name || '';
            if (!confirm(`Delete campaign "${name}" and ALL its data? This cannot be undone.`)) return;
            btn.disabled = true; btn.textContent = '…';
            try {
                await deletePlaygroupAdmin(id);
                _playgroups = _playgroups.filter(p => p.id !== id);
                _entries = _entries.filter(e => e.playgroup_id !== id);
                _members = _members.filter(m => m.playgroup_id !== id);
                renderCampaigns();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = '✕'; }
        });
    });

    setupBulkSelect('campaigns', 'campaignsBulkBar', 'campaignsBulkCount', 'campaignsTable');
    document.getElementById('campaignsBulkDelete').onclick = async () => {
        const ids = getChecked('campaigns');
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} campaign(s) and ALL their data? This cannot be undone.`)) return;
        for (const id of ids) {
            try {
                await deletePlaygroupAdmin(id);
                _playgroups = _playgroups.filter(p => p.id !== id);
                _entries = _entries.filter(e => e.playgroup_id !== id);
                _members = _members.filter(m => m.playgroup_id !== id);
            } catch (e) { alert('Error deleting campaign: ' + e.message); }
        }
        renderCampaigns();
    };
    document.getElementById('campaignsBulkClear').onclick = () => clearChecked('campaigns', 'campaignsBulkBar', 'campaignsBulkCount', 'campaignsTable');
}

// ── Users ────────────────────────────────────────────────────────────────────

async function loadUsers() {
    if (!guardAdmin()) return;
    if (!_users.length) {
        [_users, _members] = await Promise.all([fetchAllUsers(), fetchAllPlaygroupMembers()]);
    }
    renderUsers();
}

function renderUsers() {
    const q = (document.getElementById('userSearch').value || '').toLowerCase();
    const tbody = document.querySelector('#usersTable tbody');
    const filtered = _users.filter(u => {
        const email = u.email || '';
        const name = u.user_metadata?.full_name || '';
        return !q || email.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
    tbody.innerHTML = filtered.map(u => {
        const owned = _members.filter(m => m.user_id === u.id && m.role === 'owner').length;
        const memberOf = _members.filter(m => m.user_id === u.id).length;
        return `<tr>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.user_metadata?.full_name || '—')}</td>
            <td>${owned}</td>
            <td>${memberOf}</td>
            <td>${fmtDate(u.created_at)}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No users found.</td></tr>';
}

// ── Entries ───────────────────────────────────────────────────────────────────

async function loadEntries() {
    if (!guardAdmin()) return;
    if (!_entries.length) {
        [_entries, _games, _players, _playgroups] = await Promise.all([
            fetchAllEntries(), fetchAllGames(), fetchAllPlayers(), fetchPlaygroups()
        ]);
    }
    populateCampaignFilter();
    renderEntries();
}

function renderEntries() {
    const pgFilter = document.getElementById('entryCampaignFilter').value;
    const tbody = document.querySelector('#entriesTable tbody');
    const filtered = pgFilter ? _entries.filter(e => e.playgroup_id === pgFilter) : _entries;
    const shown = filtered.slice(0, 200);
    tbody.innerHTML = shown.map(e => `<tr data-id="${e.id}">
        <td><input type="checkbox" class="admin-row-check" data-table="entries" value="${e.id}"></td>
        <td>${esc(pgName(e.playgroup_id))}</td>
        <td>${esc(gameName(e.game_id))}</td>
        <td>${esc(playerName(e.player_id))}</td>
        <td>${fmtDate(e.date)}</td>
        <td>${esc(e.created_by_name || '—')}</td>
        <td>
            <button class="admin-action-btn admin-action-danger" data-delete-entry="${e.id}" title="Delete entry">✕</button>
        </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No entries found.</td></tr>';

    if (filtered.length > 200) {
        tbody.innerHTML += `<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">Showing 200 of ${filtered.length} entries.</td></tr>`;
    }

    tbody.querySelectorAll('[data-delete-entry]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this entry?')) return;
            btn.disabled = true; btn.textContent = '…';
            try {
                await adminDeleteEntry(btn.dataset.deleteEntry);
                _entries = _entries.filter(e => e.id !== btn.dataset.deleteEntry);
                renderEntries();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = '✕'; }
        });
    });

    setupBulkSelect('entries', 'entriesBulkBar', 'entriesBulkCount', 'entriesTable');
    document.getElementById('entriesBulkDelete').onclick = async () => {
        const ids = getChecked('entries');
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} entr${ids.length === 1 ? 'y' : 'ies'}?`)) return;
        for (const id of ids) {
            try {
                await adminDeleteEntry(id);
                _entries = _entries.filter(e => e.id !== id);
            } catch (e) { alert('Error: ' + e.message); }
        }
        renderEntries();
    };
    document.getElementById('entriesBulkClear').onclick = () => clearChecked('entries', 'entriesBulkBar', 'entriesBulkCount', 'entriesTable');
}

// ── Games & Players ──────────────────────────────────────────────────────────

async function loadGamesPlayers() {
    if (!guardAdmin()) return;
    if (!_games.length) {
        [_games, _players, _entries, _playgroups, _users] = await Promise.all([
            fetchAllGames(), fetchAllPlayers(), fetchAllEntries(), fetchPlaygroups(), fetchAllUsers()
        ]);
    }
    renderGamesTable();
    renderPlayersTable();
}

function renderGamesTable() {
    const tbody = document.querySelector('#gamesTable tbody');
    const winsMap = {};
    _entries.forEach(e => { winsMap[e.game_id] = (winsMap[e.game_id] || 0) + 1; });

    tbody.innerHTML = _games.map(g => `<tr data-id="${g.id}">
        <td><input type="checkbox" class="admin-row-check" data-table="games" value="${g.id}"></td>
        <td>${esc(g.name)}</td>
        <td>${esc(pgName(g.playgroup_id))}</td>
        <td>${winsMap[g.id] || 0}</td>
        <td>${g.global_game_id ? '<span class="admin-badge admin-badge-ok">Linked</span>' : '<span class="admin-badge admin-badge-warn">—</span>'}</td>
        <td>
            <button class="admin-action-btn admin-action-danger" data-delete-game="${g.id}" title="Delete game">✕</button>
        </td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No games.</td></tr>';

    tbody.querySelectorAll('[data-delete-game]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this game and all its entries?')) return;
            btn.disabled = true;
            try {
                await adminDeleteGame(btn.dataset.deleteGame);
                _games = _games.filter(g => g.id !== btn.dataset.deleteGame);
                _entries = _entries.filter(e => e.game_id !== btn.dataset.deleteGame);
                renderGamesTable();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; }
        });
    });

    setupBulkSelect('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable');
    document.getElementById('gamesBulkDelete').onclick = async () => {
        const ids = getChecked('games');
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} game(s) and all their entries?`)) return;
        for (const id of ids) {
            try {
                await adminDeleteGame(id);
                _games = _games.filter(g => g.id !== id);
                _entries = _entries.filter(e => e.game_id !== id);
            } catch (e) { alert('Error: ' + e.message); }
        }
        renderGamesTable();
    };
    document.getElementById('gamesBulkClear').onclick = () => clearChecked('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable');
}

function renderPlayersTable() {
    const tbody = document.querySelector('#playersTable tbody');
    const winsMap = {};
    _entries.forEach(e => { winsMap[e.player_id] = (winsMap[e.player_id] || 0) + 1; });

    tbody.innerHTML = _players.map(p => `<tr data-id="${p.id}">
        <td><input type="checkbox" class="admin-row-check" data-table="players" value="${p.id}"></td>
        <td>${esc(p.name)}</td>
        <td>${esc(pgName(p.playgroup_id))}</td>
        <td>${p.user_id ? esc(userName(p.user_id)) : '<span style="color:var(--text-muted);">Unclaimed</span>'}</td>
        <td>${winsMap[p.id] || 0}</td>
        <td>
            <button class="admin-action-btn admin-action-danger" data-delete-player="${p.id}" title="Delete player">✕</button>
        </td>
    </tr>`).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No players.</td></tr>';

    tbody.querySelectorAll('[data-delete-player]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this player and all their entries?')) return;
            btn.disabled = true;
            try {
                await adminDeletePlayer(btn.dataset.deletePlayer);
                _players = _players.filter(p => p.id !== btn.dataset.deletePlayer);
                _entries = _entries.filter(e => e.player_id !== btn.dataset.deletePlayer);
                renderPlayersTable();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; }
        });
    });

    setupBulkSelect('players', 'playersBulkBar', 'playersBulkCount', 'playersTable');
    document.getElementById('playersBulkDelete').onclick = async () => {
        const ids = getChecked('players');
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} player(s) and all their entries?`)) return;
        for (const id of ids) {
            try {
                await adminDeletePlayer(id);
                _players = _players.filter(p => p.id !== id);
                _entries = _entries.filter(e => e.player_id !== id);
            } catch (e) { alert('Error: ' + e.message); }
        }
        renderPlayersTable();
    };
    document.getElementById('playersBulkClear').onclick = () => clearChecked('players', 'playersBulkBar', 'playersBulkCount', 'playersTable');
}

// ── BGG Linking ──────────────────────────────────────────────────────────────

let _unlinked = [];

async function loadLinking() {
    if (!guardAdmin()) return;
    try {
        [_unlinked, _globalGames, _playgroups] = await Promise.all([
            fetchUnlinkedGames(), fetchGlobalGames(), fetchPlaygroups()
        ]);
    } catch (e) { console.error(e); return; }
    renderLinkingProgress();
    renderLinkingList();
}

function renderLinkingProgress() {
    const total = _games.length || (_unlinked.length + _globalGames.length);
    const linked = total - _unlinked.length;
    const pct = total ? Math.round((linked / total) * 100) : 0;
    document.getElementById('linkingProgress').textContent = `${linked} of ${total} games linked (${pct}%)`;
    document.getElementById('linkingProgressBar').style.width = pct + '%';
}

function renderLinkingList() {
    const container = document.getElementById('linkingList');
    if (!_unlinked.length) {
        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">All games are linked!</p>';
        return;
    }
    container.innerHTML = _unlinked.map(g => `
        <div class="admin-link-row" data-game-id="${g.id}">
            <div class="admin-link-info">
                <strong>${esc(g.name)}</strong>
                <span class="admin-link-campaign">${esc(pgName(g.playgroup_id))}</span>
            </div>
            <div class="admin-link-actions">
                <input type="text" class="admin-link-search" placeholder="Search BGG..." data-search-for="${g.id}">
                <div class="admin-link-results" data-results-for="${g.id}"></div>
                <button class="admin-action-btn" data-skip-game="${g.id}" title="Skip">Skip</button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.admin-link-search').forEach(input => {
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const q = input.value.trim();
            if (q.length < 2) return;
            timer = setTimeout(() => searchBGG(q, input.dataset.searchFor), 500);
        });
    });

    container.querySelectorAll('[data-skip-game]').forEach(btn => {
        btn.addEventListener('click', () => {
            const row = btn.closest('.admin-link-row');
            row.remove();
            _unlinked = _unlinked.filter(g => g.id !== btn.dataset.skipGame);
            renderLinkingProgress();
        });
    });
}

async function searchBGG(query, gameId) {
    const resultsDiv = document.querySelector(`[data-results-for="${gameId}"]`);
    resultsDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Searching...</span>';

    try {
        const url = SUPABASE_URL + '/functions/v1/bgg-search?q=' + encodeURIComponent(query);
        const resp = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY }
        });
        if (!resp.ok) {
            const status = resp.status;
            const friendly = describeBggStatus(status);
            throw new Error('BGG search failed (' + status + ' – ' + friendly + ')');
        }
        const results = await resp.json();

        if (!results.length) {
            resultsDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">No results.</span>';
            return;
        }

        resultsDiv.innerHTML = results.slice(0, 5).map(r =>
            `<button class="admin-bgg-result" data-bgg='${JSON.stringify(r).replace(/'/g, '&#39;')}'>
                ${esc(r.name)}${r.year_published ? ' (' + r.year_published + ')' : ''}
            </button>`
        ).join('');

        resultsDiv.querySelectorAll('.admin-bgg-result').forEach(btn => {
            btn.addEventListener('click', () => linkBGGResult(gameId, JSON.parse(btn.dataset.bgg)));
        });
    } catch (e) {
        resultsDiv.innerHTML = `<span style="color:#f87171; font-size:0.85rem;">Error: ${esc(e.message)}</span>`;
    }
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

async function linkBGGResult(gameId, bgg) {
    const row = document.querySelector(`[data-game-id="${gameId}"]`);
    try {
        const globalGame = await upsertGlobalGame(bgg.bgg_id, bgg.name, bgg.year_published, bgg.thumbnail_url);
        await linkGameToGlobal(gameId, globalGame.id);
        _unlinked = _unlinked.filter(g => g.id !== gameId);
        if (row) row.remove();
        renderLinkingProgress();
    } catch (e) {
        alert('Link failed: ' + e.message);
    }
}

// ── Invites ──────────────────────────────────────────────────────────────────

async function loadInvites() {
    if (!guardAdmin()) return;
    try {
        [_invites, _playgroups, _users] = await Promise.all([
            fetchAllInviteTokens(), fetchPlaygroups(), fetchAllUsers()
        ]);
    } catch (e) { console.error(e); return; }
    renderInvites();
}

function renderInvites() {
    const tbody = document.querySelector('#invitesTable tbody');
    tbody.innerHTML = _invites.map(t => {
        const masked = t.token ? t.token.slice(0, 8) + '…' : '—';
        const expired = t.expires_at && new Date(t.expires_at) < new Date();
        const creator = _users.find(u => u.id === t.created_by);
        const creatorLabel = creator?.email || (t.created_by ? t.created_by.slice(0, 8) + '…' : '—');
        return `<tr class="${expired ? 'admin-row-expired' : ''}" data-id="${t.id}">
            <td><input type="checkbox" class="admin-row-check" data-table="invites" value="${t.id}"></td>
            <td>${esc(pgName(t.playgroup_id))}</td>
            <td><code>${esc(masked)}</code></td>
            <td title="${esc(creator?.email || '')}">${esc(creatorLabel)}</td>
            <td>${fmtDate(t.expires_at)}${expired ? ' <span class="admin-badge admin-badge-warn">Expired</span>' : ''}</td>
            <td>${t.uses ?? 0} / ${t.max_uses ?? '∞'}</td>
            <td>
                <button class="admin-action-btn admin-action-danger" data-revoke-token="${t.id}" title="Revoke">Revoke</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No invite tokens.</td></tr>';

    tbody.querySelectorAll('[data-revoke-token]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Revoke this invite token?')) return;
            btn.disabled = true; btn.textContent = '…';
            try {
                await deleteInviteToken(btn.dataset.revokeToken);
                _invites = _invites.filter(t => t.id !== btn.dataset.revokeToken);
                renderInvites();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Revoke'; }
        });
    });

    setupBulkSelect('invites', 'invitesBulkBar', 'invitesBulkCount', 'invitesTable');
    document.getElementById('invitesBulkDelete').onclick = async () => {
        const ids = getChecked('invites');
        if (!ids.length) return;
        if (!confirm(`Revoke ${ids.length} invite token(s)?`)) return;
        for (const id of ids) {
            try {
                await deleteInviteToken(id);
                _invites = _invites.filter(t => t.id !== id);
            } catch (e) { alert('Error: ' + e.message); }
        }
        renderInvites();
    };
    document.getElementById('invitesBulkClear').onclick = () => clearChecked('invites', 'invitesBulkBar', 'invitesBulkCount', 'invitesTable');
}

// ── Config ───────────────────────────────────────────────────────────────────

async function loadConfig() {
    if (!guardAdmin()) return;
    try { _config = await fetchAppConfig(); } catch (e) { console.error(e); return; }
    document.getElementById('cfgMaxCampaigns').value = _config.max_campaigns_per_user || '2';
    document.getElementById('cfgMaxMeeples').value = _config.max_meeples_per_campaign || '4';
}

async function saveConfig() {
    const btn = document.getElementById('saveConfigBtn');
    const status = document.getElementById('configStatus');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        await setAppConfig('max_campaigns_per_user', document.getElementById('cfgMaxCampaigns').value);
        await setAppConfig('max_meeples_per_campaign', document.getElementById('cfgMaxMeeples').value);
        status.textContent = 'Saved!';
        status.style.color = 'var(--accent-success)';
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.style.color = '#f87171';
    }
    btn.disabled = false; btn.textContent = 'Save Config';
    setTimeout(() => { status.textContent = ''; }, 3000);
}

// ── Announcements ────────────────────────────────────────────────────────────

let _announcements = [];

async function loadAnnouncements() {
    if (!guardAdmin()) return;
    try {
        _announcements = await fetchAllAnnouncements();
    } catch (e) { console.error(e); return; }
    renderAnnouncements();
}

function renderAnnouncements() {
    const tbody = document.querySelector('#announcementsTable tbody');
    if (!_announcements.length) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No announcements yet.</td></tr>';
        return;
    }
    tbody.innerHTML = _announcements.map(a => `
        <tr data-id="${a.id}">
            <td style="max-width:420px; white-space:normal; line-height:1.4;">${esc(a.message)}</td>
            <td>${a.active
                ? '<span class="admin-badge admin-badge-ok">Active</span>'
                : '<span class="admin-badge" style="background:rgba(100,116,139,0.15);color:var(--text-muted);">Inactive</span>'
            }</td>
            <td>${fmtDate(a.created_at)}</td>
            <td style="white-space:nowrap; display:flex; gap:6px;">
                ${!a.active ? `<button class="admin-action-btn" data-reactivate="${a.id}" title="Set as active">Set Active</button>` : ''}
                ${a.active ? `<button class="admin-action-btn admin-action-danger" data-deactivate="${a.id}" title="Deactivate">Deactivate</button>` : ''}
                <button class="admin-action-btn admin-action-danger" data-delete-ann="${a.id}" title="Delete permanently">Delete</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-reactivate]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = '…';
            try {
                await reactivateAnnouncement(btn.dataset.reactivate);
                await loadAnnouncements();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Set Active'; }
        });
    });

    tbody.querySelectorAll('[data-deactivate]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = '…';
            try {
                await clearAnnouncement();
                await loadAnnouncements();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Deactivate'; }
        });
    });

    tbody.querySelectorAll('[data-delete-ann]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Permanently delete this announcement?')) return;
            btn.disabled = true; btn.textContent = '…';
            try {
                await deleteAnnouncement(btn.dataset.deleteAnn);
                _announcements = _announcements.filter(a => a.id !== btn.dataset.deleteAnn);
                renderAnnouncements();
            } catch (e) { alert('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Delete'; }
        });
    });
}

async function doPublishAnnouncement() {
    const msg = document.getElementById('announceMessage').value.trim();
    if (!msg) { alert('Enter a message first.'); return; }
    const btn = document.getElementById('publishAnnounceBtn');
    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
        await publishAnnouncement(msg);
        document.getElementById('announceMessage').value = '';
        await loadAnnouncements();
    } catch (e) { alert('Error: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Publish';
}

async function doClearAnnouncement() {
    if (!confirm('Deactivate the current announcement? It will no longer show to users, but stays in history.')) return;
    try {
        await clearAnnouncement();
        await loadAnnouncements();
    } catch (e) { alert('Error: ' + e.message); }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(text) {
    const d = document.createElement('div');
    d.textContent = text ?? '';
    return d.innerHTML;
}

function getChecked(tableKey) {
    return [...document.querySelectorAll(`.admin-row-check[data-table="${tableKey}"]:checked`)]
        .map(cb => cb.value);
}

function clearChecked(tableKey, barId, countId, tableId) {
    document.querySelectorAll(`.admin-row-check[data-table="${tableKey}"]`).forEach(cb => cb.checked = false);
    const selectAll = document.querySelector(`.admin-select-all[data-table="${tableKey}"]`);
    if (selectAll) selectAll.checked = false;
    document.getElementById(barId).style.display = 'none';
    document.getElementById(countId).textContent = '0 selected';
}

function setupBulkSelect(tableKey, barId, countId, tableId) {
    const selectAll = document.querySelector(`.admin-select-all[data-table="${tableKey}"]`);
    const bar = document.getElementById(barId);
    const countEl = document.getElementById(countId);

    function updateBar() {
        const checked = getChecked(tableKey);
        if (checked.length > 0) {
            bar.style.display = 'flex';
            countEl.textContent = `${checked.length} selected`;
        } else {
            bar.style.display = 'none';
        }
    }

    // Wire row checkboxes
    document.querySelectorAll(`.admin-row-check[data-table="${tableKey}"]`).forEach(cb => {
        cb.addEventListener('change', updateBar);
    });

    // Wire select-all
    if (selectAll) {
        selectAll.checked = false;
        selectAll.onchange = () => {
            document.querySelectorAll(`.admin-row-check[data-table="${tableKey}"]`)
                .forEach(cb => { cb.checked = selectAll.checked; });
            updateBar();
        };
    }
}

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', boot);
