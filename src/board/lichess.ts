import { useEffect, useState } from 'react';
import type { BookRow } from '../data/book';

// ── Common Moves (opening book) ───────────────────────────────────────────────
// Two-layer data source:
//   1. Local book server (VITE_BOOK_SERVER) — live Lichess data when running.
//   2. Bundled offline DB (public/book/explorer.json) — static fallback.
// If neither has data for a position, null is returned (no hardcoded fallback).
// A browser can't call Lichess directly (401 on Origin), so live data only comes
// via the local server (server/book-server.mjs).
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

/**
 * Common-Moves rows for a position. Tries the local book server first,
 * falls back to the bundled offline DB. Returns null if neither has data.
 */
export function useOpeningExplorer(
  fen: string, speeds: string[] = [], ratings: number[] = [],
): { rows: BookRow[] | null; loading: boolean } {
  const [rows, setRows] = useState<BookRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const filterKey = `${speeds.join(',')}|${ratings.join(',')}`;

  useEffect(() => {
    setRows(null);
    setLoading(true);
    let cancelled = false;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        // Server first (live/cached), then the bundled offline DB on miss/absence.
        let resolved = await fetchFromServer(fen, speeds, ratings, ctrl.signal);
        if (resolved === null && !cancelled) resolved = await offlineLookup(fen, speeds, ratings);
        if (!cancelled) setRows(resolved);
      } catch {
        if (!cancelled) setRows(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 50);
    return () => { cancelled = true; ctrl.abort(); clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen, filterKey]);

  return { rows, loading };
}

// Engine evaluation now comes from the local Stockfish worker — see board/engine.ts.
// (The old Lichess cloud-eval was removed: it only returned cached positions and
//  404'd for everything else, so the bar never reflected real play.)
