import { fetchPlaygroups, createPlaygroup, createInviteToken, leavePlaygroup } from './supabase.js';
import { showNotification, showModal } from './modals.js';
import { isAdminMode } from './admin.js';

let activePlaygroup = null;
let playgroups = [];
let onPlaygroupChangeCallback = null;

export function getActivePlaygroup() {
    return activePlaygroup;
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
    const select = document.getElementById('playgroupSelect');
    if (select) {
        select.value = playgroup ? playgroup.id : '';
    }
    if (onPlaygroupChangeCallback) onPlaygroupChangeCallback(playgroup);
}

function renderPlaygroupSelect() {
    const select = document.getElementById('playgroupSelect');
    if (!select) return;

    const currentId = select.value || (activePlaygroup && activePlaygroup.id);
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
    const countEl = document.getElementById('playgroupCount');
    if (countEl) {
        const max = window._scorekeeperMaxCampaigns || 2;
        countEl.textContent = playgroups.length + ' of ' + max + ' campaigns';
    }
    updatePlaygroupActionButtons();
}

function updatePlaygroupActionButtons() {
    const inviteBtn = document.getElementById('invitePlaygroupBtn');
    const shareBtn = document.getElementById('shareLeaderboardBtn');
    const leaveBtn = document.getElementById('leavePlaygroupBtn');
    const createBtn = document.getElementById('createPlaygroupBtn');
    if (inviteBtn) inviteBtn.style.display = activePlaygroup ? 'inline-flex' : 'none';
    if (shareBtn) shareBtn.style.display = activePlaygroup ? 'inline-flex' : 'none';
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
                const token = await createInviteToken(pg.id);
                const url = new URL(window.location.origin + window.location.pathname);
                url.searchParams.set('invite', token);
                await navigator.clipboard.writeText(url.toString());
                if (invitePlaygroupName) invitePlaygroupName.textContent = pg.name;
                inviteModal.classList.add('active');
            } catch (err) {
                alert('Error creating invite link: ' + (err.message || err));
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

    const shareBtn = document.getElementById('shareLeaderboardBtn');
    if (shareBtn) {
        shareBtn.addEventListener('click', async () => {
            const pg = activePlaygroup;
            if (!pg) return;
            const url = new URL(window.location.origin + window.location.pathname);
            url.searchParams.set('share', pg.id);
            try {
                await navigator.clipboard.writeText(url.toString());
                const orig = shareBtn.textContent;
                shareBtn.textContent = 'Link copied!';
                setTimeout(() => { shareBtn.textContent = orig; }, 2000);
            } catch {
                prompt('Copy this leaderboard link:', url.toString());
            }
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
                alert('Could not leave campaign: ' + (err.message || err));
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
