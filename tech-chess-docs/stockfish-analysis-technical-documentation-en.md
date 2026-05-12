# Technical Documentation: Stockfish Analysis APIs and Chess Engine Integration

## 1. Purpose

This document explains how to integrate chess position and full-game analysis using Stockfish-compatible engines and APIs.

It covers:

1. free and public analysis options,
2. how Lichess analysis works,
3. Lichess Cloud Evaluation API,
4. Fishnet and why it is not a normal public analysis API,
5. third-party Stockfish APIs,
6. self-hosted Stockfish analysis,
7. browser-based Stockfish via WebAssembly,
8. recommended architecture for analyzing PGN games,
9. TypeScript communication examples,
10. data models for storing analysis results.

This document is intended for AI agents and developers building chess applications that need to import PGN, replay positions, analyze each move, detect mistakes/blunders, and export annotated games.

---

## 2. Key Concepts

### 2.1 FEN

FEN represents a single chess position.

Example:

```text
rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1
```

Use FEN when asking an engine:

```text
Analyze this exact board position.
```

### 2.2 PGN

PGN represents a full chess game.

Example:

```pgn
1. e4 e5 2. Nf3 Nc6 3. d4 d5 4. Bb5 Bc5 5. c4 dxc4 *
```

To analyze a PGN game, the application must:

1. parse PGN,
2. replay moves,
3. generate FEN after each ply,
4. send each FEN to an engine or evaluation provider,
5. compare played moves against engine recommendations,
6. annotate the PGN or UI.

### 2.3 UCI

UCI means **Universal Chess Interface**.

It is the protocol used to communicate with Stockfish.

Basic UCI flow:

```text
uci
isready
ucinewgame
position fen <FEN>
go depth 16
bestmove <move>
```

A typical Stockfish output line:

```text
info depth 16 seldepth 22 multipv 1 score cp 34 nodes 123456 nps 1000000 pv e2e4 e7e5 g1f3
bestmove e2e4 ponder e7e5
```

---

## 3. Is There a Free Stockfish API?

Yes, but with important limitations.

There are four practical options:

| Option | Free | Real-time analysis | Good for production | Notes |
|---|---:|---:|---:|---|
| Lichess Cloud Eval API | Yes | No, cached only | Yes, for lookup/caching | Best for known/common positions |
| Lichess Fishnet | Volunteer system | Yes, internally | No public arbitrary analysis API | Used by Lichess server analysis |
| Browser Stockfish/WASM | Yes | Yes, local CPU | Yes, for client-side apps | No backend cost, uses user device |
| Self-hosted Stockfish | Yes, engine is free | Yes | Yes | Best control, requires server CPU |
| Third-party APIs | Sometimes | Yes | Depends | Check limits, reliability, terms |

Recommendation:

```text
Use Lichess Cloud Eval as a cache lookup.
Use local/self-hosted Stockfish as the real analysis engine.
Optionally use browser Stockfish/WASM for client-side analysis.
```

---

## 4. What Lichess Uses

Lichess uses several analysis layers:

### 4.1 Browser Analysis

Lichess can run Stockfish locally in the browser using JavaScript/WebAssembly builds.

This is useful for interactive analysis because the user’s own CPU performs the calculation.

Conceptually:

```text
Browser UI
  -> Web Worker
    -> Stockfish WASM
      -> UCI messages
        -> evaluation output
```

### 4.2 Cloud Evaluation

Lichess exposes a public Cloud Evaluation API.

This endpoint does **not** run a fresh engine search for every request. It returns cached evaluations if the position exists in the Lichess evaluation database.

Conceptually:

```text
App
  -> GET https://lichess.org/api/cloud-eval?fen=<FEN>&multiPv=3
    -> cached Stockfish evaluation, if available
```

If the position is not available, the API returns a 404 response.

### 4.3 Fishnet

Lichess uses **Fishnet** for distributed server-side analysis.

Fishnet is a volunteer-computing network. Users run Fishnet clients, and those clients receive analysis jobs from Lichess, run Stockfish locally, and send results back.

Conceptually:

```text
Lichess server
  -> Fishnet job queue
    -> volunteer Fishnet clients
      -> Stockfish
        -> analysis result
          -> Lichess server
```

Fishnet is not a simple public API where your application can submit arbitrary positions and receive engine results. It is part of the Lichess infrastructure.

---

## 5. Lichess Cloud Evaluation API

### 5.1 Purpose

Use this API to fetch cached evaluations for a position.

Best use cases:

- quick lookup of common positions,
- opening/middlegame positions already known to Lichess,
- avoiding unnecessary local engine work,
- enriching UI with instant evaluations.

Bad use cases:

- guaranteed analysis of every position,
- bulk downloading,
- real-time deep analysis,
- full-game analysis at scale.

For bulk evaluation data, use Lichess exported datasets instead of hammering the API.

### 5.2 Endpoint

```http
GET https://lichess.org/api/cloud-eval
```

### 5.3 Query Parameters

| Parameter | Required | Example | Meaning |
|---|---:|---|---|
| `fen` | Yes | `rnbqkbnr/...` | X-FEN of the position |
| `multiPv` | No | `3` | Number of principal variations |
| `variant` | No | `standard` | Chess variant |

Example request:

```http
GET https://lichess.org/api/cloud-eval?fen=r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R%20b%20KQkq%20-%203%203&multiPv=3
```

### 5.4 Example TypeScript Request

```ts
export interface LichessCloudEvalResponse {
  fen: string;
  knodes: number;
  depth: number;
  pvs: Array<
    | {
        moves: string;
        cp: number;
      }
    | {
        moves: string;
        mate: number;
      }
  >;
}

export async function getLichessCloudEval(
  fen: string,
  multiPv = 1,
): Promise<LichessCloudEvalResponse | null> {
  const url = new URL("https://lichess.org/api/cloud-eval");
  url.searchParams.set("fen", fen);
  url.searchParams.set("multiPv", String(multiPv));

  const response = await fetch(url);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Lichess cloud eval failed: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<LichessCloudEvalResponse>;
}
```

### 5.5 Response Shape

Example response:

```json
{
  "fen": "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R",
  "knodes": 106325,
  "depth": 29,
  "pvs": [
    {
      "moves": "d1e2 d8e7 a2a4 a7a6 b5c4",
      "cp": 41
    },
    {
      "moves": "c2c3 a7a6 b5a4 g8f6",
      "cp": 39
    }
  ]
}
```

Important details:

- `cp` is centipawn evaluation from White’s perspective.
- `mate` means forced mate in a number of moves.
- `moves` is the principal variation in UCI notation.
- The first UCI move in `moves` is the engine’s recommended move.

### 5.6 Handling 404

A 404 does not mean the FEN is invalid.

It usually means:

```text
No cached evaluation is available for this position.
```

Recommended fallback:

```text
1. Try Lichess Cloud Eval.
2. If 404, run local/self-hosted Stockfish.
3. Cache the local result.
```

### 5.7 Rate-Limit Strategy

Lichess asks API clients to make requests respectfully and not run many requests concurrently.

Recommended client behavior:

```text
- one request at a time,
- retry 429 only after delay,
- cache responses,
- do not use Cloud Eval for mass scraping,
- use exported datasets for bulk evaluation data.
```

---

## 6. Fishnet

### 6.1 What Fishnet Is

Fishnet is Lichess’s distributed Stockfish analysis network.

It is designed for Lichess infrastructure and volunteer contributors.

A Fishnet client:

1. authenticates with a Fishnet key,
2. polls Lichess for work,
3. receives analysis batches,
4. runs Stockfish locally,
5. returns results.

### 6.2 Why Fishnet Is Not Your App API

Do not treat Fishnet as a public Stockfish-as-a-service API.

It is not meant for:

- arbitrary third-party analysis jobs,
- commercial offloading,
- replacing your own engine infrastructure,
- batch analysis for your own app.

You can run Fishnet to contribute to Lichess, but your app should not depend on Fishnet as a private backend unless you are deploying your own Fishnet-like system.

### 6.3 If You Want Fishnet-Like Architecture

For your own app, implement a similar queue-based worker architecture:

```text
API Server
  -> Analysis Job Queue
    -> Worker 1: Stockfish
    -> Worker 2: Stockfish
    -> Worker N: Stockfish
  -> Result Cache
  -> Client
```

Recommended technologies:

```text
Queue:
  Redis + BullMQ
  RabbitMQ
  SQS
  PostgreSQL job table

Workers:
  Node.js child_process + Stockfish
  Rust worker
  Go worker
  Python worker

Cache:
  Redis
  PostgreSQL
  SQLite for local app
```

---

## 7. Third-Party Stockfish APIs

Several third-party APIs offer online Stockfish access.

Examples:

```text
https://chess-api.com
https://stockfish.online
```

These can be useful for prototypes, but check:

- free tier limits,
- uptime,
- CORS support,
- request rate,
- depth limit,
- terms of service,
- whether commercial use is allowed,
- whether the API may disappear.

Recommended use:

```text
Good for prototype.
Risky as the only production dependency.
```

---

## 8. Self-Hosted Stockfish

### 8.1 Why Self-Host

Self-hosting gives you:

- predictable behavior,
- no third-party rate limits,
- full control over depth/time/nodes,
- full-game batch analysis,
- private analysis,
- stable production architecture.

### 8.2 Basic UCI Commands

Start engine:

```text
stockfish
```

Initialize:

```text
uci
isready
ucinewgame
```

Analyze FEN:

```text
position fen <FEN>
go depth 16
```

Stop analysis:

```text
stop
```

Output:

```text
info depth 16 score cp 34 pv e2e4 e7e5 g1f3
bestmove e2e4
```

### 8.3 Node.js Worker Example

```ts
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export interface StockfishAnalysisResult {
  bestMove: string;
  ponder?: string;
  depth?: number;
  cp?: number;
  mate?: number;
  pv?: string[];
  raw: string[];
}

export class StockfishWorker extends EventEmitter {
  private readonly process = spawn("stockfish");
  private readonly lines: string[] = [];

  constructor() {
    super();

    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        this.lines.push(trimmed);
        this.emit("line", trimmed);
      }
    });

    this.send("uci");
    this.send("isready");
  }

  analyzeFen(fen: string, depth = 16): Promise<StockfishAnalysisResult> {
    this.lines.length = 0;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Stockfish analysis timeout."));
      }, 30_000);

      const onLine = (line: string) => {
        if (!line.startsWith("bestmove ")) {
          return;
        }

        cleanup();
        resolve(parseStockfishResult(this.lines));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("line", onLine);
      };

      this.on("line", onLine);
      this.send("ucinewgame");
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth}`);
    });
  }

  close(): void {
    this.send("quit");
    this.process.kill();
  }

  private send(command: string): void {
    this.process.stdin.write(`${command}\n`);
  }
}

function parseStockfishResult(lines: string[]): StockfishAnalysisResult {
  const bestMoveLine = [...lines].reverse().find((line) => line.startsWith("bestmove "));
  if (!bestMoveLine) {
    throw new Error("Missing bestmove line.");
  }

  const bestMoveParts = bestMoveLine.split(/\s+/);
  const bestMove = bestMoveParts[1];
  const ponderIndex = bestMoveParts.indexOf("ponder");

  const lastInfoLine = [...lines].reverse().find((line) => line.startsWith("info ") && line.includes(" pv "));
  const result: StockfishAnalysisResult = {
    bestMove,
    ponder: ponderIndex >= 0 ? bestMoveParts[ponderIndex + 1] : undefined,
    raw: [...lines],
  };

  if (lastInfoLine) {
    const parts = lastInfoLine.split(/\s+/);
    const depthIndex = parts.indexOf("depth");
    const scoreIndex = parts.indexOf("score");
    const pvIndex = parts.indexOf("pv");

    if (depthIndex >= 0) {
      result.depth = Number(parts[depthIndex + 1]);
    }

    if (scoreIndex >= 0) {
      const scoreType = parts[scoreIndex + 1];
      const scoreValue = Number(parts[scoreIndex + 2]);

      if (scoreType === "cp") {
        result.cp = scoreValue;
      }

      if (scoreType === "mate") {
        result.mate = scoreValue;
      }
    }

    if (pvIndex >= 0) {
      result.pv = parts.slice(pvIndex + 1);
    }
  }

  return result;
}
```

---

## 9. Browser-Based Stockfish/WASM

### 9.1 Use Case

Use browser Stockfish when:

- you want free client-side analysis,
- you do not want backend CPU cost,
- analysis can run on the user’s device,
- depth/time may vary depending on device speed.

Architecture:

```text
React UI
  -> Web Worker
    -> Stockfish WASM
      -> UCI messages
      -> evaluation lines
```

### 9.2 Pros and Cons

Pros:

```text
- free backend cost,
- no API rate limits,
- private local analysis,
- good for interactive board analysis.
```

Cons:

```text
- user CPU usage,
- inconsistent performance,
- mobile devices may be slow,
- browser worker setup is more complex,
- harder to run long batch analysis.
```

---

## 10. Full PGN Game Analysis Pipeline

### 10.1 Required Modules

Recommended modules:

```text
fen.ts
  parse and export board positions

pgn.ts
  parse and export full games

san.ts
  resolve SAN to legal moves and generate SAN

rules.ts
  legal move generation and board updates

analysis.ts
  communicate with Stockfish or external APIs

replay.ts
  replay PGN into board positions
```

### 10.2 Pipeline

```text
Input PGN
  -> parsePgn()
    -> replayPgnGame()
      -> positions after every ply
        -> analyzeFen()
          -> best move, evaluation, PV
            -> compare played move with best move
              -> classify move
                -> annotate PGN/UI
```

### 10.3 Data Model

```ts
export interface PositionAnalysis {
  fen: string;
  ply: number;
  moveNumber: number;
  colorToMove: "w" | "b";
  playedMove?: string;
  bestMove?: string;
  cp?: number;
  mate?: number;
  depth?: number;
  pv?: string[];
  source: "lichess-cloud" | "local-stockfish" | "third-party-api";
}

export interface MoveClassification {
  ply: number;
  san: string;
  uci: string;
  before?: PositionAnalysis;
  after?: PositionAnalysis;
  centipawnLoss?: number;
  label?: "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";
}
```

---

## 11. Move Classification

A common approach:

1. Analyze position before the move.
2. Analyze position after the move.
3. Convert both evaluations to the side-to-move perspective.
4. Compute centipawn loss.
5. Assign label.

Example thresholds:

| Centipawn Loss | Label |
|---:|---|
| `0-10` | best |
| `11-30` | excellent |
| `31-70` | good |
| `71-150` | inaccuracy |
| `151-300` | mistake |
| `>300` | blunder |

Important:

- mate scores require special handling,
- centipawn loss is not reliable in forced mate positions,
- classification thresholds are product decisions, not universal chess truth.

---

## 12. Recommended Hybrid Strategy

Use a hybrid strategy:

```text
1. Parse PGN.
2. Replay moves to FEN positions.
3. For each position:
   a. Try local cache.
   b. Try Lichess Cloud Eval.
   c. If missing, run self-hosted Stockfish.
   d. Save result to cache.
4. Build game report.
5. Export annotated PGN if needed.
```

### 12.1 Why Hybrid Is Best

```text
Lichess Cloud Eval:
  fast and free, but incomplete.

Self-hosted Stockfish:
  complete and controllable, but CPU-heavy.

Cache:
  avoids repeated work.
```

---

## 13. API Wrapper Interface

Recommended abstraction:

```ts
export interface ChessAnalysisProvider {
  analyzeFen(request: AnalyzeFenRequest): Promise<AnalyzeFenResult | null>;
}

export interface AnalyzeFenRequest {
  fen: string;
  depth?: number;
  multiPv?: number;
  timeoutMs?: number;
}

export interface AnalyzeFenResult {
  fen: string;
  depth?: number;
  knodes?: number;
  pvs: AnalysisPv[];
  source: "lichess-cloud" | "local-stockfish" | "third-party-api";
}

export interface AnalysisPv {
  moves: string[];
  cp?: number;
  mate?: number;
}
```

Then implement providers:

```text
LichessCloudEvalProvider
LocalStockfishProvider
BrowserStockfishProvider
ThirdPartyStockfishProvider
CachedAnalysisProvider
FallbackAnalysisProvider
```

### 13.1 Fallback Provider

```ts
export class FallbackAnalysisProvider implements ChessAnalysisProvider {
  constructor(private readonly providers: ChessAnalysisProvider[]) {}

  async analyzeFen(request: AnalyzeFenRequest): Promise<AnalyzeFenResult | null> {
    for (const provider of this.providers) {
      const result = await provider.analyzeFen(request);

      if (result) {
        return result;
      }
    }

    return null;
  }
}
```

---

## 14. Caching

Cache key:

```text
analysis:<normalizedFen>:depth:<depth>:multipv:<multiPv>:engine:<engineVersion>
```

Recommended stored fields:

```ts
interface CachedAnalysisRecord {
  fen: string;
  normalizedFen: string;
  depth: number;
  multiPv: number;
  engine: string;
  engineVersion: string;
  pvs: AnalysisPv[];
  createdAt: string;
}
```

Recommended storage:

```text
Development:
  SQLite

Production:
  PostgreSQL + Redis

Browser:
  IndexedDB
```

---

## 15. Security and Abuse Protection

Never expose a backend endpoint like this without limits:

```http
POST /api/analyze
```

Why?

Stockfish analysis is CPU-expensive.

Add:

```text
- authentication,
- per-user rate limits,
- max depth,
- max time,
- max positions per request,
- queue limits,
- cancellation,
- cache,
- abuse monitoring.
```

Suggested default limits:

```text
Max depth:
  14-18 for normal users

Max positions per PGN:
  200-300 plies

Max concurrent jobs per user:
  1

Timeout:
  10-30 seconds per position

Batch mode:
  background queue only
```

---

## 16. Recommended Product Architecture

### 16.1 MVP

```text
Frontend:
  PGN upload
  board replay
  move list
  analysis progress

Backend:
  PGN parser
  replay engine
  Lichess Cloud Eval lookup
  local Stockfish fallback
  result cache
```

### 16.2 Production

```text
API Server:
  receives analysis requests
  validates PGN/FEN
  creates jobs

Queue:
  Redis/BullMQ

Workers:
  Stockfish processes
  depth/time controlled

Database:
  games
  positions
  analysis results
  annotated PGN

Cache:
  Redis for fast repeated lookups
```

---

## 17. Recommended Implementation Order

1. Implement PGN import/export.
2. Implement FEN generation after each move.
3. Implement SAN-to-UCI replay.
4. Implement Lichess Cloud Eval provider.
5. Implement local Stockfish provider.
6. Add cache.
7. Add move classification.
8. Add annotated PGN export.
9. Add queue-based batch analysis.
10. Add UI progress reporting.

---

## 18. Annotated PGN Export

After analysis, export comments like:

```pgn
1. e4 {[%eval 0.25] Best move.} e5 {[%eval 0.18]} 2. Nf3 {[%eval 0.31] [%clk 0:09:58]} Nc6 *
```

Possible annotation format:

```pgn
{Best: Nf3. Eval: +0.31. Depth: 16.}
```

Or machine-readable:

```pgn
{[%eval 0.31] [%depth 16] [%best Nf3]}
```

Recommended:

```text
Preserve existing comments.
Append engine annotations.
Keep comments valid PGN.
Do not overwrite user-written annotations unless explicitly requested.
```

---

## 19. Important Warnings

1. Lichess Cloud Eval is not guaranteed to return every position.
2. Fishnet is not a public arbitrary analysis API.
3. Third-party free APIs may have limits or disappear.
4. Full-game analysis is CPU-heavy.
5. Browser Stockfish is free but uses the user’s CPU.
6. Self-hosted Stockfish is the most reliable production option.
7. You must normalize FEN before caching.
8. PGN analysis requires legal move replay, not just PGN token parsing.
9. UCI moves must be converted back to SAN for user display.
10. Mate scores must be handled separately from centipawn scores.

---

## 20. Source References for Further Verification

Use these sources to verify implementation details:

```text
Lichess API docs:
https://lichess.org/api

Lichess Cloud Eval OpenAPI spec:
https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/tags/analysis/api-cloud-eval.yaml

Lichess Cloud Eval schema:
https://raw.githubusercontent.com/lichess-org/api/master/doc/specs/schemas/CloudEval.yaml

Lichess Fishnet:
https://github.com/lichess-org/fishnet

Lichess Stockfish.js:
https://github.com/lichess-org/stockfish.js

Lichess evaluated positions dataset:
https://huggingface.co/datasets/Lichess/chess-position-evaluations

Stockfish documentation:
https://official-stockfish.github.io/docs/

Chess-API:
https://chess-api.com/

StockfishOnline:
https://stockfish.online/docs.php
```

---

## 21. Summary

For a chess application that needs full-game analysis:

```text
Do not depend only on Lichess Cloud Eval.
Do not treat Fishnet as your public compute API.
Use Cloud Eval as a cache lookup.
Use local/self-hosted Stockfish for guaranteed analysis.
Use browser Stockfish/WASM when client-side analysis is acceptable.
Use a queue and cache for full PGN analysis.
```

Recommended final architecture:

```text
PGN
  -> replay to FEN
    -> local cache
      -> Lichess Cloud Eval
        -> self-hosted Stockfish fallback
          -> analysis cache
            -> move classification
              -> annotated PGN + UI report
```
