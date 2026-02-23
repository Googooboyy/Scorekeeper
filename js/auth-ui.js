import { getSession, signInWithOAuth, signOut } from './auth.js';

const LOGGED_OUT_BANNER_TEXT = 'Log in to add wins, players and games!';
const SELECT_PLAYGROUP_BANNER_TEXT = 'Select a campaign to add wins, players and games!';

export function setupAuthButtons() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const acceptInviteBtn = document.getElementById('acceptInviteBtn');

    async function handleLogin(btn, doneText = 'Log in with Google') {
        if (!btn) return;
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Redirecting...';
        try {
            await signInWithOAuth('google');
        } catch (err) {
            btn.disabled = false;
            btn.textContent = origText;
            alert('Login failed: ' + (err.message || err));
        }
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', () => handleLogin(loginBtn, 'Log in with Google'));
    }
    if (acceptInviteBtn) {
        acceptInviteBtn.addEventListener('click', () => handleLogin(acceptInviteBtn, 'Accept Invite'));
    }
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => signOut());
    }
}

export function updateAuthUI(isLoggedIn, hasInviteToken) {
    const loginBtn = document.getElementById('loginBtn');
    const authUser = document.getElementById('authUser');
    const authEmail = document.getElementById('authEmail');
    const googleLoginNote = document.getElementById('googleLoginNote');
    const playgroupArea = document.getElementById('playgroupArea');
    const readOnlyBanner = document.getElementById('readOnlyBanner');
    const inviteBanner = document.getElementById('inviteBanner');

    if (loginBtn) {
        loginBtn.style.display = isLoggedIn ? 'none' : 'inline-flex';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log in with Google';
    }
    if (googleLoginNote) googleLoginNote.style.display = isLoggedIn ? 'none' : 'block';
    if (authUser) authUser.style.display = isLoggedIn ? 'flex' : 'none';
    if (playgroupArea) playgroupArea.style.display = isLoggedIn ? 'flex' : 'none';

    if (inviteBanner && readOnlyBanner) {
        if (!isLoggedIn && hasInviteToken) {
            inviteBanner.style.display = 'block';
            readOnlyBanner.style.display = 'none';
        } else {
            inviteBanner.style.display = 'none';
            readOnlyBanner.style.display = isLoggedIn ? 'none' : 'block';
        }
    }

    if (isLoggedIn) {
        getSession().then(session => {
            if (authEmail && session?.user?.email) {
                authEmail.textContent = session.user.email;
            }
        });
    }
}

export function updateEditability(canEdit) {
    document.body.classList.toggle('read-only', !canEdit);
    const banner = document.getElementById('readOnlyBanner');
    if (!banner) return;
    banner.style.display = canEdit ? 'none' : 'block';
}

export function showLoginPrompt() {
    alert('Please log in with Google to add wins, players and games!');
}

export function syncReadOnlyBanner(canEdit, isLoggedIn, hasInviteToken, guestCampaignName = null) {
    const banner = document.getElementById('readOnlyBanner');
    if (!banner) return;

    if (canEdit || (!isLoggedIn && hasInviteToken)) {
        banner.style.display = 'none';
        return;
    }

    if (guestCampaignName) {
        banner.innerHTML = 'Viewing <strong>' + guestCampaignName + '</strong> as guest — sign in to add wins and track your glory!';
        banner.classList.add('guest-banner');
        banner.style.display = 'block';
        return;
    }

    banner.classList.remove('guest-banner');
    banner.textContent = isLoggedIn ? SELECT_PLAYGROUP_BANNER_TEXT : LOGGED_OUT_BANNER_TEXT;
    banner.style.display = 'block';
}
