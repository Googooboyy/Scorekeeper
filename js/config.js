// Supabase configuration - set before loading, or replace defaults:
// window.SCOREKEEPER_SUPABASE_URL = 'https://xxx.supabase.co';
// window.SCOREKEEPER_SUPABASE_ANON_KEY = 'your-anon-key';
export const SUPABASE_URL = (typeof window !== 'undefined' && window.SCOREKEEPER_SUPABASE_URL) || 'https://your-project.supabase.co';
export const SUPABASE_ANON_KEY = (typeof window !== 'undefined' && window.SCOREKEEPER_SUPABASE_ANON_KEY) || 'your-anon-key';
