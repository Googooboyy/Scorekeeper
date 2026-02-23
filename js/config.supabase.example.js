// Copy this file to config.supabase.js and add your Supabase credentials
// Get them from: Supabase Dashboard → Settings → API (Project URL and anon public key)
window.SCOREKEEPER_SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
window.SCOREKEEPER_SUPABASE_ANON_KEY = 'your-anon-public-key';

// ── Admin account (optional) ──────────────────────────────────────────────────
// Grants one account full access to view and edit all campaigns.
// No database changes needed — just fill in these three values:
//   1. Your Google login email
//   2. A secret passphrase you'll type after logging in
//   3. Service role key: Supabase Dashboard → Settings → API → service_role (secret key)
window.SCOREKEEPER_ADMIN_EMAIL = ['your-admin-email@example.com']; // single email, or add more: ['a@x.com', 'b@x.com']
window.SCOREKEEPER_ADMIN_PASSPHRASE = 'your secret phrase here';
window.SCOREKEEPER_SERVICE_ROLE_KEY = 'your-service-role-key-here';
