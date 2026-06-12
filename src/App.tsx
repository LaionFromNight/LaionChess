import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { GameState, Position, PieceColor } from './chess/types';
import {
  createInitialState,
  executeMove,
  getLegalMoves,
  findKing,
  getPieceLabel,
} from './chess/logic';
import { parseFen, toFen } from './chess/fen';
import { exportPgn, parsePgn } from './chess/pgn';
import { resolveSan } from './chess/san';
import type { SpottingMode } from './chess/analysis';
import {
  createGameTree, addNode, getNodeState, findChildByMove,
  getMainLineTip, getPathToNode, deleteSubtree, pgnGameToTree, treeToPgnGame,
} from './chess/tree';
import type { GameTree } from './chess/tree';
import Board from './components/Board';
import MoveList from './components/MoveList';
import SpottingPanel from './components/SpottingPanel';
import PromotionPicker from './components/PromotionPicker';
import SettingsMenu from './components/SettingsMenu';
import EvalBar from './components/EvalBar';
import CommonMoves from './components/CommonMoves';
import BookFilters from './components/BookFilters';
import AnimatedPiece, { type AnimPiece } from './components/AnimatedPiece';
import { useSettings, BOARD_THEMES } from './settings/useSettings';
import { pieceSrc, pieceCode } from './board/pieceSrc';
import { buildSpottingOverlay } from './board/spottingOverlay';
import { getEvaluation } from './board/evaluation';
import { computeTopArrows } from './board/topArrows';
import { useOpeningExplorer } from './board/lichess';
import { useEngine, barSearchMs, SEARCH_LEVELS_MS } from './board/engine';
import { expandPv, type PvMove } from './board/pv';
import EnginePanel, { type PanelLine } from './components/EnginePanel';
import { useCourses, type CourseCardMeta } from './courses/useCourses';
import { loadProgress, countDone } from './courses/progress';
import TrainerView from './views/TrainerView';

// ── shared style helpers ──────────────────────────────────────────────────────

const BTN: React.CSSProperties = {
  padding: '10px 22px', fontSize: 13, fontWeight: 600,
  borderRadius: 6, cursor: 'pointer', letterSpacing: 1,
  textTransform: 'uppercase', transition: 'all 0.2s', border: 'none',
};

const MODAL_OVERLAY: React.CSSProperties = {
  position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.85)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
};

const MODAL_BOX: React.CSSProperties = {
  backgroundColor: '#0d1117', borderRadius: 12, padding: 32,
  maxWidth: 520, width: '92%',
};

const TEXTAREA: React.CSSProperties = {
  width: '100%', backgroundColor: '#0a0a1a', border: '1px solid #2a2a3a',
  borderRadius: 6, color: '#e0e0e0', padding: 12,
  fontSize: 12, fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box',
};

function ModalTitle({ color, text }: { color: string; text: string }) {
  return (
    <h2 style={{
      color, fontSize: 18, letterSpacing: 3, textTransform: 'uppercase',
      margin: '0 0 24px', textAlign: 'center', textShadow: `0 0 10px ${color}44`,
    }}>{text}</h2>
  );
}

function Btn({ color, bg, border, onClick, children, disabled }: {
  color: string; bg: string; border: string;
  onClick: () => void; children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '8px 16px', fontSize: 13, fontWeight: 600,
      border: `1px solid ${border}`, borderRadius: 6,
      cursor: disabled ? 'not-allowed' : 'pointer',
      backgroundColor: disabled ? '#111' : bg,
      color: disabled ? '#444' : color,
      opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
  );
}

function PanelToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`toggle btnish ${on ? 'on' : 'off'}`} onClick={onClick}>
      <span className="sw" />
      <span className="lb">{label}</span>
    </button>
  );
}

function downloadBlob(text: string, filename: string) {
  const blob = new Blob([text], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function squareName(pos: Position): string {
  return `${String.fromCharCode(97 + pos.col)}${8 - pos.row}`;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'laion-course';
}

function lineSans(nodes: string[], tree: GameTree): string {
  if (nodes.length === 0) return '';
  return nodes.map((nodeId, index) => {
    const node = tree.nodes[nodeId];
    const san = node?.move.san ?? '?';
    if (index % 2 === 0) return `${Math.floor(index / 2) + 1}. ${san}`;
    return san;
  }).join(' ');
}

function collectTerminalPaths(tree: GameTree): string[][] {
  const paths: string[][] = [];

  function walk(children: string[], path: string[]) {
    if (children.length === 0) {
      if (path.length > 0) paths.push(path);
      return;
    }
    for (const childId of children) {
      const child = tree.nodes[childId];
      if (!child) continue;
      walk(child.children, [...path, childId]);
    }
  }

  walk(tree.rootChildren, []);
  return paths;
}

function buildFoldedOpeningJson(tree: GameTree, title: string, side: PieceColor) {
  const paths = collectTerminalPaths(tree);
  const safeTitle = title.trim() || 'Untitled Course';
  return {
    schema: 'laionchess.folded-opening.v1',
    id: slugify(safeTitle),
    title: safeTitle,
    sideToTrain: side,
    startingFen: toFen(tree.initialState),
    generatedAt: new Date().toISOString(),
    lines: paths.map((path, index) => {
      const lastNode = tree.nodes[path[path.length - 1]];
      return {
        id: `line-${index + 1}`,
        name: `Line ${index + 1}`,
        pgn: lineSans(path, tree),
        finalFen: lastNode ? toFen(lastNode.state) : toFen(tree.initialState),
        moves: path.map((nodeId, ply) => {
          const move = tree.nodes[nodeId].move;
          return {
            ply: ply + 1,
            san: move.san ?? '?',
            from: squareName(move.from),
            to: squareName(move.to),
            piece: move.piece.type,
            color: move.piece.color,
            ...(move.promotion ? { promotion: move.promotion } : {}),
          };
        }),
      };
    }),
  };
}

type ActiveView = 'home' | 'analysis' | 'openings' | 'trainer' | 'create' | 'master';

type CourseCard = {
  id: string;
  name: string;
  tag: string;
  tagClass?: string;
  desc: string;
  lines: number;
  fen: string;
  ready: boolean;
};

const COURSES: CourseCard[] = [
  {
    id: 'scotch-game',
    name: 'Scotch Game',
    tag: 'Ready',
    tagClass: 'tag-green',
    desc: 'A direct weapon against 1...e5. Open the center on move 3 and develop with tempo.',
    lines: 6,
    fen: 'r1bqkbnr/pppp1ppp/2n5/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 2 4',
    ready: true,
  },
  {
    id: 'italian-game',
    name: 'Italian Game',
    tag: 'Planned',
    desc: 'Quiet development, long-term pressure on f7. The classical school in one course.',
    lines: 12,
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    ready: false,
  },
  {
    id: 'sicilian',
    name: 'Sicilian Defense',
    tag: 'Planned',
    desc: 'Fight for the win as Black from move one. Open Sicilian main lines.',
    lines: 24,
    fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6 0 2',
    ready: false,
  },
  {
    id: 'london',
    name: 'London System',
    tag: 'Planned',
    desc: 'One setup against everything. Solid structure, clear plans, minimal theory.',
    lines: 14,
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b KQkq - 1 2',
    ready: false,
  },
  {
    id: 'queens-gambit',
    name: "Queen's Gambit",
    tag: 'Planned',
    desc: 'Offer the c-pawn, take the center. Declined and Accepted main lines.',
    lines: 18,
    fen: 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3 0 2',
    ready: false,
  },
  {
    id: 'caro-kann',
    name: 'Caro-Kann Defense',
    tag: 'Planned',
    desc: 'The solid answer to 1.e4: sound structure without giving up activity.',
    lines: 16,
    fen: 'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    ready: false,
  },
];

function MiniBoard({ fen }: { fen: string }) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
  const state = parseFen(fen) ?? createInitialState();
  return (
    <div className="mini-board" aria-hidden="true">
      {state.board.map((row, rowIdx) => row.map((piece, colIdx) => {
        const light = (rowIdx + colIdx) % 2 === 0;
        const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type) : null;
        return (
          <span key={`${rowIdx}-${colIdx}`} style={{ background: light ? theme.light : theme.dark }}>
            {piece && (src
              ? <img src={src} alt={pieceCode(piece.color, piece.type)} draggable={false} style={{ width: '92%', height: '92%' }} />
              : <span style={{ color: piece.color === 'white' ? '#fff' : '#111', textShadow: piece.color === 'white' ? '0 0 2px #000' : '0 0 2px #fff' }}>{getPieceLabel(piece)}</span>
            )}
          </span>
        );
      }))}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { settings, setSetting } = useSettings();
  const [activeView, setActiveView] = useState<ActiveView>('home');

  // ── courses (loaded from public/courses) ──────────────────────────────────────
  const { catalog, courses } = useCourses();
  const [activeCourseId, setActiveCourseId] = useState('scotch-game');
  const activeCourse = courses[activeCourseId];

  // ── analysis / create panel toggles ──────────────────────────────────────────
  const [showEval, setShowEval] = useState(true);
  const [showBook, setShowBook] = useState(true);
  const [showTop, setShowTop] = useState(false);
  const [showBookOptions, setShowBookOptions] = useState(false);
  const [hoverBookSan, setHoverBookSan] = useState<string | null>(null);

  // ── game tree ───────────────────────────────────────────────────────────────
  const [tree, setTree] = useState<GameTree>(() => createGameTree(createInitialState()));
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);
  const [courseTitle, setCourseTitle] = useState('Untitled Course');
  const [courseSide, setCourseSide] = useState<PieceColor>('white');
  const [saveState, setSaveState] = useState('ready');
  const [courseSearch, setCourseSearch] = useState('');

  // ── playback ────────────────────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1000);

  // Refs for stale-closure-safe callbacks
  const currentNodeIdRef = useRef(currentNodeId);
  const treeRef = useRef(tree);
  const displayedStateRef = useRef<GameState>(tree.initialState);

  const mainLineTip = useMemo(() => getMainLineTip(tree), [tree]);
  const isAnalysisMode = currentNodeId !== mainLineTip;
  const hasAnyMoves = tree.rootChildren.length > 0;
  const terminalPaths = useMemo(() => collectTerminalPaths(tree), [tree]);
  const foldedOpeningJson = useMemo(
    () => buildFoldedOpeningJson(tree, courseTitle, courseSide),
    [tree, courseTitle, courseSide],
  );

  const displayedState = useMemo(() => getNodeState(tree, currentNodeId), [tree, currentNodeId]);
  const displayedFen = useMemo(() => toFen(displayedState), [displayedState]);

  // Common Moves (Lichess book, offline fallback).
  const { rows: bookRows, loading: bookLoading } = useOpeningExplorer(displayedFen, settings.bookSpeeds, settings.bookRatings);

  // ── PV preview (clicking a move in an engine line shows that position) ────────
  const [preview, setPreview] = useState<{ state: GameState; from: Position; to: Position } | null>(null);
  useEffect(() => { setPreview(null); }, [currentNodeId, displayedFen]);
  const boardState = preview?.state ?? displayedState;

  // ── local Stockfish analysis ──────────────────────────────────────────────────
  const enginePanelOn = settings.engineEnabled && activeView === 'analysis';
  const engineActive = activeView === 'analysis' && (showEval || enginePanelOn);
  const engineSnap = useEngine(displayedFen, {
    enabled: engineActive,
    multiPv: enginePanelOn ? settings.engineLines : 1,
    searchMs: enginePanelOn ? SEARCH_LEVELS_MS[settings.engineSearchLevel] : barSearchMs(),
    hashMb: settings.engineHashMb,
  });
  const bestLine = engineSnap.lines[0] ?? null;
  const barPawns = bestLine ? bestLine.pawns : getEvaluation(displayedState);
  const barMate = bestLine ? bestLine.mate : null;

  const evalTerminal: 'white' | 'black' | 'draw' | null =
    displayedState.isCheckmate ? (displayedState.currentTurn === 'white' ? 'black' : 'white')
    : displayedState.isStalemate ? 'draw'
    : null;

  // Expand engine PVs to SAN + preview FENs (analysis panel only).
  const engineLinesExpanded: PanelLine[] = useMemo(() => {
    if (!enginePanelOn) return [];
    return engineSnap.lines.map((l) => ({
      key: `pv${l.multipv}`,
      pawns: l.pawns,
      mate: l.mate,
      moves: expandPv(displayedState, l.pv, 12),
    }));
  }, [enginePanelOn, engineSnap, displayedState]);

  const handlePreviewMove = useCallback((m: PvMove) => {
    const st = parseFen(m.fen);
    if (st) setPreview({ state: st, from: m.from, to: m.to });
  }, []);

  const displayedLastMove = currentNodeId !== null ? (tree.nodes[currentNodeId]?.move ?? null) : null;
  const boardLastMove = preview
    ? { from: preview.from, to: preview.to }
    : (displayedLastMove ? { from: displayedLastMove.from, to: displayedLastMove.to } : null);

  const boardCheckSquare = useMemo(() => {
    if (!boardState.isCheck) return null;
    return findKing(boardState.board, boardState.currentTurn);
  }, [boardState]);

  // Keep refs in sync
  useEffect(() => { currentNodeIdRef.current = currentNodeId; });
  useEffect(() => { treeRef.current = tree; });
  useEffect(() => { displayedStateRef.current = displayedState; });

  // ── promotion picker ────────────────────────────────────────────────────────
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Position; to: Position } | null>(null);

  // ── spotting modes (multi-select, persisted across views) ────────────────────
  const [spottingModes, setSpottingModesState] = useState<Set<SpottingMode>>(
    () => new Set(settings.spotModes),
  );
  const setSpottingModes = useCallback((modes: Set<SpottingMode>) => {
    setSpottingModesState(modes);
    setSetting('spotModes', [...modes]);
  }, [setSetting]);

  const spottingOverlay = useMemo(
    () => buildSpottingOverlay(spottingModes, boardState),
    [spottingModes, boardState],
  );

  // ── Top-3 book arrows (Create view) ───────────────────────────────────────────
  const topArrows = useMemo(
    () => (showTop ? computeTopArrows(displayedState, bookRows) : []),
    [showTop, displayedState, bookRows],
  );

  // ── Engine PV arrows (Analysis view) — one per line, ranked by colour ─────────
  const ENGINE_ARROW_COLORS = ['rgba(0,255,136,0.92)', 'rgba(255,217,61,0.8)', 'rgba(255,159,67,0.72)', 'rgba(255,0,255,0.62)', 'rgba(120,140,255,0.55)'];
  const engineArrows = useMemo(() => {
    if (!enginePanelOn || !settings.engineArrows) return [];
    return engineLinesExpanded
      .filter(l => l.moves.length > 0)
      .map((l, i) => ({
        from: l.moves[0].from, to: l.moves[0].to,
        color: ENGINE_ARROW_COLORS[Math.min(i, ENGINE_ARROW_COLORS.length - 1)],
        width: i === 0 ? 3 : 2,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enginePanelOn, settings.engineArrows, engineLinesExpanded]);

  // ── Hover arrow from Common Moves ─────────────────────────────────────────────
  const hoverBookArrow = useMemo(() => {
    if (!hoverBookSan) return null;
    const resolved = resolveSan(displayedState, hoverBookSan);
    if (!resolved) return null;
    return { from: resolved.from, to: resolved.to, color: 'rgba(255,255,255,0.82)', width: 2.8 };
  }, [hoverBookSan, displayedState]);

  const boardArrows = useMemo(() => {
    const base = activeView === 'analysis' ? engineArrows : topArrows;
    if (!hoverBookArrow) return base;
    const deduped = base.filter(a =>
      !(a.from.row === hoverBookArrow.from.row && a.from.col === hoverBookArrow.from.col &&
        a.to.row === hoverBookArrow.to.row && a.to.col === hoverBookArrow.to.col)
    );
    return [hoverBookArrow, ...deduped];
  }, [activeView, engineArrows, topArrows, hoverBookArrow]);

  // ── board size ───────────────────────────────────────────────────────────────
  const [boardSize, setBoardSize] = useState(560);
  const BOARD_MIN = 240, BOARD_STEP = 60;

  // Auto-size for Analysis: fill viewport height/width, no manual controls needed.
  useEffect(() => {
    if (activeView !== 'analysis') return;
    const SIDEBAR = 210;
    const PANEL = 420;
    const PAGE_PAD_H = 40;   // 20px left + 20px right
    const PAGE_PAD_V = 16 + 40; // top + bottom
    const GRID_GAP = 12;
    const SPOTTING = 148;    // SpottingPanel fixed width
    const EVAL_W = showEval ? 26 + 12 : 0; // EvalBar + its gap
    const ROW_GAP = 12;      // gap between SpottingPanel and Board wrapper
    const SLACK = 24;        // breathing room

    const compute = () => {
      const availW = window.innerWidth - SIDEBAR - PANEL - PAGE_PAD_H - GRID_GAP - SPOTTING - EVAL_W - ROW_GAP;
      const availH = window.innerHeight - PAGE_PAD_V - SLACK;
      const raw = Math.min(availW, availH);
      // Snap to nearest 8px so each square is whole pixels
      setBoardSize(Math.max(BOARD_MIN, Math.floor(raw / 8) * 8));
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [activeView, showEval]);

  // ── modal states ────────────────────────────────────────────────────────────
  const [showNewGame, setShowNewGame] = useState(false);
  const [ngView, setNgView] = useState<'choice' | 'pgn' | 'fen'>('choice');
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState('');
  const [pgnText, setPgnText] = useState('');
  const [pgnError, setPgnError] = useState('');

  const [showExport, setShowExport] = useState(false);
  const [copyFenMsg, setCopyFenMsg] = useState('');
  const [copyPgnMsg, setCopyPgnMsg] = useState('');
  const pgnRef = useRef<HTMLTextAreaElement>(null);
  const anyModalOpen = showNewGame || showExport || pendingPromotion !== null;

  // ── valid moves ─────────────────────────────────────────────────────────────
  const validMoves = useMemo(() => {
    if (!selectedPos) return [];
    return getLegalMoves(
      displayedState.board, selectedPos,
      displayedState.enPassantTarget,
      displayedState.whiteCanCastleKingside, displayedState.whiteCanCastleQueenside,
      displayedState.blackCanCastleKingside, displayedState.blackCanCastleQueenside,
    );
  }, [displayedState, selectedPos]);

  // ── step-forward with animation ──────────────────────────────────────────────
  const stepForwardWithAnim = useCallback(() => {
    setIsPlaying(false);
    setSelectedPos(null);
    const t = treeRef.current;
    const curId = currentNodeIdRef.current;
    const children = curId === null ? t.rootChildren : (t.nodes[curId]?.children ?? []);
    if (children.length === 0) return;
    const nextId = children[0];
    const move = t.nodes[nextId]?.move;
    const curState = displayedStateRef.current;
    if (move && curState) {
      const piece = curState.board[move.from.row][move.from.col];
      if (piece) setAnimPiece({ piece, from: move.from, to: move.to });
    }
    setCurrentNodeId(nextId);
  }, []);

  // ── keyboard ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (anyModalOpen) return;
      if ((e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false); setSelectedPos(null);
        const curId = currentNodeIdRef.current;
        const t = treeRef.current;
        setCurrentNodeId(curId !== null ? (t.nodes[curId]?.parentId ?? null) : null);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepForwardWithAnim();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anyModalOpen, stepForwardWithAnim]);

  // ── auto-play ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const t = treeRef.current;
      const curId = currentNodeIdRef.current;
      const children = curId === null ? t.rootChildren : (t.nodes[curId]?.children ?? []);
      if (children.length === 0) { setIsPlaying(false); return; }
      const nextId = children[0];
      const move = t.nodes[nextId]?.move;
      const curState = displayedStateRef.current;
      if (move && curState) {
        const piece = curState.board[move.from.row][move.from.col];
        if (piece) setAnimPiece({ piece, from: move.from, to: move.to });
      }
      setCurrentNodeId(nextId);
    }, playSpeed);
    return () => clearInterval(id);
  }, [isPlaying, playSpeed]);

  // ── helpers ─────────────────────────────────────────────────────────────────
  function applyNewTree(newTree: GameTree, nodeId?: string | null) {
    setTree(newTree);
    setCurrentNodeId(nodeId !== undefined ? nodeId : getMainLineTip(newTree));
    setSelectedPos(null);
    setIsPlaying(false);
  }

  function doTreeMove(from: Position, to: Position, promotion?: import('./chess/types').PieceType) {
    const movingPiece = displayedState.board[from.row][from.col];
    const existing = findChildByMove(tree, currentNodeId, from, to, promotion);
    if (existing) {
      if (movingPiece) setAnimPiece({ piece: movingPiece, from, to });
      setCurrentNodeId(existing);
      return;
    }
    if (movingPiece) setAnimPiece({ piece: movingPiece, from, to });
    const newState = executeMove(displayedState, from, to, promotion);
    const lastMove = newState.moveHistory[newState.moveHistory.length - 1];
    const { tree: newTree, nodeId } = addNode(tree, currentNodeId, lastMove, newState);
    setTree(newTree);
    setCurrentNodeId(nodeId);
  }

  // Play a book row's SAN on the current position (Common Moves click).
  const playBookMove = (san: string) => {
    const resolved = resolveSan(displayedState, san);
    if (resolved) doTreeMove(resolved.from, resolved.to, resolved.promotionPiece);
  };

  const handleSquareClick = useCallback((pos: Position) => {
    if (preview) { setPreview(null); return; } // dismiss PV preview, act on next click
    if (displayedState.isCheckmate || displayedState.isStalemate) return;
    if (pendingPromotion) return;
    if (selectedPos && validMoves.some(m => m.row === pos.row && m.col === pos.col)) {
      const movingPiece = displayedState.board[selectedPos.row][selectedPos.col];
      const isPromotion = movingPiece?.type === 'pawn' && (pos.row === 0 || pos.row === 7);
      if (isPromotion) {
        setPendingPromotion({ from: selectedPos, to: pos });
        setSelectedPos(null);
        return;
      }
      setSelectedPos(null);
      doTreeMove(selectedPos, pos);
      return;
    }
    const piece = displayedState.board[pos.row][pos.col];
    setSelectedPos(piece && piece.color === displayedState.currentTurn ? pos : null);
  }, [displayedState, selectedPos, validMoves, pendingPromotion, tree, currentNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromotionSelect = useCallback((pieceType: import('./chess/types').PieceType) => {
    if (!pendingPromotion) return;
    setPendingPromotion(null);
    doTreeMove(pendingPromotion.from, pendingPromotion.to, pieceType);
  }, [pendingPromotion, displayedState, tree, currentNodeId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePromotionCancel = useCallback(() => {
    setPendingPromotion(null);
  }, []);

  const handleUndo = () => {
    const tip = getMainLineTip(tree);
    if (tip === null) return;
    const parentId = tree.nodes[tip].parentId;
    setTree(deleteSubtree(tree, tip));
    setCurrentNodeId(parentId);
  };

  // ── new game modal ──────────────────────────────────────────────────────────
  const openNewGame = () => {
    setNgView('choice'); setFenInput(''); setFenError('');
    setPgnText(''); setPgnError(''); setShowNewGame(true);
  };

  const startFresh = () => { applyNewTree(createGameTree(createInitialState()), null); setShowNewGame(false); };

  const openTrainerCourse = (courseId: string) => {
    setActiveCourseId(courseId);
    setActiveView('trainer');
  };

  // Analysis → handoff: load a position from another view into a fresh tree.
  const openAnalysisFromState = (state: GameState) => {
    applyNewTree(createGameTree(parseFen(toFen(state)) ?? state), null);
    setActiveView('analysis');
  };

  const loadFromFen = () => {
    const trimmed = fenInput.trim();
    if (!trimmed) { setFenError('FEN cannot be empty'); return; }
    const state = parseFen(trimmed);
    if (!state) { setFenError('Invalid FEN — check all 6 fields'); return; }
    applyNewTree(createGameTree(state), null); setShowNewGame(false);
  };

  const loadFromPgn = () => {
    const db = parsePgn(pgnText);
    if (db.games.length === 0) { setPgnError('No valid PGN found'); return; }
    const game = db.games[0];
    const initState = (game.tags.SetUp === '1' && game.tags.FEN)
      ? (parseFen(game.tags.FEN) ?? createInitialState())
      : createInitialState();
    const newTree = pgnGameToTree(game, initState);
    if (newTree.rootChildren.length === 0 && game.moves.length > 0) {
      setPgnError('Could not parse any moves from PGN'); return;
    }
    applyNewTree(newTree); setShowNewGame(false);
  };

  // ── export ──────────────────────────────────────────────────────────────────
  const currentFen = toFen(displayedState);
  const currentPgn = exportPgn(treeToPgnGame(tree));
  const activePath = useMemo(() => getPathToNode(tree, currentNodeId), [tree, currentNodeId]);
  const activeLineText = lineSans(activePath, tree);

  const copyFen = () => navigator.clipboard.writeText(currentFen).then(() => {
    setCopyFenMsg('Copied!'); setTimeout(() => setCopyFenMsg(''), 2000);
  });
  const copyPgn = () => navigator.clipboard.writeText(currentPgn).then(() => {
    setCopyPgnMsg('Copied!'); setTimeout(() => setCopyPgnMsg(''), 2000);
  });

  const downloadFoldedOpening = () => {
    const filename = `${slugify(courseTitle)}.json`;
    downloadBlob(JSON.stringify(foldedOpeningJson, null, 2), filename);
    setSaveState(`downloaded ${filename}`);
    setTimeout(() => setSaveState('ready'), 2500);
  };

  // ── status ───────────────────────────────────────────────────────────────────
  const statusText = displayedState.isCheckmate
    ? `Checkmate! ${displayedState.currentTurn === 'white' ? 'Black' : 'White'} wins!`
    : displayedState.isStalemate ? 'Stalemate! Draw.'
    : displayedState.isCheck
      ? `${displayedState.currentTurn === 'white' ? 'White' : 'Black'} is in check!`
      : isAnalysisMode ? 'Analysis'
      : `${displayedState.currentTurn === 'white' ? 'White' : 'Black'} to move`;

  const statusColor = displayedState.isCheckmate ? '#ff0040'
    : displayedState.isStalemate ? '#ffd93d'
    : displayedState.isCheck ? '#ff9f43'
    : isAnalysisMode ? '#ff9f43'
    : displayedState.currentTurn === 'white' ? '#fff' : '#0ff';

  const statusClass = displayedState.isCheckmate ? 'checkmate-overlay'
    : displayedState.isCheck ? 'status-slide-in' : '';

  const SPEED_OPTIONS = [{ label: '1s', ms: 1000 }, { label: '5s', ms: 5000 }, { label: '15s', ms: 15000 }];

  // ── course catalog (loaded "ready" courses + static "planned" cards) ──────────
  type DisplayCard = {
    id: string; name: string; tag: string; tagClass?: string; desc: string;
    fen: string; ready: boolean; lines: number; learned: number;
  };
  const readyCards: DisplayCard[] = catalog.map((meta: CourseCardMeta) => {
    const c = courses[meta.id];
    const total = c?.lines.length ?? 0;
    const prog = loadProgress(meta.id);
    const learned = c ? c.lines.filter(l => prog.learn[l.id]).length : 0;
    return {
      id: meta.id, name: meta.name, tag: meta.tag, tagClass: meta.tagClass,
      desc: meta.desc, fen: meta.fen, ready: true, lines: total, learned,
    };
  });
  const plannedCards: DisplayCard[] = COURSES
    .filter(c => !c.ready && !catalog.some(m => m.id === c.id))
    .map(c => ({ id: c.id, name: c.name, tag: c.tag, tagClass: c.tagClass, desc: c.desc, fen: c.fen, ready: false, lines: c.lines, learned: 0 }));
  const allCards = [...readyCards, ...plannedCards];
  const filteredCourses = allCards.filter(course => course.name.toLowerCase().includes(courseSearch.trim().toLowerCase()));
  const totalLines = allCards.reduce((sum, c) => sum + c.lines, 0);
  const readyLines = readyCards.reduce((sum, c) => sum + c.lines, 0);

  // Scotch progress for Home "continue training".
  const scotchCourse = courses['scotch-game'];
  const scotchProgress = loadProgress('scotch-game');
  const scotchTotal = scotchCourse?.lines.length ?? 0;
  const scotchLearned = scotchCourse ? scotchCourse.lines.filter(l => scotchProgress.learn[l.id]).length : 0;

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="laion-app">
      <div className="bg-grid" />
      <div className="bg-scan" />

      <div className="page-shell">

        {/* Sidebar nav */}
        <nav className="side-nav">
          <button className="wordmark" type="button" onClick={() => setActiveView('home')}>
            <span className="knight">♞</span>
            <span className="name">LaionChess</span>
          </button>
          <nav className="main-nav">
            <button type="button" className={activeView === 'home' ? 'active' : ''} onClick={() => setActiveView('home')}><span>⌂</span>Home</button>
            <button type="button" className={activeView === 'analysis' ? 'active' : ''} onClick={() => setActiveView('analysis')}><span>☷</span>Analysis</button>
            <button type="button" className={activeView === 'openings' || activeView === 'trainer' ? 'active' : ''} onClick={() => setActiveView('openings')}><span>♘</span>Openings</button>
            <button type="button" className={activeView === 'create' ? 'active' : ''} onClick={() => setActiveView('create')}><span>⚙</span>Create</button>
            <button type="button" className={activeView === 'master' ? 'active' : ''} onClick={() => setActiveView('master')}><span>☰</span>Master Plan</button>
          </nav>
          <div className="side-nav-footer">
            <button className="btn btn-magenta" type="button" onClick={openNewGame}>⟳ New / Import</button>
            <button className="btn btn-green" type="button" onClick={() => setShowExport(true)}>↑ Export</button>
            <SettingsMenu />
          </div>
        </nav>

        {/* Main scrollable content */}
        <div className="page-content">

        {activeView === 'home' && (
          <main className="home-view">
            <section className="hero">
              <span className="kicker">Practice &gt; Playing Bots</span>
              <h1 className="h-display">LaionChess</h1>
              <hr className="divider-glow" />
              <p className="tagline">Analyze your games. Drill your openings.<br />Deliberate practice, move by move.</p>
              <div className="cta-row">
                <button className="btn btn-cyan" type="button" onClick={() => openTrainerCourse('scotch-game')}>♞ Train Openings</button>
                <button className="btn btn-ghost" type="button" onClick={() => setActiveView('analysis')}>Open Analysis Board →</button>
              </div>
            </section>

            <section className="feature-grid">
              <button className="card feature f-cyan" type="button" onClick={() => setActiveView('analysis')}>
                <div className="ic">☷</div>
                <h2>Analysis Board</h2>
                <p>Free analysis with PGN/FEN import, export, variants and the existing Laion spotting modes.</p>
                <span className="go">Open →</span>
              </button>
              <button className="card feature f-green" type="button" onClick={() => setActiveView('openings')}>
                <div className="ic">♘</div>
                <h2>Opening Trainer</h2>
                <p>Ready-made repertoires replayed against the board. Learn mode guides you; Practice mode tests recall.</p>
                <span className="go">Browse courses →</span>
              </button>
              <button className="card feature f-magenta" type="button" onClick={() => setActiveView('create')}>
                <div className="ic">⚙</div>
                <h2>Course Creator</h2>
                <p>Build your repertoire from scratch or import PGN/FEN, then export folded-opening JSON.</p>
                <span className="go">Start building →</span>
              </button>
            </section>

            <section className="card continue-card">
              <div className="mini"><MiniBoard fen={COURSES[0].fen} /></div>
              <div className="body">
                <span className="kicker">Continue training</span>
                <h3>Scotch Game</h3>
                <div className="progress-track"><div className="progress-fill" style={{ width: `${scotchTotal ? Math.round((scotchLearned / scotchTotal) * 100) : 0}%` }} /></div>
                <span className="mono-dim">{scotchLearned}/{scotchTotal} lines learned</span>
              </div>
              <button className="btn btn-green" type="button" onClick={() => openTrainerCourse('scotch-game')}>Resume →</button>
            </section>
          </main>
        )}

        {activeView === 'openings' && (
          <main className="catalog-view">
            <div className="catalog-head">
              <span className="kicker">Repertoire Training</span>
              <h1 className="h-display">Opening Courses</h1>
              <p>Learn lines move by move, then prove them in Practice.</p>
              <hr className="divider-glow" />
            </div>

            <div className="catalog-bar">
              <div className="search-wrap">
                <span className="icon">⌕</span>
                <input className="input" value={courseSearch} onChange={e => setCourseSearch(e.target.value)} placeholder="Search openings..." />
              </div>
              <div className="right">
                <span className="stat">{readyLines}/{totalLines} lines ready</span>
                <button className="btn btn-magenta" type="button" onClick={() => setActiveView('create')}>⚙ Create a Course</button>
              </div>
            </div>

            <div className="course-grid">
              {filteredCourses.map(course => {
                const pct = course.ready && course.lines ? Math.round((course.learned / course.lines) * 100) : 0;
                return (
                  <button
                    key={course.id}
                    type="button"
                    className={`card course-card ${course.ready ? '' : 'disabled'}`}
                    onClick={() => course.ready && openTrainerCourse(course.id)}
                  >
                    <div className="mini"><MiniBoard fen={course.fen} /></div>
                    <div className="body">
                      <div className="ttl"><h2>{course.name}</h2><span className={`tag ${course.tagClass ?? ''}`}>{course.tag}</span></div>
                      <div className="desc">{course.desc}</div>
                      <div className="meta">{course.lines} lines total</div>
                      <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                      <div className="foot"><span className="mono-dim">{course.ready ? `${course.learned}/${course.lines} learned` : 'not started'}</span><span className="go">{course.ready ? 'Train →' : 'Coming soon'}</span></div>
                    </div>
                  </button>
                );
              })}
            </div>
          </main>
        )}

        {activeView === 'trainer' && (
          activeCourse ? (
            <TrainerView
              course={activeCourse}
              spottingModes={spottingModes}
              setSpottingModes={setSpottingModes}
              boardSize={boardSize}
              setBoardSize={setBoardSize}
              onAnalysis={openAnalysisFromState}
            />
          ) : (
            <main className="catalog-view">
              <div className="catalog-head">
                <span className="kicker">Opening Trainer</span>
                <h1 className="h-display">Loading…</h1>
                <p>Fetching course data. If this persists, check public/courses/manifest.json.</p>
              </div>
            </main>
          )
        )}

        {(activeView === 'analysis' || activeView === 'create') && (
          <>
            {activeView === 'create' && (
              <div className={statusClass} style={{
                fontSize: 18, fontWeight: 700, padding: '8px 28px', borderRadius: 6,
                backgroundColor: statusColor, color: statusColor === '#fff' || statusColor === '#0ff' ? '#000' : '#fff',
                boxShadow: `0 0 20px ${statusColor}40, 0 2px 8px rgba(0,0,0,0.4)`,
                letterSpacing: 1, textTransform: 'uppercase',
              }}>{statusText}</div>
            )}

            <div className="board-workspace">
              <div className="board-col">
                <div className="board-row">
                  <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />
                  {showEval && (
                    <div style={{ paddingTop: 34 }}>
                      <EvalBar pawns={barPawns} mate={barMate} terminal={evalTerminal} height={boardSize} />
                    </div>
                  )}
                  <div style={{ position: 'relative' }}>
                    <Board
                      arrows={boardArrows}
                      board={boardState.board}
                      selectedPos={preview ? null : selectedPos}
                      validMoves={preview ? [] : validMoves}
                      lastMove={boardLastMove}
                      checkSquare={boardCheckSquare}
                      enPassantTarget={boardState.enPassantTarget}
                      whiteCanCastleKingside={boardState.whiteCanCastleKingside}
                      whiteCanCastleQueenside={boardState.whiteCanCastleQueenside}
                      blackCanCastleKingside={boardState.blackCanCastleKingside}
                      blackCanCastleQueenside={boardState.blackCanCastleQueenside}
                      isCheck={boardState.isCheck}
                      isCheckmate={boardState.isCheckmate}
                      isStalemate={boardState.isStalemate}
                      currentTurn={boardState.currentTurn}
                      onSquareClick={handleSquareClick}
                      onResize={setBoardSize}
                      overlay={spottingOverlay}
                      interactiveOverlay={pendingPromotion ? (
                        <PromotionPicker
                          color={displayedState.currentTurn}
                          col={pendingPromotion.to.col}
                          isWhitePromotion={displayedState.currentTurn === 'white'}
                          squarePx={Math.round(boardSize / 8)}
                          onSelect={handlePromotionSelect}
                          onCancel={handlePromotionCancel}
                        />
                      ) : undefined}
                      boardSize={boardSize}
                      hidePieceAt={animPiece?.to ?? null}
                      animOverlay={animPiece ? (
                        <AnimatedPiece anim={animPiece} boardSize={boardSize} onDone={() => setAnimPiece(null)} />
                      ) : undefined}
                    />
                    {(isAnalysisMode || preview) && <div className="analysis-frame" />}
                  </div>
                </div>

                {hasAnyMoves && activeView === 'create' && (
                  <div className="control-stack">
                    <div className="control-row">
                      <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(null); }} disabled={currentNodeId === null}>⏮</Btn>
                      <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(currentNodeId !== null ? (tree.nodes[currentNodeId]?.parentId ?? null) : null); }} disabled={currentNodeId === null}>◀</Btn>
                      <button onClick={() => {
                        if (isPlaying) { setIsPlaying(false); return; }
                        if (currentNodeId === mainLineTip) setCurrentNodeId(null);
                        setIsPlaying(true);
                      }} className={isPlaying ? 'btn btn-yellow' : 'btn btn-green'}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
                      <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={stepForwardWithAnim} disabled={!(currentNodeId === null ? tree.rootChildren.length > 0 : (tree.nodes[currentNodeId]?.children.length ?? 0) > 0)}>▶</Btn>
                      <Btn color="#00ffff" bg="#051520" border="#00ffff30" onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }} disabled={currentNodeId === mainLineTip}>⏭</Btn>
                      {SPEED_OPTIONS.map(({ label, ms }) => (
                        <button key={ms} onClick={() => setPlaySpeed(ms)} className={`seg ${playSpeed === ms ? 'active' : ''}`}>{label}</button>
                      ))}
                    </div>
                  </div>
                )}

                {activeView === 'create' && (
                  <div className="board-size-control">
                    <span>BOARD</span>
                    <button onClick={() => setBoardSize(s => Math.max(BOARD_MIN, s - BOARD_STEP))} disabled={boardSize <= BOARD_MIN}>−</button>
                    <strong>{boardSize}px</strong>
                    <button onClick={() => setBoardSize(s => s + BOARD_STEP)}>+</button>
                  </div>
                )}
              </div>

              {activeView === 'analysis' && (
                <aside className="an-panel">
                  <div className="an-head">
                    <div className={`an-status ${statusClass}`} style={{
                      fontSize: 12, fontWeight: 700, padding: '5px 10px', borderRadius: 5, flex: 1,
                      backgroundColor: statusColor, color: statusColor === '#fff' || statusColor === '#0ff' ? '#000' : '#fff',
                      letterSpacing: 1, textTransform: 'uppercase', textAlign: 'center',
                      boxShadow: `0 0 10px ${statusColor}30`,
                    }}>{statusText}</div>
                    <SettingsMenu />
                  </div>
                  <div className="an-toggles">
                    <PanelToggle on={showEval} label="Evaluation" onClick={() => setShowEval(v => !v)} />
                    <PanelToggle on={settings.engineEnabled} label="Engine analysis" onClick={() => setSetting('engineEnabled', !settings.engineEnabled)} />
                  </div>

                  <EnginePanel
                    enabled={settings.engineEnabled}
                    onToggle={() => setSetting('engineEnabled', !settings.engineEnabled)}
                    showArrows={settings.engineArrows}
                    onToggleArrows={() => setSetting('engineArrows', !settings.engineArrows)}
                    best={bestLine ? { pawns: bestLine.pawns, mate: bestLine.mate } : null}
                    depth={engineSnap.depth}
                    searching={enginePanelOn}
                    lines={engineLinesExpanded}
                    startMoveNum={displayedState.fullmoveNumber}
                    whiteToMove={displayedState.currentTurn === 'white'}
                    searchLevel={settings.engineSearchLevel}
                    onSearchLevel={(n) => setSetting('engineSearchLevel', n)}
                    numLines={settings.engineLines}
                    onNumLines={(n) => setSetting('engineLines', n)}
                    hashMb={settings.engineHashMb}
                    onHashMb={(mb) => setSetting('engineHashMb', mb)}
                    onPreviewMove={handlePreviewMove}
                  />

                  {hasAnyMoves && (
                    <MoveList
                      tree={tree}
                      currentNodeId={currentNodeId}
                      onNavigate={(id: string | null) => { setIsPlaying(false); setSelectedPos(null); setCurrentNodeId(id); }}
                    />
                  )}

                  {hasAnyMoves && (
                    <div className="panel-controls">
                      <button className="pc-btn" onClick={() => { setIsPlaying(false); setCurrentNodeId(null); }} disabled={currentNodeId === null}>⏮</button>
                      <button className="pc-btn" onClick={() => { setIsPlaying(false); setCurrentNodeId(currentNodeId !== null ? (tree.nodes[currentNodeId]?.parentId ?? null) : null); }} disabled={currentNodeId === null}>◀</button>
                      <button className={`pc-btn pc-play${isPlaying ? ' pc-pause' : ''}`} onClick={() => {
                        if (isPlaying) { setIsPlaying(false); return; }
                        if (currentNodeId === mainLineTip) setCurrentNodeId(null);
                        setIsPlaying(true);
                      }}>{isPlaying ? '⏸' : '▶'}</button>
                      <button className="pc-btn" onClick={stepForwardWithAnim} disabled={!(currentNodeId === null ? tree.rootChildren.length > 0 : (tree.nodes[currentNodeId]?.children.length ?? 0) > 0)}>▶</button>
                      <button className="pc-btn" onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }} disabled={currentNodeId === mainLineTip}>⏭</button>
                      <div className="pc-sep" />
                      {SPEED_OPTIONS.map(({ label, ms }) => (
                        <button key={ms} className={`pc-btn pc-seg${playSpeed === ms ? ' active' : ''}`} onClick={() => setPlaySpeed(ms)}>{label}</button>
                      ))}
                      {isAnalysisMode && <button className="pc-btn pc-warn" onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }}>↩ end</button>}
                    </div>
                  )}

                  <div className="sec-block">
                    <div className="book-sec-head">
                      <PanelToggle on={showBook} label="Common moves" onClick={() => setShowBook(v => !v)} />
                      <button
                        type="button"
                        className={`btn-book-opts${showBookOptions ? ' active' : ''}`}
                        onClick={() => setShowBookOptions(v => !v)}
                        title="Filter options"
                      >⚙</button>
                      {showBookOptions && (
                        <div className="book-opts-popup">
                          <BookFilters />
                        </div>
                      )}
                    </div>
                    {showBook && <CommonMoves rows={bookRows} loading={bookLoading} onPlay={playBookMove} onHover={setHoverBookSan} />}
                  </div>

                  <div className="sec-block">
                    <div className="sec-title">Position</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-yellow" type="button" onClick={copyFen}>{copyFenMsg || '📋 FEN'}</button>
                      <button className="btn btn-green" type="button" onClick={copyPgn}>{copyPgnMsg || '📋 PGN'}</button>
                      <button className="btn btn-ghost" type="button" onClick={() => setShowExport(true)}>Export…</button>
                    </div>
                  </div>
                </aside>
              )}

              {activeView === 'create' && (
                <aside className="side-panel creator-panel">
                  <div className="course-head">
                    <div className="course-icon">⚙</div>
                    <input value={courseTitle} onChange={e => setCourseTitle(e.target.value)} maxLength={60} />
                    <span>{saveState}</span>
                    <SettingsMenu />
                  </div>
                  <div className="cr-toggles">
                    <PanelToggle on={showEval} label="Eval" onClick={() => setShowEval(v => !v)} />
                    <PanelToggle on={showBook} label="Book" onClick={() => setShowBook(v => !v)} />
                    <PanelToggle on={showTop} label="Top 3" onClick={() => setShowTop(v => !v)} />
                    <div className="side-seg">
                      <button type="button" className={courseSide === 'white' ? 'sel' : ''} onClick={() => setCourseSide('white')}>♔ White</button>
                      <button type="button" className={courseSide === 'black' ? 'sel' : ''} onClick={() => setCourseSide('black')}>♚ Black</button>
                    </div>
                  </div>
                  <div className="current-line">{activeLineText ? activeLineText : <span>No moves yet</span>}</div>
                  <div className="panel-tools">
                    <button className="btn btn-cyan" type="button" onClick={handleUndo} disabled={mainLineTip === null}>◀ Undo</button>
                    <button className="btn btn-ghost" type="button" onClick={startFresh}>↻ Clear</button>
                    <button className="btn btn-yellow" type="button" onClick={() => openAnalysisFromState(displayedState)}>Analysis →</button>
                    <button className="btn btn-magenta" type="button" onClick={openNewGame}>Import</button>
                    <button className="btn btn-green" type="button" onClick={downloadFoldedOpening} disabled={terminalPaths.length === 0}>↓ Save JSON</button>
                  </div>

                  {showBook && (
                    <div className="sec-block">
                      <div className="sec-title">Common moves</div>
                      <BookFilters />
                      <CommonMoves rows={bookRows} loading={bookLoading} onPlay={playBookMove} onHover={setHoverBookSan} />
                    </div>
                  )}

                  <div className="saved-lines">
                    <div className="sec-title">Course lines ({terminalPaths.length})</div>
                    {terminalPaths.length === 0 ? <div className="empty-panel compact">No saved paths</div> : terminalPaths.map((path, index) => (
                      <button key={path.join('-')} className={`saved-line ${currentNodeId === path[path.length - 1] ? 'current' : ''}`} type="button" onClick={() => setCurrentNodeId(path[path.length - 1])}>
                        <span>#{index + 1}</span><strong>{lineSans(path, tree)}</strong><em>{path.length} ply</em>
                      </button>
                    ))}
                  </div>
                  <details className="import-box">
                    <summary>PGN / FEN import</summary>
                    <div className="import-actions">
                      <button className="btn btn-cyan" type="button" onClick={() => { setNgView('pgn'); setPgnText(''); setPgnError(''); setShowNewGame(true); }}>Load PGN</button>
                      <button className="btn btn-yellow" type="button" onClick={() => { setNgView('fen'); setFenInput(currentFen); setFenError(''); setShowNewGame(true); }}>Load FEN</button>
                    </div>
                  </details>
                  <div className="creator-hint">
                    Save JSON downloads a <code>laionchess.folded-opening.v1</code> file. Drop it into <code>public/courses/</code> and add an entry to <code>manifest.json</code> to publish it as a lesson on the Openings board.
                  </div>
                </aside>
              )}
            </div>
          </>
        )}

        {activeView === 'master' && (
          <main className="doc-view">
            <div className="doc-head">
              <span className="kicker">Implementation Master Plan</span>
              <h1 className="h-display">Opening Trainer</h1>
              <p className="sub">Roadmap and current implementation map for LaionChess: analysis board, opening catalog, trainer, course creator, folded openings and shared theming.</p>
            </div>
            {[
              ['0 · Current state', ['Vite + React + TypeScript app deployed under /LaionChess/.', 'Analysis board with PGN/FEN import/export, game-tree variations and a material eval bar.', 'Spotting modes (Dalmacja / Lucyfer / King Path / King Shot / LaionEye) preserved and persisted across all board screens.']],
              ['1 · Implemented screens', ['Home, Analysis, Openings, Trainer, Create and Master Plan are React views.', 'Guided Trainer: Learn / Practice with coach notes, hint arrows, mistake flashes, completion banner and per-mode progress.', 'Settings: board themes, four self-hosted piece sets, UI accent and arrows/coords toggles, persisted in localStorage.']],
              ['2 · Data model', ['Trainable courses load from public/courses (manifest.json + course files).', 'Create exports laionchess.folded-opening.v1; drop it in public/courses + manifest to publish a lesson.', 'Common-Moves book + Top-3 arrows are keyed by board placement + side to move.']],
              ['3 · Next phases', ['Wire a real engine behind getEvaluation (Stockfish / Lichess cloud).', 'Add SRS Drill / Time trainer modes (the locked tabs).', 'Author more courses beyond Scotch as JSON files.']],
            ].map(([title, items]) => (
              <section key={title as string}>
                <h2>{title as string}</h2>
                <ul>{(items as string[]).map(item => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
          </main>
        )}

        </div>{/* end .page-content */}
      </div>{/* end .page-shell */}

      {/* ── NEW GAME MODAL ── */}
      {showNewGame && (
        <div style={MODAL_OVERLAY} onClick={() => setShowNewGame(false)}>
          <div style={{ ...MODAL_BOX, border: '1px solid #ff00ff30', boxShadow: '0 0 40px rgba(255,0,255,0.15)' }} onClick={e => e.stopPropagation()}>
            {ngView === 'choice' && (
              <>
                <ModalTitle color="#ff00ff" text="New / Import" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <button onClick={startFresh} style={{ ...BTN, border: '1px solid #ff00ff60', backgroundColor: '#1a001a', color: '#ff00ff', width: '100%', padding: '16px 22px', fontSize: 14 }}>♟ Standard Starting Position</button>
                  <button onClick={() => { setNgView('pgn'); setPgnText(''); setPgnError(''); }} style={{ ...BTN, border: '1px solid #00ffff40', backgroundColor: '#001a1a', color: '#00ffff', width: '100%', padding: '16px 22px', fontSize: 14 }}>📄 Load from PGN</button>
                  <button onClick={() => { setNgView('fen'); setFenInput(currentFen); setFenError(''); }} style={{ ...BTN, border: '1px solid #ffd93d40', backgroundColor: '#1a1a00', color: '#ffd93d', width: '100%', padding: '16px 22px', fontSize: 14 }}>⚙ Load from FEN</button>
                </div>
                <div style={{ textAlign: 'right', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setShowNewGame(false)}>Cancel</Btn>
                </div>
              </>
            )}
            {ngView === 'pgn' && (
              <>
                <ModalTitle color="#00ffff" text="Load from PGN" />
                <textarea value={pgnText} onChange={e => { setPgnText(e.target.value); setPgnError(''); }} placeholder="Paste PGN here..." style={{ ...TEXTAREA, minHeight: 160 }} />
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666', cursor: 'pointer', textDecoration: 'underline' }}>Or load from .pgn file</span>
                  <input type="file" accept=".pgn,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setPgnText((ev.target?.result as string) ?? ''); r.readAsText(f); }} />
                </label>
                {pgnError && <div style={{ color: '#ff4060', fontSize: 13, marginTop: 8 }}>{pgnError}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setNgView('choice')}>← Back</Btn>
                  <Btn color="#00ffff" bg="#001a1a" border="#00ffff50" onClick={loadFromPgn}>Load Game</Btn>
                </div>
              </>
            )}
            {ngView === 'fen' && (
              <>
                <ModalTitle color="#ffd93d" text="Load from FEN" />
                <textarea value={fenInput} onChange={e => { setFenInput(e.target.value); setFenError(''); }} style={{ ...TEXTAREA, minHeight: 64 }} />
                <div style={{ fontSize: 11, color: '#555', marginTop: 6, lineHeight: 1.5 }}>Format: pieces / turn / castling / en passant / halfmove / fullmove</div>
                <label style={{ display: 'block', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#666', cursor: 'pointer', textDecoration: 'underline' }}>Or load from .fen file</span>
                  <input type="file" accept=".fen,text/plain" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setFenInput(((ev.target?.result as string) ?? '').trim()); r.readAsText(f); }} />
                </label>
                {fenError && <div style={{ color: '#ff4060', fontSize: 13, marginTop: 8 }}>{fenError}</div>}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
                  <Btn color="#666" bg="transparent" border="#444" onClick={() => setNgView('choice')}>← Back</Btn>
                  <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d50" onClick={loadFromFen}>Load Position</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EXPORT MODAL ── */}
      {showExport && (
        <div style={MODAL_OVERLAY} onClick={() => setShowExport(false)}>
          <div style={{ ...MODAL_BOX, border: '1px solid #00ff8830', boxShadow: '0 0 40px rgba(0,255,136,0.12)', maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <ModalTitle color="#00ff88" text="Export" />
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#00ffff', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>FEN Position</div>
              <textarea value={currentFen} readOnly style={{ ...TEXTAREA, minHeight: 48, color: '#ffd93d', cursor: 'text' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d40" onClick={copyFen}>{copyFenMsg || '📋 Copy FEN'}</Btn>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#00ffff', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 8 }}>PGN Game</div>
              <textarea ref={pgnRef} value={currentPgn} readOnly style={{ ...TEXTAREA, minHeight: 120, color: '#00ff88', cursor: 'text' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <Btn color="#00ff88" bg="#0a1a0a" border="#00ff8840" onClick={copyPgn}>{copyPgnMsg || '📋 Copy PGN'}</Btn>
                <Btn color="#00ff88" bg="#0a1a0a" border="#00ff8840" onClick={() => downloadBlob(currentPgn, 'game.pgn')}>↓ Download .pgn</Btn>
                <Btn color="#ffd93d" bg="#1a1a00" border="#ffd93d40" onClick={() => downloadBlob(currentFen, 'position.fen')}>↓ Download .fen</Btn>
                <Btn color="#ff00ff" bg="#1a001a" border="#ff00ff40" onClick={downloadFoldedOpening} disabled={terminalPaths.length === 0}>↓ Folded JSON</Btn>
              </div>
            </div>
            <div style={{ textAlign: 'right', marginTop: 24 }}>
              <Btn color="#666" bg="transparent" border="#444" onClick={() => setShowExport(false)}>Close</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
