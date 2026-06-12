import { useEffect, useState } from 'react';

/**
 * Local Stockfish engine (lite single-threaded WASM, served from public/engine/).
 * Single-threaded → no SharedArrayBuffer, so it runs on GitHub Pages without
 * COOP/COEP headers. Supports MultiPV, a movetime/infinite search budget and a
 * configurable hash size. Threads are NOT exposed: the single-threaded build
 * can't use them on this host.
 */

export const ENGINE_NAME = 'Stockfish 18 lite';

/** Search-time slider levels (ms). Last = infinite (analyse until position changes). */
export const SEARCH_LEVELS_MS: number[] = [500, 1000, 1500, 2000, 3000, 5000, 8000, 12000, Infinity];
export const HASH_OPTIONS_MB: number[] = [16, 32, 64, 128, 256];
export const MAX_LINES = 5;
/** Quick budget used for the eval bar when the full analysis panel is off. */
const BAR_ONLY_MS = 2500;

export interface PvLine {
  multipv: number;
  /** White-relative evaluation in pawns (used when mate is null). */
  pawns: number;
  /** White-relative forced mate distance (signed, |N| ≥ 1), or null. */
  mate: number | null;
  depth: number;
  /** Principal variation as UCI moves. */
  pv: string[];
}

export interface EngineSnapshot {
  lines: PvLine[]; // sorted by multipv ascending (line 1 = best)
  depth: number;
}

export interface EngineOptions {
  enabled: boolean;
  multiPv: number;
  /** Per-position search budget in ms; Infinity = analyse until superseded. */
  searchMs: number;
  hashMb: number;
}

type Listener = (snapshot: EngineSnapshot, fen: string) => void;

class StockfishEngine {
  private worker: Worker | null = null;
  private ready = false;
  private readyWaiters: Array<() => void> = [];

  private searching = false;
  private pending: { fen: string; opts: EngineOptions } | null = null;
  private activeFen: string | null = null;
  private activeWhiteToMove = true;

  private appliedMultiPv = 1;
  private appliedHash = 16;

  private lines = new Map<number, PvLine>();
  private listener: Listener | null = null;

  setListener(listener: Listener | null) {
    this.listener = listener;
  }

  analyse(fen: string, opts: EngineOptions) {
    this.ensureWorker();
    this.pending = { fen, opts };
    if (!this.ready) {
      this.readyWaiters.push(() => this.maybeDispatch());
      return;
    }
    if (this.searching) this.send('stop'); // bestmove triggers the next dispatch
    else this.maybeDispatch();
  }

  stop() {
    this.pending = null;
    if (this.searching) this.send('stop');
  }

  private ensureWorker() {
    if (this.worker) return;
    const url = `${import.meta.env.BASE_URL}engine/stockfish.js`;
    this.worker = new Worker(url);
    this.worker.onmessage = (ev: MessageEvent) => {
      const line = typeof ev.data === 'string' ? ev.data : (ev.data?.data ?? '');
      this.onMessage(line);
    };
    this.send('uci');
    this.send('isready');
  }

  private send(cmd: string) {
    this.worker?.postMessage(cmd);
  }

  private maybeDispatch() {
    if (!this.ready || this.searching || this.pending == null) return;
    const { fen, opts } = this.pending;
    this.pending = null;

    if (opts.hashMb !== this.appliedHash) {
      this.send(`setoption name Hash value ${opts.hashMb}`);
      this.appliedHash = opts.hashMb;
      this.send('ucinewgame');
    }
    const wantMultiPv = Math.max(1, opts.multiPv);
    if (wantMultiPv !== this.appliedMultiPv) {
      this.send(`setoption name MultiPV value ${wantMultiPv}`);
      this.appliedMultiPv = wantMultiPv;
    }

    this.activeFen = fen;
    this.activeWhiteToMove = fen.split(' ')[1] !== 'b';
    this.lines = new Map();
    this.searching = true;
    this.send(`position fen ${fen}`);
    this.send(opts.searchMs === Infinity ? 'go infinite' : `go movetime ${opts.searchMs}`);
  }

  private onMessage(line: string) {
    if (line === 'uciok' || line === 'readyok') {
      if (!this.ready) {
        this.ready = true;
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        waiters.forEach((w) => w());
      }
      return;
    }

    if (line.startsWith('bestmove')) {
      this.searching = false;
      this.maybeDispatch();
      return;
    }

    if (line.startsWith('info') && line.includes(' pv ') && this.activeFen) {
      const parsed = parseInfo(line, this.activeWhiteToMove);
      if (!parsed) return;
      this.lines.set(parsed.multipv, parsed);
      const sorted = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
      const depth = sorted.reduce((m, l) => Math.max(m, l.depth), 0);
      this.listener?.({ lines: sorted, depth }, this.activeFen);
    }
  }
}

/** Parse a UCI `info` line (with a pv) into a white-relative PvLine. */
function parseInfo(line: string, whiteToMove: boolean): PvLine | null {
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] ?? 0);
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] ?? 1);

  const pvMatch = line.match(/ pv (.+)$/);
  if (!pvMatch) return null;
  const pv = pvMatch[1].trim().split(/\s+/);

  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) {
    const stmMate = Number(mateMatch[1]);
    if (stmMate === 0) return null; // already mated — handled via terminal state in the UI
    const mate = whiteToMove ? stmMate : -stmMate;
    return { multipv, pawns: mate > 0 ? 99 : -99, mate, depth, pv };
  }
  const cpMatch = line.match(/score cp (-?\d+)/);
  if (cpMatch) {
    const stmCp = Number(cpMatch[1]);
    const cp = whiteToMove ? stmCp : -stmCp;
    return { multipv, pawns: cp / 100, mate: null, depth, pv };
  }
  return null;
}

const engine = new StockfishEngine();

/**
 * Live engine analysis for a position. Returns the current set of PV lines
 * (line 1 = best). Empty until the engine reports, or when disabled.
 */
export function useEngine(fen: string, opts: EngineOptions): EngineSnapshot {
  const [snapshot, setSnapshot] = useState<EngineSnapshot>({ lines: [], depth: 0 });

  useEffect(() => {
    if (!opts.enabled) {
      engine.stop();
      setSnapshot({ lines: [], depth: 0 });
      return;
    }
    setSnapshot({ lines: [], depth: 0 });
    let cancelled = false;
    engine.setListener((snap, evalFen) => {
      if (!cancelled && evalFen === fen) setSnapshot(snap);
    });
    engine.analyse(fen, opts);
    return () => {
      cancelled = true;
      engine.setListener(null);
    };
  }, [fen, opts.enabled, opts.multiPv, opts.searchMs, opts.hashMb]);

  return snapshot;
}

/** Label for a search-time slider level. */
export function searchLevelLabel(ms: number): string {
  if (ms === Infinity) return '∞';
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`;
}

/** Resolve the per-position search budget: full user budget when the panel is on, else a quick bar pass. */
export function barSearchMs(): number {
  return BAR_ONLY_MS;
}
