import { getSession, signInWithOAuth, signOut } from './auth.js';
import { isAdminConfigured, isAdminEmail, isAdminMode, deactivateAdminMode, showAdminPassphraseModal } from './admin.js';

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
            readOnlyBanner.style.display = 'none';
        }
    }

    if (isLoggedIn) {
        getSession().then(session => {
            if (authEmail && session?.user?.email) {
                authEmail.textContent = session.user.email;
            }
            _updateAdminControls(session?.user?.email || null);
        });
    } else {
        _updateAdminControls(null);
    }

    // About page hero CTA
    const aboutGetStartedBtn = document.getElementById('aboutGetStartedBtn');
    const aboutHeroLoggedInBtns = document.getElementById('aboutHeroLoggedInBtns');
    if (aboutGetStartedBtn) aboutGetStartedBtn.style.display = isLoggedIn ? 'none' : 'inline-block';
    if (aboutHeroLoggedInBtns) aboutHeroLoggedInBtns.style.display = isLoggedIn ? 'flex' : 'none';

    // About page bottom CTA
    const aboutBottomLoggedOut = document.getElementById('aboutBottomLoggedOut');
    const aboutBottomLoggedIn = document.getElementById('aboutBottomLoggedIn');
    if (aboutBottomLoggedOut) aboutBottomLoggedOut.style.display = isLoggedIn ? 'none' : 'block';
    if (aboutBottomLoggedIn) aboutBottomLoggedIn.style.display = isLoggedIn ? 'block' : 'none';
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

/**
 * Update the admin button/badge in the auth area.
 * Called whenever auth state or admin mode changes.
 * @param {string|null} email - current user's email, or null if logged out
 * @param {Function} [onAdminActivated] - callback fired after admin mode is activated
 */
export function updateAdminUI(email, onAdminActivated) {
    _updateAdminControls(email, onAdminActivated);
}

function _updateAdminControls(email, onAdminActivated) {
    const btn = document.getElementById('adminModeBtn');
    const dashBtn = document.getElementById('adminDashboardLink');
    if (!btn) return;

    if (!email || !isAdminConfigured() || !isAdminEmail(email)) {
        btn.style.display = 'none';
        if (dashBtn) dashBtn.style.display = 'none';
        return;
    }

    if (dashBtn) {
        dashBtn.style.display = 'inline-flex';
        dashBtn.onclick = () => { window.location.href = 'admin.html'; };
        dashBtn.title = 'Open admin dashboard';
    }

    btn.style.display = 'inline-flex';
    btn.onclick = null;

    if (isAdminMode()) {
        btn.textContent = 'ADMIN ✕';
        btn.classList.add('admin-mode-active');
        btn.title = 'Exit admin mode';
        btn.onclick = () => {
            if (confirm('Exit admin mode? You will only see your own campaigns.')) {
                deactivateAdminMode();
                window.location.reload();
            }
        };
    } else {
        btn.textContent = '🛡 Admin';
        btn.classList.remove('admin-mode-active');
        btn.title = 'Enter admin mode';
        btn.onclick = () => {
            showAdminPassphraseModal(
                () => {
                    if (onAdminActivated) onAdminActivated();
                },
                null
            );
        };
    }
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
    if (!isLoggedIn) {
        banner.style.display = 'none';
        return;
    }
    banner.textContent = SELECT_PLAYGROUP_BANNER_TEXT;
    banner.style.display = 'block';
}
