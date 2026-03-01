import { getSession, signInWithOAuth, signOut } from './auth.js';
import { isAdminConfigured, isAdminEmail, isAdminMode, deactivateAdminMode, showAdminPassphraseModal } from './admin.js';
import { showModal } from './modals.js';

/** In-app toast (avoids importing modals.js and circular dependency). */
function _toast(message) {
    const el = document.createElement('div');
    el.style.cssText = 'position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: var(--bg-card); color: var(--text-primary); padding: 16px 24px; border-radius: 12px; border: 1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.5); z-index: 1000; animation: slideUp 0.3s ease; font-weight: 500;';
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'slideDown 0.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 2000);
}

const LOGGED_OUT_BANNER_TEXT = 'Log in to add wins, players and games!';
const SELECT_PLAYGROUP_BANNER_HTML = 'Select a campaign to add wins, players and games!';

export function setupAuthButtons() {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');

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
            _toast('Login failed: ' + (err.message || err));
        }
    }

    if (loginBtn) {
        loginBtn.addEventListener('click', () => handleLogin(loginBtn, 'Log in with Google'));
    }
    const dashboardGuestLoginBtn = document.getElementById('dashboardGuestLoginBtn');
    if (dashboardGuestLoginBtn) {
        dashboardGuestLoginBtn.addEventListener('click', () => handleLogin(dashboardGuestLoginBtn, 'Log in with Google'));
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
    if (loginBtn) {
        loginBtn.style.display = isLoggedIn ? 'none' : 'inline-flex';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Log in with Google';
    }
    if (googleLoginNote) googleLoginNote.style.display = isLoggedIn ? 'none' : 'block';
    if (authUser) authUser.style.display = isLoggedIn ? 'flex' : 'none';
    if (playgroupArea) playgroupArea.style.display = isLoggedIn ? 'flex' : 'none';

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

    // Dashboard guest prompt (login CTA + logo) — show only when not logged in
    const dashboardGuestPrompt = document.getElementById('dashboardGuestPrompt');
    if (dashboardGuestPrompt) dashboardGuestPrompt.style.display = isLoggedIn ? 'none' : 'flex';
}

export function updateEditability(canEdit) {
    document.body.classList.toggle('read-only', !canEdit);
    const banner = document.getElementById('readOnlyBanner');
    if (!banner) return;
    banner.style.display = canEdit ? 'none' : 'block';
}

export function showLoginPrompt() {
    _toast('Please log in with Google to add wins, players and games!');
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
            showModal(
                'Exit admin mode?',
                'You\'ll go back to seeing only campaigns you\'re a member of.',
                () => {
                    deactivateAdminMode();
                    window.location.reload();
                },
                'Exit admin'
            );
        };
    } else {
        btn.textContent = '🛡 Admin';
        btn.classList.remove('admin-mode-active');
        btn.title = 'Enter admin mode';
        btn.onclick = () => {
            showAdminPassphraseModal(
                () => {
                    if (onAdminActivated) onAdminActivated();
                    window.location.href = 'admin.html';
                },
                null
            );
        };
    }
}

function formatTierLabels(tiers) {
    if (!tiers || tiers.length === 0) return 'Commoners, Nobles and Royals';
    const labels = tiers.map(t => {
        if (t === 2) return 'Noble';
        if (t === 3) return 'Royal';
        return 'Commoner';
    });
    return labels.join(', ');
}

export function syncReadOnlyBanner(canEdit, isLoggedIn, hasInviteToken, guestCampaignName = null, viewingViaInvite = false, joinInfo = null) {
    const banner = document.getElementById('readOnlyBanner');
    if (!banner) return;

    if (canEdit) {
        banner.style.display = 'none';
        return;
    }

    if (guestCampaignName && viewingViaInvite) {
        const btnText = isLoggedIn ? 'Join campaign' : 'Login and join campaign';
        const acceptLabel = joinInfo ? formatTierLabels(joinInfo.allowedTiers) : 'Commoners, Nobles and Royals';
        banner.classList.add('guest-banner');
        banner.innerHTML = 'Viewing <strong>' + guestCampaignName + '</strong> as guest. Accepts: ' + acceptLabel + '. <button type="button" class="btn-accept-invite" id="joinOrLoginInviteBtn">' + btnText + '</button>';
        banner.style.display = 'block';
        return;
    }

    if (guestCampaignName) {
        const acceptLabel = joinInfo ? formatTierLabels(joinInfo.allowedTiers) : '';
        banner.innerHTML = 'Viewing <strong>' + guestCampaignName + '</strong> as guest — sign in to add wins and track your glory!' +
            (acceptLabel ? ' <span class="guest-accepts">Accepts: ' + acceptLabel + '</span>' : '');
        banner.classList.add('guest-banner');
        banner.style.display = 'block';
        return;
    }

    banner.classList.remove('guest-banner');
    if (!isLoggedIn) {
        banner.style.display = 'none';
        return;
    }
    banner.innerHTML = SELECT_PLAYGROUP_BANNER_HTML;
    banner.style.display = 'block';
}
