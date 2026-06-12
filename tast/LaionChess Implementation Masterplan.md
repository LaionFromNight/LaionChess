# LaionChess — Implementation Master Plan (Design → React, page by page)

> **Purpose of this document.** This is a build spec for an implementation agent.
> It maps the finished HTML/CSS/JS **design prototype** onto the existing
> **Vite + React + TypeScript** codebase, screen by screen, reusing the chess
> module that already exists under `src/chess/`. Implement it 1:1 — the prototype
> is the visual source of truth; the React app is the target.
>
> **Golden rule:** do not rebuild chess logic. Everything the UI needs already
> exists in `src/chess/` (`fen`, `san`, `pgn`, `replay`, `tree`, `analysis`,
> `logic`). Only build/port UI + the small client-side feature layer described here.

---

## 0. Two sources, one target

### 0.1 The design prototype (visual source of truth)
A self-contained static prototype lives alongside this plan. Treat its markup,
CSS, and vanilla JS as the canonical look, layout, and interaction model:

| Prototype file | Defines |
|---|---|
| `index.html` | Home / hub |
| `Analysis.html` | Analysis board (eval bar, Common Moves, Top-3 arrows, spotting) |
| `Openings.html` | Course catalog with mini-boards |
| `Trainer.html` | Opening trainer — Learn / Practice |
| `Create Course.html` | Course creator — build line on board, save lines |
| `Master Plan.html` | The in-app roadmap doc |
| `css/laion.css` | **Design tokens** + all shared component styles |
| `css/board.css` | Board renderer styles (squares, pieces, highlights, arrows) |
| `js/theme.js` | **Settings store** — accent, board theme, piece set, toggles (localStorage) |
| `js/settings-menu.js` | The shared ⚙ settings popover |
| `js/board.js` | `LaionBoard` renderer (themes, SVG/Unicode pieces, arrows, highlights) |
| `js/engine.js` | Prototype-only pseudo-engine (**do NOT port** — use `src/chess/` instead) |
| `js/book.js` | Common-Moves "book" table + demo data |
| `js/spotting.js` | Prototype spotting overlay (**do NOT port** — `src/chess/analysis.ts` is richer) |
| `js/scotch-lines.js` | Scotch course content with coach notes |
| `js/trainer.js`, `js/creator.js` | Reference interaction logic for Trainer / Creator |

### 0.2 The existing app (target)
```
src/
  chess/      types, logic, fen, san, pgn, replay, tree, analysis, index   ← REUSE, do not rewrite
  components/ Board, Square, MoveList, PromotionPicker, SpottingPanel        ← extend
  App.tsx     single-page shell, all views, modals                          ← refactor + extend
  App.css     view styles                                                    ← align to css/laion.css tokens
```
The app is already a single-page router via `activeView` state
(`'home' | 'analysis' | 'openings' | 'trainer' | 'create' | 'master'`). Keep this
pattern. Keep deployment under `/LaionChess/` (Vite `base`).

### 0.3 What already works (do not regress)
- **New / Import modal** with three paths: Standard start, **Load from PGN**
  (paste + `.pgn` file), **Load from FEN** (paste + `.fen` file). `openNewGame()`
  + `ngView` state in `App.tsx`. ⚠️ **This is the "import party" the user wants
  kept on Analysis — see §3.**
- Export modal (FEN/PGN copy + download, folded-opening JSON).
- Game tree with variations, animated piece movement, keyboard nav, autoplay.
- Spotting overlay (`buildSpottingOverlay`) with all modes
  (`dalmacja`, `lufycfer`, `king-path`, `king-shot`, `eye-*`) and `SpottingPanel`.
- Folded-opening JSON export (`buildFoldedOpeningJson`, schema
  `laionchess.folded-opening.v1`).

### 0.4 What this plan adds (the gap)
1. **Settings layer** — board theme, piece set, UI accent, arrows/coords toggles,
   persisted; a shared ⚙ popover on every board screen. (§1, §2)
2. **SVG piece sets** rendered on the board (today pieces are Unicode glyphs). (§2)
3. **Eval bar** beside the board on Analysis + Create. (§3, §5)
4. **Common Moves (opening book)** panel on Analysis, Trainer, Create. (§7)
5. **Top-3 arrows** toggle (draws book's three most-played moves as arrows). (§3, §7)
6. **Guided Trainer** — per-move coach notes, hint arrows, mistake tracking,
   completion banner, per-mode progress persistence. (§4)
7. **"Analysis →" handoff** from Trainer/Create that opens Analysis at the
   current position. (§3, §4, §5)

Everything else is faithful re-skinning of views you already have.

---

## 1. Phase 1 — Design tokens & the settings store (foundation)

### 1.1 Port the tokens
Copy the CSS custom properties from `css/laion.css` (`:root { … }` + the
`html[data-accent="…"]` overrides) into `src/index.css`. These drive the whole
UI: `--bg-0/1/2`, `--panel`, `--line`, `--text*`, the neon palette
(`--cyan/green/magenta/yellow/orange/red`), `--accent` + `--accent-soft` +
`--accent-border`, and the `--mono` / `--sans` font stacks. Port the `.bg-grid`
and `.bg-scan` background layers too (already present in `App.tsx`).

`data-accent` is set on `<html>` and switches the accent group. Keep that
mechanism exactly.

### 1.2 Settings model + persistence
Create `src/settings/useSettings.ts` (React context + hook) mirroring
`js/theme.js`:

```ts
type Accent = 'cyan' | 'green' | 'magenta' | 'amber';
type BoardTheme = 'classic' | 'neon' | 'forest' | 'ice';
type PieceSet = 'classic' | 'merida' | 'alpha' | 'glyph';

interface UiSettings {
  accent: Accent;        // default 'cyan'  → sets document.documentElement.dataset.accent
  boardTheme: BoardTheme;// default 'classic'
  pieceSet: PieceSet;    // default 'classic'
  arrows: boolean;       // default true  — training/Top-3 arrows visible
  coords: boolean;       // default true  — board coordinates visible
}
```

- Persist under **`localStorage['laionchess-ui-settings']`** (same key as the
  prototype, so designs and app stay interchangeable).
- On change of `accent`, set `document.documentElement.dataset.accent`.
- Expose `BOARD_THEMES` and `PIECE_SETS` maps (copy values verbatim from
  `js/theme.js` §`BOARD_THEMES`/`PIECE_SETS`): each board theme is
  `{ label, light, dark, coordL, coordD }`; each piece set is either
  `{ kind:'img', dir }` or `{ kind:'glyph' }`.
- Wrap `<App/>` in the provider in `main.tsx`.

### 1.3 The shared settings popover
Port `js/settings-menu.js` as `src/components/SettingsMenu.tsx`:
- A ⚙ icon button (`.btn .btn-icon .btn-ghost`) that toggles a `.menu` popover.
- Sections: **Board Theme** (radio list), **Piece Set** (radio list),
  **UI Accent** (4 color swatches), **Trainer** (toggles: *Training arrows*,
  *Coordinates*). Match `.menu / .menu-item / .swatch-row / .swatch` styles from
  `css/laion.css`.
- Each control calls the corresponding `setSetting`.
- Mount it in the header `nav-actions` (all views) and in the board-screen panel
  toolbars (Trainer, Create, Analysis), exactly where the prototype puts the gear.

**Acceptance:** changing any setting persists across reload and is reflected on
every board on the page immediately; accent recolors the whole UI.

---

## 2. Phase 2 — Board renderer: themes + SVG piece sets

The board currently renders Unicode pieces via `getPieceLabel`. Extend
`components/Board.tsx` + `components/Square.tsx` to honor settings. Reference
`css/board.css` and `js/board.js`.

### 2.1 Board theming
- Read `boardTheme` from settings; set CSS variables on the board root:
  `--sq-light`, `--sq-dark`, `--coord-on-light`, `--coord-on-dark` from the
  chosen `BOARD_THEMES` entry. `Square.tsx` light/dark uses these vars.
- Gate coordinate labels on `settings.coords`. Keep the existing
  `board[0][0] = a8` orientation (ADR-001).

### 2.2 Piece sets
- Add `src/board/pieceSrc.ts`:
  ```ts
  // returns an <img src> for img sets, or null for the glyph set
  function pieceSrc(pieceSet, color: 'w'|'b', type): string | null
  ```
- For `kind:'img'` sets, render `<img>` (no tinting; SVGs are full-color).
  For `glyph`, keep the current `getPieceLabel` Unicode rendering as the
  zero-asset fallback.
- **Bundle the SVGs locally** under `public/pieces/<set>/<code>.svg`
  (codes `wK,wQ,wR,wB,wN,wP,bK,…`). The prototype points at a CDN for
  convenience; production must self-host. Use the open **cburnett** (CC BY-SA),
  **merida**, and **alpha** sets and ship `public/pieces/LICENSES.md`.
- Keep `AnimatedPiece` working: it must render the same way (img or glyph)
  while sliding.

**Acceptance:** all four piece sets and four board themes render correctly on
every board (full board, mini-boards, animation), with no console errors.

### 2.3 Arrows on the board
`js/board.js` exposes `addArrow(from, to, color, width)` / `clearArrow()` drawn
in an SVG overlay in board %-space. Add an **arrows overlay layer** to
`Board.tsx` (separate `<svg viewBox="0 0 100 100">`, above pieces, below the
interactive/promotion overlay) and a small imperative or prop-driven API:
`arrows: { from, to, color, width }[]`. Used by Top-3 (§7) and Trainer hints (§4).

---

## 3. Phase 3 — Analysis view (the most-used screen)

Target: `activeView === 'analysis'` block in `App.tsx`. Visual reference:
`Analysis.html`.

Layout: **eval bar | board | right panel**. The board column already exists;
add the eval bar to its left and a right-hand analysis panel.

### 3.1 KEEP: "New" opens import (explicit user requirement)
On Analysis, the header **`⟳ New / Import`** button (and any board-local "New")
must call the existing `openNewGame()` → New/Import modal with the **choice →
PGN → FEN** flow already implemented (`ngView`, `loadFromPgn`, `loadFromFen`,
`.pgn`/`.fen` file inputs). **Do not** replace it with a plain "reset to start".
The prototype's `New` button is only a placeholder; the real behavior is the
existing modal. Verify: New → Load from PGN → paste a game → board shows the
final position and the move list/tree fills in.

### 3.2 Eval bar
- Component `src/components/EvalBar.tsx` styled per `.eval-bar` in `css/laion.css`
  (vertical, white share grows from bottom, numeric label).
- **v1 source = material balance** computed from `displayedState.board` (sum of
  piece values, white positive). This matches the honest prototype behavior.
- Map score → fill height: `50 + clamp(score*6, -45, 45)` percent. Show
  `+x.x` / `-x.x`.
- Toggle: **Evaluation** switch in the panel (default on). When off, hide the bar.
- **Hook point for real engine:** isolate the score behind
  `getEvaluation(state): number`. A later Stockfish/Lichess-cloud integration
  swaps this function only (see `tech-chess-docs/stockfish-analysis-…md`).

### 3.3 Right panel
Per `Analysis.html` `.an-panel`:
- Title row + "Full engine app ↗" link (optional external link to the live
  Stockfish app, if desired).
- **Toggles** (styled `.toggle`): *Evaluation*, *Common moves*, *Top 3 arrows*.
- **Move list** — reuse existing `MoveList.tsx` (tree-aware, click to navigate).
  Keep the existing transport controls (`⏮ ◀ ▶ ⏭`, Play, speeds) and board-size
  control already present.
- **Common Moves** book table — see §7.
- FEN/PGN quick row (reuse existing export logic; the full Export modal stays).

### 3.4 Spotting panel
Keep `SpottingPanel` to the left of the board (already wired). It stays available
on Analysis, Trainer, and Create — the user explicitly wants spotting always
reachable. Modes persist via `spottingModes` state; **also** persist the set to
`localStorage['laionchess-ui-settings'].spotModes` so a mode chosen on Analysis
is still active when entering the Trainer (mirror `js/spotting.js` persistence).

### 3.5 Top-3 arrows
A toggle that, when on, draws the book's top-3 moves for the current position as
board arrows (colors: #1 green, #2 yellow, #3 magenta; width tapers). See §7.3.

**Acceptance:** New→PGN import works; eval bar reflects material and toggles;
Common Moves updates each move and clicking a row plays it; Top-3 arrows draw and
update; spotting modes work and persist into the Trainer.

---

## 4. Phase 4 — Trainer view (Learn / Practice)

Target: `activeView === 'trainer'`. Visual + interaction reference:
`Trainer.html` + `js/trainer.js` + content in `js/scotch-lines.js`.

The current trainer panel is static (loads a line, replays it). Upgrade it into
the guided experience from the prototype.

### 4.1 Course content model
Replace the bare `SCOTCH_LINES` (sans-only) with the richer structure from
`js/scotch-lines.js`. Add coach notes per **user** move:

```ts
interface CoursePly { san: string; from: Square; to: Square; promo?: string; note?: string }
interface CourseLine { id: string; name: string; tag: 'Main'|'Sideline'|'Trap'|'Punish'; plies: CoursePly[] }
interface Course { id; name; author; playAs: 'w'|'b'; description; lines: CourseLine[] }
```
Ship the Scotch course as `public/courses/scotch-game.json` (port the 6 lines and
notes verbatim from `js/scotch-lines.js`). Load it at runtime. Resolve/validate
each ply with `resolveSan` + `executeMove` so the data stays engine-consistent.

### 4.2 Trainer state machine (from `js/trainer.js`)
```
start line → promptUser
promptUser → (user plays expected move) → animate → opponent auto-replies → promptUser
promptUser → (wrong move) → flash red, mistakes++ → promptUser
promptUser → (no plies left) → completeLine → save progress
```
- **Learn mode:** show the coach `note`, a hint **arrow** (gated on
  `settings.arrows`), and highlight the source square before each user move.
- **Practice mode:** no hints; arrow only via the **Hint** button (sets
  `hintUsed`, marks the run imperfect); count mistakes.
- Validate the user's click against the expected ply only (repertoire training —
  no full legality search needed; the move is already known-legal).
- Opponent's reply is the next ply, auto-played after a short delay.

### 4.3 Panel UI (per `Trainer.html`)
- Header: mode name • course • line number.
- **Coach** bubble (avatar ♘ + speech bubble) showing the current note / feedback.
- **Mode tabs:** 📖 Learn / 🎯 Practice (each shows `done/total` lines). Locked
  🔥 Drill / ⏳ Time tabs (disabled, "learn 3 lines to unlock") as future SRS.
- **Lines list:** each row shows ✓/○ status, name, tag. Click loads the line.
- Progress bar above the board (moves done / total user moves).
- Toolbar: ⚙ settings, ↻ Restart, **Analysis →** (see §4.5), 💡 Hint.
- **Completion banner** on finishing a line (✓ Line Complete, perfect-run note,
  Next line / Replay buttons).

### 4.4 Progress persistence
Persist under **`localStorage['laionchess-scotch-progress']`** as
`{ learn: {lineId:true}, practice: {lineId:true} }` (same shape/key as the
prototype, so Home's "continue training" and Openings' progress read it too).

### 4.5 Analysis handoff
**Analysis →** button: stash the current board position and switch
`activeView` to `'analysis'`, loading that position into a fresh tree
(`applyNewTree(createGameTree(parseFen(fen)), null)`). The prototype passes a FEN
string; in-app you can pass the `GameState`/FEN directly. This lets a user break
out of a line to analyze freely at any point.

**Acceptance:** Learn walks a full line with notes+hints; wrong moves flash and
don't advance; Practice hides hints and counts mistakes; completing a line ticks
it ✓ and persists; Hint draws an arrow; Analysis → opens the current position.

---

## 5. Phase 5 — Create Course view

Target: `activeView === 'create'`. Reference: `Create Course.html` + `js/creator.js`.
Most of this exists already (build line on the board, undo/clear, save folded
JSON). Bring it to parity with the prototype:

- Add the **eval bar** (§3.2) and **Common Moves** (§7) and **Top-3** toggle
  beside the creator board (same components as Analysis).
- Keep the existing **course name** input (auto-save indicator), **play-as**
  segmented control (`courseSide`), **current line** strip, **saved lines** list
  (from `terminalPaths`), and **Save JSON** (`downloadFoldedOpening`).
- Keep the **PGN / FEN import** disclosure that reuses the New/Import modal
  (`setNgView('pgn'|'fen')`). This is the same import-party path as Analysis.
- Add an **Analysis →** button (hand the current position to Analysis, §4.5).
- Mount the ⚙ settings popover and the `SpottingPanel`.

**Acceptance:** building moves on the board grows the line; Save JSON produces a
valid `laionchess.folded-opening.v1` file; eval/book/Top-3/spotting all present;
import modal works.

---

## 6. Phase 6 — Home, Openings, Master Plan views (re-skin)

### 6.1 Home (`index.html`)
Already implemented. Verify against the prototype: hero, three feature cards
(Analysis / Trainer / Creator), and the **Continue training** card whose progress
reads `localStorage['laionchess-scotch-progress']`. Wire its mini-board through
the themed renderer (§2).

### 6.2 Openings catalog (`Openings.html`)
Already implemented with `COURSES` + `MiniBoard`. Bring to parity:
- Render mini-boards with the themed board renderer + chosen piece set (§2),
  not raw `getPieceLabel`, so the catalog respects settings.
- Show real per-course progress for Scotch from
  `localStorage['laionchess-scotch-progress']` (learned/total). Planned courses
  show "Coming soon" and are non-clickable.
- Search box filters by name (exists).

### 6.3 Master Plan view (`Master Plan.html`)
Keep the in-app `'master'` view as a short roadmap summary (it already exists).
This MD file is the full spec; the in-app view can link/refer to it. No heavy
work — just keep its content current with the phases below.

---

## 7. The Common-Moves "book" feature (shared)

Reference: `js/book.js`. Used on Analysis, Trainer, Create.

### 7.1 Data
- Book is keyed by **board placement + side to move** (`"<placement> <w|b>"`).
- Each entry: `[san, played%, gamesLabel, whiteWin%, draw%]` (black% = remainder).
- Ship as `public/book/openings.json` (port the demo map from `js/book.js`;
  expand later). Provide a `lookup(key): Row[] | null` helper.
- Derive the key from `displayedState` via `toFen` (take fields 1–2).

### 7.2 Table component
`src/components/CommonMoves.tsx` styled per `.book / .book-row / .bar` in
`css/laion.css`: move • played% • games • a win/draw/loss bar. Clicking a row
plays that move (resolve via `resolveSan(displayedState, san)` → `doTreeMove`).
Empty state when no data for the position.

### 7.3 Top-3 arrows
When the **Top 3 arrows** toggle is on, take the first three book rows for the
current position, resolve each SAN to `{from,to}`, and feed the board arrows
layer (§2.3): `#1` green `rgba(0,255,136,.9)` w2.8, `#2` yellow w2.2,
`#3` magenta w1.7. Re-render on every position change. Hide when toggle off or
no data.

**Acceptance:** book table and Top-3 arrows update on every move and reflect the
current position; clicking a row advances the game.

---

## 8. Cross-cutting acceptance checklist

- [ ] All six views match the prototype on desktop (~1440px) and mobile.
- [ ] Settings (accent, board theme, piece set, arrows, coords) persist and apply
      on every board, every view; ⚙ popover present on all board screens.
- [ ] Four piece sets self-hosted under `public/pieces/` with licenses.
- [ ] **Analysis "New" still opens the PGN/FEN import modal** (not a bare reset).
- [ ] Eval bar (material v1) on Analysis + Create, toggleable.
- [ ] Common Moves table on Analysis + Trainer + Create; clicking a row plays it.
- [ ] Top-3 arrows toggle works and updates per position.
- [ ] Spotting modes work on all three board screens and persist across views.
- [ ] Trainer Learn/Practice flow: coach notes, hint arrows, mistake flashes,
      completion banner, per-mode progress persisted.
- [ ] "Analysis →" handoff from Trainer + Create opens the current position.
- [ ] No TypeScript errors; no console errors; `src/chess/` untouched except
      additive helpers.

---

## 9. Suggested commit order (each leaves a working app)

1. **Tokens + settings store + ⚙ popover** (§1) — no visual regressions.
2. **Themed board + SVG piece sets** (§2) — pieces/themes switch live.
3. **Analysis panel**: eval bar + Common Moves + Top-3 + keep import (§3, §7).
4. **Trainer** guided Learn/Practice + progress + Analysis handoff (§4).
5. **Create** parity: eval/book/Top-3/spotting/analysis-handoff (§5).
6. **Home / Openings / Master** re-skin + themed mini-boards + real progress (§6).
7. Polish: mobile passes, completion effects, optional move sounds.

---

## 10. Explicit "reuse, don't rebuild" API map

UI imports only from `src/chess/index.ts`. Available surface (already built):

```ts
// logic.ts
createInitialState(): GameState
executeMove(state, from, to, promotionPiece?): GameState
getLegalMoves(board, pos, ep, wK, wQ, bK, bQ): Position[]
findKing(board, color): Position | null
isKingInCheck(board, color): boolean
getPieceLabel(piece): string            // Unicode fallback / glyph set

// fen.ts
parseFen(fen, {strict?}): GameState | null
toFen(state, {enPassantPolicy?}): string
validateFen(fen): FenValidationResult
normalizeFen(fen): string

// san.ts
moveToSan(state, move): string
resolveSan(state, san): Move | null      // USE for book rows + course plies
renderSanForMoveList(san, 'w'|'b'): string

// pgn.ts
parsePgn(input): PgnDatabase
exportPgn(game): string
buildMoveTableRows(moves): PgnMoveTableRow[]
gameStateToPgnGame(state, tags?): PgnGame

// replay.ts
replayPgnGame(game, {lenient?}): { state, errors }

// tree.ts
createGameTree, addNode, getNodeState, findChildByMove,
getMainLineTip, getPathToNode, deleteSubtree,
pgnGameToTree, treeToPgnGame   // (GameTree)

// analysis.ts  — power the SpottingPanel (already wired in App.tsx)
type SpottingMode = 'none'|'eye-full'|'eye-1'|'eye-2'|'eye-white'|'eye-black'
                  | 'dalmacja'|'lufycfer'|'king-path'|'king-shot'
getAttackedSquares, computeDefenseEdges, computeExchanges
```

New code added by this plan (UI-only):
`settings/useSettings.ts`, `components/SettingsMenu.tsx`, `components/EvalBar.tsx`,
`components/CommonMoves.tsx`, `board/pieceSrc.ts`, board arrows layer, the Trainer
state machine, and static data under `public/` (`pieces/`, `courses/`, `book/`).

---

## 11. Out of scope for this pass (track for later)
- Real engine evaluation (Stockfish/Lichess cloud) — keep the `getEvaluation`
  seam from §3.2.
- SRS Drill/Time trainer modes (the locked tabs).
- Authoring courses other than Scotch (ship JSON files over time).
- Backend persistence / accounts (all state is localStorage for now).
- i18n (UI stays English, matching the current app).
