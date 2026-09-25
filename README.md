

# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.


## Opening courses

`public/courses/manifest.json` lists the trainable courses (18 openings, 171 lines).

- **White:** Scotch, Italian, Ruy Lopez, Vienna Game, Queen's Gambit, Catalan,
  London System, English Opening.
- **Black:** Sicilian Najdorf, Accelerated Dragon, Caro-Kann, French, Scandinavian,
  Petroff (vs 1.e4); King's Indian, Nimzo-Indian (+ Queen's Indian), Grünfeld,
  Slav (vs 1.d4).

Each course is a `laionchess.course.v1` JSON file; every line starts from move 1
and every move of the trained side carries a coach note. Lines branch only on the
opponent's moves, so the repertoire stays consistent — the same position always
gets the same answer. Lines follow mainstream book theory; every move is checked
for legality and repertoire consistency before it ships.

Trainer modes: **Learn** (guided arrows + notes), **Practice** (recall a chosen
line) and **Drill** (random lines, no hints, streak counter).

Drill details: wrong move → ✕ badge; 2nd miss highlights the piece that should
move, 3rd reveals the arrow (the Hint button works the same way: piece first,
then move). Failed lines come back two lines later (spaced retry). Session
accuracy, clean lines and a persisted best streak are shown. When a line ends a
result card appears on the board (Next / Again; `Enter` = next, `R` = again), so
on mobile there's no need to scroll. Common Moves is hidden while a line is
being recalled so it can't give answers away.

### Training tools

- **Board vision** (*Vision*): "find it yourself" quizzes on real positions from
  the courses — tap every check, capture, threat, hanging / loose piece or pin
  against the clock, then see what you found, missed or got wrong. Score,
  streak and best streak are kept.
- **Play it out**: when a course line ends, play the final position against
  Stockfish (5 strength levels, hint, take-back). A **middlegame plan card**
  recognises the pawn structure (IQP, Carlsbad, French chain, closed KID,
  Maróczy, Open Sicilian, open centre…) and lists plans for both sides plus
  concrete targets, outposts and files.
- **Essential endgames** (*Endgames*): 14 Stockfish-verified positions — basic
  mates, key squares, opposition, rule of the square, rook-pawn fortress,
  outside passer, Lucena, Philidor, queen vs pawn — each with a goal
  (checkmate / promote / hold the draw). For ≤ 7 pieces the Lichess tablebase
  tells you the moment a move spoils the result.
- **Spaced repetition**: every reviewed line is scheduled (10 min → 1 → 3 → 7 →
  16 → 35 days). Drill serves due lines first and Home shows what's due.
- **⚠ Threat** (Analysis): the opponent's best move if it were their turn.

### Board overlays

The **◎ Overlays** button (under every board) turns on visual aids built on the
rules players are taught. Old saved choices are migrated automatically.

| Overlay | Principle |
|---|---|
| Hanging pieces | Static exchange evaluation: red `−n` = you lose it, green `+n` = you can win it, amber `a:d` = attacked but held |
| Loose pieces | "Loose pieces drop off" (LPDO): undefended pieces are tactical targets |
| Checks | Checks, captures, threats — every check for the side to move (safe vs. can be taken) |
| King safety & pins | Enemy hits on the king zone, escape squares, pinned pieces and their pinners |
| Square control / White's / Black's control | Who controls each square and by how much |
| Protection map | Which pieces defend which, and how many times |
| Pawn structure | Passed, isolated, doubled and backward pawns |
| Outposts | Pawn-supported squares no enemy pawn can attack |
| Open files | Open and half-open files — where rooks belong |
| Opening principles | Undeveloped minors, uncastled king, early queen, centre control |
| Piece activity | Legal moves per piece, passive pieces and bad bishops |
| Rule of the square | Can the defending king catch a passed pawn? |
| Key squares & opposition | Pawn endings: squares that force promotion, and who holds the opposition |

Up to 16 overlays can be on at once — in practice all of them.

### Board controls

- Click or drag pieces to move.
- Right-click drag draws arrows, right-click a square draws a circle
  (Shift = red, Alt/Ctrl = blue, Shift+Alt = yellow). Left-click clears them.
- `←` / `→` step through moves, `↑` / `↓` jump to start / end, `F` flips the board.
  Shortcuts are ignored while typing in a field.

## Github Page
[Under](https://laionfromnight.github.io/LaionChess/)

## Common Moves (opening book) data

Common Moves are served from a layered source so the app **always works**:

0. **Lichess live, straight from the browser** — click **♞ Connect Lichess**
   under Common Moves (OAuth PKCE "Login with Lichess", no scopes, no backend).
   The explorer rejects anonymous calls, but accepts the resulting token, so
   live stats work on GitHub Pages too. The token stays in the browser's
   localStorage; you can also paste a personal token instead. A badge shows
   where the rows came from (Live · Lichess / Local book server / Offline snapshot).
1. **Local book server** (dev only) — serves a persistent offline DB and, in
   online mode, fills gaps from the Lichess Opening Explorer and saves them.
2. **Bundled offline DB** — `public/book/explorer.json`, shipped in the build.
3. **Hardcoded demo book** — `src/data/book.ts`, last-resort seed.

### GitHub Pages (no backend)

Pages is fully static. `public/book/explorer.json` is bundled into the build and
the app reads it offline — `VITE_BOOK_SERVER` is unset there, so it never tries a
server. To enrich what Pages serves, run the local server, browse positions to
cache them, and commit the updated `public/book/explorer.json`.

> The old Cloudflare Worker proxy was removed: a browser can't call Lichess
> directly (401 on `Origin`) and the Worker also got 401 (cloud egress IPs /
> wrong host). Live data now flows only through the local server.

### Local development with live data

```bash
npm run server   # online with cache (default); or: npm run server:offline
npm run dev      # in another terminal — .env.local points it at the server
```

See [`server/README.md`](server/README.md) for the API, DB format, and modes.
