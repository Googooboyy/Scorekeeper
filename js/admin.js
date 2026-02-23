/**
 * Admin mode — unlocks full access to all campaigns.
 *
 * Configuration (set in js/config.supabase.js, which is gitignored):
 *   // Single admin:
 *   window.SCOREKEEPER_ADMIN_EMAIL = 'you@gmail.com';
 *   // Multiple admins (array):
 *   window.SCOREKEEPER_ADMIN_EMAIL = ['you@gmail.com', 'colleague@gmail.com'];
 *
 *   window.SCOREKEEPER_ADMIN_PASSPHRASE = 'your secret phrase';
 *   window.SCOREKEEPER_SERVICE_ROLE_KEY = 'eyJ...';  // Supabase Dashboard → Settings → API → service_role key
 */

const _rawEmail     = (typeof window !== 'undefined' && window.SCOREKEEPER_ADMIN_EMAIL) || null;
const ADMIN_EMAILS  = _rawEmail
    ? (Array.isArray(_rawEmail) ? _rawEmail : [_rawEmail]).map(e => e.toLowerCase())
    : [];
const ADMIN_PASSPHRASE = (typeof window !== 'undefined' && window.SCOREKEEPER_ADMIN_PASSPHRASE) || null;

const ADMIN_SESSION_KEY = 'scorekeeper_admin_mode';

/** True if admin credentials are configured in config.supabase.js */
export function isAdminConfigured() {
    return !!(ADMIN_EMAILS.length && ADMIN_PASSPHRASE && window.SCOREKEEPER_SERVICE_ROLE_KEY);
}

/** True if the given email is in the configured admin email list */
export function isAdminEmail(email) {
    return !!(email && ADMIN_EMAILS.includes(email.toLowerCase()));
}

/** True if admin mode is currently active for this browser session */
export function isAdminMode() {
    try {
        return sessionStorage.getItem(ADMIN_SESSION_KEY) === 'true';
    } catch { return false; }
}

/** Activate admin mode for this browser session */
export function activateAdminMode() {
    try { sessionStorage.setItem(ADMIN_SESSION_KEY, 'true'); } catch { /* ignore */ }
}

/** Deactivate admin mode */
export function deactivateAdminMode() {
    try { sessionStorage.removeItem(ADMIN_SESSION_KEY); } catch { /* ignore */ }
}

/** Returns true if the entered phrase exactly matches the configured passphrase */
export function verifyAdminPassphrase(phrase) {
    return !!(ADMIN_PASSPHRASE && phrase && phrase.trim() === ADMIN_PASSPHRASE);
}

/**
 * Show the admin passphrase modal.
 * Calls onSuccess() if the phrase is correct, onDismiss() if the user skips.
 */
export function showAdminPassphraseModal(onSuccess, onDismiss) {
    const modal     = document.getElementById('adminPassphraseModal');
    const input     = document.getElementById('adminPassphraseInput');
    const submitBtn = document.getElementById('adminPassphraseSubmit');
    const skipBtn   = document.getElementById('adminPassphraseSkip');
    const errorEl   = document.getElementById('adminPassphraseError');
    if (!modal || !input || !submitBtn || !skipBtn || !errorEl) return;

    input.value = '';
    errorEl.style.display = 'none';
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enter Admin Mode';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 50);

    function handleSubmit() {
        const phrase = input.value;
        if (!phrase.trim()) return;
        if (verifyAdminPassphrase(phrase)) {
            cleanup();
            modal.classList.remove('active');
            onSuccess();
        } else {
            errorEl.style.display = 'block';
            input.value = '';
            input.focus();
        }
    }

    function handleSkip() {
        cleanup();
        modal.classList.remove('active');
        if (onDismiss) onDismiss();
    }

    function handleKey(e) {
        if (e.key === 'Enter')  { e.preventDefault(); handleSubmit(); }
        if (e.key === 'Escape') { e.preventDefault(); handleSkip(); }
    }

    function handleOverlay(e) {
        if (e.target === modal) handleSkip();
    }

    function cleanup() {
        submitBtn.removeEventListener('click', handleSubmit);
        skipBtn.removeEventListener('click', handleSkip);
        input.removeEventListener('keydown', handleKey);
        modal.removeEventListener('click', handleOverlay);
    }

    submitBtn.addEventListener('click', handleSubmit);
    skipBtn.addEventListener('click', handleSkip);
    input.addEventListener('keydown', handleKey);
    modal.addEventListener('click', handleOverlay);
}
