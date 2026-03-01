import { setRenderCallback, loadData, resetData, data } from './data.js';
import { renderAll, toggleVictoryRoster, nextStep } from './render.js';
import { setupEventListeners, showSection, showNewPlayerInput } from './events.js';
import { onAuthStateChange, getSession, getInviteTokenFromStorage, saveInviteTokenToStorage, clearInviteTokenFromStorage, getInviteIntentFromStorage, clearInviteIntent, setInviteIntentToJoin, signInWithOAuth } from './auth.js';

function hasInviteToken() {
    return !!getInviteTokenFromUrl() || !!getInviteTokenFromStorage();
}
import { loadPlaygroups, setActivePlaygroup, setOnPlaygroupChange, setupPlaygroupUI, getActivePlaygroup, ensureLastCampaignSelected, updateUserPlanLabelFromTier } from './playgroups.js';
import { setupAuthButtons, updateAuthUI, updateEditability, syncReadOnlyBanner, updateAdminUI } from './auth-ui.js';
import { redeemInviteToken, resolveInviteToken, fetchPlaygroupName, fetchActiveAnnouncement, fetchActivePersonalMessage, fetchAppConfig, fetchUserProfile, ensureUserTier, fetchUserTier, fetchCampaignJoinInfo, fetchTierDefinition } from './supabase.js';
import { showNotification, fireConfetti } from './modals.js';
import { isAdminConfigured, isAdminEmail, isAdminMode, activateAdminMode, deactivateAdminMode, showAdminPassphraseModal, hasAdminPromptDismissed, clearAdminPromptDismissed } from './admin.js';

// Expose toggleVictoryRoster for onclick handlers in player cards
window.toggleVictoryRoster = toggleVictoryRoster;

async function loadPersonalMessage() {
    try {
        const pm = await fetchActivePersonalMessage();
        const banner = document.getElementById('personalMessageBanner');
        const text = document.getElementById('personalMessageText');
        const closeBtn = document.getElementById('personalMessageClose');
        if (!banner || !text) return;
        if (pm?.message) {
            const dismissed = sessionStorage.getItem('scorekeeper_dismiss_personal');
            if (dismissed === pm.id) return;
            text.textContent = pm.message;
            banner.style.display = 'block';
            closeBtn?.addEventListener('click', () => {
                banner.style.display = 'none';
                try { sessionStorage.setItem('scorekeeper_dismiss_personal', pm.id); } catch {}
            }, { once: true });
        }
    } catch {}
}

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

/** Tier labels: Commoner (1), Noble (2), Royal (3). */
export function getTierLabel(tier) {
    const t = parseInt(tier, 10) || 1;
    if (t === 2) return 'Noble';
    if (t === 3) return 'Royal';
    return 'Commoner';
}

/** Fallback tier limits when tier_definitions RPC is unavailable. */
const FALLBACK_TIER_LIMITS = { 1: { campaigns: 2, meeples: 5 }, 2: { campaigns: 4, meeples: 10 }, 3: { campaigns: 999999, meeples: 999999 } };

async function loadBetaLimits() {
    try {
        const config = await fetchAppConfig();
        let maxCampaigns = null, maxMeeples = null;
        let userTier = 1;

        const session = await getSession();
        if (session?.user) {
            try {
                await ensureUserTier();
                const { tier } = await fetchUserTier();
                userTier = tier ?? 1;
                window._scorekeeperUserTier = userTier;
                try {
                    const def = await fetchTierDefinition(userTier);
                    maxCampaigns = def?.maxCampaigns ?? FALLBACK_TIER_LIMITS[userTier]?.campaigns ?? 2;
                    maxMeeples = def?.maxMeeples ?? FALLBACK_TIER_LIMITS[userTier]?.meeples ?? 5;
                } catch (_) {
                    const limits = FALLBACK_TIER_LIMITS[userTier] || FALLBACK_TIER_LIMITS[1];
                    maxCampaigns = limits.campaigns;
                    maxMeeples = limits.meeples;
                }
            } catch (e) { /* fallback to config */ }
        }

        // Store tier-derived limit for Party Permit display (ignores app_config override so Royal sees unlimited)
        window._scorekeeperMaxMeeplesTier = maxMeeples ?? 5;

        if (config.max_campaigns_per_user) {
            const override = parseInt(config.max_campaigns_per_user, 10);
            if (!isNaN(override) && override > 0) maxCampaigns = override;
        }
        if (config.max_meeples_per_campaign) {
            const override = parseInt(config.max_meeples_per_campaign, 10);
            if (!isNaN(override) && override > 0) maxMeeples = override;
        }

        window._scorekeeperMaxCampaigns = maxCampaigns ?? 2;
        window._scorekeeperMaxMeeples = maxMeeples ?? 5;
        if (session?.user && typeof window._scorekeeperUserTier === 'undefined') window._scorekeeperUserTier = userTier;
        updateUserPlanLabelFromTier();

        if (config.leaderboard_quotes_enabled !== 'false' && config.leaderboard_quotes) {
            try {
                window._scorekeeperLeaderboardQuotes = JSON.parse(config.leaderboard_quotes);
            } catch (_) {
                window._scorekeeperLeaderboardQuotes = null;
            }
        } else {
            window._scorekeeperLeaderboardQuotes = null;
        }
        window._scorekeeperBggSearchEnabled = config.bgg_search_enabled !== 'false';
        renderAll();
    } catch {}
}

const INVITE_STORAGE_KEY = 'scorekeeper_invite_token';

function getInviteTokenFromUrl() {
    return new URLSearchParams(window.location.search).get('invite');
}

/** Load campaign as guest by invite token (resolve token then load data). Returns { name, joinInfo } or null. */
async function loadGuestCampaignByInvite(token) {
    try {
        const config = await fetchAppConfig();
        if (config.allow_guest_viewing === 'false') {
            showNotification('Guest viewing is disabled. Sign in to view this campaign.');
            return null;
        }
        const res = await resolveInviteToken(token);
        if (!res?.playgroup_id) return null;
        await loadData(res.playgroup_id);
        let joinInfo = null;
        try {
            joinInfo = await fetchCampaignJoinInfo(res.playgroup_id);
        } catch { /* ignore */ }
        return { name: res.playgroup_name || null, joinInfo };
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
    if (typeof window !== 'undefined') {
        window._scorekeeperShowSection = showSection;
        window._scorekeeperNextStep = nextStep;
        window._scorekeeperShowNewPlayerInput = showNewPlayerInput;
    }
    loadAnnouncement();
    loadPersonalMessage();
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
            loadPersonalMessage();
            const userEmail = session.user?.email || null;
            updateAdminUI(userEmail, () => doActivateAdmin(userEmail));
            if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
                showSection('dashboard');
            }
            setupPlaygroupUI();

            // If viewing via invite link, load campaign as guest first (so they always see it)
            let guestPg = null;
            if (viewingViaInvite) {
                guestPg = await loadGuestCampaignByInvite(token);
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
                syncReadOnlyBanner(canEdit, true, hasInviteToken(), guestPg?.name ?? null, viewingViaInvite, guestPg?.joinInfo ?? null);
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
                const guestPg = await loadGuestCampaignByInvite(token);
                syncReadOnlyBanner(false, false, true, guestPg?.name ?? null, true, guestPg?.joinInfo ?? null);
            } else {
                syncReadOnlyBanner(false, false, hasInviteToken());
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && data.currentUserId) {
            ensureLastCampaignSelected();
        }
    });

    setOnPlaygroupChange(async (playgroup) => {
        const canEdit = !!playgroup;
        updateEditability(canEdit);
        syncReadOnlyBanner(canEdit, true, hasInviteToken());
        if (playgroup) {
            await loadData(playgroup.id);
            showSection('dashboard');
        } else {
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

        let guestPg = null;
        if (viewingViaInvite) {
            guestPg = await loadGuestCampaignByInvite(token);
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
            syncReadOnlyBanner(canEdit, true, hasInviteToken(), guestPg?.name ?? null, viewingViaInvite, guestPg?.joinInfo ?? null);
        }
        if (sess?.user?.id) {
            fetchUserProfile(sess.user.id).then(p => {
                data.currentUserFavouriteQuote = p?.favourite_quote ?? null;
                renderAll();
            }).catch(() => {});
        }
        const hash = (typeof location !== 'undefined' && location.hash) ? location.hash : '';
        // Logged-in users go to leaderboard (dashboard) by default when no hash
        let initialSection = 'dashboard';
        if (hash === '#about') initialSection = 'about';
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
            const guestPg = await loadGuestCampaignByInvite(token);
            syncReadOnlyBanner(false, false, true, guestPg?.name ?? null, true, guestPg?.joinInfo ?? null);
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
