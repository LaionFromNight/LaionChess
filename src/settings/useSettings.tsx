import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type { SpottingMode } from '../chess/analysis';

// ── types ───────────────────────────────────────────────────────────────────
export type Accent = 'cyan' | 'green' | 'magenta' | 'amber';
export type BoardTheme = 'classic' | 'neon' | 'forest' | 'ice';
export type PieceSet = 'classic' | 'merida' | 'alpha' | 'glyph';

export type ExplorerSpeed = 'ultraBullet' | 'bullet' | 'blitz' | 'rapid' | 'classical' | 'correspondence';
export const EXPLORER_SPEEDS: ExplorerSpeed[] = ['ultraBullet', 'bullet', 'blitz', 'rapid', 'classical', 'correspondence'];
export const EXPLORER_SPEED_LABELS: Record<ExplorerSpeed, string> = {
  ultraBullet: 'UltraB', bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', classical: 'Classical', correspondence: 'Corr',
};
export const EXPLORER_RATINGS: number[] = [1000, 1200, 1400, 1600, 1800, 2000, 2200, 2500];

export interface UiSettings {
  accent: Accent;
  boardTheme: BoardTheme;
  pieceSet: PieceSet;
  arrows: boolean;
  coords: boolean;
  /** Spotting modes chosen on any board screen, persisted across views. */
  spotModes: SpottingMode[];
  /** Lichess opening-explorer filters (Common Moves). Empty = all. */
  bookSpeeds: ExplorerSpeed[];
  bookRatings: number[];
  /** Local engine analysis (Analysis view). */
  engineEnabled: boolean;
  engineArrows: boolean;
  engineLines: number;       // MultiPV, 1..5
  engineSearchLevel: number; // index into SEARCH_LEVELS_MS
  engineHashMb: number;
}

// ── theme + piece-set maps (verbatim from prototype js/theme.js) ──────────────
export interface BoardThemeDef {
  label: string; light: string; dark: string; coordL: string; coordD: string;
}
export const BOARD_THEMES: Record<BoardTheme, BoardThemeDef> = {
  classic: { label: 'Classic Wood', light: '#f0d9b5', dark: '#b58863', coordL: '#b58863', coordD: '#f0d9b5' },
  neon:    { label: 'Neon Night',   light: '#1e2a44', dark: '#121a30', coordL: '#5fd9d9', coordD: '#5fd9d9' },
  forest:  { label: 'Forest',       light: '#e6e8c9', dark: '#6a8f4f', coordL: '#6a8f4f', coordD: '#e6e8c9' },
  ice:     { label: 'Ice',          light: '#dee3e6', dark: '#8ca2ad', coordL: '#8ca2ad', coordD: '#dee3e6' },
};

export type PieceSetDef =
  | { label: string; kind: 'img'; dir: string }
  | { label: string; kind: 'glyph' };

// Open-source piece SVGs self-hosted under public/pieces/<set>/ (see
// public/pieces/LICENSES.md). Served from the app base so they work offline.
const PIECES_DIR = `${import.meta.env.BASE_URL}pieces/`;
export const PIECE_SETS: Record<PieceSet, PieceSetDef> = {
  classic: { label: 'Classic (Cburnett)', kind: 'img', dir: PIECES_DIR + 'cburnett/' },
  merida:  { label: 'Merida',             kind: 'img', dir: PIECES_DIR + 'merida/' },
  alpha:   { label: 'Alpha',              kind: 'img', dir: PIECES_DIR + 'alpha/' },
  glyph:   { label: 'Glyph (Unicode)',    kind: 'glyph' },
};

export const ACCENT_SWATCHES: Array<{ value: Accent; color: string }> = [
  { value: 'cyan',    color: '#00ffff' },
  { value: 'green',   color: '#00ff88' },
  { value: 'magenta', color: '#ff00ff' },
  { value: 'amber',   color: '#ffd93d' },
];

// ── persistence ───────────────────────────────────────────────────────────────
const STORAGE_KEY = 'laionchess-ui-settings';

const DEFAULTS: UiSettings = {
  accent: 'cyan',
  boardTheme: 'classic',
  pieceSet: 'classic',
  arrows: true,
  coords: true,
  spotModes: [],
  bookSpeeds: [...EXPLORER_SPEEDS],
  bookRatings: [...EXPLORER_RATINGS],
  engineEnabled: false,
  engineArrows: true,
  engineLines: 3,
  engineSearchLevel: 3,
  engineHashMb: 64,
};

function load(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

// ── context ───────────────────────────────────────────────────────────────────
interface SettingsContextValue {
  settings: UiSettings;
  setSetting: <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UiSettings>(load);
  const initial = useRef(true);

  // Apply accent to <html data-accent> so CSS overrides recolor the whole UI.
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent;
  }, [settings.accent]);

  // Persist on change.
  useEffect(() => {
    if (initial.current) { initial.current = false; return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
  }, [settings]);

  const setSetting = useCallback(<K extends keyof UiSettings>(key: K, value: UiSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const value = useMemo(() => ({ settings, setSetting }), [settings, setSetting]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
