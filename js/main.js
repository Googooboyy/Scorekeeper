import { setRenderCallback, loadData, resetData, data } from './data.js';
import { renderAll, toggleVictoryRoster } from './render.js';
import { setupEventListeners } from './events.js';
import { onAuthStateChange, getSession, getInviteTokenFromStorage, saveInviteTokenToStorage, clearInviteTokenFromStorage } from './auth.js';

function hasInviteToken() {
    return !!getInviteTokenFromUrl() || !!getInviteTokenFromStorage();
}
import { loadPlaygroups, setActivePlaygroup, setOnPlaygroupChange, setupPlaygroupUI, getActivePlaygroup } from './playgroups.js';
import { setupAuthButtons, updateAuthUI, updateEditability, syncReadOnlyBanner, updateAdminUI } from './auth-ui.js';
import { redeemInviteToken, fetchPlaygroupName } from './supabase.js';
import { showNotification, fireConfetti } from './modals.js';
import { isAdminConfigured, isAdminEmail, isAdminMode, activateAdminMode, deactivateAdminMode, showAdminPassphraseModal } from './admin.js';

// Expose toggleVictoryRoster for onclick handlers in player cards
window.toggleVictoryRoster = toggleVictoryRoster;

const INVITE_STORAGE_KEY = 'scorekeeper_invite_token';

function getInviteTokenFromUrl() {
    return new URLSearchParams(window.location.search).get('invite');
}

function getShareIdFromUrl() {
    return new URLSearchParams(window.location.search).get('share');
}

async function loadGuestCampaign(shareId) {
    try {
        await loadData(shareId);
        const pgName = await fetchPlaygroupName(shareId);
        syncReadOnlyBanner(false, false, false, pgName);
    } catch {
        // Invalid or inaccessible campaign ID — fall through to default state
    }
}

function clearInviteFromUrl() {
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    const newUrl = url.pathname + (url.search || '') + url.hash;
    window.history.replaceState({}, '', newUrl);
}

async function tryRedeemInvite(session) {
    if (!session) return false;
    const token = getInviteTokenFromUrl() || getInviteTokenFromStorage();
    if (!token) return false;
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
            return true;
        }
    } catch (err) {
        alert('Could not join campaign: ' + (err.message || err));
        clearInviteTokenFromStorage();
        clearInviteFromUrl();
    }
    return false;
}

document.addEventListener('DOMContentLoaded', async function () {
    setupAuthButtons();
    setRenderCallback(renderAll);
    setupEventListeners();

    const urlToken = getInviteTokenFromUrl();
    if (urlToken) {
        saveInviteTokenToStorage(urlToken);
    }

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
        if (session) {
            const userEmail = session.user?.email || null;
            updateAdminUI(userEmail, () => doActivateAdmin(userEmail));
            setupPlaygroupUI();
            const redeemed = await tryRedeemInvite(session);
            if (!redeemed) {
                await loadPlaygroups();
            }
            const canEdit = !!getActivePlaygroup();
            updateEditability(canEdit);
            syncReadOnlyBanner(canEdit, true, hasInviteToken());
            const pg = getActivePlaygroup();
            if (pg) await loadData(pg.id);
            else {
                resetData();
                renderAll();
            }
            // Show passphrase prompt on sign-in and on page load (INITIAL_SESSION), but not on token refreshes
            const shouldPrompt = (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')
                && isAdminConfigured() && isAdminEmail(userEmail) && !isAdminMode();
            if (shouldPrompt) {
                showAdminPassphraseModal(() => doActivateAdmin(userEmail), null);
            }
        } else {
            data.currentUserId = null;
            deactivateAdminMode();
            updateAdminUI(null);
            resetData();
            renderAll();
            updateEditability(false);
            const shareId = getShareIdFromUrl();
            if (shareId) {
                await loadGuestCampaign(shareId);
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
    if (sess) {
        const userEmail = sess.user?.email || null;
        data.currentUserId = sess.user?.id || null;
        updateAuthUI(true, false);
        updateAdminUI(userEmail, () => doActivateAdmin(userEmail));
        setupPlaygroupUI();
        const redeemed = await tryRedeemInvite(sess);
        if (!redeemed) {
            await loadPlaygroups();
        }
        const pg = getActivePlaygroup();
        if (pg) await loadData(pg.id);
        else { resetData(); renderAll(); }
        const canEdit = !!pg;
        updateEditability(canEdit);
        syncReadOnlyBanner(canEdit, true, hasInviteToken());
    } else {
        data.currentUserId = null;
        updateAdminUI(null);
        updateAuthUI(false, hasInviteToken());
        resetData();
        renderAll();
        updateEditability(false);
        const shareId = getShareIdFromUrl();
        if (shareId) {
            await loadGuestCampaign(shareId);
        } else {
            syncReadOnlyBanner(false, false, hasInviteToken());
        }
    }
});
