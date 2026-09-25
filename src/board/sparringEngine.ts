// ── Sparring engine: Stockfish as an opponent ────────────────────────────────
// A second, independent Stockfish worker (the analysis engine keeps its own),
// so playing a position out never fights with the analysis panel. Strength is
// set with Stockfish's "Skill Level" (0–20) and a per-move time budget.

export interface SparringLevel { label: string; skill: number; movetime: number }

export const SPARRING_LEVELS: SparringLevel[] = [
  { label: 'Beginner', skill: 1, movetime: 150 },
  { label: 'Club', skill: 6, movetime: 300 },
  { label: 'Strong', skill: 12, movetime: 600 },
  { label: 'Expert', skill: 17, movetime: 900 },
  { label: 'Max', skill: 20, movetime: 1200 },
];

class SparringEngine {
  private worker: Worker | null = null;
  private ready: Promise<void> | null = null;
  private waiting: ((uci: string | null) => void) | null = null;
  private resolveReady: (() => void) | null = null;
  private skill = -1;

  private ensure(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise<void>(res => { this.resolveReady = res; });
    this.worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish.js`);
    this.worker.onmessage = (ev: MessageEvent) => {
      const line: string = typeof ev.data === 'string' ? ev.data : (ev.data?.data ?? '');
      if (line === 'readyok') { this.resolveReady?.(); this.resolveReady = null; }
      else if (line.startsWith('bestmove')) {
        const uci = line.split(/\s+/)[1];
        const w = this.waiting;
        this.waiting = null;
        w?.(uci && uci !== '(none)' ? uci : null);
      }
    };
    this.worker.postMessage('uci');
    this.worker.postMessage('isready');
    return this.ready;
  }

  /** Best move (UCI, e.g. "e2e4" / "e7e8q") for `fen` at the given level. */
  async bestMove(fen: string, level: SparringLevel): Promise<string | null> {
    await this.ensure();
    // Abandon a previous request (takeback / restart while thinking).
    if (this.waiting) { this.worker!.postMessage('stop'); this.waiting(null); this.waiting = null; }
    if (level.skill !== this.skill) {
      this.worker!.postMessage(`setoption name Skill Level value ${level.skill}`);
      this.skill = level.skill;
    }
    return new Promise(res => {
      this.waiting = res;
      this.worker!.postMessage(`position fen ${fen}`);
      this.worker!.postMessage(`go movetime ${level.movetime}`);
    });
  }

  cancel() {
    if (this.waiting) { this.worker?.postMessage('stop'); const w = this.waiting; this.waiting = null; w(null); }
  }
}

export const sparringEngine = new SparringEngine();

// ── Lichess tablebase (≤ 7 pieces, public, no login) ─────────────────────────
export type TbCategory = 'win' | 'draw' | 'loss' | 'unknown';

/** Result for the side to move in `fen`, from the Lichess 7-piece tablebase. */
export async function tablebase(fen: string): Promise<TbCategory> {
  const pieces = fen.split(' ')[0].replace(/[^a-zA-Z]/g, '').length;
  if (pieces > 7) return 'unknown';
  try {
    const res = await fetch(`https://tablebase.lichess.ovh/standard?fen=${encodeURIComponent(fen)}`);
    if (!res.ok) return 'unknown';
    const j = (await res.json()) as { category?: string };
    const c = j.category ?? '';
    if (c === 'win' || c === 'syzygy-win' || c === 'maybe-win') return 'win';
    if (c === 'loss' || c === 'syzygy-loss' || c === 'maybe-loss') return 'loss';
    if (c === 'draw' || c === 'cursed-win' || c === 'blessed-loss') return 'draw';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
