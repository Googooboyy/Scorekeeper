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
    fetchUserTiersMap, updateUserTier,
    fetchAllAnnouncements, publishAnnouncement, clearAnnouncement, fetchActiveAnnouncement,
    deleteAnnouncement, reactivateAnnouncement,
    fetchUnlinkedGames, fetchGlobalGames, upsertGlobalGame, linkGameToGlobal, createGlobalGameByName,
    deletePlaygroupAdmin, deleteInviteToken, replaceInviteToken,
    adminDeleteEntry, adminDeleteGame, adminDeletePlayer, adminMergeGames, adminUpdateGame,
    adminRemoveUserFromCampaigns, adminDeleteUserAccount,
    updateLastSeen, fetchUserLastSeenMap
} from './supabase.js';
import { signOut } from './auth.js';

// ── Toast (replaces alert for consistent in-app feedback) ──────────────────────
function adminToast(msg) {
    const el = document.createElement('div');
    el.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--bg-card); color: var(--text-primary); padding: 16px 24px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.5); z-index: 10000; animation: slideUp 0.3s ease; font-weight: 500;';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => { el.style.animation = 'slideDown 0.3s ease'; setTimeout(() => el.remove(), 300); }, 2000);
}

// ── Cached data ──────────────────────────────────────────────────────────────
let _playgroups = [], _users = [], _members = [], _games = [], _players = [];
let _entries = [], _invites = [], _config = {}, _globalGames = [];
let _userLastSeen = {};
let _userTiersMap = {};
let _usersSortBy = 'last_seen';
let _usersSortDir = 'asc'; // asc = oldest first (for pruning), desc = newest first

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
    const backBtn = document.getElementById('backToAppBtn');
    if (backBtn) {
        backBtn.addEventListener('click', () => { window.location.href = 'index.html'; });
    }

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
    updateLastSeen().catch(() => {}); // fire-and-forget, throttled once/day
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
            if (tab.dataset.subtab === 'consolidated-list') renderConsolidatedGames();
        });
    });

    document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);
    document.getElementById('addQuoteBtn').addEventListener('click', addQuoteRow);
    document.getElementById('saveQuotesBtn').addEventListener('click', saveQuotes);
    document.getElementById('publishAnnounceBtn').addEventListener('click', doPublishAnnouncement);
    document.getElementById('clearAnnounceBtn').addEventListener('click', doClearAnnouncement);

    document.getElementById('campaignSearch').addEventListener('input', renderCampaigns);
    document.getElementById('userSearch').addEventListener('input', renderUsers);
    document.getElementById('entryCampaignFilter').addEventListener('change', renderEntries);

    document.querySelector('#usersTable .admin-sortable[data-sort="last_seen"]')?.addEventListener('click', (e) => {
        if (e.target.closest('input')) return;
        _usersSortBy = 'last_seen';
        _usersSortDir = _usersSortDir === 'asc' ? 'desc' : 'asc';
        renderUsers();
    });

    document.getElementById('adminMergeCancel').addEventListener('click', hideMergeModal);
    document.getElementById('adminMergeConfirm').addEventListener('click', doMergeGames);
    document.getElementById('adminMergeModal').addEventListener('click', (e) => {
        if (e.target.id === 'adminMergeModal') hideMergeModal();
    });
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
        tiers: loadTiers,
        config: loadConfig,
        quotes: loadQuotes,
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

    _playgroups = _playgroups || [];
    _users = _users || [];
    _entries = _entries || [];
    _games = _games || [];
    _players = _players || [];
    _globalGames = _globalGames || [];

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
        const key = game?.global_game_id || game?.name;
        const label = game?.global_game_id
            ? (_globalGames.find(gg => gg.id === game.global_game_id)?.name || game.name)
            : game?.name || '—';
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
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = '✕'; }
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
            } catch (e) { adminToast('Error deleting campaign: ' + e.message); }
        }
        renderCampaigns();
    };
    document.getElementById('campaignsBulkClear').onclick = () => clearChecked('campaigns', 'campaignsBulkBar', 'campaignsBulkCount', 'campaignsTable');
}

// ── Users ────────────────────────────────────────────────────────────────────

async function loadUsers() {
    if (!guardAdmin()) return;
    if (!_users.length) {
        const [users, members, lastSeen, tiersMap] = await Promise.all([
            fetchAllUsers(), fetchAllPlaygroupMembers(), fetchUserLastSeenMap(), fetchUserTiersMap()
        ]);
        _users = users;
        _members = members;
        _userLastSeen = lastSeen;
        _userTiersMap = tiersMap || {};
    }
    renderUsers();
}

async function loadTiers() {
    if (!guardAdmin()) return;
    try {
        _userTiersMap = await fetchUserTiersMap();
        const free = Object.values(_userTiersMap).filter(t => t === 1).length;
        const noble = Object.values(_userTiersMap).filter(t => t === 2).length;
        const royal = Object.values(_userTiersMap).filter(t => t === 3).length;
        document.getElementById('tierFreeCount').textContent = free;
        document.getElementById('tierNobleCount').textContent = noble;
        document.getElementById('tierRoyalCount').textContent = royal;
    } catch (e) {
        console.error('Tiers load error:', e);
    }
}

function getTierLabel(tier) {
    const t = parseInt(tier, 10) || 1;
    if (t === 2) return 'Noble';
    if (t === 3) return 'Royal';
    return 'Commoner';
}

function renderUsers() {
    const q = (document.getElementById('userSearch').value || '').toLowerCase();
    const tbody = document.querySelector('#usersTable tbody');
    const thead = document.querySelector('#usersTable thead tr');
    let filtered = _users.filter(u => {
        const email = u.email || '';
        const name = u.user_metadata?.full_name || '';
        return !q || email.toLowerCase().includes(q) || name.toLowerCase().includes(q);
    });
    if (_usersSortBy === 'last_seen') {
        filtered = [...filtered].sort((a, b) => {
            const ta = _userLastSeen[a.id] ? new Date(_userLastSeen[a.id]).getTime() : 0;
            const tb = _userLastSeen[b.id] ? new Date(_userLastSeen[b.id]).getTime() : 0;
            if (ta === tb) return 0;
            return _usersSortDir === 'asc' ? ta - tb : tb - ta;
        });
    }
    // Update sort icon
    thead?.querySelectorAll('.admin-sortable').forEach(th => {
        const icon = th.querySelector('.sort-icon');
        if (icon) icon.textContent = th.dataset.sort === _usersSortBy ? (_usersSortDir === 'asc' ? '↑' : '↓') : '';
    });
    tbody.innerHTML = filtered.map(u => {
        const owned = _members.filter(m => m.user_id === u.id && m.role === 'owner').length;
        const memberOf = _members.filter(m => m.user_id === u.id).length;
        const lastSeen = _userLastSeen[u.id];
        const tier = _userTiersMap[u.id] ?? 1;
        const tierOpts = `<option value="1" ${tier === 1 ? 'selected' : ''}>Commoner</option><option value="2" ${tier === 2 ? 'selected' : ''}>Noble</option><option value="3" ${tier === 3 ? 'selected' : ''}>Royal</option>`;
        return `<tr data-id="${u.id}">
            <td><input type="checkbox" class="admin-row-check" data-table="users" value="${u.id}"></td>
            <td>${esc(u.email || '—')}</td>
            <td>${esc(u.user_metadata?.full_name || '—')}</td>
            <td><select class="admin-tier-select" data-user-id="${u.id}" title="Assign tier">${tierOpts}</select></td>
            <td>${owned}</td>
            <td>${memberOf}</td>
            <td>${fmtDate(u.created_at)}</td>
            <td>${lastSeen ? fmtDate(lastSeen) : '—'}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="8" style="text-align:center; color:var(--text-muted);">No users found.</td></tr>';

    tbody.querySelectorAll('.admin-tier-select').forEach(sel => {
        sel.addEventListener('change', async () => {
            const uid = sel.dataset.userId;
            const newTier = parseInt(sel.value, 10) || 1;
            try {
                await updateUserTier(uid, newTier);
                _userTiersMap[uid] = newTier;
                adminToast('Tier updated to ' + getTierLabel(newTier));
            } catch (e) {
                adminToast('Error updating tier: ' + (e.message || e));
                sel.value = _userTiersMap[uid] ?? 1;
            }
        });
    });

    setupBulkSelect('users', 'usersBulkBar', 'usersBulkCount', 'usersTable');
    const removeBtn = document.getElementById('usersBulkRemoveCampaigns');
    const deleteBtn = document.getElementById('usersBulkDeleteAccounts');
    const clearBtn = document.getElementById('usersBulkClear');

    if (removeBtn) {
        removeBtn.onclick = async () => {
            const ids = getChecked('users');
            if (!ids.length) return;
            if (!confirm(`Remove ${ids.length} user(s) from all campaigns? Their accounts will remain, but they won’t be members anywhere.`)) return;
            for (const id of ids) {
                try {
                    await adminRemoveUserFromCampaigns(id);
                    _members = _members.filter(m => m.user_id !== id);
                } catch (e) {
                    adminToast('Error removing memberships: ' + e.message);
                }
            }
            renderUsers();
            renderCampaigns();
            renderPlayersTable();
            clearChecked('users', 'usersBulkBar', 'usersBulkCount', 'usersTable');
        };
    }

    if (deleteBtn) {
        deleteBtn.onclick = async () => {
            const ids = getChecked('users');
            if (!ids.length) return;
            if (!confirm(`Permanently delete ${ids.length} user account(s)? This cannot be undone.`)) return;
            for (const id of ids) {
                try {
                    await adminRemoveUserFromCampaigns(id);
                    await adminDeleteUserAccount(id);
                    _members = _members.filter(m => m.user_id !== id);
                    _users = _users.filter(u => u.id !== id);
                } catch (e) {
                    adminToast('Error deleting user: ' + e.message);
                }
            }
            renderUsers();
            renderCampaigns();
            renderPlayersTable();
            clearChecked('users', 'usersBulkBar', 'usersBulkCount', 'usersTable');
        };
    }

    if (clearBtn) {
        clearBtn.onclick = () => clearChecked('users', 'usersBulkBar', 'usersBulkCount', 'usersTable');
    }
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
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = '✕'; }
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
            } catch (e) { adminToast('Error: ' + e.message); }
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
    if (!_globalGames?.length) {
        _globalGames = await fetchGlobalGames();
    }
    const sortEl = document.getElementById('gamesSortSelect');
    if (sortEl && !sortEl.dataset.bound) {
        sortEl.dataset.bound = '1';
        sortEl.addEventListener('change', () => renderGamesTable());
    }
    renderGamesTable();
    renderPlayersTable();
    renderConsolidatedGames();
}

function renderGamesTable() {
    const tbody = document.querySelector('#gamesTable tbody');
    const winsMap = {};
    _entries.forEach(e => { winsMap[e.game_id] = (winsMap[e.game_id] || 0) + 1; });

    // Earliest entry created_at per game (date added proxy)
    const gameFirstEntryAt = {};
    _entries.forEach(e => {
        const t = e.created_at ? new Date(e.created_at).getTime() : 0;
        if (!gameFirstEntryAt[e.game_id] || t < gameFirstEntryAt[e.game_id]) {
            gameFirstEntryAt[e.game_id] = t;
        }
    });

    const sortBy = document.getElementById('gamesSortSelect')?.value || 'name-az';
    const sorted = [..._games].sort((a, b) => {
        if (sortBy === 'name-az') return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        if (sortBy === 'name-za') return (b.name || '').localeCompare(a.name || '', undefined, { sensitivity: 'base' });
        const ta = gameFirstEntryAt[a.id] || (sortBy === 'date-newest' ? 0 : 1e15);
        const tb = gameFirstEntryAt[b.id] || (sortBy === 'date-newest' ? 0 : 1e15);
        if (sortBy === 'date-newest') return tb - ta; // newest first
        return ta - tb; // oldest first
    });

    const sameCampaignCount = {};
    _games.forEach(g => {
        const k = g.playgroup_id;
        sameCampaignCount[k] = (sameCampaignCount[k] || 0) + 1;
    });
    tbody.innerHTML = sorted.map(g => {
        const canMerge = (sameCampaignCount[g.playgroup_id] || 0) > 1;
        return `<tr data-id="${g.id}">
        <td><input type="checkbox" class="admin-row-check" data-table="games" value="${g.id}"></td>
        <td class="games-name-cell" data-game-id="${g.id}" data-game-name="${esc(g.name)}">${esc(g.name)}</td>
        <td>${esc(pgName(g.playgroup_id))}</td>
        <td>${winsMap[g.id] || 0}</td>
        <td>${g.global_game_id ? '<span class="admin-badge admin-badge-ok">Linked</span>' : '<span class="admin-badge admin-badge-warn">—</span>'}</td>
        <td>
            <button class="admin-action-btn" data-edit-game="${g.id}" title="Edit name">Edit</button>
            ${canMerge ? `<button class="admin-action-btn admin-action-success" data-merge-game="${g.id}" title="Merge into another game">Merge</button>` : ''}
            <button class="admin-action-btn admin-action-danger" data-delete-game="${g.id}" title="Delete game">✕</button>
        </td>
    </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No games.</td></tr>';

    tbody.querySelectorAll('[data-edit-game]').forEach(btn => {
        btn.addEventListener('click', () => startEditGameName(btn.dataset.editGame));
    });
    tbody.querySelectorAll('[data-merge-game]').forEach(btn => {
        btn.addEventListener('click', () => showMergeModal(btn.dataset.mergeGame));
    });
    tbody.querySelectorAll('[data-delete-game]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Delete this game and all its entries?')) return;
            btn.disabled = true;
            try {
                await adminDeleteGame(btn.dataset.deleteGame);
                _games = _games.filter(g => g.id !== btn.dataset.deleteGame);
                _entries = _entries.filter(e => e.game_id !== btn.dataset.deleteGame);
                renderGamesTable();
                renderConsolidatedGames();
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; }
        });
    });

    setupBulkSelect('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable', updateGamesMergeButton);
    document.getElementById('gamesBulkMerge').onclick = () => showBulkMergeModal();
    document.getElementById('gamesBulkDelete').onclick = async () => {
        const ids = getChecked('games');
        if (!ids.length) return;
        if (!confirm(`Delete ${ids.length} game(s) and all their entries?`)) return;
        for (const id of ids) {
            try {
                await adminDeleteGame(id);
                _games = _games.filter(g => g.id !== id);
                _entries = _entries.filter(e => e.game_id !== id);
            } catch (e) { adminToast('Error: ' + e.message); }
        }
        renderGamesTable();
        renderConsolidatedGames();
    };
    document.getElementById('gamesBulkClear').onclick = () => clearChecked('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable');
}

// ── Edit game name ───────────────────────────────────────────────────────────

function startEditGameName(gameId) {
    const row = document.querySelector(`#gamesTable tr[data-id="${gameId}"]`);
    const cell = row?.querySelector('.games-name-cell');
    if (!cell || cell.querySelector('input')) return;
    const currentName = (cell.dataset.gameName || '').trim();
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentName;
    input.className = 'admin-edit-input';
    input.style.cssText = 'width:100%; padding:6px 10px; background:var(--bg-input); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; font-size:inherit;';
    const finish = (save) => {
        input.removeEventListener('blur', onBlur);
        input.removeEventListener('keydown', onKey);
        const newName = (input.value || '').trim();
        cell.textContent = '';
        cell.dataset.gameName = newName || currentName;
        cell.textContent = newName || currentName;
        if (save && newName && newName !== currentName) {
            adminUpdateGame(gameId, { name: newName }).then(() => {
                const g = _games.find(x => x.id === gameId);
                if (g) g.name = newName;
                renderGamesTable();
                renderConsolidatedGames();
                adminToast('Game name updated.');
            }).catch(e => {
                adminToast('Error: ' + e.message);
                cell.textContent = currentName;
                cell.dataset.gameName = currentName;
            });
        } else {
            cell.textContent = currentName;
            cell.dataset.gameName = currentName;
        }
    };
    const onBlur = () => finish(true);
    const onKey = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    input.addEventListener('blur', onBlur);
    input.addEventListener('keydown', onKey);
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();
}

// ── Merge modal ──────────────────────────────────────────────────────────────

let _mergeSourceId = null;
let _mergeBulkIds = null;

function updateGamesMergeButton() {
    const ids = getChecked('games');
    const mergeBtn = document.getElementById('gamesBulkMerge');
    if (!mergeBtn) return;
    mergeBtn.style.display = ids.length >= 2 ? 'inline-block' : 'none';
}

let _mergeIsLinkMode = false;
let _linkChosenBGG = null;

async function showBulkMergeModal() {
    const ids = getChecked('games');
    if (ids.length < 2) {
        adminToast('Select at least 2 games to merge or link.');
        return;
    }
    const selectedGames = ids.map(id => _games.find(g => g.id === id)).filter(Boolean);
    const playgroupIds = [...new Set(selectedGames.map(g => g.playgroup_id))];
    const allSameCampaign = playgroupIds.length === 1;

    _mergeSourceId = null;
    _mergeBulkIds = ids;
    _mergeIsLinkMode = !allSameCampaign;
    _linkChosenBGG = null;
    _linkChosenGlobalGameId = null;
    _linkCreateNewName = null;

    const pickerEl = document.getElementById('adminMergeGamePicker');
    const bggEl = document.getElementById('adminMergeBGGLink');
    const titleEl = document.getElementById('adminMergeTitle');
    const descEl = document.getElementById('adminMergeDesc');
    const confirmBtn = document.getElementById('adminMergeConfirm');

    if (allSameCampaign) {
        pickerEl.style.display = 'block';
        bggEl.style.display = 'none';
        titleEl.textContent = 'Merge Games';
        descEl.textContent = `Merge ${ids.length} selected games into one. Choose which game to keep (others will be merged into it):`;
        const sel = document.getElementById('adminMergeTargetSelect');
        sel.innerHTML = selectedGames.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
        confirmBtn.textContent = 'Merge';
        confirmBtn.disabled = false;
    } else {
        pickerEl.style.display = 'none';
        bggEl.style.display = 'block';
        titleEl.textContent = 'Link Selected Games';
        descEl.textContent = `Link ${ids.length} selected games so they appear as one in the Consolidated view.`;
        _globalGames = await fetchGlobalGames();
        const existingSel = document.getElementById('adminMergeExistingSelect');
        existingSel.innerHTML = '<option value="">— Choose an existing game —</option>' +
            (_globalGames || []).map(gg => `<option value="${gg.id}">${esc(gg.name)}${gg.year_published ? ' (' + gg.year_published + ')' : ''}</option>`).join('');
        existingSel.value = '';
        const uniqueNames = [...new Set(selectedGames.map(g => (g.name || '').trim()).filter(Boolean))];
        const createSel = document.getElementById('adminMergeCreateNewSelect');
        createSel.innerHTML = '<option value="">— Choose a name —</option>' +
            uniqueNames.map(n => `<option value="${(n || '').replace(/"/g, '&quot;')}">${esc(n)}</option>`).join('');
        createSel.value = '';
        document.getElementById('adminMergeBGGSearch').value = '';
        document.getElementById('adminMergeBGGResults').innerHTML = '';
        confirmBtn.textContent = 'Link All';
        confirmBtn.disabled = true;
        setupMergeBGGLink();
    }
    document.getElementById('adminMergeModal').classList.add('active');
}

let _linkChosenGlobalGameId = null;
let _linkCreateNewName = null;

function updateLinkConfirmButton() {
    const confirmBtn = document.getElementById('adminMergeConfirm');
    const canLink = !!(_linkChosenBGG || _linkChosenGlobalGameId || _linkCreateNewName);
    confirmBtn.disabled = !canLink;
}

function setupMergeBGGLink() {
    const existingSel = document.getElementById('adminMergeExistingSelect');
    const createSel = document.getElementById('adminMergeCreateNewSelect');
    const input = document.getElementById('adminMergeBGGSearch');
    const resultsDiv = document.getElementById('adminMergeBGGResults');
    let timer;

    existingSel.onchange = () => {
        _linkChosenGlobalGameId = existingSel.value || null;
        _linkChosenBGG = null;
        _linkCreateNewName = null;
        createSel.value = '';
        resultsDiv.querySelectorAll('.admin-bgg-result').forEach(b => b.classList.remove('selected'));
        updateLinkConfirmButton();
    };

    createSel.onchange = () => {
        _linkCreateNewName = (createSel.value || '').trim() || null;
        _linkChosenGlobalGameId = null;
        _linkChosenBGG = null;
        existingSel.value = '';
        resultsDiv.innerHTML = '';
        resultsDiv.querySelectorAll('.admin-bgg-result').forEach(b => b.classList.remove('selected'));
        updateLinkConfirmButton();
    };

    input.oninput = () => {
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 2) {
            resultsDiv.innerHTML = '';
            _linkChosenBGG = null;
            if (!_linkChosenGlobalGameId && !_linkCreateNewName) existingSel.value = '';
            if (!_linkChosenGlobalGameId && !_linkCreateNewName) createSel.value = '';
            updateLinkConfirmButton();
            return;
        }
        timer = setTimeout(() => searchBGGForMerge(q, resultsDiv, () => {
            _linkChosenBGG = null;
            updateLinkConfirmButton();
        }, (bgg) => {
            _linkChosenBGG = bgg;
            _linkChosenGlobalGameId = null;
            _linkCreateNewName = null;
            existingSel.value = '';
            createSel.value = '';
            updateLinkConfirmButton();
        }), 500);
    };
}

async function searchBGGForMerge(query, resultsDiv, onClear, onPick) {
    resultsDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">Searching...</span>';
    onClear();
    try {
        const url = SUPABASE_URL + '/functions/v1/bgg-search?q=' + encodeURIComponent(query);
        const resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY } });
        if (!resp.ok) throw new Error('BGG search failed');
        const results = await resp.json();
        if (!results.length) {
            resultsDiv.innerHTML = '<span style="color:var(--text-muted); font-size:0.85rem;">No results.</span>';
            return;
        }
        resultsDiv.innerHTML = results.slice(0, 5).map(r =>
            `<button type="button" class="admin-bgg-result" data-bgg='${JSON.stringify(r).replace(/'/g, '&#39;')}'>
                ${esc(r.name)}${r.year_published ? ' (' + r.year_published + ')' : ''}
            </button>`
        ).join('');
        resultsDiv.querySelectorAll('.admin-bgg-result').forEach(btn => {
            btn.addEventListener('click', () => {
                const bgg = JSON.parse(btn.dataset.bgg);
                onPick(bgg);
                resultsDiv.querySelectorAll('.admin-bgg-result').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
        });
    } catch (e) {
        resultsDiv.innerHTML = `<span style="color:#f87171; font-size:0.85rem;">Error: ${esc(e.message)}</span>`;
        onClear();
    }
}

function showMergeModal(sourceGameId) {
    const source = _games.find(g => g.id === sourceGameId);
    if (!source) return;
    const others = _games.filter(g => g.playgroup_id === source.playgroup_id && g.id !== sourceGameId);
    if (!others.length) {
        adminToast('No other games in this campaign to merge into.');
        return;
    }
    _mergeSourceId = sourceGameId;
    _mergeBulkIds = null;
    document.getElementById('adminMergeDesc').textContent = `Merge "${source.name}" into another game in ${pgName(source.playgroup_id)}. All entries will be reassigned.`;
    const sel = document.getElementById('adminMergeTargetSelect');
    sel.innerHTML = others.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    document.getElementById('adminMergeModal').classList.add('active');
}

function hideMergeModal() {
    _mergeSourceId = null;
    _mergeBulkIds = null;
    _mergeIsLinkMode = false;
    _linkChosenBGG = null;
    _linkChosenGlobalGameId = null;
    _linkCreateNewName = null;
    document.getElementById('adminMergeModal').classList.remove('active');
}

async function doMergeGames() {
    if (_mergeIsLinkMode) {
        await doLinkSelectedGames();
        return;
    }

    const targetId = document.getElementById('adminMergeTargetSelect').value;
    if (!targetId) return;

    const idsToMerge = _mergeBulkIds || (_mergeSourceId ? [_mergeSourceId] : []);
    if (!idsToMerge.length) return;

    const btn = document.getElementById('adminMergeConfirm');
    btn.disabled = true;
    try {
        const sourcesToMerge = idsToMerge.filter(id => id !== targetId);
        for (const sourceId of sourcesToMerge) {
            await adminMergeGames(sourceId, targetId);
            _entries.forEach(e => {
                if (e.game_id === sourceId) e.game_id = targetId;
            });
            _games = _games.filter(g => g.id !== sourceId);
        }
        hideMergeModal();
        clearChecked('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable');
        document.getElementById('gamesBulkBar').style.display = 'none';
        renderGamesTable();
        renderConsolidatedGames();
        adminToast(sourcesToMerge.length === 1 ? 'Games merged successfully.' : `${sourcesToMerge.length} games merged successfully.`);
    } catch (e) {
        adminToast('Error: ' + e.message);
    }
    btn.disabled = false;
}

async function doLinkSelectedGames() {
    if ((!_linkChosenBGG && !_linkChosenGlobalGameId && !_linkCreateNewName) || !_mergeBulkIds?.length) {
        adminToast('Pick an existing game, create a new one, or search BGG and select a result.');
        return;
    }
    const btn = document.getElementById('adminMergeConfirm');
    btn.disabled = true;
    try {
        let globalGameId;
        let canonicalName;
        if (_linkChosenGlobalGameId) {
            globalGameId = _linkChosenGlobalGameId;
            canonicalName = (_globalGames || []).find(gg => gg.id === globalGameId)?.name || null;
        } else if (_linkCreateNewName) {
            const globalGame = await createGlobalGameByName(_linkCreateNewName);
            globalGameId = globalGame.id;
            canonicalName = globalGame.name;
            _globalGames = _globalGames || [];
            _globalGames.push(globalGame);
        } else {
            const globalGame = await upsertGlobalGame(
                _linkChosenBGG.bgg_id,
                _linkChosenBGG.name,
                _linkChosenBGG.year_published,
                _linkChosenBGG.thumbnail_url
            );
            globalGameId = globalGame.id;
            canonicalName = globalGame.name;
        }
        for (const gameId of _mergeBulkIds) {
            await linkGameToGlobal(gameId, globalGameId, canonicalName);
        }
        _games = _games.map(g =>
            _mergeBulkIds.includes(g.id)
                ? { ...g, global_game_id: globalGameId, name: canonicalName || g.name }
                : g
        );
        hideMergeModal();
        clearChecked('games', 'gamesBulkBar', 'gamesBulkCount', 'gamesTable');
        document.getElementById('gamesBulkBar').style.display = 'none';
        renderGamesTable();
        renderConsolidatedGames();
        adminToast(`${_mergeBulkIds.length} game(s) linked successfully.`);
    } catch (e) {
        adminToast('Error: ' + e.message);
    }
    btn.disabled = false;
}

// ── Consolidated games view ──────────────────────────────────────────────────

function normalizeGameName(name) {
    return (name || '').toLowerCase().trim().replace(/\s*\([^)]*\)\s*/g, '').trim();
}

function renderConsolidatedGames() {
    const tbody = document.querySelector('#consolidatedGamesTable tbody');
    if (!tbody) return;
    const entries = _entries || [];
    const games = _games || [];
    const globalGames = _globalGames || [];

    const winsByGame = {};
    entries.forEach(e => {
        const game = games.find(g => g.id === e.game_id);
        if (!game) return;
        winsByGame[game.id] = (winsByGame[game.id] || 0) + 1;
    });

    const groups = {};
    games.forEach(g => {
        const key = g.global_game_id
            ? 'gg:' + g.global_game_id
            : 'name:' + normalizeGameName(g.name);
        if (!groups[key]) {
            groups[key] = {
                key,
                canonicalName: g.global_game_id
                    ? (globalGames.find(gg => gg.id === g.global_game_id)?.name || g.name)
                    : g.name,
                games: [],
                totalWins: 0,
                campaigns: new Set()
            };
        }
        groups[key].games.push(g);
        groups[key].totalWins += winsByGame[g.id] || 0;
        groups[key].campaigns.add(g.playgroup_id);
    });

    const rows = Object.values(groups).sort((a, b) => b.totalWins - a.totalWins);

    tbody.innerHTML = rows.map((row, idx) => {
        const campaigns = [...row.campaigns].map(pgId => pgName(pgId)).join(', ');
        const linked = row.games[0]?.global_game_id;
        const campaignCounts = {};
        row.games.forEach(g => { campaignCounts[g.playgroup_id] = (campaignCounts[g.playgroup_id] || 0) + 1; });
        const hasSameCampaignDuplicates = Object.values(campaignCounts).some(c => c > 1);
        const sourceForMerge = hasSameCampaignDuplicates
            ? row.games.find(g => campaignCounts[g.playgroup_id] > 1)
            : null;
        return `<tr data-consolidated-row="${idx}">
            <td>${esc(row.canonicalName)}</td>
            <td>${esc(campaigns)}</td>
            <td>${row.totalWins}</td>
            <td>${row.games.length}</td>
            <td>
                ${linked ? '<span class="admin-badge admin-badge-ok">Linked</span>' : ''}
                ${sourceForMerge ? `<button type="button" class="admin-action-btn admin-action-success" data-consolidated-merge="${sourceForMerge.id}">Merge</button>` : ''}
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No games.</td></tr>';

    tbody.querySelectorAll('[data-consolidated-merge]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const sourceId = btn.dataset.consolidatedMerge;
            if (sourceId) showMergeModal(sourceId);
        });
    });
}

function renderPlayersTable() {
    const tbody = document.querySelector('#playersTable tbody');
    const winsMap = {};
    _entries.forEach(e => { winsMap[e.player_id] = (winsMap[e.player_id] || 0) + 1; });

    tbody.innerHTML = _players.map(p => `<tr data-id="${p.id}">
        <td><input type="checkbox" class="admin-row-check" data-table="players" value="${p.id}"></td>
        <td>${esc(p.name)}</td>
        <td>${esc(pgName(p.playgroup_id))}</td>
        <td>${renderPlayerUserCell(p)}</td>
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
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; }
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
            } catch (e) { adminToast('Error: ' + e.message); }
        }
        renderPlayersTable();
    };
    document.getElementById('playersBulkClear').onclick = () => clearChecked('players', 'playersBulkBar', 'playersBulkCount', 'playersTable');
}

function renderPlayerUserCell(p) {
    if (!p.user_id) {
        return '<span style="color:var(--text-muted);">Unclaimed</span>';
    }
    const user = _users.find(u => u.id === p.user_id);
    const isMember = _members.some(m => m.user_id === p.user_id && m.playgroup_id === p.playgroup_id);
    if (!user || !isMember) {
        return '<span style="color:var(--accent-warning);">User misplaced</span>';
    }
    return esc(user.email || '—');
}

// ── BGG Linking ──────────────────────────────────────────────────────────────

let _unlinked = [];

async function loadLinking() {
    if (!guardAdmin()) return;
    try {
        const [u, gg, pg] = await Promise.all([
            fetchUnlinkedGames(), fetchGlobalGames(), fetchPlaygroups()
        ]);
        _unlinked = u || [];
        _globalGames = gg || [];
        _playgroups = pg || [];
    } catch (e) { console.error(e); return; }
    renderLinkingProgress();
    renderLinkingList();
}

function renderLinkingProgress() {
    const gamesLen = (_games && _games.length) || 0;
    const unlinkedLen = (_unlinked && _unlinked.length) || 0;
    const globalLen = (_globalGames && _globalGames.length) || 0;
    const total = gamesLen || (unlinkedLen + globalLen);
    const linked = total - unlinkedLen;
    const pct = total ? Math.round((linked / total) * 100) : 0;
    document.getElementById('linkingProgress').textContent = `${linked} of ${total} games linked (${pct}%)`;
    document.getElementById('linkingProgressBar').style.width = pct + '%';
}

function renderLinkingList() {
    const container = document.getElementById('linkingList');
    const unlinked = _unlinked || [];
    if (!unlinked.length) {
        container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">All games are linked!</p>';
        return;
    }
    container.innerHTML = unlinked.map(g => `
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
            _unlinked = (_unlinked || []).filter(g => g.id !== btn.dataset.skipGame);
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
        await linkGameToGlobal(gameId, globalGame.id, globalGame.name);
        _unlinked = (_unlinked || []).filter(g => g.id !== gameId);
        if (row) row.remove();
        renderLinkingProgress();
    } catch (e) {
        adminToast('Link failed: ' + e.message);
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
    const baseUrl = typeof window !== 'undefined' && window.location ? (window.location.origin + (window.location.pathname || '/').replace(/admin\.html$/, '') || window.location.origin + '/') : '';
    const tbody = document.querySelector('#invitesTable tbody');
    tbody.innerHTML = _invites.map(t => {
        const masked = t.token ? t.token.slice(0, 8) + '…' : '—';
        const creator = _users.find(u => u.id === t.created_by);
        const creatorLabel = creator?.email || (t.created_by ? t.created_by.slice(0, 8) + '…' : '—');
        const useCount = t.use_count ?? 0;
        return `<tr data-id="${t.id}">
            <td><input type="checkbox" class="admin-row-check" data-table="invites" value="${t.id}"></td>
            <td>${esc(pgName(t.playgroup_id))}</td>
            <td><code>${esc(masked)}</code></td>
            <td title="${esc(creator?.email || '')}">${esc(creatorLabel)}</td>
            <td>${useCount}</td>
            <td>
                <button class="admin-action-btn" data-copy-invite="${esc(t.token)}" title="Copy invite link">Copy link</button>
                <button class="admin-action-btn admin-action-danger" data-replace-invite="${t.playgroup_id}" title="Replace with new token (old link stops working)">Replace</button>
                <button class="admin-action-btn admin-action-danger" data-revoke-token="${t.id}" title="Revoke">Revoke</button>
            </td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No invite tokens.</td></tr>';

    tbody.querySelectorAll('[data-copy-invite]').forEach(btn => {
        btn.addEventListener('click', () => {
            const token = btn.dataset.copyInvite;
            const url = baseUrl + (baseUrl.endsWith('/') ? '' : '') + (baseUrl.includes('?') ? '&' : '?') + 'invite=' + encodeURIComponent(token);
            navigator.clipboard.writeText(url).then(() => { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy link'; }, 1500); }).catch(() => prompt('Copy invite link:', url));
        });
    });
    tbody.querySelectorAll('[data-replace-invite]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Replace this invite? The current link will stop working and a new link will be created.')) return;
            const playgroupId = btn.dataset.replaceInvite;
            btn.disabled = true; btn.textContent = '…';
            try {
                await replaceInviteToken(playgroupId);
                await loadInvites();
            } catch (e) { adminToast('Error: ' + e.message); }
            btn.disabled = false; btn.textContent = 'Replace';
        });
    });
    tbody.querySelectorAll('[data-revoke-token]').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Revoke this invite token? The link will stop working.')) return;
            btn.disabled = true; btn.textContent = '…';
            try {
                await deleteInviteToken(btn.dataset.revokeToken);
                _invites = _invites.filter(t => t.id !== btn.dataset.revokeToken);
                renderInvites();
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Revoke'; }
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
            } catch (e) { adminToast('Error: ' + e.message); }
        }
        renderInvites();
    };
    document.getElementById('invitesBulkClear').onclick = () => clearChecked('invites', 'invitesBulkBar', 'invitesBulkCount', 'invitesTable');
}

// ── Leaderboard quotes ────────────────────────────────────────────────────────

const DEFAULT_LEADERBOARD_QUOTES = [
    'Roll with it.',
    'Winning is just the beginning.',
    'May the dice be ever in your favor.',
    'One more game? Always.',
    'Board games > boring games.'
];

async function loadQuotes() {
    if (!guardAdmin()) return;
    try {
        const config = await fetchAppConfig();
        let quotes = [];
        if (config.leaderboard_quotes) {
            try {
                quotes = JSON.parse(config.leaderboard_quotes);
            } catch (_) {}
        }
        if (!Array.isArray(quotes) || quotes.length === 0) {
            quotes = [...DEFAULT_LEADERBOARD_QUOTES];
        }
        const list = document.getElementById('quotesList');
        list.innerHTML = quotes.map((q, i) => {
            const safe = (esc(q) || '').replace(/"/g, '&quot;');
            return `
            <div class="admin-quote-row" data-index="${i}">
                <input type="text" class="admin-quote-input" value="${safe}" placeholder="Short game quote…">
                <button type="button" class="admin-action-btn admin-action-danger admin-quote-remove" data-index="${i}" title="Remove">Remove</button>
            </div>
        `;
        }).join('');
        list.querySelectorAll('.admin-quote-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('.admin-quote-row');
                if (row) row.remove();
            });
        });
    } catch (e) { console.error(e); }
}

function addQuoteRow() {
    const list = document.getElementById('quotesList');
    const index = list.querySelectorAll('.admin-quote-row').length;
    const div = document.createElement('div');
    div.className = 'admin-quote-row';
    div.dataset.index = index;
    div.innerHTML = `
        <input type="text" class="admin-quote-input" value="" placeholder="Short game quote…">
        <button type="button" class="admin-action-btn admin-action-danger admin-quote-remove" title="Remove">Remove</button>
    `;
    div.querySelector('.admin-quote-remove').addEventListener('click', () => div.remove());
    list.appendChild(div);
}

async function saveQuotes() {
    if (!guardAdmin()) return;
    const list = document.getElementById('quotesList');
    const inputs = list.querySelectorAll('.admin-quote-input');
    const quotes = Array.from(inputs).map(inp => inp.value.trim()).filter(Boolean);
    const btn = document.getElementById('saveQuotesBtn');
    const status = document.getElementById('quotesStatus');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
        await setAppConfig('leaderboard_quotes', JSON.stringify(quotes));
        status.textContent = 'Saved! Users will see these quotes on the next refresh.';
        status.style.color = 'var(--accent-success)';
    } catch (e) {
        status.textContent = 'Error: ' + e.message;
        status.style.color = '#f87171';
    }
    btn.disabled = false;
    btn.textContent = 'Save quotes';
    setTimeout(() => { status.textContent = ''; }, 4000);
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
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Set Active'; }
        });
    });

    tbody.querySelectorAll('[data-deactivate]').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true; btn.textContent = '…';
            try {
                await clearAnnouncement();
                await loadAnnouncements();
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Deactivate'; }
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
            } catch (e) { adminToast('Error: ' + e.message); btn.disabled = false; btn.textContent = 'Delete'; }
        });
    });
}

async function doPublishAnnouncement() {
    const msg = document.getElementById('announceMessage').value.trim();
    if (!msg) { adminToast('Enter a message first.'); return; }
    const btn = document.getElementById('publishAnnounceBtn');
    btn.disabled = true; btn.textContent = 'Publishing…';
    try {
        await publishAnnouncement(msg);
        document.getElementById('announceMessage').value = '';
        await loadAnnouncements();
    } catch (e) { adminToast('Error: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Publish';
}

async function doClearAnnouncement() {
    if (!confirm('Deactivate the current announcement? It will no longer show to users, but stays in history.')) return;
    try {
        await clearAnnouncement();
        await loadAnnouncements();
    } catch (e) { adminToast('Error: ' + e.message); }
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

function setupBulkSelect(tableKey, barId, countId, tableId, onBarUpdate) {
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
        if (typeof onBarUpdate === 'function') onBarUpdate();
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
