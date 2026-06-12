/**
 * LaionChess — bulk Common Moves crawler.
 *
 * Level model:
 * - Use all speed tags and all rating tags together in one Lichess request.
 * - Level 0: one initial request for the starting FEN.
 * - Level 1: request every move returned by level 0, no percentage filter.
 * - Level 2+: request every move returned by the previous level only when
 *   played percentage is >= BOOK_MIN_PERCENT.
 * - Stop when the next level queue is empty.
 *
 * Saves all fetched positions into public/book/explorer.json.
 *
 * Usage:
 *   LICHESS_COOKIE='lila2=REAL_VALUE&sessionId=REAL_VALUE' node server/book-script.mjs
 *
 * Optional env:
 *   BOOK_MIN_PERCENT=15
 *   BOOK_MOVES_LIMIT=30
 *   BOOK_DELAY_MS=250
 *   BOOK_DEBUG=1
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(HERE, '..', 'public', 'book', 'explorer.json');

const UPSTREAM = 'https://explorer.lichess.org/lichess';
const UPSTREAM_TIMEOUT_MS = 8000;
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const ALL_SPEEDS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const ALL_RATINGS = ['1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'];

const LICHESS_COOKIE = process.env.LICHESS_COOKIE || '';
const LICHESS_TOKEN = process.env.LICHESS_TOKEN || '';
const MIN_PERCENT = Number(process.env.BOOK_MIN_PERCENT ?? 20);
const MIN_MOVES = Number(process.env.BOOK_MIN_MOVES ?? 2);    // need ≥ this many above MIN_PERCENT to use percent filter
const MIN_PATH = Number(process.env.BOOK_MIN_PATH ?? 3);      // fallback: take top N when all below MIN_PERCENT
const MAX_STAGES = Number(process.env.BOOK_MAX_STAGES ?? 8);  // hard stage cap
const MOVES_LIMIT = Number(process.env.BOOK_MOVES_LIMIT ?? 100);
const DELAY_MS = Number(process.env.BOOK_DELAY_MS ?? 300);    // per-worker delay after each fetch
const CONCURRENCY = Number(process.env.BOOK_CONCURRENCY ?? 4); // parallel workers per stage
const DEBUG_BOOK = process.env.BOOK_DEBUG !== '0';

/**
 * explorer.json structure:
 *
 * {
 *   version: 1,
 *   entries: {
 *     "<bookKey>": {
 *       name: "Italian Game: Rousseau Gambit" | null,
 *       rows: [
 *         // [san, played%, gamesLabel, whiteWin%, draw%, openingName]
 *         ["f5", 10, "503k", 46, 4, "Italian Game: Rousseau Gambit"]
 *       ],
 *       source: "lichess",
 *       fetchedAt: "..."
 *     }
 *   }
 * }
 *
 * @type {{
 *   version: number,
 *   entries: Record<string, {
 *     name?: string | null,
 *     rows: any[],
 *     source: string,
 *     fetchedAt?: string
 *   }>
 * }}
 */
let db = { version: 1, entries: {} };

function debugLog(message) {
  if (DEBUG_BOOK) console.log(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCookie(cookie) {
  return cookie.trim();
}

function redactHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key,
      key.toLowerCase() === 'authorization'
        ? 'Bearer ***redacted***'
        : key.toLowerCase() === 'cookie'
          ? '***redacted***'
          : value,
    ]),
  );
}

function loadDb() {
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, 'utf8'));

    if (parsed && typeof parsed === 'object' && parsed.entries) {
      db = parsed;
    }
  } catch {
    // No DB yet, or unreadable file. First save creates it.
  }
}

function saveDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

/**
 * For DB keys:
 * Empty string means "all", so explorer.json keys stay compact:
 *   startpos w||
 */
function normList(list, all) {
  const set = new Set((list || []).filter(Boolean));

  if (set.size === 0 || set.size === all.length) {
    return '';
  }

  return [...set].sort().join(',');
}

/**
 * For Lichess URL params:
 * Always send explicit values, even when user selected "all".
 */
function lichessParamList(list, all) {
  const allowed = new Set(all);
  const selected = (list || []).filter((value) => allowed.has(value));
  const source = selected.length ? selected : all;
  const unique = [];
  const seen = new Set();

  for (const value of source) {
    if (seen.has(value)) continue;

    seen.add(value);
    unique.push(value);
  }

  return unique.join(',');
}

function bookKey(fen, speeds, ratings) {
  const f = fen.split(' ');
  const placement = `${f[0]} ${f[1] || 'w'}`;

  return `${placement}|${normList(speeds, ALL_SPEEDS)}|${normList(ratings, ALL_RATINGS)}`;
}

function humanGames(n) {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  }

  if (n >= 1_000) {
    return `${Math.round(n / 1_000)}k`;
  }

  return String(n);
}

function openingNameFromMove(move) {
  return move?.opening?.name || null;
}

function openingNameFromResponse(data) {
  return data?.opening?.name || null;
}

/**
 * Lichess explorer response -> BookRow[]
 *
 * Row structure:
 *   [san, played%, gamesLabel, whiteWin%, draw%, openingName]
 *
 * Example:
 *   ["f5", 10, "503k", 46, 4, "Italian Game: Rousseau Gambit"]
 */
function toBookRows(data) {
  const total = data.white + data.draws + data.black;

  return (data.moves ?? []).slice(0, MOVES_LIMIT).map((move) => {
    const moveTotal = move.white + move.draws + move.black;
    const played = total ? Math.round((moveTotal / total) * 100) : 0;
    const whiteWin = moveTotal ? Math.round((move.white / moveTotal) * 100) : 0;
    const draw = moveTotal ? Math.round((move.draws / moveTotal) * 100) : 0;
    const name = openingNameFromMove(move);

    return [move.san, played, humanGames(moveTotal), whiteWin, draw, name];
  });
}

const FILES = 'abcdefgh';

function squareToCoords(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);

  if (file < 0 || !Number.isInteger(rank) || rank < 1 || rank > 8) {
    throw new Error(`invalid square: ${square}`);
  }

  return {
    row: 8 - rank,
    col: file,
  };
}

function coordsToSquare(row, col) {
  if (row < 0 || row > 7 || col < 0 || col > 7) {
    throw new Error(`invalid coords: ${row},${col}`);
  }

  return `${FILES[col]}${8 - row}`;
}

function parsePlacement(placement) {
  const rows = placement.split('/');

  if (rows.length !== 8) {
    throw new Error(`invalid FEN placement: ${placement}`);
  }

  return rows.map((fenRow) => {
    const row = [];

    for (const char of fenRow) {
      if (/^[1-8]$/.test(char)) {
        row.push(...Array(Number(char)).fill(null));
      } else {
        row.push(char);
      }
    }

    if (row.length !== 8) {
      throw new Error(`invalid FEN row: ${fenRow}`);
    }

    return row;
  });
}

function serializePlacement(board) {
  return board
    .map((row) => {
      let result = '';
      let empty = 0;

      for (const piece of row) {
        if (!piece) {
          empty += 1;
          continue;
        }

        if (empty) {
          result += String(empty);
          empty = 0;
        }

        result += piece;
      }

      return result + (empty ? String(empty) : '');
    })
    .join('/');
}

function withoutCastlingRights(castling, rights) {
  let result = castling === '-' ? '' : castling;

  for (const right of rights) {
    result = result.replace(right, '');
  }

  return result || '-';
}

function fenAfterUci(fen, uci) {
  if (!uci || uci.length < 4) {
    throw new Error(`invalid UCI move: ${uci}`);
  }

  const [placement, turn = 'w', castling = '-', ep = '-', halfmove = '0', fullmove = '1'] = fen.split(' ');
  const board = parsePlacement(placement);

  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci.slice(4, 5);

  const { row: fromRow, col: fromCol } = squareToCoords(from);
  const { row: toRow, col: toCol } = squareToCoords(to);

  const piece = board[fromRow][fromCol];

  if (!piece) {
    throw new Error(`no piece on ${from} in FEN: ${fen}`);
  }

  const isWhite = piece === piece.toUpperCase();
  const isPawn = piece.toLowerCase() === 'p';
  const isKing = piece.toLowerCase() === 'k';
  const isRook = piece.toLowerCase() === 'r';

  const capturedOnTarget = board[toRow][toCol];
  let captured = capturedOnTarget;
  let nextCastling = castling;

  // En passant capture.
  if (isPawn && to === ep && !capturedOnTarget && fromCol !== toCol) {
    const capturedPawnRow = isWhite ? toRow + 1 : toRow - 1;

    if (capturedPawnRow < 0 || capturedPawnRow > 7) {
      throw new Error(`invalid en passant target: ${uci} in FEN: ${fen}`);
    }

    captured = board[capturedPawnRow]?.[toCol] || null;
    board[capturedPawnRow][toCol] = null;
  }

  board[fromRow][fromCol] = null;
  board[toRow][toCol] = promotion
    ? isWhite
      ? promotion.toUpperCase()
      : promotion.toLowerCase()
    : piece;

  // Castling rook move.
  if (isKing && Math.abs(toCol - fromCol) === 2) {
    if (toCol === 6) {
      board[fromRow][5] = board[fromRow][7];
      board[fromRow][7] = null;
    } else if (toCol === 2) {
      board[fromRow][3] = board[fromRow][0];
      board[fromRow][0] = null;
    }
  }

  // Castling rights after king move.
  if (isKing) {
    nextCastling = withoutCastlingRights(nextCastling, isWhite ? 'KQ' : 'kq');
  }

  // Castling rights after rook move.
  if (isRook) {
    if (from === 'h1') nextCastling = withoutCastlingRights(nextCastling, 'K');
    if (from === 'a1') nextCastling = withoutCastlingRights(nextCastling, 'Q');
    if (from === 'h8') nextCastling = withoutCastlingRights(nextCastling, 'k');
    if (from === 'a8') nextCastling = withoutCastlingRights(nextCastling, 'q');
  }

  // Castling rights after rook capture.
  if (capturedOnTarget?.toLowerCase() === 'r') {
    if (to === 'h1') nextCastling = withoutCastlingRights(nextCastling, 'K');
    if (to === 'a1') nextCastling = withoutCastlingRights(nextCastling, 'Q');
    if (to === 'h8') nextCastling = withoutCastlingRights(nextCastling, 'k');
    if (to === 'a8') nextCastling = withoutCastlingRights(nextCastling, 'q');
  }

  const nextEp = isPawn && Math.abs(toRow - fromRow) === 2
    ? coordsToSquare((fromRow + toRow) / 2, fromCol)
    : '-';

  const nextHalfmove = isPawn || captured ? 0 : Number(halfmove || 0) + 1;
  const nextFullmove = turn === 'b' ? Number(fullmove || 1) + 1 : Number(fullmove || 1);
  const nextTurn = turn === 'w' ? 'b' : 'w';

  return `${serializePlacement(board)} ${nextTurn} ${nextCastling} ${nextEp} ${nextHalfmove} ${nextFullmove}`;
}

function toCrawlerMoves(data, parentFen) {
  const total = data.white + data.draws + data.black;

  return (data.moves ?? []).map((move) => {
    const moveTotal = move.white + move.draws + move.black;
    const played = total ? Math.round((moveTotal / total) * 100) : 0;
    const name = openingNameFromMove(move);

    let nextFen = null;

    try {
      nextFen = fenAfterUci(parentFen, move.uci);
    } catch (error) {
      console.warn(`[book-script] could not create child FEN for ${move.san || move.uci}: ${error?.message || error}`);
    }

    return {
      san: move.san,
      uci: move.uci,
      fen: nextFen,
      played,
      games: moveTotal,
      name,
    };
  });
}

async function fetchFromLichess(fen, speeds, ratings) {
  const url = new URL(UPSTREAM);

  url.searchParams.set('variant', 'standard');
  url.searchParams.set('fen', fen);
  url.searchParams.set('moves', String(MOVES_LIMIT));
  url.searchParams.set('speeds', lichessParamList(speeds, ALL_SPEEDS));
  url.searchParams.set('ratings', lichessParamList(ratings, ALL_RATINGS));

  const headers = {
    Accept: 'application/json,text/plain,*/*',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    Dnt: '1',
    Referer: 'https://lichess.org/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  };

  if (LICHESS_COOKIE) headers.Cookie = normalizeCookie(LICHESS_COOKIE);
  if (LICHESS_TOKEN) headers.Authorization = `Bearer ${LICHESS_TOKEN}`;

  debugLog(`[book-script] request fen: ${fen}`);
  debugLog(`[book-script] request speeds: ${JSON.stringify(speeds)}`);
  debugLog(`[book-script] request ratings: ${JSON.stringify(ratings)}`);
  debugLog(`[book-script] request url: ${url.toString()}`);
  debugLog(`[book-script] request headers: ${JSON.stringify(redactHeaders(headers))}`);

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: ctrl.signal,
      headers,
    });

    debugLog(`[book-script] response: ${response.status} ${response.statusText}`);
    debugLog(`[book-script] response content-type: ${response.headers.get('content-type') || ''}`);

    if (!response.ok) {
      const body = await response.text();

      console.warn(`[book-script] lichess error body: ${body.slice(0, 1000)}`);

      throw new Error(`lichess ${response.status}`);
    }

    const data = await response.json();

    return {
      name: openingNameFromResponse(data),
      rows: toBookRows(data),
      moves: toCrawlerMoves(data, fen),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAndStorePosition(fen, speeds, ratings, level, fallbackName = null) {
  const key = bookKey(fen, speeds, ratings);
  try {
    const result = await fetchFromLichess(fen, speeds, ratings);
    const name = result.name || fallbackName || null;

    if (!result.rows.length) {
      console.log(`[book-script] level=${level} empty ${key}`);
      return { key, name, rows: [], moves: [] };
    }

    db.entries[key] = {
      name,
      rows: result.rows,
      source: 'lichess',
      fetchedAt: new Date().toISOString(),
    };

    saveDb();

    console.log(
      `[book-script] level=${level} saved ${key} name=${name || '-'} rows=${result.rows.length} moves=${result.moves.length} total=${Object.keys(db.entries).length}`,
    );

    return { key, name, rows: result.rows, moves: result.moves };
  } finally {
    // Rate-limit: each worker pauses after its fetch, works for both sequential and parallel modes.
    await sleep(DELAY_MS);
  }
}

function movesForNextLevel(moves, nextLevel) {
  // Level 1: all moves from the root (no filtering).
  if (nextLevel === 1) {
    return moves.filter((m) => Boolean(m.fen));
  }

  // Level 2+: filter by MIN_PERCENT; if fewer than MIN_MOVES pass, fall back
  // to top MIN_PATH moves by played% so we never dead-end prematurely.
  const withFen = moves.filter((m) => Boolean(m.fen));
  const sorted = [...withFen].sort((a, b) => b.played - a.played);
  const byPercent = sorted.filter((m) => m.played >= MIN_PERCENT);

  if (byPercent.length >= MIN_MOVES) return byPercent;

  return sorted.slice(0, MIN_PATH);
}

/**
 * Run `fn` over `items` with at most `limit` concurrent workers.
 * Returns an array of { status: 'fulfilled'|'rejected', value|reason } objects
 * in the same order as `items`. Never rejects — errors are captured per-item.
 */
async function runConcurrently(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const idx = next++;
      try {
        results[idx] = { status: 'fulfilled', value: await fn(items[idx], idx) };
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function makeJob({
  fen,
  level,
  fromSan = 'ROOT',
  fromPlayed = 100,
  fromName = null,
}) {
  return {
    fen,
    speeds: ALL_SPEEDS,
    ratings: ALL_RATINGS,
    level,
    fromSan,
    fromPlayed,
    fromName,
    key: bookKey(fen, ALL_SPEEDS, ALL_RATINGS),
  };
}

function enqueueJob(queue, queuedKeys, job) {
  if (queuedKeys.has(job.key)) return;

  queuedKeys.add(job.key);
  queue.push(job);
}

async function crawlAllSpeedRatings() {
  const seenKeys = new Set();

  let queue = [makeJob({ fen: START_FEN, level: 0 })];
  let queuedKeys = new Set(queue.map((j) => j.key));
  let level = 0;

  while (queue.length > 0) {
    if (level > MAX_STAGES) {
      console.log(`[book-script] reached MAX_STAGES=${MAX_STAGES} — stopping`);
      break;
    }

    const currentLevelJobs = queue.filter((j) => j.level === level);
    const futureJobs = queue.filter((j) => j.level !== level);

    if (!currentLevelJobs.length) {
      queue = futureJobs;
      queuedKeys = new Set(queue.map((j) => j.key));
      level += 1;
      continue;
    }

    const unseenJobs = currentLevelJobs.filter((j) => !seenKeys.has(j.key));
    unseenJobs.forEach((j) => seenKeys.add(j.key));

    console.log(
      `[book-script] level=${level} processing jobs=${unseenJobs.length} concurrency=${CONCURRENCY}`,
    );

    const nextQueue = [...futureJobs];
    const nextQueuedKeys = new Set(futureJobs.map((j) => j.key));
    let queuedChildren = 0;

    const results = await runConcurrently(unseenJobs, CONCURRENCY, async (job) => {
      console.log(
        `[book-script] level=${job.level} fetch from=${job.fromSan}:${job.fromPlayed}% name=${job.fromName || '-'}`,
      );
      return fetchAndStorePosition(job.fen, job.speeds, job.ratings, job.level, job.fromName);
    });

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const job = unseenJobs[i];

      if (result.status === 'rejected') {
        console.warn(`[book-script] level=${level} job failed ${job.fromSan}: ${result.reason?.message || result.reason}`);
        continue;
      }

      const current = result.value;
      const nextLevel = job.level + 1;
      const children = movesForNextLevel(current.moves, nextLevel);
      queuedChildren += children.length;

      for (const child of children) {
        enqueueJob(nextQueue, nextQueuedKeys, makeJob({
          fen: child.fen,
          level: nextLevel,
          fromSan: child.san,
          fromPlayed: child.played,
          fromName: child.name,
        }));
      }
    }

    console.log(
      `[book-script] level=${level + 1} queued=${nextQueue.filter((j) => j.level === level + 1).length} children=${queuedChildren}`,
    );

    queue = nextQueue;
    queuedKeys = nextQueuedKeys;
    level += 1;
  }
}

async function main() {
  loadDb();

  console.log(`[book-script] db=${DB_PATH}`);
  console.log(`[book-script] loaded entries=${Object.keys(db.entries).length}`);
  console.log(`[book-script] start fen=${START_FEN}`);
  console.log(`[book-script] min percent for level 2+ >= ${MIN_PERCENT} (need >= ${MIN_MOVES} moves; fallback top ${MIN_PATH})`);
  console.log(`[book-script] max stages=${MAX_STAGES} · moves limit=${MOVES_LIMIT}`);
  console.log(`[book-script] delay=${DELAY_MS}ms per worker · concurrency=${CONCURRENCY}`);
  console.log(`[book-script] Lichess cookie: ${LICHESS_COOKIE ? 'set' : 'none'}`);
  console.log(`[book-script] Lichess token: ${LICHESS_TOKEN ? 'set' : 'none'}`);
  console.log('[book-script] filters=all speeds + all ratings');

  await crawlAllSpeedRatings();

  saveDb();

  console.log(`[book-script] done entries=${Object.keys(db.entries).length}`);
}

main().catch((error) => {
  console.error(`[book-script] failed: ${error?.stack || error?.message || error}`);
  process.exitCode = 1;
});