---
name: bgg-backed-game-api
overview: Design a small Node-based API layer and local cache on top of BoardGameGeek, suitable for a JAMstack app using React and Node, likely deployed as serverless functions and backed by Supabase.
todos:
  - id: define-db-schema
    content: Design the Supabase/Postgres `games` table (and optional `collections` table) keyed by BGG ID.
    status: pending
  - id: implement-bgg-client
    content: Create a Node helper module that wraps BGG XML/JSON APIs and normalizes responses into the internal game type.
    status: pending
  - id: create-serverless-endpoints
    content: Add JAMstack serverless functions for search, get-by-id, and optional sync/collection endpoints that use the BGG client and DB cache.
    status: pending
  - id: wire-up-react-frontend
    content: Implement a small frontend API client and React hooks/components that talk to the new endpoints instead of BGG directly.
    status: pending
  - id: add-ops-and-guardrails
    content: Add input validation, error handling, basic rate limiting, and logging for BGG interactions and cache refreshes.
    status: pending
isProject: false
---

## BGG-backed API plan for JAMstack/React

### Goal

Build a small, opinionated API layer that:

- Uses **BoardGameGeek (BGG)** as the upstream source of truth.
- Caches a minimal game schema in your own database (Supabase fits well with your current project).
- Exposes **clean JSON endpoints** your React/JAMstack frontend can call without dealing with BGG XML or rate limits directly.

### High-level architecture

- **Frontend (React/JAMstack)**
  - Calls your own endpoints like `/api/games/search`, `/api/games/:bggId`, `/api/collections/:username`.
  - Only deals with your **normalized game model** and your own error formats.
- **Backend/API (Node, ideally serverless functions)**
  - Implemented as functions such as `api/games-search.js`, `api/games-sync.js`, `api/games-get.js`.
  - Each function:
    - Validates inputs.
    - Checks your **local cache** first.
    - Falls back to BGG API (via XML or a JSON wrapper) when needed, then **upserts** into your DB.
- **Database (Supabase/Postgres)**
  - A `games` table with a normalized schema, e.g.:
    - `id` (PK, UUID/serial)
    - `bgg_id` (unique int, main link key)
    - `name`, `year_published`
    - `min_players`, `max_players`, `min_playtime`, `max_playtime`
    - `image_url`, `thumbnail_url`
    - `complexity_weight`, `average_rating` (optional snapshot fields)
    - `last_synced_at`
  - Optionally a `collections` table keyed by `user_id` or BGG username to store the subset of games relevant to your players.

### API surface recommendation

- `**GET /api/games/search?q=...`**
  - Checks your `games` table for matches (ILIKE on `name`).
  - If not enough local hits, calls BGG search (via helper) and stores results.
  - Returns a **short list of games** with IDs/titles/images, ideal for autocomplete.
- `**GET /api/games/:bggId`**
  - Reads from `games` by `bgg_id`.
  - If missing or stale (`last_synced_at` older than e.g. 7 days), fetches fresh details from BGG, upserts, and returns.
- `**POST /api/games/sync`** (optional admin-only)
  - Accepts body like `{ bggIds: [174430, 13, ...] }`.
  - Bulk-fetches from BGG with backoff and stores/updates rows.
  - Useful for seeding or regularly refreshing a curated list.
- `**GET /api/collections/:bggUsername`** (optional, if you want BGG collections)
  - Fetches and caches a user’s BGG collection, creates/updates `games` entries for each item.
  - Returns your normalized `games` rows joined with ownership info.

### BGG integration strategy

- **Helper module** (e.g. `lib/bggClient.js`):
  - Wraps either:
    - BGG XML API (`https://boardgamegeek.com/xmlapi2/...`) using a Node HTTP client + XML-to-JSON parsing, or
    - A trusted JSON proxy (like `bgg-json`) if you prefer to avoid XML.
  - Exposes typed helpers such as:
    - `searchGames(query: string)` → simplified array of `{ bggId, name, year }`.
    - `getGameDetails(bggId: number)` → normalized game object matching your DB schema.
    - `getUserCollection(username: string)`.
  - Implements **rate limiting / sleep** between calls and simple retry logic.

### Data model and mapping

- Define a minimal **internal game type** shared between backend and frontend, for example:
  - `Game { bggId, name, yearPublished, playerRange, playtimeRange, imageUrl, weight, rating }`.
- In the BGG client, convert raw responses into this type before persisting.
- Keep your frontend typed against this narrow shape so you can change upstream APIs without touching React code.

### JAMstack deployment pattern

- If using **Vercel**:
  - Put functions under `api/` (e.g. `api/games-search.js`).
  - Use environment variables for Supabase URL/key and BGG-related config.
- If using **Netlify**:
  - Put serverless functions under `netlify/functions/` and expose similar routes.
- For both:
  - Keep BGG calls server-side only, never from the browser.
  - Use incremental background jobs (cron or scheduled functions) to refresh popular games by `last_synced_at`.

### Frontend integration (React)

- Create a small **API client** in the frontend, e.g. `src/api/games.ts`, with:
  - `searchGames(query: string)` → calls `/api/games/search`.
  - `getGame(bggId: number)` → calls `/api/games/:bggId`.
  - Optional hooks: `useGameSearch`, `useGameDetails` using React Query or SWR for caching.
- Replace any direct BGG links with calls to your API plus links out to `https://boardgamegeek.com/boardgame/{bggId}` for users who want more info.

### Security and robustness

- Validate and sanitize all incoming query params and request bodies.
- Add basic **rate-limiting** (per IP or per user) at the API edge so your BGG usage doesn’t spike.
- Log BGG errors and fall back gracefully (e.g. serve stale data if refresh fails).

### How this fits your current project

- Reuse **Supabase** (you already have `config.supabase.js`) as the storage layer for `games` and any admin tables.
- Add the API files in your JAMstack project (e.g. `api/games-search.js` etc.).
- Use your existing `admin.html` and `admin_tables.sql` patterns as a reference if you want an internal admin view to manage curated game lists or manual overrides.

