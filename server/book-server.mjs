/**
 * LaionChess — local Common Moves server.
 *
 * Serves the opening "book" (Common Moves) to the app from a persistent offline
 * database, and — in online mode — fills gaps from the Lichess Opening Explorer
 * and writes the results back to disk so they survive restarts and ship to
 * GitHub Pages via a commit.
 *
 * Why this (and not a CORS proxy): a browser can't call Lichess directly (401 on
 * Origin) and the Cloudflare Worker proxy also got 401 (cloud egress IPs / wrong
 * host). This server runs locally, hits the correct host server-to-server, and
 * is the single source of truth for the offline DB.
 *
 *   npm run server          # online with cache (default)  — gaps fetched + saved
 *   npm run server:offline  # offline only                 — DB only, never fetch
 *
 * Env: BOOK_PORT (default 8787), BOOK_MODE = online | offline.
 *
 * The DB is public/book/explorer.json — the SAME file Vite bundles into the
 * build, so enriching it locally and committing makes the data live on Pages.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.BOOK_PORT) || 8787;
const MODE = process.env.BOOK_MODE === 'offline' ? 'offline' : 'online';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(HERE, '..', 'public', 'book', 'explorer.json');

const UPSTREAM = 'https://explorer.lichess.org/lichess';
const UPSTREAM_TIMEOUT_MS = 8000;
// Optional Lichess session cookie. The explorer endpoint returns 401 for plain
// Node/curl requests, but works when called with an authenticated browser
// session cookie. Treat this like a password: keep it local, never commit it.
// Set with the exact value that works in curl -b, for example:
// LICHESS_COOKIE='lila2=REAL_VALUE&sessionId=REAL_VALUE' npm run server
const LICHESS_COOKIE = process.env.LICHESS_COOKIE || '';

// Optional fallback token support. The explorer usually needs the session cookie,
// but keep this for quick experiments without changing the server code.
const LICHESS_TOKEN = process.env.LICHESS_TOKEN || '';

const DEBUG_BOOK = process.env.BOOK_DEBUG !== '0';

function debugLog(message) {
  if (DEBUG_BOOK) console.log(message);
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

function normalizeCookie(cookie) {
  return cookie.trim();
}

// Must match src/board/lichess.ts and src/settings/useSettings.tsx so the keys
// the client computes line up with what this server stores.
const ALL_SPEEDS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const ALL_RATINGS = ['1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'];

// ── persistent DB ─────────────────────────────────────────────────────────────
/** @type {{ version: number, entries: Record<string, { rows: any[], source: string, fetchedAt?: string }> }} */
let db = { version: 1, entries: {} };
let warned401 = false; // emit the 401/token hint only once per session

function loadDb() {
  try {
    const parsed = JSON.parse(readFileSync(DB_PATH, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.entries) db = parsed;
  } catch {
    // No DB yet (or unreadable) — start empty; first write creates it.
  }
}

function saveDb() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  writeFileSync(DB_PATH, JSON.stringify(db, null, 2) + '\n');
}

// ── key + transform (kept in sync with the client) ───────────────────────────
function normList(list, all) {
  const set = new Set((list || []).filter(Boolean));
  if (set.size === 0 || set.size === all.length) return ''; // empty or full = "all"
  return [...set].sort().join(',');
}

function bookKey(fen, speeds, ratings) {
  const f = fen.split(' ');
  const placement = `${f[0]} ${f[1] || 'w'}`;
  return `${placement}|${normList(speeds, ALL_SPEEDS)}|${normList(ratings, ALL_RATINGS)}`;
}

function humanGames(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function openingNameFromMove(move) {
  return move?.opening?.name || null;
}

/** Lichess explorer response → BookRow[] = [san, played%, gamesLabel, whiteWin%, draw%, openingName]. */
function toBookRows(data) {
  const total = data.white + data.draws + data.black;
  return (data.moves ?? []).slice(0, 12).map((m) => {
    const moveTotal = m.white + m.draws + m.black;
    const played = total ? Math.round((moveTotal / total) * 100) : 0;
    const ww = moveTotal ? Math.round((m.white / moveTotal) * 100) : 0;
    const dd = moveTotal ? Math.round((m.draws / moveTotal) * 100) : 0;
    const name = openingNameFromMove(m);
    return [m.san, played, humanGames(moveTotal), ww, dd, name];
  });
}

async function fetchFromLichess(fen, speeds, ratings) {
  const url = new URL(UPSTREAM);
  url.searchParams.set('variant', 'standard');
  url.searchParams.set('fen', fen);
  const sp = normList(speeds, ALL_SPEEDS);
  const ra = normList(ratings, ALL_RATINGS);
  if (sp) url.searchParams.set('speeds', sp);
  if (ra) url.searchParams.set('ratings', ra);

  const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'max-age=0',
    Dnt: '1',
    Priority: 'u=0, i',
    Referer: 'https://lichess.org/',
    'Sec-Ch-Ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"macOS"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  };
  if (LICHESS_COOKIE) headers.Cookie = normalizeCookie(LICHESS_COOKIE);
  if (LICHESS_TOKEN) headers.Authorization = `Bearer ${LICHESS_TOKEN}`;

  debugLog(`[book] lichess request fen: ${fen}`);
  debugLog(`[book] lichess request speeds: ${JSON.stringify(speeds || [])}`);
  debugLog(`[book] lichess request ratings: ${JSON.stringify(ratings || [])}`);
  debugLog(`[book] lichess request url: ${url.toString()}`);
  debugLog(`[book] lichess request headers: ${JSON.stringify(redactHeaders(headers))}`);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    debugLog(`[book] lichess response: ${res.status} ${res.statusText}`);
    debugLog(`[book] lichess response content-type: ${res.headers.get('content-type') || ''}`);
    debugLog(`[book] lichess response headers: ${JSON.stringify(Object.fromEntries(res.headers.entries()))}`);
    if (!res.ok) {
      const body = await res.text();
      console.warn(`[book] lichess error body: ${body.slice(0, 1000)}`);
      throw new Error(`lichess ${res.status}`);
    }
    const data = await res.json();
    const rows = (data.moves && data.moves.length) ? toBookRows(data) : [];
    return rows;
  } finally {
    clearTimeout(t);
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
};

function sendJson(res, status, body) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseList(v) {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  debugLog(`[book] incoming request: ${req.method} ${url.pathname}${url.search}`);

  if (url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true, mode: MODE, entries: Object.keys(db.entries).length });
    return;
  }

  if (url.pathname === '/api/common-moves') {
    const fen = url.searchParams.get('fen');
    if (!fen) { sendJson(res, 400, { error: 'missing fen' }); return; }
    const speeds = parseList(url.searchParams.get('speeds'));
    const ratings = parseList(url.searchParams.get('ratings'));
    const key = bookKey(fen, speeds, ratings);
    debugLog(`[book] common-moves fen: ${fen}`);
    debugLog(`[book] common-moves speeds: ${JSON.stringify(speeds)}`);
    debugLog(`[book] common-moves ratings: ${JSON.stringify(ratings)}`);
    debugLog(`[book] common-moves key: ${key}`);

    const cached = db.entries[key];
    if (cached) {
      debugLog(`[book] cache hit: ${key} (${cached.rows?.length ?? 0} rows)`);
      sendJson(res, 200, { rows: cached.rows, source: 'cache' });
      return;
    }
    debugLog(`[book] cache miss: ${key}`);

    if (MODE === 'offline') { sendJson(res, 200, { rows: null, source: 'empty' }); return; }

    try {
      const rows = await fetchFromLichess(fen, speeds, ratings);
      if (rows.length) {
        db.entries[key] = { rows, source: 'lichess', fetchedAt: new Date().toISOString() };
        saveDb();
        console.log(`[book] cached ${key} (${rows.length} moves) — db now ${Object.keys(db.entries).length} entries`);
        sendJson(res, 200, { rows, source: 'lichess' });
      } else {
        sendJson(res, 200, { rows: null, source: 'empty' });
      }
    } catch (err) {
      console.warn(`[book] lichess fetch failed for ${key}: ${err.message}`);
      if (/\b401\b/.test(err.message) && !warned401) {
        warned401 = true;
        console.warn('[book] Lichess explorer returned 401. This endpoint needs your local');
        console.warn('[book] browser session cookie — set LICHESS_COOKIE and restart.');
        console.warn('[book] The app keeps working from the bundled offline book regardless.');
      }
      sendJson(res, 200, { rows: null, source: 'error' });
    }
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

loadDb();
server.listen(PORT, () => {
  console.log(`[book] LaionChess Common Moves server on http://localhost:${PORT}`);
  console.log(`[book] mode=${MODE} · db=${DB_PATH} · ${Object.keys(db.entries).length} entries loaded`);
  console.log(`[book] debug logs: ${DEBUG_BOOK ? 'on' : 'off'} (set BOOK_DEBUG=0 to disable)`);
  if (MODE === 'offline') console.log('[book] offline only — gaps will NOT be fetched from Lichess');
  else {
    console.log(`[book] online with cache · Lichess cookie: ${LICHESS_COOKIE ? 'set' : 'none (set LICHESS_COOKIE if Lichess returns 401)'}`);
    console.log(`[book] online with cache · Lichess token: ${LICHESS_TOKEN ? 'set' : 'none'}`);
  }
});
