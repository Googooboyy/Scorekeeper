---
name: Help Page Implementation
overview: Create a standalone Help page (help.html) that mirrors the structure of the Hadith sample—fixed sidebar TOC, hero with key highlights, numbered sections—but uses ScoreKpr's dark theme, and re-enable the Help link in the footer.
todos: []
isProject: false
---

# Help Page Implementation Plan

## Understanding

1. **Structure** — Follow the Hadith HTML structure:
  - **Fixed sidebar Table of Contents** (left, ~320px) with hierarchical links (1, 1.1, 1.2, 2, 2.1…)
  - **Mobile TOC** — hamburger toggle, slide-out panel, overlay
  - **Hero section** — full-height intro with title and 4 highlight cards
  - **Main content** — numbered sections and subsections, quote-highlight blocks, tables where useful, gradient section dividers
  - **Smooth scrolling** and active TOC state on scroll
2. **Theme** — Use ScoreKpr's existing dark theme:
  - `styles.css` CSS variables: `--bg-primary`, `--bg-secondary`, `--accent-primary`, `--accent-gold`, etc.
  - Cinzel Decorative for headings, existing typography
  - No Tailwind; inline/page-specific CSS for help-page layout (like ethos/roadmap)
3. **Footer** — In [index.html](index.html) line 494, change:
  - From: `<a href="#" data-coming-soon>Help</a>`
  - To: `<a href="help.html">Help</a>`
  - Remove `data-coming-soon` so events.js no longer shows "Coming soon.." modal
4. **Help content** — A step-by-step walkthrough covering:
  - Getting started (sign in, campaigns)
  - Adding a win (3-step flow, add game/meeple)
  - Leaderboard (meeples, games, celebration pills, meeple profiles)
  - Tally Scores (round-by-round scoring flow)
  - History (view, edit, participants)
  - Data Management (export, import, clear)
  - Personalisation (meeples, games, favourite quotes)
  - Inviting and joining campaigns

---

## Proposed Section Outline


| #   | Section         | Subsections                                                                 |
| --- | --------------- | --------------------------------------------------------------------------- |
| 1   | Getting Started | 1.1 Sign in, 1.2 Create a Campaign, 1.3 Join a Campaign                     |
| 2   | Adding a Win    | 2.1 Select Game, 2.2 Select Winner & Players, 2.3 Select Date               |
| 3   | Leaderboard     | 3.1 Meeple Cards, 3.2 Top Games, 3.3 Meeple Profiles, 3.4 Celebration Pills |
| 4   | Tally Scores    | 4.1 Setup (game, players), 4.2 Scoring Rounds, 4.3 Record Winner            |
| 5   | History         | 5.1 View Entries, 5.2 Edit a Win, 5.3 Participants                          |
| 6   | Data Management | 6.1 Export, 6.2 Import, 6.3 Clear All                                       |
| 7   | Personalisation | 7.1 Meeple Customisation, 7.2 Game Images, 7.3 Favourite Quotes             |


---

## Files to Create/Modify


| File                     | Action                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| [help.html](help.html)   | **Create** — New standalone page with Hadith-like layout, ScoreKpr theme                  |
| [index.html](index.html) | **Modify** — Replace Help footer link (remove `data-coming-soon`, add `href="help.html"`) |


---

## Technical Approach

- **help.html** — Standalone HTML; link `styles.css` for base theme; add page-specific `<style>` block for TOC, hero, section layout (similar to ethos.html pattern)
- **No new JS dependencies** — Vanilla JS for TOC toggle, smooth scroll, active-link highlighting (inline `<script>` like Hadith sample)
- **Back link** — Include "← Back to ScoreKpr" linking to `index.html` (like ethos/roadmap `legal-back`)
- **Responsive** — TOC hidden by default on mobile, hamburger opens overlay + sidebar

### Placeholders for Future Media

- **Image placeholders** — Add `<img>` slots for key steps (e.g. `help-images/add-win-step1.png`) with alt text; user adds screenshots later
- **Video embed placeholders** — Add `<div class="help-video-placeholder">` blocks where embedded video assistance will go (YouTube, Loom, etc.). Use a simple placeholder box with "Video walkthrough coming soon" or similar text; replace with `<iframe>` or `<video>` when ready

---

## Decisions

- **Content depth** — Short and sweet (1–2 paragraphs per subsection)
- **Footer scope** — Only the main index footer links to Help (not ethos, roadmap, contact, etc.)

