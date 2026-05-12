# Technical Documentation: PGN Notation for Full Chess Game Import and Export

## 1. Purpose

This document describes **PGN** (*Portable Game Notation*) and proposes a TypeScript implementation for importing and exporting complete chess games.

The goal is to support:

1. reading full games from PGN text,
2. exporting internal game state back to PGN,
3. preserving standard PGN tags,
4. preserving move text,
5. preserving comments,
6. preserving Numeric Annotation Glyphs,
7. preserving recursive variations,
8. preserving engine/platform annotations such as Chess.com or Lichess clock/evaluation annotations inside comments,
9. supporting FEN-based non-standard starting positions.

This document is designed for AI agents and developers implementing chess import/export, game archives, chess viewers, chess editors, training tools, analysis tools, and integrations with platforms such as Chess.com, Lichess, or chess engines.

---

## 2. What PGN Is

**PGN** is a plain-text notation for storing complete chess games.

Unlike FEN, which stores only a single position, PGN stores:

- metadata about the game,
- move sequence,
- result,
- optional comments,
- optional annotations,
- optional variations,
- optional clock/evaluation data embedded in comments.

A minimal PGN game:

```pgn
[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 *
```

---

## 3. PGN File Structure

A PGN game consists of two main sections:

```text
<tag-pair section>

<movetext section>
```

Example:

```pgn
[Event "Casual Game"]
[Site "Chess.com"]
[Date "2026.05.12"]
[Round "?"]
[White "PlayerA"]
[Black "PlayerB"]
[Result "1-0"]

1. e4 {Best by test.} e5 2. Nf3 Nc6 3. Bb5 a6 1-0
```

A PGN file may contain multiple games one after another.

---

## 4. Tag Pair Section

The tag pair section contains metadata in this format:

```pgn
[TagName "Tag value"]
```

Example:

```pgn
[White "Magnus Carlsen"]
```

### 4.1 Seven Tag Roster

The standard required tags are known as the **Seven Tag Roster**:

```pgn
[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]
```

These seven tags should always be exported first and in exactly this order:

1. `Event`
2. `Site`
3. `Date`
4. `Round`
5. `White`
6. `Black`
7. `Result`

### 4.2 Unknown Values

Use `?` when a value is unknown:

```pgn
[White "?"]
```

Use `????.??.??` for an unknown date:

```pgn
[Date "????.??.??"]
```

Use `*` for an unfinished or unknown result:

```pgn
[Result "*"]
```

### 4.3 Common Optional Tags

Useful optional tags include:

```pgn
[WhiteElo "1850"]
[BlackElo "1800"]
[TimeControl "600+5"]
[ECO "C20"]
[Opening "King's Pawn Game"]
[Termination "Normal"]
[Annotator "AI Agent"]
[Variant "Standard"]
```

### 4.4 FEN and SetUp Tags

For games that do not start from the standard initial chess position, use:

```pgn
[SetUp "1"]
[FEN "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"]
```

Rules:

- If `SetUp` is `"1"`, the `FEN` tag should be present.
- If `SetUp` is missing or `"0"`, the game starts from the standard initial position.
- The move numbers in movetext must be interpreted relative to the FEN position.

---

## 5. Movetext Section

The movetext section stores the moves of the game.

Example:

```pgn
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
```

Movetext may contain:

- move numbers,
- SAN moves,
- game result marker,
- comments,
- NAG annotations,
- recursive variations.

---

## 6. Move Numbers

Move numbers appear as:

```pgn
1.
1...
```

Meaning:

```pgn
1. e4
```

White's first move.

```pgn
1... e5
```

Black's first move.

A parser should generally tolerate move numbers and use them mostly as structural hints. The real move sequence is represented by SAN move tokens.

---

## 7. SAN Moves

PGN uses **SAN** (*Standard Algebraic Notation*) for moves.

Examples:

```pgn
e4
Nf3
Bb5
O-O
O-O-O
exd5
Qxe7+
Rfe1
c8=Q
exd8=N+
Qh5#
```

### 7.1 Supported SAN Features

A PGN parser should support:

| Feature | Example |
|---|---|
| Pawn move | `e4` |
| Piece move | `Nf3` |
| Capture | `Bxe6` |
| Check | `Qh5+` |
| Checkmate | `Qh5#` |
| Kingside castling | `O-O` |
| Queenside castling | `O-O-O` |
| Promotion | `e8=Q` |
| Promotion with capture | `exd8=N+` |
| Disambiguation by file | `Nbd2` |
| Disambiguation by rank | `R1e1` |
| Disambiguation by square | `Qh4e1` |

### 7.2 SAN Validation Strategy

There are two implementation modes:

1. **Syntax-only parsing**
   - parse and preserve the SAN string,
   - do not verify whether the move is legal.

2. **Legal move parsing**
   - use the current board state,
   - generate all legal moves,
   - match SAN against generated legal moves,
   - update position after each move.

Recommendation:

- the PGN parser should be able to parse syntax without a chess engine,
- full import into game state should use a legal move engine,
- export should generate SAN from legal move objects whenever possible.

---

## 8. Game Termination Marker

The movetext must end with one of these result markers:

```text
1-0
0-1
1/2-1/2
*
```

The result marker should match the `[Result "..."]` tag.

Valid examples:

```pgn
[Result "1-0"]

1. e4 e5 2. Qh5 Ke7 3. Qxe5# 1-0
```

```pgn
[Result "*"]

1. e4 e5 *
```

If the result marker and the `Result` tag differ, the parser should produce a warning or error depending on strictness.

---

## 9. Comments

PGN supports two main comment styles.

### 9.1 Brace Comments

Brace comments start with `{` and end with `}`:

```pgn
1. e4 {This is a comment.} e5
```

Rules:

- brace comments do not nest,
- a `{` inside a brace comment is treated as text,
- comments should be preserved when importing/exporting.

### 9.2 Semicolon Comments

A semicolon starts a comment until the end of the line:

```pgn
1. e4 ; this comment runs to the end of the line
e5
```

Recommendation:

- parser should support semicolon comments,
- exporter should prefer brace comments for portability.

---

## 10. Numeric Annotation Glyphs

PGN supports **NAGs** (*Numeric Annotation Glyphs*) using `$` followed by a number:

```pgn
1. e4 $1 e5 $2
```

Common NAGs:

| NAG | Symbol | Meaning |
|---:|---|---|
| `$1` | `!` | good move |
| `$2` | `?` | mistake |
| `$3` | `!!` | brilliant move |
| `$4` | `??` | blunder |
| `$5` | `!?` | interesting move |
| `$6` | `?!` | dubious move |
| `$10` | `=` | equal position |
| `$13` | `∞` | unclear position |
| `$14` | `+=` | White has slight advantage |
| `$15` | `=+` | Black has slight advantage |
| `$16` | `±` | White has moderate advantage |
| `$17` | `∓` | Black has moderate advantage |
| `$18` | `+-` | White has decisive advantage |
| `$19` | `-+` | Black has decisive advantage |

### 10.1 Human-Friendly Annotation Aliases

Many PGN files use these aliases directly after moves:

```pgn
e4!
e5?
Nf3!!
Nc6?!
```

Recommended parser behavior:

- treat suffix `!`, `?`, `!!`, `??`, `!?`, `?!` as annotation aliases,
- convert them internally to NAGs if canonical storage is needed,
- preserve the original spelling if round-trip fidelity matters.

Suggested mapping:

```ts
const SYMBOL_TO_NAG = {
  "!": 1,
  "?": 2,
  "!!": 3,
  "??": 4,
  "!?": 5,
  "?!": 6,
} as const;
```

---

## 11. Recursive Annotation Variations

PGN supports variations inside parentheses:

```pgn
1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6
```

These are called **RAV** (*Recursive Annotation Variations*).

A variation can contain:

- move numbers,
- SAN moves,
- comments,
- NAGs,
- nested variations.

Example:

```pgn
1. e4 e5 (1... c5 {Sicilian.} 2. Nf3 d6) 2. Nf3 Nc6 *
```

Recommendation:

- store variations as child move lines attached to the previous move or to the current ply context,
- preserve variation structure even if legal move validation is not enabled.

---

## 12. Platform-Specific Comment Annotations

Chess platforms often place machine-readable annotations inside PGN comments.

Examples:

```pgn
{[%clk 0:09:58]}
{[%eval 0.34]}
{[%clk 0:05:01] [%eval -1.25]}
{[%emt 0:00:03]}
```

Common embedded commands:

| Command | Example | Meaning |
|---|---|---|
| `%clk` | `[%clk 0:09:58]` | remaining clock time |
| `%emt` | `[%emt 0:00:03]` | elapsed move time |
| `%eval` | `[%eval 0.34]` | engine evaluation |
| `%cal` | `[%cal Ge2e4,Rf1e1]` | colored arrows |
| `%csl` | `[%csl Ye4,Rd5]` | colored highlighted squares |

These are not part of the core Seven Tag Roster, but they are widely used by Chess.com, Lichess, chess GUIs, and analysis tools.

### 12.1 Recommended Handling

The parser should:

1. preserve the raw comment text,
2. optionally extract embedded commands into structured metadata,
3. export both human comments and embedded commands.

Example internal structure:

```ts
interface PgnComment {
  text: string;
  commands: PgnEmbeddedCommand[];
}

interface PgnEmbeddedCommand {
  name: string;
  value: string;
  raw: string;
}
```

Example:

```pgn
{Interesting move. [%clk 0:09:58] [%eval 0.34]}
```

Parsed as:

```ts
{
  text: "Interesting move.",
  commands: [
    { name: "clk", value: "0:09:58", raw: "[%clk 0:09:58]" },
    { name: "eval", value: "0.34", raw: "[%eval 0.34]" }
  ]
}
```

---

## 13. Proposed TypeScript Domain Model

```ts
export type PgnResult = "1-0" | "0-1" | "1/2-1/2" | "*";

export interface PgnGame {
  tags: PgnTagMap;
  moves: PgnMoveNode[];
  result: PgnResult;
  raw?: string;
}

export type PgnTagMap = Record<string, string>;

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
  name: string;
  value: string;
  raw: string;
}
```

---

## 14. Proposed Module API

File:

```text
src/chess/pgn.ts
```

Recommended exported functions:

```ts
export function parsePgn(input: string, options?: ParsePgnOptions): PgnDatabase;

export function parseSinglePgnGame(input: string, options?: ParsePgnOptions): PgnGame;

export function exportPgn(game: PgnGame, options?: ExportPgnOptions): string;

export function validatePgn(input: string, options?: ParsePgnOptions): PgnValidationResult;
```

Types:

```ts
export interface PgnDatabase {
  games: PgnGame[];
}

export interface ParsePgnOptions {
  strict?: boolean;
  preserveRaw?: boolean;
  parseEmbeddedCommands?: boolean;
}

export interface ExportPgnOptions {
  lineWidth?: number;
  includeUnknownSevenTags?: boolean;
  preserveTagOrder?: boolean;
  useNagSymbols?: boolean;
}

export interface PgnValidationResult {
  valid: boolean;
  errors: PgnParseError[];
  warnings: PgnParseWarning[];
}
```

---

## 15. Parsing Strategy

### 15.1 Recommended Parser Pipeline

1. Normalize line endings:
   ```ts
   input.replace(/\r\n?/g, "\n")
   ```

2. Tokenize PGN into:
   - tag tokens,
   - move number tokens,
   - SAN tokens,
   - result tokens,
   - NAG tokens,
   - comment tokens,
   - variation open/close tokens.

3. Split tokens into games.

4. Parse tag pair section.

5. Parse movetext section.

6. Build move tree:
   - mainline moves,
   - comments,
   - NAGs,
   - variations.

7. Validate:
   - Seven Tag Roster exists,
   - result marker matches `Result` tag,
   - variation parentheses are balanced,
   - comments are closed,
   - tags are syntactically valid.

8. Optionally pass SAN moves to a chess rules engine for legal validation and board state reconstruction.

---

## 16. Export Strategy

### 16.1 Tag Export

Always export Seven Tag Roster first:

```pgn
[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]
```

Then export optional tags in stable insertion order or alphabetical order.

Escape tag values:

- `"` becomes `\"`,
- `\` becomes `\\`.

Example:

```pgn
[Event "John \"The Wall\" Smith Memorial"]
```

### 16.2 Movetext Export

Recommended formatting:

```pgn
1. e4 e5 2. Nf3 Nc6 *
```

For Black-only continuation:

```pgn
1... c5
```

For comments:

```pgn
1. e4 {Best by test.} e5 *
```

For NAGs:

```pgn
1. e4 $1 e5 $2 *
```

For variations:

```pgn
1. e4 e5 (1... c5 2. Nf3) 2. Nf3 *
```

---

## 17. Importing Full Games Into Application State

PGN import should produce at least two layers:

### 17.1 PGN Syntax Layer

Preserves what was written:

```ts
const game = parseSinglePgnGame(pgn);
```

This layer can work without a chess engine.

### 17.2 Chess State Layer

Replays moves from the initial position or `[FEN]`:

```ts
const replay = replayPgnGame(game, {
  validateLegalMoves: true,
});
```

This layer requires:

- FEN parser,
- legal move generator,
- SAN-to-move resolver,
- board update function.

Recommended separation:

```text
pgn.ts       // parsing and exporting PGN text
fen.ts       // parsing and exporting positions
rules.ts     // legal moves and board updates
san.ts       // SAN generation and SAN resolution
replay.ts    // applies PGN moves to board state
```

---

## 18. Handling Chess.com / Lichess PGNs

Typical Chess.com-style PGN:

```pgn
[Event "Live Chess"]
[Site "Chess.com"]
[Date "2026.05.12"]
[Round "?"]
[White "PlayerA"]
[Black "PlayerB"]
[Result "1-0"]
[TimeControl "600"]
[Termination "PlayerA won by checkmate"]

1. e4 {[%clk 0:09:59]} e5 {[%clk 0:09:58]} 2. Qh5 {[%clk 0:09:55] [%eval 0.20]} Nc6 {[%clk 0:09:50]} 1-0
```

Importer should:

- preserve tags,
- parse `TimeControl`,
- parse `Termination`,
- preserve comments,
- optionally extract `%clk` and `%eval`,
- preserve result marker.

Exporter should be able to regenerate a compatible PGN.

---

## 19. Minimal TypeScript Implementation

A starter TypeScript module is provided separately as:

```text
pgn.ts
```

It supports:

- parsing multiple games,
- parsing tag pairs,
- parsing Seven Tag Roster,
- parsing comments,
- parsing NAGs,
- parsing simple variations,
- parsing embedded commands inside comments,
- exporting PGN with stable tag order,
- preserving unknown tags.

Limitations of the starter module:

- it does not validate legal chess moves,
- it does not resolve SAN into board moves,
- it preserves SAN as text,
- it is intended as an import/export syntax layer.

---

## 20. Test Cases

### 20.1 Minimal Game

```pgn
[Event "?"]
[Site "?"]
[Date "????.??.??"]
[Round "?"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 *
```

### 20.2 Game With Comments

```pgn
[Event "Comment Test"]
[Site "?"]
[Date "2026.05.12"]
[Round "?"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 {Best by test.} e5 {Symmetrical reply.} *
```

### 20.3 Game With NAGs

```pgn
[Event "NAG Test"]
[Site "?"]
[Date "2026.05.12"]
[Round "?"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 $1 e5 $2 *
```

### 20.4 Game With Variations

```pgn
[Event "Variation Test"]
[Site "?"]
[Date "2026.05.12"]
[Round "?"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 *
```

### 20.5 Game With Clock and Evaluation Commands

```pgn
[Event "Clock Test"]
[Site "Chess.com"]
[Date "2026.05.12"]
[Round "?"]
[White "White"]
[Black "Black"]
[Result "*"]

1. e4 {[%clk 0:09:59] [%eval 0.20]} e5 {[%clk 0:09:58]} *
```

### 20.6 Game Starting From FEN

```pgn
[Event "FEN Start"]
[Site "?"]
[Date "2026.05.12"]
[Round "?"]
[White "White"]
[Black "Black"]
[Result "*"]
[SetUp "1"]
[FEN "8/8/8/8/8/8/4K3/4k3 w - - 0 1"]

1. Kd2 *
```

---

## 21. Common Implementation Mistakes

1. Confusing PGN with FEN.
2. Treating PGN as a single position instead of a full game.
3. Dropping unknown tags during import/export.
4. Dropping comments during import/export.
5. Dropping Chess.com/Lichess embedded commands inside comments.
6. Assuming every PGN starts from the standard initial position.
7. Ignoring `[SetUp "1"]` and `[FEN "..."]`.
8. Assuming the `Result` tag and final result marker always match.
9. Not escaping quotes and backslashes in tag values.
10. Trying to validate legal moves inside the tokenizer.
11. Not supporting multiple games in one PGN file.
12. Not supporting semicolon comments.
13. Not supporting recursive variations.
14. Treating `!` and `?` suffixes as part of SAN instead of annotations.

---

## 22. Recommendations for AI Agents

AI agents implementing PGN should:

1. Treat PGN as a complete game container.
2. Keep PGN parsing separate from chess move legality.
3. Preserve unknown tags.
4. Preserve comments and embedded commands.
5. Export Seven Tag Roster first.
6. Normalize line endings before parsing.
7. Parse comments before tokenizing movetext into SAN tokens.
8. Preserve variations even if they are not replayed.
9. Use `[SetUp "1"]` and `[FEN "..."]` when the game starts from a custom position.
10. Validate legal moves only in a replay layer, not in the raw parser.
11. Make parser strictness configurable.
12. Prefer canonical export while supporting tolerant import.

---

## 23. Implementation Checklist

- [ ] Parse multiple games from one PGN string.
- [ ] Parse tag pairs.
- [ ] Export Seven Tag Roster first.
- [ ] Preserve optional and unknown tags.
- [ ] Escape tag values on export.
- [ ] Parse movetext.
- [ ] Parse SAN as text.
- [ ] Parse result markers.
- [ ] Validate result marker against `[Result]`.
- [ ] Parse brace comments.
- [ ] Parse semicolon comments.
- [ ] Parse NAGs like `$1`.
- [ ] Parse symbolic suffixes like `!`, `?`, `!!`, `??`, `!?`, `?!`.
- [ ] Parse recursive variations.
- [ ] Preserve Chess.com/Lichess embedded commands like `[%clk ...]`.
- [ ] Support `[SetUp "1"]` and `[FEN "..."]`.
- [ ] Keep syntax parser independent from move legality engine.
- [ ] Add round-trip tests.

---

## 24. Suggested Architecture

```text
src/
  chess/
    fen.ts
    pgn.ts
    san.ts
    rules.ts
    replay.ts
    types.ts
```

Responsibilities:

```text
fen.ts
  Position import/export.

pgn.ts
  PGN syntax import/export.

san.ts
  SAN generation and SAN resolution.

rules.ts
  Legal moves, check/checkmate, castling, en passant, promotion.

replay.ts
  Reconstructs board states by applying PGN moves.
```

---

---

## 26. Move List Visualization Layer

PGN stores moves as **SAN text**, for example:

```pgn
1. e4 e5 2. Nf3 Nc6 3. d4 d5 4. Bb5 Bc5 5. c4 dxc4 *
```

A chess UI may display the same moves with visual piece symbols:

```text
1   e4       e5
2   ♘f3      ♞c6
3   d4       d5
4   ♗b5      ♝c5
5   c4       dxc4
```

This visual representation is **not PGN syntax**. It is a rendering layer derived from SAN.

### 26.1 Example From Move List UI

Given PGN movetext:

```pgn
1. e4 e5 2. Nf3 Nc6 3. d4 d5 4. Bb5 Bc5 5. c4 dxc4 *
```

The application may render the move table as:

| Move | White | Black |
|---:|---|---|
| 1 | `e4` | `e5` |
| 2 | `♘f3` | `♞c6` |
| 3 | `d4` | `d5` |
| 4 | `♗b5` | `♝c5` |
| 5 | `c4` | `dxc4` |

The original PGN remains:

```pgn
1. e4 e5 2. Nf3 Nc6 3. d4 d5 4. Bb5 Bc5 5. c4 dxc4 *
```

The visual version should never replace the canonical PGN export unless the user explicitly asks for a custom human-readable move list.

### 26.2 SAN to Visual Piece Mapping

In SAN, pieces are represented by uppercase letters:

| SAN Prefix | Piece | White Symbol | Black Symbol |
|---|---|---:|---:|
| `K` | King | `♔` | `♚` |
| `Q` | Queen | `♕` | `♛` |
| `R` | Rook | `♖` | `♜` |
| `B` | Bishop | `♗` | `♝` |
| `N` | Knight | `♘` | `♞` |

Pawn moves have no SAN prefix.

Examples:

| SAN | White display | Black display |
|---|---|---|
| `Nf3` | `♘f3` | `♞f3` |
| `Bb5` | `♗b5` | `♝b5` |
| `Qxe7+` | `♕xe7+` | `♛xe7+` |
| `Rfe1` | `♖fe1` | `♜fe1` |
| `O-O` | `O-O` or `♔O-O` | `O-O` or `♚O-O` |
| `O-O-O` | `O-O-O` or `♔O-O-O` | `O-O-O` or `♚O-O-O` |

Recommended default:

- keep castling as `O-O` and `O-O-O`,
- render piece moves with Unicode chess symbols,
- keep pawn moves unchanged,
- keep captures, checks, checkmates, promotions, and annotations unchanged.

### 26.3 Visual Rendering Must Be Color-Aware

The same SAN move can have a different symbol depending on the side to move.

Example:

```pgn
4. Bb5 Bc5
```

Should render as:

```text
White: ♗b5
Black: ♝c5
```

Both SAN tokens start with `B`, but the rendered symbol depends on move color:

```ts
renderSanForMoveList("Bb5", "w") // "♗b5"
renderSanForMoveList("Bc5", "b") // "♝c5"
```

### 26.4 Move Table Model

For UI display, convert parsed PGN moves into rows:

```ts
export interface PgnMoveTableRow {
  moveNumber: number;
  white?: PgnMoveNode;
  black?: PgnMoveNode;
  whiteDisplay?: string;
  blackDisplay?: string;
}
```

Example output for:

```pgn
1. e4 e5 2. Nf3 Nc6 3. d4 d5 4. Bb5 Bc5 5. c4 dxc4 *
```

```ts
[
  { moveNumber: 1, whiteDisplay: "e4", blackDisplay: "e5" },
  { moveNumber: 2, whiteDisplay: "♘f3", blackDisplay: "♞c6" },
  { moveNumber: 3, whiteDisplay: "d4", blackDisplay: "d5" },
  { moveNumber: 4, whiteDisplay: "♗b5", blackDisplay: "♝c5" },
  { moveNumber: 5, whiteDisplay: "c4", blackDisplay: "dxc4" },
]
```

### 26.5 Visual Rendering Rules

The rendering function should:

1. preserve the original SAN for PGN export,
2. use visual symbols only for display,
3. identify the first SAN character,
4. if the first SAN character is one of `KQRBN`, replace it with the side-specific Unicode symbol,
5. if the move is castling, either keep it unchanged or prepend the king symbol depending on UI configuration,
6. keep checks, checkmates, captures, promotions, and NAG symbols intact,
7. never mutate the underlying `san` value stored in `PgnMoveNode`.

Recommended function:

```ts
renderSanForMoveList(san: string, color: "w" | "b", options?: RenderSanOptions): string
```

### 26.6 Important Distinction

These are different layers:

```text
PGN storage:
  Bb5

Internal parsed move:
  { san: "Bb5", color: "w" }

UI display:
  ♗b5
```

The exporter must use the PGN storage value:

```pgn
4. Bb5 Bc5
```

The UI can use the display value:

```text
4   ♗b5   ♝c5
```

### 26.7 Recommendation for AI Agents

AI agents must not confuse visual move-list rendering with PGN notation.

When implementing import/export:

- parse PGN SAN as text,
- store SAN unchanged,
- derive visual notation only for UI,
- never export Unicode chess symbols as canonical PGN,
- optionally expose a separate human-readable export mode for visual move lists.

Recommended API addition:

```ts
export function renderSanForMoveList(
  san: string,
  color: "w" | "b",
  options?: RenderSanOptions
): string;

export function buildMoveTableRows(
  moves: PgnMoveNode[],
  options?: RenderSanOptions
): PgnMoveTableRow[];
```

## 25. Summary

PGN is the correct format for importing and exporting complete chess games.

FEN should be used for single positions.
PGN should be used for full games.

A production-ready architecture should support:

```ts
parsePgn(input)
exportPgn(game)
validatePgn(input)
replayPgnGame(game)
```

The PGN parser should preserve all meaningful information, including tags, comments, NAGs, recursive variations, and platform-specific embedded annotations such as `[%clk]`, `[%eval]`, `[%cal]`, and `[%csl]`. Visual move-list notation such as `♗b5` should be generated only in the UI layer from canonical SAN such as `Bb5`.

Legal move validation should be implemented as a separate replay step using the FEN module and chess rules engine.
