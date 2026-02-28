# Pre-Implementation Review: Games Played & Win %

**Status**: Final review before implementation  
**Decisions confirmed**:
- Migrations: `022_entry_participants.sql`, `023_backfill_entry_participants.sql`
- Profile stats: Separate "Games Played" and "Win Rate" cards; placement at end
- Add-win flow: Option B (single expanded Step 2)
- Player modal: New section listing all games played (per-game breakdown) and total games played

---

## 1. Migration Numbering

**Confirmed**: Use `022_entry_participants.sql` and `023_backfill_entry_participants.sql` for the new migrations.

---

## 2. Add-Win Flow: Option B (Single Expanded Step 2)

**Confirmed**: Combine into one step — "Select winner (required) and other players (optional)" in step2. Two visual groups: Winner (single-select) | Others (multi-select). Add "Continue" button to advance to step3. No new step DOM node.

---

## 3. Profile Stats Layout

**Confirmed**:
- **Separate cards**: "Games Played" and "Win Rate" are two distinct stat cards.
- **Placement**: At the end of the stats row (after Total Wins, Campaigns, Favourite Game).
- **Order**: Total Wins | Campaigns | Favourite Game | Games Played | Win Rate (5 cards total).
- **Grid**: `.profile-stats-row` may need `grid-template-columns: repeat(2, 1fr)` or `repeat(auto-fill, minmax(100px, 1fr))` to accommodate 5 cards; rows will wrap (2+2+1 or similar).

---

## 4. Player Modal — New "Games Played" Section

**New section**:
- **Title**: "Games Played" (or "All Games Played")
- **Content**: Lists all games the player participated in (win or loss), with:
  - Per-game breakdown: game name + count (e.g. "Catan: 8 games", "Ticket to Ride: 5 games")
  - Total games played (summary at top or bottom)
- **Data source**: Entries where player is in `participants` (or fallback: `entry.player`). Group by game, count.
- **Sort**: By games played desc (most played first) or alphabetically.
- **Placement**: After "Wins by Game", before "Recent Wins". Distinct from "Wins by Game" (wins per game).
- **Linked players**: Aggregate across campaigns. Requires RPC or client-side merge of cross-campaign data with participants.
- **Unlinked players**: Current campaign only, from `data.entries`.

**Implementation notes**:
- Reuse `_renderGameBreakdownHtml` pattern but with participation counts instead of win counts.
- For cross-campaign: `get_cross_campaign_player_stats` or a new RPC may need `games_played_per_game`; or derive from `fetchPlayerRecentEntries`-style data with participants. Simpler: for linked, sum participation from campaign stats if RPC returns per-game breakdown; otherwise client-side from fetched entries (linked player may have entries in multiple campaigns — need to fetch entries with participants for all campaigns). Scope: MVP could show current-campaign only for "Games Played" section; cross-campaign in a follow-up if RPC doesn't support it yet.

---

## 5. `resetEntryFlow` and `currentEntry.participants`

**File**: `js/render.js` — `resetEntryFlow()`

Must reset `currentEntry.participants = []` in addition to game, player, date. Prevents stale participants across flows.

---

## 6. Legacy Entries Without Participants — Fallback Logic

**Scenario**: Entries have no `entry_participants` until backfill runs. App must handle:
- Pre-migration: no `entry_participants` table; `fetchEntryParticipants` would fail.
- Post-migration, pre-backfill: table exists but empty; entries have no participants.
- Post-backfill: every entry has at least winner in `entry_participants`.

**Fallback** (use everywhere gamesPlayed is computed):
```javascript
const participated = (e, playerName) =>
  (e.participants && e.participants.includes(playerName)) ||
  (!e.participants && e.player === playerName);
const gamesPlayed = data.entries.filter(e => participated(e, playerName)).length;
```

Apply in: `render.js` (playerStats), `modals.js` (_renderProfileLinked, _renderProfileUnlinked, new Games Played section).

---

## 7. Win % Edge Cases

| Case | Handling |
|------|----------|
| gamesPlayed === 0 | Show "—" or 0%; avoid division |
| wins > gamesPlayed | Cap at 100% (data invariant after backfill) |
| Sort tie-breaker | Primary wins DESC, secondary (winPct \|\| 0) DESC |

---

## 8. Import/Export

- **Export**: Entries will include `participants` from `loadPlaygroupData`. Automatic.
- **Import**: `insertEntry(playgroupId, gameId, playerId, date, participantIds?)`. Default `participantIds = [playerId]` when omitted. If `entry.participants` exists in imported file, map names to IDs and pass.
- **Backward compatibility**: Old exports lack `participants`; import uses winner-only default. No break.

---

## 9. Backfill Impact Analysis

### 8.1 Migration 023: Backfill Logic

```sql
INSERT INTO entry_participants (entry_id, player_id)
SELECT id, player_id FROM entries
ON CONFLICT (entry_id, player_id) DO NOTHING;
```

- **Requires**: UNIQUE(entry_id, player_id) on `entry_participants` for idempotency.
- **Effect**: Every existing entry gets one row: winner as sole participant.
- **Result**: gamesPlayed = wins for all legacy entries; win% = 100% for legacy.

### 8.2 App Behavior Before vs After Backfill

| Phase | entries table | entry_participants | fetchEntries returns | App behavior |
|-------|---------------|--------------------|----------------------|--------------|
| Pre-migration | Has rows | Table does not exist | Entries without participants | App must not call fetchEntryParticipants; use fetchEntries only. Participants undefined. Fallback: `!e.participants && e.player === player` → gamesPlayed = wins. |
| Post-022, pre-023 | Has rows | Table empty | Entries; fetchEntryParticipants returns {} | Merge yields participants: [] for all. Fallback kicks in: gamesPlayed = wins. |
| Post-023 (backfilled) | Has rows | One row per entry (winner) | Entries with participants: [winner] | No fallback needed. gamesPlayed = wins, win% = 100%. |

**Conclusion**: App must deploy with fallback logic so it works in all three phases. No break.

### 8.3 Deployment Order

1. **Run 022**: Create `entry_participants` table.
2. **Run 023**: Backfill (insert winner for each entry).
3. **Deploy app**: New code that fetches participants and uses them.

If app deploys before migrations: `fetchEntryParticipants` will fail (table missing). Mitigation: wrap fetch in try/catch; on error, use empty map so all entries get `participants: []` and fallback applies. Or require migrations-first deploy (standard).

### 8.4 Backfill Idempotency

- Use `ON CONFLICT (entry_id, player_id) DO NOTHING` so re-running 023 does not error.
- UNIQUE(entry_id, player_id) required on `entry_participants`.

### 8.5 Foreign Key and Cascade Behavior

- `entry_participants.entry_id` → `entries(id) ON DELETE CASCADE`: Deleting an entry removes its participants. Good.
- `entry_participants.player_id` → `players(id) ON DELETE CASCADE`: Deleting a player removes their participant rows. Entries where they only participated (didn't win) remain; entries where they won are deleted via entries.player_id. Correct.
- `clearPlaygroupData`: Deletes entries first; cascade removes entry_participants. No code change.
- `deleteEntry`: Deletes one entry; cascade removes its participants. No code change.

### 8.6 fetchEntries / loadPlaygroupData and Missing Table

If 022 has not run, `entry_participants` does not exist. Options:

- **A**: Require migrations before app deploy. Standard.
- **B**: `fetchEntryParticipants` catches error, returns `{}`. `loadPlaygroupData` merges; entries get `participants: []`. Fallback ensures gamesPlayed = wins. Safer for phased rollout.

**Recommendation**: Option B — graceful degradation.

### 8.7 RPC get_cross_campaign_player_stats

Update in migration **024** (after 023). RPC adds `total_games_played` via JOIN to `entry_participants`. After backfill, every entry has participants; RPC returns correct counts. Fallback in RPC: `COALESCE(ep_count, wins)` if needed for edge cases.

### 8.8 Data Consistency After Backfill

- Every entry has ≥1 participant (the winner).
- gamesPlayed ≥ wins always.
- winPct = wins / gamesPlayed; 0 ≤ winPct ≤ 1 (or 100%).
- No division by zero if gamesPlayed computed via fallback (participated count).

### 8.9 Rollback Scenario

If we need to rollback:
- Drop `entry_participants` table.
- App must handle missing table (Option B above).
- Entries and app behavior revert to pre-feature state. No data loss for core entries.

---

## 10. Summary: Backfill Will Not Break the App

| Check | Result |
|-------|--------|
| Backfill adds only winner | Yes; gamesPlayed = wins for legacy |
| Fallback when participants missing | Yes; `!e.participants && e.player === player` |
| Cascade on delete | Yes; no orphaned participant rows |
| Idempotent backfill | Yes; ON CONFLICT DO NOTHING |
| App works pre-backfill | Yes; fallback logic |
| App works if table missing | Yes; graceful error handling recommended |
| RPC runs after backfill | Yes; migration 024 after 023 |
| Import/export compatibility | Yes; default participantIds |

---

## 11. Remaining Items (No Conflicts)

- **clearPlaygroupData / deleteEntry**: Cascade handles entry_participants. No change.
- **Admin dashboard**: Uses raw entries; no participant logic. No change.
- **fetchPlayerRecentEntries**: Winner-centric; no change.
- **lastPlayedDate**: Use participated entries (winner or participant) for "last played" date.
- **Edit entry modal**: Add participants multi-select; reuse tally chip styling.
- **Games Played section**: New player modal section; uses same participation data and fallback as stats.

---

## 12. Final Green Light Checklist

- [x] Migration numbering: 022, 023 (and 024 for RPC)
- [x] Add-win flow: Option B
- [x] Profile stats: Separate Games Played and Win Rate cards at end
- [x] Legacy fallback documented
- [x] Import/export backward compatibility
- [x] Backfill impact analyzed; no breaks identified
- [x] Cascade and FK behavior verified
- [x] Graceful handling when table missing (recommended)
- [x] Player modal: New "Games Played" section with per-game breakdown and total
