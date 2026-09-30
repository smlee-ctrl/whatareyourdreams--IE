// Supabase project credentials for this static site.
// A plain HTML/CSS/JS site with no build step can't read .env.local (only
// a bundler or server runtime can) — the anon key is meant to be public
// client-side (Supabase enforces access via Row Level Security), so it's
// safe to keep the real values directly here instead.
//
// Fill these in from your Supabase dashboard: Settings > API
window.SUPABASE_URL = "https://your-project-ref.supabase.co";
window.SUPABASE_ANON_KEY = "your-anon-key-here";
