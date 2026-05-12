# Technical Documentation: FEN Notation in Chess Games

## 1. Purpose

This document describes the **FEN** format (*Forsyth–Edwards Notation*) and proposes a TypeScript implementation responsible for:

1. converting the current chess position state into a FEN string,
2. reconstructing a chess position state from a FEN string,
3. validating FEN correctness,
4. normalizing FEN into a canonical form used by the application.

This document is intended for AI agents and developers implementing chess logic, position serialization, position import/export, chess engine integration, or persistent storage of chess game state.

---

## 2. What FEN Is

**FEN** is a standard single-line notation for representing a chess position. It does not describe the full move history. It describes only the current position state needed to resume or analyze a game.

Starting position example:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```

FEN encodes:

1. piece placement,
2. active color,
3. castling availability,
4. en passant target square,
5. halfmove clock for the fifty-move rule,
6. fullmove number.

FEN **does not encode**:

- full move history,
- list of moves already played,
- repetition history,
- whether a threefold repetition claim is available,
- clock time,
- player metadata,
- game variant, unless the application extends the model separately.

---

## 3. FEN Structure

FEN consists of exactly **6 fields** separated by spaces:

```text
<piecePlacement> <activeColor> <castlingAvailability> <enPassantTarget> <halfmoveClock> <fullmoveNumber>
```

Example:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```

| No. | Field | Example | Meaning |
|---:|---|---|---|
| 1 | `piecePlacement` | `rnbqkbnr/pppppppp/8/...` | Piece placement on the board |
| 2 | `activeColor` | `w` | Side to move: white or black |
| 3 | `castlingAvailability` | `KQkq` | Available castling rights |
| 4 | `enPassantTarget` | `-` or `e3` | En passant target square |
| 5 | `halfmoveClock` | `0` | Number of halfmoves since the last pawn move or capture |
| 6 | `fullmoveNumber` | `1` | Fullmove number, starting at 1 |

---

## 4. Field 1: Piece Placement

### 4.1 Rank Order

The board is written from **rank 8 down to rank 1**, from White’s perspective, top to bottom:

```text
8: rnbqkbnr
7: pppppppp
6: 8
5: 8
4: 8
3: 8
2: PPPPPPPP
1: RNBQKBNR
```

Ranks are separated by `/`:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR
```

### 4.2 File Order Within a Rank

Each rank is written from file `a` to file `h`.

For rank 1:

```text
a1 b1 c1 d1 e1 f1 g1 h1
```

### 4.3 Piece Symbols

| Piece | White | Black |
|---|---:|---:|
| King | `K` | `k` |
| Queen | `Q` | `q` |
| Rook | `R` | `r` |
| Bishop | `B` | `b` |
| Knight | `N` | `n` |
| Pawn | `P` | `p` |

Note: the knight is encoded as `N`, not `K`, because `K` is already used by the king.

### 4.4 Empty Squares

A continuous sequence of empty squares inside one rank is represented by a digit from `1` to `8`.

Examples:

```text
8        // eight empty squares
3p4     // three empty squares, black pawn, four empty squares
R3K2R   // white rook, three empty, white king, two empty, white rook
```

Each rank must expand to exactly **8 squares**.

Valid:

```text
8
3p4
R3K2R
```

Invalid:

```text
9        // out of range
33p2     // expands to 8, but adjacent empty blocks should be normalized to 6p2
4P5      // expands to 10 squares
```

---

## 5. Field 2: Active Color

The `activeColor` field defines which side is to move next.

Allowed values:

```text
w
b
```

| Value | Meaning |
|---|---|
| `w` | White to move |
| `b` | Black to move |

---

## 6. Field 3: Castling Rights

The `castlingAvailability` field defines which castling rights are still available based on game history.

Allowed symbols:

| Symbol | Meaning |
|---|---|
| `K` | White can castle kingside |
| `Q` | White can castle queenside |
| `k` | Black can castle kingside |
| `q` | Black can castle queenside |
| `-` | No castling rights available |

Examples:

```text
KQkq
Kq
-
```

### 6.1 Important Implementation Note

FEN stores **castling rights**, not whether castling is currently executable.

Example: if the king and rook have not moved, but there is a piece between them, the castling right may still be encoded as `K` or `Q`. Whether castling is legal in the current position should be checked by the move generation or rule engine.

### 6.2 Minimal Positional Validation

A FEN parser can operate at two validation levels:

1. **syntax validation** — validates format only,
2. **semantic validation** — checks whether castling rights make sense relative to king and rook placement.

Recommendation:

- `parseFen` should perform syntax validation by default,
- an optional `strict` mode may perform semantic validation.

Example that is syntactically valid but semantically suspicious:

```text
8/8/8/8/8/8/8/4K3 w K - 0 1
```

The `K` field suggests White kingside castling rights, but there is no white rook on `h1`.

---

## 7. Field 4: En Passant Target Square

The `enPassantTarget` field indicates the square that a pawn could move to when capturing en passant.

Allowed values:

```text
-
a3 b3 c3 d3 e3 f3 g3 h3
a6 b6 c6 d6 e6 f6 g6 h6
```

Example after `1. e4`:

```text
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1
```

The white pawn moved from `e2` to `e4`, so the skipped square is `e3`.

### 7.1 Classical FEN vs Application-Canonical FEN

Two practices exist:

1. write the en passant target square after every double pawn move,
2. write the en passant target square only when an en passant capture is actually legal.

The implementation should define this policy explicitly:

```ts
type EnPassantPolicy = "fen-spec-compatible" | "legal-only";
```

Recommendation:

- use `fen-spec-compatible` for maximum compatibility with classical FEN,
- use `legal-only` for canonical internal positions and position comparison.

If the application compares positions, caches analysis, or creates transposition keys, `legal-only` can reduce false differences between otherwise equivalent positions.

---

## 8. Field 5: Halfmove Clock

`halfmoveClock` is the number of halfmoves since the last:

- pawn move,
- capture.

It is used for the fifty-move rule.

Examples:

```text
0
1
24
99
```

Validation rules:

- must be an integer,
- must be `>= 0`,
- must not contain `+`, `-`, spaces, or decimals.

---

## 9. Field 6: Fullmove Number

`fullmoveNumber` is the fullmove counter.

Rules:

- starts at `1`,
- increments after Black’s move,
- must be an integer `>= 1`.

Examples:

```text
1
2
57
```

---

## 10. Proposed TypeScript Domain Model

The recommended model is independent of UI. The board is an 8×8 matrix where:

- `board[0][0]` means `a8`,
- `board[0][7]` means `h8`,
- `board[7][0]` means `a1`,
- `board[7][7]` means `h1`.

```ts
export type Color = "w" | "b";

export type PieceType = "p" | "n" | "b" | "r" | "q" | "k";

export interface Piece {
  type: PieceType;
  color: Color;
}

export type BoardSquare = Piece | null;

export type BoardMatrix = BoardSquare[][];

export interface CastlingRights {
  whiteKingSide: boolean;
  whiteQueenSide: boolean;
  blackKingSide: boolean;
  blackQueenSide: boolean;
}

export interface ChessPositionState {
  board: BoardMatrix;
  activeColor: Color;
  castling: CastlingRights;
  enPassantTarget: SquareName | null;
  halfmoveClock: number;
  fullmoveNumber: number;
}

export type SquareName =
  | "a1" | "b1" | "c1" | "d1" | "e1" | "f1" | "g1" | "h1"
  | "a2" | "b2" | "c2" | "d2" | "e2" | "f2" | "g2" | "h2"
  | "a3" | "b3" | "c3" | "d3" | "e3" | "f3" | "g3" | "h3"
  | "a4" | "b4" | "c4" | "d4" | "e4" | "f4" | "g4" | "h4"
  | "a5" | "b5" | "c5" | "d5" | "e5" | "f5" | "g5" | "h5"
  | "a6" | "b6" | "c6" | "d6" | "e6" | "f6" | "g6" | "h6"
  | "a7" | "b7" | "c7" | "d7" | "e7" | "f7" | "g7" | "h7"
  | "a8" | "b8" | "c8" | "d8" | "e8" | "f8" | "g8" | "h8";
```

---

## 11. Proposed Module API

File:

```text
src/chess/fen.ts
```

Exported functions:

```ts
export function parseFen(fen: string, options?: ParseFenOptions): ChessPositionState;

export function toFen(state: ChessPositionState, options?: ToFenOptions): string;

export function validateFen(fen: string, options?: ValidateFenOptions): FenValidationResult;

export function normalizeFen(fen: string, options?: NormalizeFenOptions): string;
```

### 11.1 Option Types

```ts
export interface ParseFenOptions {
  strict?: boolean;
}

export interface ToFenOptions {
  enPassantPolicy?: EnPassantPolicy;
}

export interface ValidateFenOptions {
  strict?: boolean;
}

export interface NormalizeFenOptions {
  strict?: boolean;
  enPassantPolicy?: EnPassantPolicy;
}

export type EnPassantPolicy = "fen-spec-compatible" | "legal-only";

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

export interface FenValidationWarning {
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
```

---

## 12. `parseFen` Algorithm

### 12.1 Steps

1. Trim outer whitespace:
   ```ts
   const input = fen.trim();
   ```

2. Split by one or more whitespace characters:
   ```ts
   const fields = input.split(/\s+/);
   ```

3. Verify that there are exactly 6 fields.

4. Parse `piecePlacement`:
   - split by `/`,
   - verify that there are exactly 8 ranks,
   - expand each rank to 8 squares,
   - convert digits `1-8` to empty squares,
   - convert piece symbols to `Piece` objects.

5. Parse `activeColor`:
   - `w` or `b`.

6. Parse `castlingAvailability`:
   - `-` or a non-empty string with unique characters from `KQkq`,
   - canonical serialization order: `KQkq`.

7. Parse `enPassantTarget`:
   - `-` => `null`,
   - square name with file `a-h` and rank `3` or `6`.

8. Parse `halfmoveClock`:
   - integer `>= 0`.

9. Parse `fullmoveNumber`:
   - integer `>= 1`.

10. Optionally run strict validation:
    - exactly one white king,
    - exactly one black king,
    - no pawns on rank 1 or rank 8,
    - castling rights compatible with king and rook placement,
    - en passant target compatible with active color and pawn placement.

---

## 13. `toFen` Algorithm

### 13.1 Steps

1. Verify that the board is an 8×8 matrix.
2. For each rank from index `0` to `7`:
   - iterate from file `a` to `h`,
   - count consecutive empty squares,
   - when a piece is found:
     - if the empty counter is greater than 0, append the digit,
     - append the piece symbol,
   - at the end of the rank, append the remaining empty counter if needed.
3. Join ranks with `/`.
4. Append active color.
5. Append castling rights in `KQkq` order or `-`.
6. Append en passant target square or `-`.
7. Append `halfmoveClock`.
8. Append `fullmoveNumber`.

---

## 14. Validation

### 14.1 Syntax Validation

Minimal validation should detect:

- wrong number of fields,
- wrong number of ranks,
- rank that does not expand to 8 squares,
- unknown piece symbol,
- invalid active color,
- invalid castling rights,
- duplicate castling symbols,
- invalid en passant square,
- invalid halfmove clock,
- invalid fullmove number.

### 14.2 Semantic Validation

`strict` mode may detect:

- missing king,
- more than one king of a given color,
- pawn on rank 1 or rank 8,
- castling rights without matching king and rook on starting squares,
- impossible en passant target relative to active color,
- excessive material or promoted pieces, if the application wants material-balance validation.

Note: full validation of whether a chess position is legally reachable is much harder than validating FEN syntax. Do not mix the FEN parser with the full move legality engine unless the application explicitly requires it.

---

## 15. FEN Normalization

The `normalizeFen` function should:

1. parse FEN,
2. serialize it again through `toFen`,
3. enforce canonical castling order: `KQkq`,
4. replace excessive whitespace with single spaces,
5. compress empty squares in ranks,
6. optionally apply the en passant policy.

Example:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR   w   qKQk   -   0   1
```

after normalization:

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```

---

## 16. FEN Examples

### 16.1 Starting Position

```text
rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1
```

### 16.2 After 1. e4

```text
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1
```

### 16.3 After 1. e4 c5

```text
rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2
```

### 16.4 After 1. e4 c5 2. Nf3

```text
rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2
```

---

## 17. Recommended File Structure

```text
src/
  chess/
    fen.ts
    fen.test.ts
    types.ts
    boardCoordinates.ts
```

Alternative domain-oriented structure:

```text
src/
  domain/
    chess/
      fen/
        parseFen.ts
        toFen.ts
        validateFen.ts
        normalizeFen.ts
        fen.types.ts
        index.ts
```

---

## 18. Minimal TypeScript Module

A ready-to-use module is provided separately in:

```text
fen.ts
```

The module contains:

- `parseFen`,
- `toFen`,
- `normalizeFen`,
- `validateFen`,
- strict validation for kings and pawns on illegal ranks,
- canonical castling serialization,
- board matrix representation using FEN orientation.

---

## 19. Test Cases

### 19.1 Valid FEN Strings

```ts
const validFens = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2",
  "8/8/8/8/8/8/8/8 w - - 0 1",
];
```

### 19.2 Invalid FEN Strings

```ts
const invalidFens = [
  "",                                                         // empty
  "8/8/8/8/8/8/8/8 w - - 0",                                  // only 5 fields
  "8/8/8/8/8/8/8/8/8 w - - 0 1",                              // 9 ranks
  "9/8/8/8/8/8/8/8 w - - 0 1",                                // invalid digit
  "8/8/8/8/8/8/8/7X w - - 0 1",                               // invalid piece
  "8/8/8/8/8/8/8/8 x - - 0 1",                                // invalid active color
  "8/8/8/8/8/8/8/8 w KK - 0 1",                               // duplicate castling
  "8/8/8/8/8/8/8/8 w - e4 0 1",                               // invalid en passant rank
  "8/8/8/8/8/8/8/8 w - - -1 1",                               // invalid halfmove
  "8/8/8/8/8/8/8/8 w - - 0 0",                                // invalid fullmove
];
```

### 19.3 Round-Trip Test

Every valid FEN should pass this test:

```ts
for (const fen of validFens) {
  expect(toFen(parseFen(fen))).toBe(normalizeFen(fen));
}
```

---

## 20. Integration with Application State

If the application stores the board as a square map:

```ts
type BoardMap = Partial<Record<SquareName, Piece>>;
```

then adapters are needed:

```ts
function boardMapToMatrix(boardMap: BoardMap): BoardMatrix;
function boardMatrixToMap(board: BoardMatrix): BoardMap;
```

Index mapping:

```text
rankIndex = 8 - rank
fileIndex = file.charCodeAt(0) - "a".charCodeAt(0)
```

Examples:

| Square | `rankIndex` | `fileIndex` |
|---|---:|---:|
| `a8` | 0 | 0 |
| `h8` | 0 | 7 |
| `a1` | 7 | 0 |
| `h1` | 7 | 7 |
| `e4` | 4 | 4 |

---

## 21. Common Implementation Mistakes

1. Reversing the board and serializing from rank 1 to rank 8.
2. Treating `board[0][0]` as `a1` without an explicit adapter.
3. Using `S` instead of `N` for the knight.
4. Serializing empty squares as repeated `1`s instead of compressed digits.
5. Not validating that each rank expands to exactly 8 squares.
6. Sorting castling rights alphabetically instead of canonically as `KQkq`.
7. Confusing castling rights with immediate castling legality.
8. Incrementing `fullmoveNumber` after White’s move instead of after Black’s move.
9. Resetting `halfmoveClock` after every move instead of only after pawn moves or captures.
10. Treating FEN as a complete game record.

---

## 22. Recommendations for AI Agents

An AI agent implementing FEN should:

1. First define the internal board model.
2. Explicitly define matrix orientation.
3. Keep the FEN parser separate from the move legality engine.
4. Implement `parseFen` and `toFen` as pure functions.
5. Add `normalizeFen` for canonical position comparison.
6. Never assume FEN contains game history.
7. Use normalized FEN for cache keys, comparisons, and tests.
8. Cover starting position, en passant, castling, empty boards, and invalid data in tests.
9. Do not store FEN as the only source of state if the application needs move history, clocks, or repetition data.
10. Use coordinate adapters in UI code instead of assuming the matrix orientation.

---

## 23. Implementation Checklist

- [ ] `parseFen` handles exactly 6 fields.
- [ ] `parseFen` validates 8 ranks.
- [ ] Each rank expands to 8 squares.
- [ ] Supported symbols are `PNBRQKpnbrqk`.
- [ ] `activeColor` accepts only `w` or `b`.
- [ ] Castling accepts `-` or unique `KQkq` characters.
- [ ] `toFen` serializes castling rights in `KQkq` order.
- [ ] En passant accepts `-` or squares `a3-h3` / `a6-h6`.
- [ ] `halfmoveClock >= 0`.
- [ ] `fullmoveNumber >= 1`.
- [ ] `normalizeFen` returns canonical FEN.
- [ ] Round-trip test: `toFen(parseFen(fen))`.
- [ ] Invalid input tests.
- [ ] Optional `strict` mode.

---

## 24. Architectural Decisions

Recommended project decisions:

```text
ADR-001: BoardMatrix uses FEN orientation
board[0][0] = a8
board[7][7] = h1

ADR-002: FEN parser validates syntax by default
Strict chess-position validation is opt-in.

ADR-003: FEN serialization is canonical
Castling rights are always serialized as KQkq.
Whitespace is normalized.
Empty squares are compressed.

ADR-004: FEN does not replace game history
Move history, repetition data, clocks, and players must live outside FEN.
```

---

## 25. Recommended Verification Sources

To confirm compatibility, compare behavior with:

- Chessprogramming Wiki: Forsyth–Edwards Notation
- PGN Specification and Implementation Guide by Steven J. Edwards
- FICS Help: FEN
- popular chess libraries, for example `chess.js` or `python-chess`

---

## 26. Summary

FEN is a compact position format, not a game-history format. A correct implementation should separate:

- textual format,
- internal board model,
- syntax validation,
- position legality validation,
- move generation rules.

The safest functional set for the application is:

```ts
parseFen(fen)
toFen(state)
validateFen(fen)
normalizeFen(fen)
```

This allows FEN to be used consistently by UI, backend, tests, AI agents, analysis engines, and position import/export flows.
