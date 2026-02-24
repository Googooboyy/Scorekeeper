import { setRenderCallback, loadData, resetData, data } from './data.js';
import { renderAll, toggleVictoryRoster } from './render.js';
import { setupEventListeners, showSection } from './events.js';
import { onAuthStateChange, getSession, getInviteTokenFromStorage, saveInviteTokenToStorage, clearInviteTokenFromStorage, getInviteIntentFromStorage, clearInviteIntent, setInviteIntentToJoin, signInWithOAuth } from './auth.js';

function hasInviteToken() {
    return !!getInviteTokenFromUrl() || !!getInviteTokenFromStorage();
}
import { loadPlaygroups, setActivePlaygroup, setOnPlaygroupChange, setupPlaygroupUI, getActivePlaygroup } from './playgroups.js';
import { setupAuthButtons, updateAuthUI, updateEditability, syncReadOnlyBanner, updateAdminUI } from './auth-ui.js';
import { redeemInviteToken, resolveInviteToken, fetchPlaygroupName, fetchActiveAnnouncement, fetchAppConfig, fetchUserProfile } from './supabase.js';
import { showNotification, fireConfetti } from './modals.js';
import { isAdminConfigured, isAdminEmail, isAdminMode, activateAdminMode, deactivateAdminMode, showAdminPassphraseModal, hasAdminPromptDismissed, clearAdminPromptDismissed } from './admin.js';

// Expose toggleVictoryRoster for onclick handlers in player cards
window.toggleVictoryRoster = toggleVictoryRoster;

async function loadAnnouncement() {
    try {
        const ann = await fetchActiveAnnouncement();
        const banner = document.getElementById('announcementBanner');
        const text = document.getElementById('announcementText');
        const closeBtn = document.getElementById('announcementClose');
        if (!banner || !text) return;
        if (ann?.message) {
            const dismissed = sessionStorage.getItem('scorekeeper_dismiss_announce');
            if (dismissed === ann.id) return;
            text.textContent = ann.message;
            banner.style.display = 'block';
            closeBtn?.addEventListener('click', () => {
                banner.style.display = 'none';
                try { sessionStorage.setItem('scorekeeper_dismiss_announce', ann.id); } catch {}
            }, { once: true });
        }
    } catch {}
}

async function loadBetaLimits() {
    try {
        const config = await fetchAppConfig();
        if (config.max_meeples_per_campaign) {
            window._scorekeeperMaxMeeples = parseInt(config.max_meeples_per_campaign, 10) || 4;
        }
        if (config.max_campaigns_per_user) {
            window._scorekeeperMaxCampaigns = parseInt(config.max_campaigns_per_user, 10) || 2;
        }
        if (config.leaderboard_quotes) {
            try {
                window._scorekeeperLeaderboardQuotes = JSON.parse(config.leaderboard_quotes);
            } catch (_) {
                window._scorekeeperLeaderboardQuotes = null;
            }
        }
        renderAll();
    } catch {}
}

const INVITE_STORAGE_KEY = 'scorekeeper_invite_token';

function getInviteTokenFromUrl() {
    return new URLSearchParams(window.location.search).get('invite');
}

/** Load campaign as guest by invite token (resolve token then load data). Returns campaign name or null. */
async function loadGuestCampaignByInvite(token) {
    try {
        const res = await resolveInviteToken(token);
        if (!res?.playgroup_id) return null;
        await loadData(res.playgroup_id);
        return res.playgroup_name || null;
    } catch (err) {
        const is404 = (typeof err?.status === 'number' && err.status === 404) || (err?.message && String(err.message).includes('Could not find'));
        if (is404) {
            showNotification('Invite link could not be loaded. The server may need the "resolve_invite_token" database function — run migration 021.');
        } else {
            showNotification('This invite link couldn\'t be loaded. It may be invalid or expired.');
        }
        return null;
    }
}

function clearInviteFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    const newUrl = url.pathname + (url.search || '') + url.hash;
    window.history.replaceState({}, '', newUrl);
}

/** Redeem invite only when user chose "Login and join" (intent set before OAuth). Returns true if joined. */
async function tryRedeemInvite(session) {
    if (!session || !getInviteIntentFromStorage()) return false;
    const token = getInviteTokenFromUrl() || getInviteTokenFromStorage();
    if (!token) return false;
    try {
        const result = await redeemInviteToken(token);
        clearInviteTokenFromStorage();
        clearInviteIntent();
        clearInviteFromUrl();
        if (result?.playgroup_id) {
            const playgroups = await loadPlaygroups();
            const pg = playgroups.find(p => p.id === result.playgroup_id);
            if (pg) {
                setActivePlaygroup(pg);
                await loadData(pg.id);
            }
            fireConfetti();
            showNotification('Joined "' + (result.playgroup_name || 'campaign') + '"!');
            return true;
        }
    } catch (err) {
        showNotification('Could not join campaign: ' + (err.message || err));
        clearInviteTokenFromStorage();
        clearInviteIntent();
        clearInviteFromUrl();
    }
    return false;
}

document.addEventListener('DOMContentLoaded', async function () {
    setupAuthButtons();
    setRenderCallback(renderAll);
    setupEventListeners();
    loadAnnouncement();
    loadBetaLimits();

    const urlToken = getInviteTokenFromUrl();
    if (urlToken) {
        saveInviteTokenToStorage(urlToken);
    }

    // Join campaign / Login and join campaign (from invite guest banner)
    document.body.addEventListener('click', async (e) => {
        if (e.target.id !== 'joinOrLoginInviteBtn') return;
        const sess = await getSession();
        if (sess) {
            const token = getInviteTokenFromUrl() || getInviteTokenFromStorage();
            if (!token) return;
            e.target.disabled = true;
            e.target.textContent = 'Joining…';
            try {
                const result = await redeemInviteToken(token);
                clearInviteTokenFromStorage();
                clearInviteFromUrl();
                if (result?.playgroup_id) {
                    const playgroups = await loadPlaygroups();
                    const pg = playgroups.find(p => p.id === result.playgroup_id);
                    if (pg) {
                        setActivePlaygroup(pg);
                        await loadData(pg.id);
                    }
                    fireConfetti();
                    showNotification('Joined "' + (result.playgroup_name || 'campaign') + '"!');
                    updateEditability(true);
                    syncReadOnlyBanner(true, true, false);
                    showSection('dashboard');
                }
            } catch (err) {
                showNotification('Could not join campaign: ' + (err.message || err));
            }
            e.target.disabled = false;
            e.target.textContent = 'Join campaign';
        } else {
            setInviteIntentToJoin();
            signInWithOAuth('google');
        }
    });

    /** Shared admin activation — called from both the passphrase modal and the admin button. */
    async function doActivateAdmin(userEmail) {
        try {
            activateAdminMode();
            await loadPlaygroups();
            updateAdminUI(userEmail);
            showNotification('Admin mode activated — all campaigns loaded');
        } catch (err) {
            deactivateAdminMode();
            showNotification('Admin mode failed: ' + (err.message || 'check your service role key'));
        }
    }

    onAuthStateChange(async (event, session) => {
        data.currentUserId = session?.user?.id || null;
        updateAuthUI(!!session, hasInviteToken());
        const token = getInviteTokenFromUrl() || getInviteTokenFromStorage();
        const viewingViaInvite = !!token;

        if (session) {
            const userEmail = session.user?.email || null;
            updateAdminUI(userEmail, () => doActivateAdmin(userEmail));
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                showSection('dashboard');
            }
            setupPlaygroupUI();

            // If viewing via invite link, load campaign as guest first (so they always see it)
            let guestPgName = null;
            if (viewingViaInvite) {
                guestPgName = await loadGuestCampaignByInvite(token);
            }

            // Only auto-redeem when user chose "Login and join campaign" (intent set before OAuth)
            const redeemed = await tryRedeemInvite(session);
            if (redeemed) {
                // Already set active playgroup and loaded data in tryRedeemInvite
                const canEdit = true;
                updateEditability(canEdit);
                syncReadOnlyBanner(canEdit, true, false);
            } else {
                if (!viewingViaInvite) {
                    await loadPlaygroups();
                }
                const canEdit = !!getActivePlaygroup();
                updateEditability(canEdit);
                syncReadOnlyBanner(canEdit, true, hasInviteToken(), guestPgName, viewingViaInvite);
                const pg = getActivePlaygroup();
                if (pg && !viewingViaInvite) await loadData(pg.id);
                else if (!viewingViaInvite) {
                    resetData();
                    renderAll();
                }
            }

            if (session?.user?.id) {
                fetchUserProfile(session.user.id).then(p => {
                    data.currentUserFavouriteQuote = p?.favourite_quote ?? null;
                    renderAll();
                }).catch(() => {});
            }
            const shouldPrompt = (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
                && isAdminConfigured() && isAdminEmail(userEmail) && !isAdminMode()
                && !hasAdminPromptDismissed();
            if (shouldPrompt) {
                showAdminPassphraseModal(() => doActivateAdmin(userEmail), null);
            }
        } else {
            data.currentUserId = null;
            clearAdminPromptDismissed();
            deactivateAdminMode();
            updateAdminUI(null);
            resetData();
            renderAll();
            updateEditability(false);
            if (viewingViaInvite) {
                const guestPgName = await loadGuestCampaignByInvite(token);
                syncReadOnlyBanner(false, false, true, guestPgName, true);
            } else {
                syncReadOnlyBanner(false, false, hasInviteToken());
            }
        }
    });

    setOnPlaygroupChange(async (playgroup) => {
        const canEdit = !!playgroup;
        updateEditability(canEdit);
        syncReadOnlyBanner(canEdit, true, hasInviteToken());
        if (playgroup) await loadData(playgroup.id);
        else {
            resetData();
            renderAll();
        }
    });

    const sess = await getSession();
    const token = getInviteTokenFromUrl() || getInviteTokenFromStorage();
    const viewingViaInvite = !!token;

    if (sess) {
        const userEmail = sess.user?.email || null;
        data.currentUserId = sess.user?.id || null;
        updateAuthUI(true, false);
        updateAdminUI(userEmail, () => doActivateAdmin(userEmail));
        setupPlaygroupUI();

        let guestPgName = null;
        if (viewingViaInvite) {
            guestPgName = await loadGuestCampaignByInvite(token);
        }
        const redeemed = await tryRedeemInvite(sess);
        if (redeemed) {
            updateEditability(true);
            syncReadOnlyBanner(true, true, false);
        } else {
            if (!viewingViaInvite) {
                await loadPlaygroups();
            }
            const pg = getActivePlaygroup();
            if (pg && !viewingViaInvite) await loadData(pg.id);
            else if (!viewingViaInvite) { resetData(); renderAll(); }
            const canEdit = !!getActivePlaygroup();
            updateEditability(canEdit);
            syncReadOnlyBanner(canEdit, true, hasInviteToken(), guestPgName, viewingViaInvite);
        }
        if (sess?.user?.id) {
            fetchUserProfile(sess.user.id).then(p => {
                data.currentUserFavouriteQuote = p?.favourite_quote ?? null;
                renderAll();
            }).catch(() => {});
        }
        const hash = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
        let initialSection = 'about';
        if (hash === '#dashboard') initialSection = 'dashboard';
        else if (hash === '#add') initialSection = 'add';
        else if (hash === '#history') initialSection = 'history';
        else if (hash === '#data') initialSection = 'data';
        else if (hash && !['#about', '#dashboard', '#add', '#history', '#data'].includes(hash)) {
            initialSection = 'not-found';
        }
        showSection(initialSection);
    } else {
        data.currentUserId = null;
        updateAdminUI(null);
        updateAuthUI(false, hasInviteToken());
        resetData();
        renderAll();
        updateEditability(false);
        if (viewingViaInvite) {
            const guestPgName = await loadGuestCampaignByInvite(token);
            syncReadOnlyBanner(false, false, true, guestPgName, true);
            showSection('dashboard');
        } else {
            syncReadOnlyBanner(false, false, hasInviteToken());
            const hash = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
            let initialSection = 'about';
            if (hash === '#dashboard') initialSection = 'dashboard';
            else if (hash === '#add') initialSection = 'add';
            else if (hash === '#history') initialSection = 'history';
            else if (hash === '#data') initialSection = 'data';
            else if (hash && !['#about', '#dashboard', '#add', '#history', '#data'].includes(hash)) {
                initialSection = 'not-found';
            }
            if (initialSection === 'dashboard' && !getActivePlaygroup() && !viewingViaInvite) {
                initialSection = 'about';
            }
            showSection(initialSection);
        }
    }
});
