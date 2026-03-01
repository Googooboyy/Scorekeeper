import { fetchPlaygroups, createPlaygroup, getOrCreateInviteToken, leavePlaygroup, fetchCampaignJoinInfo, updateCampaignJoinRequirements } from './supabase.js';
import { showNotification, showModal } from './modals.js';
import { isAdminMode } from './admin.js';

function getTierLabel(tier) {
    const t = parseInt(tier, 10) || 1;
    if (t === 2) return 'Noble';
    if (t === 3) return 'Royal';
    return 'Commoner';
}

let activePlaygroup = null;
let playgroups = [];
let onPlaygroupChangeCallback = null;
const LAST_CAMPAIGN_KEY = 'scorekeeper_last_campaign_id';

export function getActivePlaygroup() {
    return activePlaygroup;
}

function saveLastCampaignId(id) {
    try {
        if (id) localStorage.setItem(LAST_CAMPAIGN_KEY, id);
        else localStorage.removeItem(LAST_CAMPAIGN_KEY);
    } catch { /* ignore */ }
}

function getLastCampaignId() {
    try {
        return localStorage.getItem(LAST_CAMPAIGN_KEY) || null;
    } catch { return null; }
}

export function getPlaygroups() {
    return playgroups;
}

export function setOnPlaygroupChange(callback) {
    onPlaygroupChangeCallback = callback;
}

export async function loadPlaygroups() {
    playgroups = await fetchPlaygroups();
    renderPlaygroupSelect();
    return playgroups;
}

export function setActivePlaygroup(playgroup) {
    activePlaygroup = playgroup;
    saveLastCampaignId(playgroup ? playgroup.id : null);
    const select = document.getElementById('playgroupSelect');
    if (select) {
        select.value = playgroup ? playgroup.id : '';
    }
    updatePlaygroupCountBadge();
    if (onPlaygroupChangeCallback) onPlaygroupChangeCallback(playgroup);
}

function renderPlaygroupSelect() {
    const select = document.getElementById('playgroupSelect');
    if (!select) return;

    const lastId = getLastCampaignId();
    const defaultLastId = lastId && playgroups.some(pg => pg.id === lastId) ? lastId : null;
    const currentId = (activePlaygroup && activePlaygroup.id) || defaultLastId || select.value || null;
    select.innerHTML = '<option value="">Select campaign...</option>' +
        playgroups.map(pg => '<option value="' + pg.id + '">' + escapeHtml(pg.name) + '</option>').join('');

    if (currentId && playgroups.some(pg => pg.id === currentId)) {
        select.value = currentId;
        activePlaygroup = playgroups.find(pg => pg.id === currentId);
    } else if (playgroups.length === 1) {
        select.value = playgroups[0].id;
        activePlaygroup = playgroups[0];
        if (onPlaygroupChangeCallback) onPlaygroupChangeCallback(activePlaygroup);
    } else {
        activePlaygroup = null;
        if (onPlaygroupChangeCallback) onPlaygroupChangeCallback(null);
    }
    updatePlaygroupCountBadge();
    updatePlaygroupActionButtons();
}

function updateUserPlanLabel() {
    const pill = document.getElementById('planPillTier');
    const summary = document.getElementById('planSummary');
    if (!pill) return;
    const tier = window._scorekeeperUserTier;
    if (tier == null || tier === undefined) {
        pill.textContent = '';
        pill.style.display = 'none';
        if (summary) {
            summary.classList.remove('plan-summary-tier-commoner', 'plan-summary-tier-noble', 'plan-summary-tier-royal');
        }
        return;
    }
    pill.textContent = 'Class: ' + getTierLabel(tier);
    pill.title = 'Your membership tier';
    pill.style.display = '';
    if (summary) {
        summary.classList.remove('plan-summary-tier-commoner', 'plan-summary-tier-noble', 'plan-summary-tier-royal');
        const t = parseInt(tier, 10) || 1;
        if (t === 1) summary.classList.add('plan-summary-tier-commoner');
        else if (t === 2) summary.classList.add('plan-summary-tier-noble');
        else if (t === 3) summary.classList.add('plan-summary-tier-royal');
    }
}

export function updateUserPlanLabelFromTier() {
    updateUserPlanLabel();
}

function formatAcceptsRequirement(allowedTiers) {
    if (!allowedTiers || allowedTiers.length === 0) return 'Commoners, Nobles and Royals';
    const labels = allowedTiers
        .slice()
        .sort((a, b) => a - b)
        .map(t => t === 1 ? 'Commoners' : t === 2 ? 'Nobles' : 'Royals');
    if (labels.length === 1) return labels[0];
    if (labels.length === 2) return labels[0] + ' and ' + labels[1];
    return labels[0] + ', ' + labels[1] + ' and ' + labels[2];
}

function formatPopulationBreakdown(tier1Count, tier2Count, tier3Count, allowedTiers) {
    const allowed = new Set(allowedTiers || [1, 2, 3]);
    const parts = [];
    if (allowed.has(1) && tier1Count > 0) parts.push(tier1Count + ' Commoner' + (tier1Count === 1 ? '' : 's'));
    if (allowed.has(2) && tier2Count > 0) parts.push(tier2Count + ' Noble' + (tier2Count === 1 ? '' : 's'));
    if (allowed.has(3) && tier3Count > 0) parts.push(tier3Count + ' Royal' + (tier3Count === 1 ? '' : 's'));
    if (parts.length === 0) return null;
    const total = (allowed.has(1) ? tier1Count : 0) + (allowed.has(2) ? tier2Count : 0) + (allowed.has(3) ? tier3Count : 0);
    const phrase = parts.length === 1 ? parts[0] : parts.length === 2 ? parts[0] + ' and ' + parts[1] : parts[0] + ', ' + parts[1] + ', and ' + parts[2];
    return { total, phrase };
}

function formatLine2(travellers, tier1Count, tier2Count, tier3Count, allowedTiers) {
    const travellerLabel = travellers === 1 ? '1 Traveller' : travellers + ' Travellers';
    const breakdown = formatPopulationBreakdown(tier1Count, tier2Count, tier3Count, allowedTiers);
    if (!breakdown) {
        return 'There are currently ' + travellerLabel + '.';
    }
    const meepleLabel = breakdown.total === 1 ? 'Meeple' : 'Meeples';
    return 'There are currently ' + travellerLabel + ' and an active party of ' + breakdown.total + ' ' + meepleLabel + ': ' + breakdown.phrase + '.';
}

async function updatePlaygroupCountBadge() {
    const tierPill = document.getElementById('planPillTier');
    const campaignsPill = document.getElementById('planPillCampaigns');
    const meeplesRow = document.getElementById('meeplesRow');
    const summary = document.getElementById('planSummary');
    const pg = activePlaygroup;
    if (!campaignsPill || !summary) return;

    updateUserPlanLabel();

    const maxCampaigns = window._scorekeeperMaxCampaigns || 2;
    const campaignsText = 'Engagement: ' + playgroups.length + ' of ' + maxCampaigns + ' campaigns';
    campaignsPill.textContent = campaignsText;
    campaignsPill.title = 'Campaigns you belong to vs plan limit';

    const partyPermitPill = document.getElementById('planPillPartyPermit');
    if (partyPermitPill && pg) {
        const max = window._scorekeeperMaxMeeplesTier ?? window._scorekeeperMaxMeeples ?? 5;
        const UNLIMITED = 999999;
        if (max >= UNLIMITED) {
            partyPermitPill.textContent = 'Party Permit: unlimited meeples';
            partyPermitPill.title = 'Your plan has no meeple limit';
        } else {
            partyPermitPill.textContent = 'Party Permit: ' + max + ' meeples limit';
            partyPermitPill.title = 'Max meeples allowed for your account tier';
        }
        partyPermitPill.style.display = '';
    } else if (partyPermitPill) {
        partyPermitPill.textContent = '';
        partyPermitPill.style.display = 'none';
    }

    const acceptsText = document.getElementById('meeplesAcceptsText');
    const populationText = document.getElementById('meeplesPopulationText');
    const changeBtn = document.getElementById('meeplesChangeBtn');

    if (!pg) {
        if (meeplesRow) { meeplesRow.style.display = 'none'; }
        if (acceptsText) acceptsText.textContent = '';
        if (populationText) populationText.textContent = '';
        if (changeBtn) changeBtn.style.display = 'none';
    } else {
        try {
            const joinInfo = await fetchCampaignJoinInfo(pg.id);
            const travellers = joinInfo.travellers ?? 0;
            const tier1 = joinInfo.tier1Count ?? 0;
            const tier2 = joinInfo.tier2Count ?? 0;
            const tier3 = joinInfo.tier3Count ?? 0;
            const allowedTiers = joinInfo.allowedTiers ?? [1, 2, 3];

            const acceptsAll = allowedTiers && allowedTiers.length >= 3 &&
                allowedTiers.includes(1) && allowedTiers.includes(2) && allowedTiers.includes(3);
            const acceptsPhrase = acceptsAll ? 'everyone' : 'only ' + formatAcceptsRequirement(allowedTiers);
            if (acceptsText) acceptsText.textContent = 'This campaign accepts ' + acceptsPhrase + '. ';
            if (populationText) populationText.textContent = formatLine2(travellers, tier1, tier2, tier3, allowedTiers);

            const isOwner = pg.role === 'owner';
            if (changeBtn) {
                changeBtn.style.display = isOwner ? 'inline-flex' : 'none';
                if (isOwner) {
                    changeBtn.onclick = () => openCampaignSettingsModal();
                }
            }
            if (meeplesRow) meeplesRow.style.display = 'block';
        } catch {
            if (meeplesRow) meeplesRow.style.display = 'none';
            if (acceptsText) acceptsText.textContent = '';
            if (populationText) populationText.textContent = '';
            if (changeBtn) changeBtn.style.display = 'none';
        }
    }

    const hasTier = tierPill && tierPill.textContent;
    summary.style.display = (hasTier || campaignsPill.textContent) ? 'flex' : 'none';
}

function updatePlaygroupActionButtons() {
    const inviteBtn = document.getElementById('invitePlaygroupBtn');
    const shareBtn = document.getElementById('shareLeaderboardBtn');
    const leaveBtn = document.getElementById('leavePlaygroupBtn');
    const createBtn = document.getElementById('createPlaygroupBtn');
    if (inviteBtn) inviteBtn.style.display = activePlaygroup ? 'inline-flex' : 'none';
    if (shareBtn) shareBtn.style.display = 'none'; // Replaced by single "Copy Campaign Invite Link"
    if (leaveBtn) leaveBtn.style.display = activePlaygroup ? 'inline-flex' : 'none';

    const maxCampaigns = window._scorekeeperMaxCampaigns || 2;
    const ownedCount = playgroups.filter(pg => pg.role === 'owner').length;
    if (createBtn) {
        const atLimit = !isAdminMode() && ownedCount >= maxCampaigns;
        createBtn.disabled = atLimit;
        createBtn.title = atLimit ? `You can only own ${maxCampaigns} campaigns on the current plan` : '';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

let playgroupUISetup = false;

export function setupPlaygroupUI() {
    if (playgroupUISetup) return;
    playgroupUISetup = true;

    const select = document.getElementById('playgroupSelect');
    const createBtn = document.getElementById('createPlaygroupBtn');
    const area = document.getElementById('playgroupArea');

    if (!select || !createBtn || !area) return;

    area.style.display = 'flex';

    select.addEventListener('change', function () {
        const id = this.value;
        const pg = playgroups.find(p => p.id === id) || null;
        setActivePlaygroup(pg);
        updatePlaygroupActionButtons();
    });

    const inviteBtn = document.getElementById('invitePlaygroupBtn');
    const inviteModal = document.getElementById('invitePlaygroupModal');
    const inviteModalClose = document.getElementById('inviteModalClose');
    const invitePlaygroupName = document.getElementById('invitePlaygroupName');

    if (inviteBtn && inviteModal) {
        inviteBtn.addEventListener('click', async () => {
            const pg = activePlaygroup;
            if (!pg) return;
            inviteBtn.disabled = true;
            try {
                const token = await getOrCreateInviteToken(pg.id);
                const url = new URL(window.location.origin + window.location.pathname);
                url.searchParams.set('invite', token);
                await navigator.clipboard.writeText(url.toString());
                if (invitePlaygroupName) invitePlaygroupName.textContent = pg.name;
                inviteModal.classList.add('active');
            } catch (err) {
                const rawMessage = (err && err.message) ? err.message : String(err || 'Unknown error');
                if (/Not authenticated/i.test(rawMessage)) {
                    showNotification('Sign in to copy a campaign invite link.');
                } else {
                    showNotification('Could not get invite link: ' + rawMessage);
                }
            } finally {
                inviteBtn.disabled = false;
            }
        });
    }
    if (inviteModalClose && inviteModal) {
        inviteModalClose.addEventListener('click', () => inviteModal.classList.remove('active'));
    }
    if (inviteModal) {
        inviteModal.addEventListener('click', (e) => {
            if (e.target === inviteModal) inviteModal.classList.remove('active');
        });
    }

    updatePlaygroupActionButtons();

    // Leave playgroup
    const leaveBtn = document.getElementById('leavePlaygroupBtn');
    const leaveModal = document.getElementById('leavePlaygroupModal');
    const leaveNameEl = document.getElementById('leavePlaygroupName');
    const leaveConfirmBtn = document.getElementById('leavePlaygroupConfirm');
    const leaveCancelBtn = document.getElementById('leavePlaygroupCancel');

    if (leaveBtn && leaveModal) {
        leaveBtn.addEventListener('click', () => {
            const pg = activePlaygroup;
            if (!pg) return;
            if (leaveNameEl) leaveNameEl.textContent = pg.name;
            leaveModal.classList.add('active');
        });
    }
    if (leaveCancelBtn && leaveModal) {
        leaveCancelBtn.addEventListener('click', () => leaveModal.classList.remove('active'));
    }
    if (leaveModal) {
        leaveModal.addEventListener('click', (e) => {
            if (e.target === leaveModal) leaveModal.classList.remove('active');
        });
    }
    if (leaveConfirmBtn && leaveModal) {
        leaveConfirmBtn.addEventListener('click', async () => {
            const pg = activePlaygroup;
            if (!pg) return;
            leaveConfirmBtn.disabled = true;
            try {
                await leavePlaygroup(pg.id);
                leaveModal.classList.remove('active');
                playgroups = playgroups.filter(p => p.id !== pg.id);
                activePlaygroup = null;
                renderPlaygroupSelect();
                showNotification('You left "' + pg.name + '"');
            } catch (err) {
                showNotification('Could not leave campaign: ' + (err.message || err));
            } finally {
                leaveConfirmBtn.disabled = false;
            }
        });
    }

    const modal = document.getElementById('createPlaygroupModal');
    const input = document.getElementById('createPlaygroupInput');
    const okBtn = document.getElementById('createPlaygroupOk');
    const cancelBtn = document.getElementById('createPlaygroupCancel');

    createBtn.addEventListener('click', () => {
        input.value = '';
        modal.classList.add('active');
        input.focus();
    });

    function closeModal() {
        modal.classList.remove('active');
    }

    async function doCreate() {
        const name = input.value?.trim();
        if (!name) return;
        const maxC = window._scorekeeperMaxCampaigns || 2;
        if (!isAdminMode() && playgroups.filter(pg => pg.role === 'owner').length >= maxC) {
            showModal('Campaign limit reached', `You can only own ${maxC} campaigns on the current plan.`, () => {});
            return;
        }
        const exists = playgroups.some(pg => pg.name.toLowerCase() === name.toLowerCase());
        if (exists) {
            showModal('Name already in use', 'You already have a campaign with that name. Please choose a different unique name and try again.', () => {});
            return;
        }
        okBtn.disabled = true;
        okBtn.textContent = 'Creating...';
        try {
            const pg = await createPlaygroup(name);
            playgroups = [pg, ...playgroups];
            renderPlaygroupSelect();
            setActivePlaygroup(pg);
            closeModal();
        } catch (err) {
            okBtn.disabled = false;
            okBtn.textContent = 'Create';
            const raw = (err && err.message) ? err.message : 'Could not create campaign.';
            const isDuplicate = /already exists|already in use/i.test(raw);
            const title = isDuplicate ? 'Name already taken' : 'Cannot create campaign';
            const msg = isDuplicate
                ? raw + ' Please choose a different unique name and try again.'
                : raw;
            showModal(title, msg, () => {});
        }
    }

    okBtn.addEventListener('click', doCreate);
    cancelBtn.addEventListener('click', closeModal);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            doCreate();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

/** Ensures the last known campaign is selected when returning to the tab/window. */
export function ensureLastCampaignSelected() {
    if (playgroups.length === 0) return;
    const lastId = getLastCampaignId();
    if (!lastId || !playgroups.some(pg => pg.id === lastId)) return;
    if (activePlaygroup && activePlaygroup.id === lastId) return;
    const pg = playgroups.find(pg => pg.id === lastId);
    if (pg) setActivePlaygroup(pg);
}

/** Open campaign settings modal (join requirements). Owner only. */
export async function openCampaignSettingsModal() {
    const pg = getActivePlaygroup();
    if (!pg) return;
    const modal = document.getElementById('campaignSettingsModal');
    const checksContainer = document.getElementById('campaignSettingsTierChecks');
    const saveBtn = document.getElementById('campaignSettingsSave');
    const cancelBtn = document.getElementById('campaignSettingsCancel');
    if (!modal || !checksContainer || !saveBtn || !cancelBtn) return;

    try {
        const joinInfo = await fetchCampaignJoinInfo(pg.id);
        const allowed = joinInfo.allowedTiers ?? [1, 2, 3];
        checksContainer.querySelectorAll('input[data-tier]').forEach(cb => {
            const tier = parseInt(cb.dataset.tier, 10);
            cb.checked = allowed.includes(tier);
        });
    } catch {
        checksContainer.querySelectorAll('input[data-tier]').forEach(cb => { cb.checked = true; });
    }

    modal.classList.add('active');
    const close = () => modal.classList.remove('active');

    const doSave = async () => {
        const selected = [];
        checksContainer.querySelectorAll('input[data-tier]:checked').forEach(cb => {
            selected.push(parseInt(cb.dataset.tier, 10));
        });
        if (selected.length === 0) {
            showNotification('Select at least one tier.');
            return;
        }
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';
        try {
            await updateCampaignJoinRequirements(pg.id, selected);
            if (activePlaygroup && activePlaygroup.id === pg.id) {
                activePlaygroup.join_allowed_tiers = selected;
            }
            close();
            showNotification('Join requirements updated.');
            updatePlaygroupCountBadge();
        } catch (err) {
            showNotification('Could not update: ' + (err.message || err));
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
        }
    };

    saveBtn.onclick = doSave;
    cancelBtn.onclick = close;
    modal.onclick = (e) => { if (e.target === modal) close(); };
}
