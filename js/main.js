import { setRenderCallback, loadData, resetData, data } from './data.js';
import { renderAll, toggleVictoryRoster } from './render.js';
import { setupEventListeners } from './events.js';
import { onAuthStateChange, getSession, getInviteTokenFromStorage, saveInviteTokenToStorage, clearInviteTokenFromStorage } from './auth.js';

function hasInviteToken() {
    return !!getInviteTokenFromUrl() || !!getInviteTokenFromStorage();
}
import { loadPlaygroups, setActivePlaygroup, setOnPlaygroupChange, setupPlaygroupUI, getActivePlaygroup } from './playgroups.js';
import { setupAuthButtons, updateAuthUI, updateEditability, syncReadOnlyBanner } from './auth-ui.js';
import { redeemInviteToken, fetchPlaygroupName } from './supabase.js';
import { showNotification, fireConfetti } from './modals.js';

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
        saveInviteTokenToStorage(urlToken); // always persist so it survives OAuth redirect (which may drop query params)
    }

    onAuthStateChange(async (event, session) => {
        data.currentUserId = session?.user?.id || null;
        updateAuthUI(!!session, hasInviteToken());
        if (session) {
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
        } else {
            data.currentUserId = null;
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
        data.currentUserId = sess.user?.id || null;
        updateAuthUI(true, false);
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
