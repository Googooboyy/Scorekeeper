# The Scorekeeper

Track your board game wins and bragging rights. A simple web app for running campaigns with friends: log wins, see leaderboards, and share invite or view-only links.

## Features

- **Sign in with Google** — One account, all your campaigns
- **Campaigns (playgroups)** — Create campaigns, invite others via link, leave when you’re done
- **Add wins** — Record which game, who won, and optional notes
- **Leaderboard** — Per-campaign standings; share a read-only leaderboard link
- **History** — Browse and filter past games
- **Data** — Export game data (when signed in)

## Tech

- Static frontend: HTML, CSS, JavaScript (no build step)
- Backend: [Supabase](https://supabase.com) (Auth, Postgres, RLS)
- Migrations in `supabase/migrations/`

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/Googooboyy/Scorekeeper.git
   cd Scorekeeper
   ```

2. **Supabase**
   - Create a project at [Supabase](https://supabase.com)
   - Enable Google sign-in in Authentication → Providers
   - Run the migrations in `supabase/migrations/` (e.g. via Supabase Dashboard SQL editor or CLI)

3. **App config**
   - Copy the example config:
     ```bash
     cp js/config.supabase.example.js js/config.supabase.js
     ```
   - In Supabase: **Settings → API** — copy **Project URL** and **anon public** key
   - Put them in `js/config.supabase.js`:
     - `window.SCOREKEEPER_SUPABASE_URL`
     - `window.SCOREKEEPER_SUPABASE_ANON_KEY`

4. **Run**
   - Open `index.html` in a browser, or serve the folder (e.g. `npx serve .` or any static server).

`js/config.supabase.js` is gitignored; never commit real keys.

## License

Private / unlicensed unless otherwise noted.
