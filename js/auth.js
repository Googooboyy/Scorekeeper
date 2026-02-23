import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

let supabase = null;

function getClient() {
    if (!supabase) {
        supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabase;
}

export async function getSession() {
    const { data: { session } } = await getClient().auth.getSession();
    return session;
}

export function isLoggedIn() {
    return getClient().auth.getUser().then(({ data: { user } }) => !!user);
}

export async function signInWithOAuth(provider = 'google') {
    let redirectTo = window.location.origin + window.location.pathname;
    const urlToken = new URLSearchParams(window.location.search).get('invite');
    const inviteToken = getInviteTokenFromStorage() || urlToken;
    if (inviteToken) {
        saveInviteTokenToStorage(inviteToken); // persist before redirect (Supabase may drop query params)
        redirectTo += '?invite=' + encodeURIComponent(inviteToken);
    }
    const { data, error } = await getClient().auth.signInWithOAuth({
        provider,
        options: {
            redirectTo,
            queryParams: { prompt: 'select_account' }
        }
    });
    if (error) throw error;
    return data;
}

/** Get invite token from sessionStorage (for OAuth redirect persistence) */
export function getInviteTokenFromStorage() {
    try {
        return sessionStorage.getItem('scorekeeper_invite_token');
    } catch { return null; }
}

/** Save invite token to sessionStorage before OAuth redirect */
export function saveInviteTokenToStorage(token) {
    try {
        if (token) sessionStorage.setItem('scorekeeper_invite_token', token);
        else sessionStorage.removeItem('scorekeeper_invite_token');
    } catch { /* ignore */ }
}

/** Clear invite token from sessionStorage */
export function clearInviteTokenFromStorage() {
    saveInviteTokenToStorage(null);
}

export async function signOut() {
    const { error } = await getClient().auth.signOut();
    if (error) throw error;
}

export function onAuthStateChange(callback) {
    return getClient().auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
}

export function getSupabase() {
    return getClient();
}
