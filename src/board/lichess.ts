import { useEffect, useState } from 'react';
import type { BookRow } from '../data/book';
import { getLichessToken, markLichessTokenInvalid, useLichessAuth } from './lichessAuth';

// ── Common Moves (opening book) ───────────────────────────────────────────────
// Three-layer data source:
//   1. Lichess explorer, live, straight from the browser — when the user has
//      connected a Lichess account (OAuth PKCE, see lichessAuth.ts). The
//      explorer rejects anonymous calls (401), but accepts a Bearer token, so
//      this works on GitHub Pages too — no backend needed.
//   2. Local book server (VITE_BOOK_SERVER) — live data in local dev.
//   3. Bundled offline DB (public/book/explorer.json) — static fallback.
// If none has data for a position, null is returned (no hardcoded fallback).
const BOOK_SERVER = (import.meta.env.VITE_BOOK_SERVER ?? '').replace(/\/$/, '');

// Kept in sync with server/book-server.mjs and src/settings/useSettings.tsx, so
// the cache keys the client computes line up with what the server stores.
const ALL_SPEEDS = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
const ALL_RATINGS = ['1000', '1200', '1400', '1600', '1800', '2000', '2200', '2500'];

/** book.ts demo key: "<placement> <side>". */
function keyFromFen(fen: string): string {
  const f = fen.split(' ');
  return `${f[0]} ${f[1]}`;
}

/** Normalize a filter list: sorted; empty OR the full set → "" (= "all"). */
function normList(list: Array<string | number>, all: string[]): string {
  const set = new Set(list.map(String).filter(Boolean));
  if (set.size === 0 || set.size === all.length) return '';
  return [...set].sort().join(',');
}

/** DB/cache key: "<placement> <side>|<speeds>|<ratings>" (matches the server). */
function bookKey(fen: string, speeds: string[], ratings: number[]): string {
  return `${keyFromFen(fen)}|${normList(speeds, ALL_SPEEDS)}|${normList(ratings, ALL_RATINGS)}`;
}

// ── bundled offline DB (public/book/explorer.json), loaded once ───────────────
interface OfflineEntry { rows: BookRow[] }
type OfflineEntries = Record<string, OfflineEntry>;
let offlineDbPromise: Promise<OfflineEntries> | null = null;

function loadOfflineDb(): Promise<OfflineEntries> {
  if (!offlineDbPromise) {
    const url = `${import.meta.env.BASE_URL}book/explorer.json`;
    offlineDbPromise = fetch(url)
      .then(r => (r.ok ? r.json() : { entries: {} }))
      .then((j: { entries?: OfflineEntries }) => j.entries ?? {})
      .catch(() => ({} as OfflineEntries));
  }
  return offlineDbPromise;
}

// Kick off the DB fetch immediately at module load so the data is ready
// by the time the user opens the Analysis view.
loadOfflineDb();

async function offlineLookup(fen: string, speeds: string[], ratings: number[]): Promise<BookRow[] | null> {
  const db = await loadOfflineDb();
  const exact = db[bookKey(fen, speeds, ratings)];
  if (exact?.rows?.length) return exact.rows;
  // Fall back to the all-filters entry — the broadest data we have for the position.
  const broad = db[`${keyFromFen(fen)}||`];
  return broad?.rows?.length ? broad.rows : null;
}

// ── Lichess explorer, direct (needs a connected account) ─────────────────────
const EXPLORER = 'https://explorer.lichess.org/lichess';
const liveCache = new Map<string, BookRow[] | null>();
let liveBackoffUntil = 0; // after a 429 we pause live calls for a minute

function humanGames(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

interface ExplorerMove { san: string; white: number; draws: number; black: number; opening?: { name?: string } | null }
interface ExplorerResponse { white: number; draws: number; black: number; moves?: ExplorerMove[] }

/** Explorer JSON → BookRow[] (same transform as server/book-server.mjs). */
function toBookRows(data: ExplorerResponse): BookRow[] {
  const total = data.white + data.draws + data.black;
  return (data.moves ?? []).slice(0, 12).map((m): BookRow => {
    const moveTotal = m.white + m.draws + m.black;
    const played = total ? Math.round((moveTotal / total) * 100) : 0;
    const ww = moveTotal ? Math.round((m.white / moveTotal) * 100) : 0;
    const dd = moveTotal ? Math.round((m.draws / moveTotal) * 100) : 0;
    return [m.san, played, humanGames(moveTotal), ww, dd, m.opening?.name ?? null];
  });
}

/** undefined = live source unavailable (no token / error) → try the next layer. */
async function fetchLive(
  fen: string, speeds: string[], ratings: number[], signal: AbortSignal,
): Promise<BookRow[] | null | undefined> {
  const token = getLichessToken();
  if (!token || Date.now() < liveBackoffUntil) return undefined;
  const key = bookKey(fen, speeds, ratings);
  if (liveCache.has(key)) return liveCache.get(key) ?? null;
  const url = new URL(EXPLORER);
  url.searchParams.set('variant', 'standard');
  url.searchParams.set('fen', fen);
  url.searchParams.set('moves', '12');
  url.searchParams.set('topGames', '0');
  url.searchParams.set('recentGames', '0');
  const sp = normList(speeds, ALL_SPEEDS);
  const ra = normList(ratings, ALL_RATINGS);
  if (sp) url.searchParams.set('speeds', sp);
  if (ra) url.searchParams.set('ratings', ra);
  try {
    const res = await fetch(url, { signal, headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { markLichessTokenInvalid(); return undefined; }
    if (res.status === 429) { liveBackoffUntil = Date.now() + 60_000; return undefined; }
    if (!res.ok) return undefined;
    const data = (await res.json()) as ExplorerResponse;
    const rows = data.moves?.length ? toBookRows(data) : null;
    liveCache.set(key, rows);
    return rows;
  } catch {
    return undefined; // network / CORS / abort → fall back
  }
}

// ── local book server (dev) ───────────────────────────────────────────────────
const serverCache = new Map<string, BookRow[] | null>();
// Circuit breaker: if the local server isn't running we stop calling it after a
// couple of misses and fall back to the bundled DB for the session. A reload re-arms.
let serverFails = 0;
let serverDisabled = false;

async function fetchFromServer(
  fen: string, speeds: string[], ratings: number[], signal: AbortSignal,
): Promise<BookRow[] | null> {
  if (!BOOK_SERVER || serverDisabled) return null;
  const key = bookKey(fen, speeds, ratings);
  if (serverCache.has(key)) return serverCache.get(key) ?? null;
  const sp = normList(speeds, ALL_SPEEDS);
  const ra = normList(ratings, ALL_RATINGS);
  let url = `${BOOK_SERVER}/api/common-moves?fen=${encodeURIComponent(fen)}`;
  if (sp) url += `&speeds=${sp}`;
  if (ra) url += `&ratings=${ra}`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`book server ${res.status}`);
    const data = (await res.json()) as { rows: BookRow[] | null };
    const rows = data.rows ?? null;
    serverCache.set(key, rows); // cache misses too — server already consulted Lichess
    serverFails = 0;
    return rows;
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return null; // navigated away
    if (++serverFails >= 2) {
      serverDisabled = true;
      console.info('[LaionChess] Local book server unavailable — using bundled offline book for this session.');
    }
    return null;
  }
}

export type BookSource = 'live' | 'server' | 'offline' | null;

/**
 * Common-Moves rows for a position. Tries Lichess live (connected account),
 * then the local book server, then the bundled offline DB.
 * Returns null rows if none has data; `source` says where the rows came from.
 */
export function useOpeningExplorer(
  fen: string, speeds: string[] = [], ratings: number[] = [], enabled = true,
): { rows: BookRow[] | null; loading: boolean; source: BookSource } {
  const [rows, setRows] = useState<BookRow[] | null>(null);
  const [source, setSource] = useState<BookSource>(null);
  const [loading, setLoading] = useState(true);
  const { token } = useLichessAuth();
  const filterKey = `${speeds.join(',')}|${ratings.join(',')}`;

  useEffect(() => {
    if (!enabled) return;
    setRows(null);
    setSource(null);
    setLoading(true);
    let cancelled = false;
    const ctrl = new AbortController();
    // Debounced so stepping quickly through moves doesn't hammer the explorer.
    const t = setTimeout(async () => {
      let resolved: BookRow[] | null = null;
      let from: BookSource = null;
      try {
        const live = await fetchLive(fen, speeds, ratings, ctrl.signal);
        if (live !== undefined) { resolved = live; from = 'live'; }
        if (resolved === null && !cancelled) {
          const srv = await fetchFromServer(fen, speeds, ratings, ctrl.signal);
          if (srv !== null) { resolved = srv; from = 'server'; }
        }
        if (resolved === null && !cancelled) {
          const off = await offlineLookup(fen, speeds, ratings);
          if (off !== null) { resolved = off; from = 'offline'; }
        }
      } catch {
        resolved = null;
      }
      if (!cancelled) { setRows(resolved); setSource(resolved ? from : null); setLoading(false); }
    }, token ? 180 : 50);
    return () => { cancelled = true; ctrl.abort(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, filterKey, token, enabled]);

  return { rows, loading, source };
}

// Engine evaluation now comes from the local Stockfish worker — see board/engine.ts.
// (The old Lichess cloud-eval was removed: it only returned cached positions and
//  404'd for everything else, so the bar never reflected real play.)
