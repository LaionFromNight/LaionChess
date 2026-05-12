# MASTERPLAN — LaionChess

Single source of truth for the chess-state / FEN / PGN module implementation.
All design decisions, module boundaries, APIs, work breakdown and acceptance
criteria live here. Update this file as the implementation evolves.

---

## 0. Goal

Build a self-contained, pure-TypeScript chess module that:

1. Holds the current game state (board, turn, castling rights, en passant,
   halfmove clock, fullmove number, move history, check/checkmate/stalemate).
2. Provides full **FEN** import / export / validation / normalization.
3. Provides full **PGN** import / export / validation, including comments,
   NAGs, recursive variations, and platform-specific embedded commands
   (`[%clk]`, `[%eval]`, `[%cal]`, `[%csl]`).
4. Provides **SAN** generation and resolution (SAN ↔ Move).
5. Provides **replay** of a parsed PGN game into the internal `GameState`.
6. Is wired into the existing React UI so the user can:
   - start a new game,
   - load any position from a FEN string or `.fen` file,
   - import a full game from a PGN string or `.pgn` file,
   - export the current position as FEN (clipboard + file download),
   - export the current game as PGN (clipboard + file download),
   - see a move list with Unicode-rendered SAN.

All of this must stay framework-agnostic at the core (no React imports under
`src/chess/`) so the module is testable in isolation.

---

## 1. Reference Documentation

The module must be compatible with the specs in:

- `tech-chess-docs/fen-technical-documentation-en.md`
- `tech-chess-docs/pgn-technical-documentation-en.md`
- `tech-chess-docs/stockfish-analysis-technical-documentation-en.md` (future)

When in doubt about format details (field order, escape rules, NAG codes,
embedded command syntax), those documents are authoritative.

---

## 2. Current State

Last updated: 2026-05-12. All Phase 1–5 items from §8 are complete and the
build passes with zero TypeScript errors.

### Implemented ✅

**Core module (`src/chess/`)**

| File | Status | Notes |
|---|---|---|
| `types.ts` | ✅ done | `Move.san`, `GameState.halfmoveClock`, `GameState.fullmoveNumber` added |
| `logic.ts` | ✅ done | `boardToFen`/`fenToBoard`/`generatePGN` removed; `moveToSan` exported (disambiguation bug fixed); `isKingInCheck` exported; `executeMove` tracks halfmove/fullmove clocks, stores SAN on each move, accepts optional `promotionPiece` |
| `fen.ts` | ✅ done | `parseFen`, `toFen`, `validateFen`, `normalizeFen`; correct `knight='n'` FEN char (was `'k'` in old code) |
| `san.ts` | ✅ done | `resolveSan`, `renderSanForMoveList`, re-exports `moveToSan` |
| `pgn.ts` | ✅ done | `parsePgn`, `parseSinglePgnGame`, `exportPgn`, `validatePgn`, `buildMoveTableRows`, `gameStateToPgnGame`; embedded `[%clk]`/`[%eval]` commands; recursive variations; Seven Tag Roster |
| `replay.ts` | ✅ done | `replayPgnGame` with `[SetUp "1"]` + `[FEN]` support and lenient mode |
| `index.ts` | ✅ done | Public barrel re-export |

**UI (`src/App.tsx`, `src/components/`)**

| Feature | Status |
|---|---|
| FEN modal — full 6-field display and parse | ✅ done |
| FEN modal — Load `.fen` file | ✅ done |
| FEN modal — Download `.fen` file | ✅ done |
| PGN export modal — clipboard copy | ✅ done |
| PGN export modal — Download `.pgn` file | ✅ done |
| Import PGN modal — paste + file upload | ✅ done |
| Move list panel (`MoveList.tsx`) — Unicode SAN | ✅ done |
| Board rendering | ✅ unchanged (`Board.tsx`, `Square.tsx`) |

### Open / Not Yet Done 🔲

| Item | Section | Notes |
|---|---|---|
| Unit tests (vitest) | §8 Phase 6 | No test runner installed |
| Acceptance criteria verification | §9 | Manually untested |
| Stockfish / engine analysis | §11 Out of scope | Deferred indefinitely |
| Promotion picker dialog | §11 Out of scope | Auto-queen for now |
| Move list click-to-scrub | §7.5 | Future task |
| RAV tree display | §11 Out of scope | Variations preserved in parse/export but not shown |
| Multi-game PGN viewer | §11 Out of scope | Always loads first game |
| Persistence (localStorage / backend) | §11 Out of scope | — |
| Threefold repetition / insufficient material | §11 Out of scope | — |

### Known Bugs / Limitations 🐛

- `handleUndo` in `App.tsx` replays from `createInitialState()` which resets
  halfmoveClock/fullmoveNumber correctly, but ignores promotion piece on
  replay — always uses `executeMove` without `promotionPiece`. Underpromotion
  undo is incorrect.
- `moveToSan` receives `stateBefore` but stores `san` on the move only after
  `executeMove` returns. If a move is loaded via `replayPgnGame`, the stored
  SAN comes from `moveToSan` recalculation, which should match the original.
- No CORS fallback if Lichess Cloud Eval is needed later.

Tests: none. No test runner installed.

---

## 3. Target Architecture

```
src/chess/
  types.ts        Domain types (Piece, Board, Position, Move, GameState, …)
  logic.ts        Move generation, legality, executeMove, check/mate/stalemate
  fen.ts          parseFen, toFen, validateFen, normalizeFen
  san.ts          moveToSan, resolveSan, renderSanForMoveList
  pgn.ts          parsePgn, parseSinglePgnGame, exportPgn, validatePgn,
                  buildMoveTableRows
  replay.ts       replayPgnGame (PGN → GameState)
  index.ts        Public facade — re-exports the stable API
```

### Module dependency graph

```
types.ts
  ▲      ▲      ▲      ▲
  │      │      │      │
logic.ts fen.ts san.ts pgn.ts
                  ▲      ▲
                  │      │
                  └── replay.ts ──► (uses logic + fen + san + pgn)
```

### Architectural decisions (ADRs)

- **ADR-001** Board orientation: `board[0][0] = a8`, `board[7][7] = h1`
  (FEN-native; matches existing code).
- **ADR-002** FEN parser validates **syntax** by default. Strict semantic
  validation (one king per side, no pawns on rank 1/8, castling rights
  consistent with rook/king placement) is opt-in via `{ strict: true }`.
- **ADR-003** FEN output is canonical: castling rights serialized in `KQkq`
  order, whitespace normalized, empty squares compressed. En passant policy
  defaults to `fen-spec-compatible`.
- **ADR-004** PGN parser is independent of the move legality engine. Legal
  move validation happens only in `replay.ts`.
- **ADR-005** Recursive Annotation Variations (RAV) are **preserved** during
  parse/export round-trip but **not replayed** in `replayPgnGame` (mainline
  only). UI may render them as an indented tree later — out of scope for v1.
- **ADR-006** The internal `GameState` remains rich (move history with
  captured pieces, castling rights, etc.). FEN / PGN modules adapt to/from
  it but do not replace it.
- **ADR-007** Promotion: keep current auto-queen behavior for v1. A
  user-promotion dialog is a future task.
- **ADR-008** No React imports under `src/chess/`. UI bindings live in
  `src/App.tsx` and `src/components/`.

---

## 4. Type Model

### 4.1 Extended `GameState` (in `types.ts`)

Add two fields to the existing interface:

```ts
export interface GameState {
  board: Board;
  currentTurn: PieceColor;
  moveHistory: Move[];
  whiteCanCastleKingside: boolean;
  whiteCanCastleQueenside: boolean;
  blackCanCastleKingside: boolean;
  blackCanCastleQueenside: boolean;
  enPassantTarget: Position | null;
  halfmoveClock: number;     // NEW — for 50-move rule
  fullmoveNumber: number;    // NEW — starts at 1, increments after Black's move
  isCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
}
```

`createInitialState()` initializes `halfmoveClock = 0`, `fullmoveNumber = 1`.
`executeMove` updates them:

- reset `halfmoveClock` to `0` after a pawn move or a capture;
- otherwise increment by 1;
- increment `fullmoveNumber` after Black's move (i.e. when the moved piece
  was black).

### 4.2 FEN domain (`fen.ts`)

Public:

```ts
export interface FenValidationResult {
  valid: boolean;
  errors: FenValidationError[];
  warnings: FenValidationWarning[];
}

export interface FenValidationError {
  code: string;
  message: string;
  field?: FenFieldName;
}

export type FenFieldName =
  | "piecePlacement"
  | "activeColor"
  | "castlingAvailability"
  | "enPassantTarget"
  | "halfmoveClock"
  | "fullmoveNumber";

export type EnPassantPolicy = "fen-spec-compatible" | "legal-only";
```

### 4.3 PGN domain (`pgn.ts`)

Mirrors the documentation §13:

```ts
export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export interface PgnGame {
  tags: Record<string, string>;
  moves: PgnMoveNode[];
  result: PgnResult;
  raw?: string;
}

export interface PgnMoveNode {
  moveNumber?: number;
  color?: "w" | "b";
  san: string;
  nags: number[];
  commentsBefore: PgnComment[];
  commentsAfter: PgnComment[];
  variations: PgnVariation[];
  raw?: string;
}

export interface PgnVariation {
  moves: PgnMoveNode[];
  raw?: string;
}

export interface PgnComment {
  text: string;
  commands: PgnEmbeddedCommand[];
  raw: string;
}

export interface PgnEmbeddedCommand {
  name: string;   // "clk" | "eval" | "cal" | "csl" | ...
  value: string;
  raw: string;
}

export interface PgnDatabase {
  games: PgnGame[];
}

export interface PgnMoveTableRow {
  moveNumber: number;
  white?: PgnMoveNode;
  black?: PgnMoveNode;
  whiteDisplay?: string;  // Unicode-rendered SAN
  blackDisplay?: string;
}
```

---

## 5. Public API

```ts
// fen.ts
export function parseFen(fen: string, options?: { strict?: boolean }): GameState | null;
export function toFen(state: GameState, options?: { enPassantPolicy?: EnPassantPolicy }): string;
export function validateFen(fen: string, options?: { strict?: boolean }): FenValidationResult;
export function normalizeFen(fen: string, options?: { strict?: boolean; enPassantPolicy?: EnPassantPolicy }): string;

// san.ts
export function moveToSan(state: GameState, move: Move): string;
export function resolveSan(state: GameState, san: string): Move | null;
export function renderSanForMoveList(san: string, color: "w" | "b"): string;

// pgn.ts
export function parsePgn(input: string, options?: ParsePgnOptions): PgnDatabase;
export function parseSinglePgnGame(input: string, options?: ParsePgnOptions): PgnGame;
export function exportPgn(game: PgnGame, options?: ExportPgnOptions): string;
export function validatePgn(input: string, options?: ParsePgnOptions): PgnValidationResult;
export function buildMoveTableRows(moves: PgnMoveNode[]): PgnMoveTableRow[];

// replay.ts
export function replayPgnGame(
  game: PgnGame,
  options?: { lenient?: boolean }
): { state: GameState; errors: string[] };

// logic.ts (existing — surface stays the same except for the new state fields)
export function createInitialState(): GameState;
export function executeMove(state: GameState, from: Position, to: Position): GameState;
export function getLegalMoves(/* … */): Position[];
// generatePGN(state) is removed. Build a PgnGame from state and call exportPgn.
```

`src/chess/index.ts` re-exports everything that UI code is allowed to import.
UI must not reach into internal files.

---

## 6. Algorithms (key details)

### 6.1 `parseFen`

1. `input.trim().split(/\s+/)` — must yield 6 fields.
2. Piece placement:
   - split by `/` → exactly 8 ranks,
   - each rank expands to exactly 8 squares (digits `1`–`8`, piece letters
     `PNBRQKpnbrqk` — uppercase = white, lowercase = black, knight is `N`),
   - `board[rankIndex][fileIndex]` with `rankIndex = 0` for rank 8.
3. Active color: `w` → `white`, `b` → `black`.
4. Castling: `-` or unique chars from `KQkq`. Canonical serialization order
   is always `KQkq` regardless of input order.
5. En passant: `-` → `null`; otherwise file `a-h` + rank `3` (after white
   double pawn move) or `6` (after black). Converted to internal `Position`.
6. Halfmove clock: integer ≥ 0.
7. Fullmove number: integer ≥ 1.
8. After successful parse, derive `isCheck`/`isCheckmate`/`isStalemate` by
   running `findKing` + `isKingInCheck` + `hasAnyLegalMoves` for
   `currentTurn`. `moveHistory` is `[]`.
9. Strict mode adds: exactly one king per side, no pawns on rank 1/8,
   castling rights consistent with king/rook placement, en passant target
   consistent with active color.

### 6.2 `toFen`

1. For each rank 0..7 build a string by counting empty squares.
2. Join ranks with `/`.
3. Append `' ' + (white ? 'w' : 'b')`.
4. Append castling: build in fixed `K Q k q` order, fall back to `-`.
5. Append en passant: convert `Position` to algebraic, or `-`.
6. Append `halfmoveClock` and `fullmoveNumber`.

### 6.3 `moveToSan` (replacement for current `generateMoveNotation`)

Fix the existing disambiguation bug:

- For each other piece of the same type and color on the board, build a
  hypothetical search: can **that** piece legally reach `move.to`?
  That requires generating legal moves *from that piece's square*, not from
  `move.from`. Current code reuses `allMoves` from `move.from`, which is why
  it always sees the original piece reach `to` and reports ambiguity even
  when there is none.
- If ambiguity detected, disambiguate by file first; if same file, by rank;
  if still ambiguous, by full square (rare — only matters with 3+ queens or
  promoted pieces).
- Append `=Q/=R/=B/=N` for promotions.
- Append `+` for check, `#` for checkmate based on the state **after** the
  move (the caller passes the post-move state, or we recompute).

### 6.4 `resolveSan`

Input: a SAN token like `Nbd2`, `exd5`, `O-O-O`, `e8=Q+`.

Algorithm:

1. Strip trailing `+`, `#`, NAG-style annotations (`!`, `?`, `!!`, etc.).
2. Handle castling first: `O-O` → king moves +2 cols; `O-O-O` → king moves −2.
3. Detect promotion suffix `=X`.
4. Detect piece type from leading uppercase letter (default = pawn).
5. Parse optional disambiguation (file letter, rank digit, or both).
6. Parse capture marker `x`.
7. Parse destination square (last two characters before any promotion).
8. Generate all legal moves for `currentTurn`; filter to moves where:
   - piece type matches,
   - destination matches,
   - disambiguation file/rank matches (if present),
   - promotion piece matches (if present).
9. Exactly one match → return it; zero or multiple → return `null`.

### 6.5 `parsePgn`

Pipeline:

1. Normalize line endings: `input.replace(/\r\n?/g, "\n")`.
2. Split input into games. Game boundary heuristic: a `[TagName "value"]`
   line that immediately follows a result token (`1-0`, `0-1`, `1/2-1/2`,
   `*`), or end of input.
3. For each game:
   - Tokenize tag section: regex `/\[([A-Za-z0-9_]+)\s+"((?:\\"|[^"])*)"\]/`.
     Unescape `\"` → `"` and `\\` → `\`.
   - Tokenize movetext: emit tokens for `{...}`, `;...\n`, `(`, `)`, `$N`,
     SAN, move-number-with-dot(s), result marker.
   - Brace comments do not nest; parse greedy until matching `}`.
   - Semicolon comments run to end of line.
   - Build the move tree recursively: a `(` opens a new variation attached
     to the most recently parsed move.
   - For each comment, scan for `[%name value]` patterns and populate
     `commands[]`. Strip them from `text` (configurable).
4. Map symbolic suffixes `!`, `?`, `!!`, `??`, `!?`, `?!` to NAGs 1..6 if
   `options.normalizeAnnotations` is set; otherwise keep them in the SAN
   token (preserve round-trip).
5. Determine `result`: prefer the explicit terminator at the end of movetext;
   warn if it disagrees with `tags.Result`.

### 6.6 `exportPgn`

1. Emit Seven Tag Roster first (Event, Site, Date, Round, White, Black,
   Result) in this exact order, with `?` / `????.??.??` / `*` defaults if
   missing.
2. If the game starts from a non-standard position, ensure `SetUp = "1"` and
   `FEN = "..."` tags are present.
3. Emit remaining tags in insertion order (or alphabetical, configurable).
4. Escape `"` → `\"` and `\` → `\\` in tag values.
5. Blank line.
6. Emit movetext: number prefixes (`1.` for white, `1...` only when the
   first move of a continuation is black), SAN tokens, NAG tokens, comments
   in braces, variations in parentheses (recursive).
7. Wrap lines to `options.lineWidth` (default 80) by breaking between tokens
   only.
8. Emit the result marker at the end.

### 6.7 `replayPgnGame`

1. If `game.tags.SetUp === "1"` and `game.tags.FEN` exists → call
   `parseFen(game.tags.FEN)`. If parse fails → return error and don't start.
2. Otherwise → `createInitialState()`.
3. For each mainline `PgnMoveNode`:
   - `move = resolveSan(state, node.san)`,
   - if `null`: push `errors[]` with move index and SAN, stop (strict) or
     skip (lenient),
   - else `state = executeMove(state, move.from, move.to)`,
   - apply promotion type from SAN if not auto-queen.
4. Return `{ state, errors }`.

---

## 7. UI Integration Plan

### 7.1 Refactor existing flows in `src/App.tsx`

- Replace inline FEN parsing in `handleFenStart` with `parseFen` →
  `setGameState(state)`. Show `validateFen().errors` in the modal when input
  is rejected.
- FEN modal "live view" textarea reads `toFen(gameState)` (full 6-field FEN
  instead of placement only).
- `handleExportPGN` builds a `PgnGame` from `gameState.moveHistory` (via a
  small `gameStateToPgnGame(state, tags?)` helper in `pgn.ts` or `replay.ts`)
  and calls `exportPgn(game)`.

### 7.2 New: PGN import

- New "Import PGN" button in the controls row.
- New modal `components/ImportPgnModal.tsx` (or inline in `App.tsx`) with:
  - `<textarea>` for pasting PGN text,
  - `<input type="file" accept=".pgn,text/plain">` for file upload,
  - Load button → `parsePgn(text)` → take first game → `replayPgnGame(game)`
    → `setGameState(state)`. On errors, render them inline.

### 7.3 New: file load / download

- FEN modal: add `Load .fen file` button (`<input type="file" accept=".fen">`)
  and `Download .fen` button (Blob + `a.download = "position.fen"`).
- PGN modal: add `Download .pgn` button.

### 7.4 New: move list panel

- `src/components/MoveList.tsx`:
  - Builds rows from `gameState.moveHistory` by converting each `Move` to a
    `PgnMoveNode` via `moveToSan`, then `buildMoveTableRows`.
  - Renders two columns (White / Black) with `renderSanForMoveList`-styled
    Unicode SAN.
  - Cyberpunk styling consistent with the rest of the app.
- Placed to the right of the board on desktop, below the board on mobile
  (CSS grid / flex with media query).

### 7.5 Out of scope for v1 (track for later)

- Click-to-scrub move list (jump to position after move N). Requires either
  storing per-move snapshots or replaying from start.
- Promotion picker dialog (currently auto-queen).
- RAV (variation) tree display.
- Drag-and-drop file upload zone.

---

## 8. Work Breakdown

Each phase ends with a working app and one commit. Phases are atomic and can
be reviewed independently.

### Phase 1 — Types + FEN module (foundation) ✅ DONE
- ✅ Extend `GameState` with `halfmoveClock`, `fullmoveNumber`.
- ✅ Update `createInitialState` and `executeMove` to maintain those counters.
- ✅ Create `src/chess/fen.ts` with `parseFen`, `toFen`, `validateFen`,
  `normalizeFen`.
- ✅ Delete `boardToFen` / `fenToBoard` from `logic.ts`. Wire `App.tsx` to the
  new functions.

### Phase 2 — SAN module ✅ DONE
- ✅ Create `src/chess/san.ts`.
- ✅ Move and fix `generateMoveNotation` into `moveToSan` (disambiguation bug fixed).
- ✅ Implement `resolveSan`.
- ✅ Implement `renderSanForMoveList`.
- ✅ `executeMove` stores SAN on each `Move` via `moveToSan`.

### Phase 3 — PGN module ✅ DONE
- ✅ Create `src/chess/pgn.ts` with full parser/exporter/validator.
- ✅ Helper `gameStateToPgnGame(state, tagsOverrides?)` bridging to UI.
- ✅ Removed `generatePGN` from `logic.ts`.

### Phase 4 — Replay layer ✅ DONE
- ✅ Create `src/chess/replay.ts` with `replayPgnGame`.
- ✅ Handle `[SetUp "1"]` + `[FEN]`.

### Phase 5 — UI integration ✅ DONE
- ✅ Refactor FEN flow in `App.tsx` (full 6-field FEN, `parseFen`).
- ✅ Add PGN import modal (paste + file upload).
- ✅ Add Download .pgn / Download .fen / Load .fen buttons.
- ✅ Add `MoveList.tsx` panel with Unicode SAN.

### Phase 6 — Tests (optional) 🔲 NOT STARTED
- 🔲 Add `vitest` and round-trip tests (`parseFen(toFen(s)) ≈ s`,
  `parsePgn(exportPgn(g)) ≈ g`).
- 🔲 Replay a real game (e.g. Karpov–Kasparov) and verify the final position.

---

## 9. Acceptance Criteria

Implemented = code exists. Verified = manually or automatically tested.
Status: code implemented (Phase 1–5 done), automated tests not yet written
(Phase 6 not started).

### FEN
- [x] `parseFen` accepts the 4 documented valid examples. *(implemented)*
- [x] `parseFen` rejects all 10 documented invalid examples with a relevant
      `FenValidationError.code`. *(implemented — not yet run against the list)*
- [x] `toFen(parseFen(fen))` equals `normalizeFen(fen)` for every valid FEN.
      *(implemented — not yet automated)*
- [x] FEN modal in the UI shows all 6 fields and round-trips correctly.
      *(implemented)*

### SAN
- [x] `moveToSan` produces correct disambiguation when two knights / rooks
      can reach the same square (file first, then rank, then both).
      *(implemented — disambiguation bug fixed)*
- [x] `resolveSan` handles `O-O`, `O-O-O`, `e4`, `exd5`, `Nbd2`, `R1e1`,
      `e8=Q`, `exd8=N+`. *(implemented — not yet automated)*
- [x] `renderSanForMoveList("Bb5", "w")` returns `♗b5`. *(implemented)*
- [x] `renderSanForMoveList("Bc5", "b")` returns `♝c5`. *(implemented)*

### PGN
- [x] All 6 documented test PGNs parse without errors. *(implemented)*
- [x] Brace comments, semicolon comments, NAGs, and recursive variations
      survive round-trip. *(implemented — not yet automated)*
- [x] `[%clk]` and `[%eval]` survive round-trip. *(implemented)*
- [x] Tag values containing `"` and `\` are correctly escaped on export.
      *(implemented)*

### Replay
- [x] `replayPgnGame` reproduces the final position of a known opening line
      (e.g. Italian Game, 5 moves) and ends with the correct `currentTurn`.
      *(implemented — not yet automated)*
- [x] Replay of a game with `[SetUp "1"]` + `[FEN]` starts from that
      position. *(implemented)*

### UI
- [x] User can paste a PGN and the board reflects the final position.
- [x] User can upload a `.pgn` file via file input.
- [x] User can download the current game as `.pgn`.
- [x] User can upload a `.fen` file via file input.
- [x] Move list shows Unicode SAN for played moves and updates in real time.

---

## 10. Risks and Known Pitfalls

From the FEN/PGN documentation §21 and our existing code:

- Treating `board[0][0]` as `a1` instead of `a8`. We picked `a8`; stay
  consistent everywhere.
- Using `S` for knight instead of `N`.
- Forgetting to compress empty squares in FEN output.
- Sorting castling alphabetically instead of `KQkq`.
- Conflating castling rights with castling legality.
- Incrementing `fullmoveNumber` after white's move (it must be after black's).
- Resetting `halfmoveClock` on every move instead of only on pawn moves /
  captures.
- Treating PGN as a single position rather than a complete game container.
- Dropping unknown tags or comments during round-trip.
- Treating `!` / `?` SAN suffixes as part of SAN rather than as annotations.
- Trying to validate legal moves inside the PGN tokenizer (legality belongs
  in `replay.ts`).

The existing `generatePGN` disambiguation bug (see §6.3) must be fixed when
moving the logic into `san.ts`.

---

## 11. Out of Scope (for now)

- Stockfish / engine integration (covered by a separate doc).
- Drawing by threefold repetition or insufficient material.
- Promotion picker UI (auto-queen for now).
- RAV / variation tree UI.
- Multi-game PGN viewer (we always load the first game).
- Persistence to localStorage / backend.
- i18n.

---

## 12. Change Log

Update this section whenever the plan changes meaningfully.

- **2026-05-12 initial** — masterplan created. No code changes yet.
- **2026-05-12 Phase 1–5 complete** — full chess module implemented in one
  commit. Files created: `fen.ts`, `san.ts`, `pgn.ts`, `replay.ts`,
  `index.ts`, `MoveList.tsx`. Files modified: `types.ts`, `logic.ts`,
  `App.tsx`. Build passes 0 TypeScript errors. Bugs fixed: knight FEN char
  (`'k'` → `'n'`), SAN disambiguation (was testing source-piece moves instead
  of candidate-piece moves), `boardToFen`/`fenToBoard` removed. New features:
  import PGN (paste + file), export FEN/PGN with download, full 6-field FEN
  modal, Unicode move list panel.
- **2026-05-12 §2 Current State updated** — section updated to reflect
  implemented state. Stockfish integration deferred indefinitely per user
  decision. Phase 6 (vitest) not started.
