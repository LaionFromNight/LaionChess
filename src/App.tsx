import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import type { GameState, Position, PieceColor, PieceType } from './chess/types';
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
import { ARROW } from './board/arrowPalette';
import { useOpeningExplorer } from './board/lichess';
import { completeLichessLogin, VIEW_KEY } from './board/lichessAuth';
import { useEngine, barSearchMs, SEARCH_LEVELS_MS } from './board/engine';
import { expandPv, type PvMove } from './board/pv';
import { useBoardKeys, useFitBoardSize } from './board/useBoardLayout';
import EnginePanel, { type PanelLine } from './components/EnginePanel';
import { useCourses, type Course, type CourseCardMeta } from './courses/useCourses';
import { loadProgress, loadLastCourse, saveLastCourse } from './courses/progress';
import TrainerView from './views/TrainerView';

// ── helpers ───────────────────────────────────────────────────────────────────

function PanelToggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`toggle ${on ? 'on' : 'off'}`} onClick={onClick} aria-pressed={on}>
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

function MiniBoard({ fen, flipped }: { fen: string; flipped?: boolean }) {
  const { settings } = useSettings();
  const theme = BOARD_THEMES[settings.boardTheme] ?? BOARD_THEMES.classic;
  const state = parseFen(fen) ?? createInitialState();
  const rows = flipped ? [...state.board].reverse().map(r => [...r].reverse()) : state.board;
  return (
    <div className="mini-board" aria-hidden="true">
      {rows.map((row, rowIdx) => row.map((piece, colIdx) => {
        const light = (rowIdx + colIdx) % 2 === 0;
        const src = piece ? pieceSrc(settings.pieceSet, piece.color, piece.type) : null;
        return (
          <span key={`${rowIdx}-${colIdx}`} style={{ background: light ? theme.light : theme.dark }}>
            {piece && (src
              ? <img src={src} alt={pieceCode(piece.color, piece.type)} draggable={false} />
              : <span className={`glyph ${piece.color}`}>{getPieceLabel(piece)}</span>
            )}
          </span>
        );
      }))}
    </div>
  );
}

type DisplayCard = CourseCardMeta & { playAs: 'w' | 'b'; lines: number; learned: number; practiced: number };

function CourseCard({ card, onOpen }: { card: DisplayCard; onOpen: () => void }) {
  const pct = card.lines ? Math.round((card.learned / card.lines) * 100) : 0;
  return (
    <button type="button" className="course-card" onClick={onOpen}>
      <div className="mini"><MiniBoard fen={card.fen} flipped={card.playAs === 'b'} /></div>
      <div className="body">
        <div className="ttl">
          <h3>{card.name}</h3>
          <span className={`side-pill ${card.playAs === 'w' ? 'white' : 'black'}`}>{card.playAs === 'w' ? 'White' : 'Black'}</span>
        </div>
        <p className="desc">{card.desc}</p>
        <div className="foot">
          <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
          <span className="muted">{card.learned}/{card.lines} learned</span>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const { settings, setSetting } = useSettings();
  const [activeView, setActiveView] = useState<ActiveView>('home');

  // ── courses (loaded from public/courses) ──────────────────────────────────────
  const { catalog, courses, loading: coursesLoading } = useCourses();
  const [activeCourseId, setActiveCourseId] = useState(() => loadLastCourse() ?? 'scotch-game');
  const activeCourse: Course | undefined = courses[activeCourseId];

  // Remember where we are so the Lichess OAuth round-trip returns to this view,
  // and finish that round-trip (?code=…) when we come back from lichess.org.
  useEffect(() => {
    try { sessionStorage.setItem(VIEW_KEY, activeView); } catch { /* ignore */ }
  }, [activeView]);
  useEffect(() => {
    completeLichessLogin().then(back => {
      if (back && ['home', 'openings', 'analysis', 'create', 'trainer', 'master'].includes(back)) {
        setActiveView(back as ActiveView);
      }
    });
  }, []);

  // ── analysis / create panel toggles ──────────────────────────────────────────
  const [showEval, setShowEval] = useState(true);
  const [showBook, setShowBook] = useState(true);
  const [showTop, setShowTop] = useState(false);
  const [showBookOptions, setShowBookOptions] = useState(false);
  const [hoverBookSan, setHoverBookSan] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  // ── game tree ───────────────────────────────────────────────────────────────
  const [tree, setTree] = useState<GameTree>(() => createGameTree(createInitialState()));
  const [currentNodeId, setCurrentNodeId] = useState<string | null>(null);
  const [selectedPos, setSelectedPos] = useState<Position | null>(null);
  const [animPiece, setAnimPiece] = useState<AnimPiece | null>(null);
  const [courseTitle, setCourseTitle] = useState('Untitled Course');
  const [courseSide, setCourseSide] = useState<PieceColor>('white');
  const [saveState, setSaveState] = useState('');
  const [courseSearch, setCourseSearch] = useState('');
  const [sideFilter, setSideFilter] = useState<'all' | 'w' | 'b'>('all');

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
  const isBoardView = activeView === 'analysis' || activeView === 'create';

  // Common Moves (Lichess book, offline fallback).
  const { rows: bookRows, loading: bookLoading, source: bookSource } = useOpeningExplorer(displayedFen, settings.bookSpeeds, settings.bookRatings, isBoardView);

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
  const engineArrows = useMemo(() => {
    if (!enginePanelOn || !settings.engineArrows) return [];
    const colors = [ARROW.green, ARROW.gold, ARROW.violet, ARROW.coral, ARROW.blue];
    return engineLinesExpanded
      .filter(l => l.moves.length > 0)
      .map((l, i) => ({
        from: l.moves[0].from, to: l.moves[0].to,
        color: colors[Math.min(i, colors.length - 1)],
        width: i === 0 ? 2.6 : 1.9,
      }));
  }, [enginePanelOn, settings.engineArrows, engineLinesExpanded]);

  // ── Hover arrow from Common Moves ─────────────────────────────────────────────
  const hoverBookArrow = useMemo(() => {
    if (!hoverBookSan) return null;
    const resolved = resolveSan(displayedState, hoverBookSan);
    if (!resolved) return null;
    return { from: resolved.from, to: resolved.to, color: ARROW.sky, width: 2.4 };
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

  // ── board size: fit the column, capped by the user's preferred size ─────────
  const { ref: fitRef, size: boardSize } = useFitBoardSize(settings.boardMax, {
    reserveWidth: activeView === 'analysis' && showEval ? 40 : 0,
    reserveHeight: 118,
  });

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
  const anyModalOpen = showNewGame || showExport || pendingPromotion !== null;

  // Close modals with Escape.
  useEffect(() => {
    if (!showNewGame && !showExport) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowNewGame(false); setShowExport(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showNewGame, showExport]);

  // ── valid moves ─────────────────────────────────────────────────────────────
  const legalFrom = useCallback((state: GameState, from: Position) => getLegalMoves(
    state.board, from,
    state.enPassantTarget,
    state.whiteCanCastleKingside, state.whiteCanCastleQueenside,
    state.blackCanCastleKingside, state.blackCanCastleQueenside,
  ), []);

  const validMoves = useMemo(
    () => (selectedPos ? legalFrom(displayedState, selectedPos) : []),
    [displayedState, selectedPos, legalFrom],
  );

  // ── navigation ────────────────────────────────────────────────────────────────
  const childrenOf = (t: GameTree, id: string | null) => (id === null ? t.rootChildren : (t.nodes[id]?.children ?? []));

  const stepForwardWithAnim = useCallback(() => {
    setIsPlaying(false);
    setSelectedPos(null);
    const t = treeRef.current;
    const curId = currentNodeIdRef.current;
    const children = childrenOf(t, curId);
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

  const stepBack = useCallback(() => {
    setIsPlaying(false); setSelectedPos(null); setAnimPiece(null);
    const curId = currentNodeIdRef.current;
    setCurrentNodeId(curId !== null ? (treeRef.current.nodes[curId]?.parentId ?? null) : null);
  }, []);

  const goStart = useCallback(() => {
    setIsPlaying(false); setSelectedPos(null); setAnimPiece(null); setCurrentNodeId(null);
  }, []);

  /** End of the line currently shown (follows first children from here). */
  const goEnd = useCallback(() => {
    setIsPlaying(false); setSelectedPos(null); setAnimPiece(null);
    const t = treeRef.current;
    let id = currentNodeIdRef.current;
    for (;;) {
      const ch = childrenOf(t, id);
      if (ch.length === 0) break;
      id = ch[0];
    }
    setCurrentNodeId(id);
  }, []);

  useBoardKeys({
    prev: stepBack,
    next: stepForwardWithAnim,
    first: goStart,
    last: goEnd,
    flip: () => setFlipped(f => !f),
  }, isBoardView && !anyModalOpen);

  // ── auto-play ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      const t = treeRef.current;
      const curId = currentNodeIdRef.current;
      const children = childrenOf(t, curId);
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

  function doTreeMove(from: Position, to: Position, promotion?: PieceType, animate = true) {
    const movingPiece = displayedState.board[from.row][from.col];
    const existing = findChildByMove(tree, currentNodeId, from, to, promotion);
    if (animate && movingPiece) setAnimPiece({ piece: movingPiece, from, to });
    if (existing) {
      setCurrentNodeId(existing);
      return;
    }
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

  /** Shared by click-to-move and drag-and-drop. */
  const tryMove = (from: Position, to: Position, animate: boolean): boolean => {
    if (!legalFrom(displayedState, from).some(m => m.row === to.row && m.col === to.col)) return false;
    const movingPiece = displayedState.board[from.row][from.col];
    setSelectedPos(null);
    if (movingPiece?.type === 'pawn' && (to.row === 0 || to.row === 7)) {
      setPendingPromotion({ from, to });
      return true;
    }
    doTreeMove(from, to, undefined, animate);
    return true;
  };

  const handleSquareClick = (pos: Position) => {
    if (preview) { setPreview(null); return; } // dismiss PV preview, act on next click
    if (displayedState.isCheckmate || displayedState.isStalemate) return;
    if (pendingPromotion) return;
    if (selectedPos && tryMove(selectedPos, pos, true)) return;
    const piece = displayedState.board[pos.row][pos.col];
    setSelectedPos(piece && piece.color === displayedState.currentTurn && !(selectedPos && selectedPos.row === pos.row && selectedPos.col === pos.col) ? pos : null);
  };

  const handleDragMove = (from: Position, to: Position) => {
    if (preview) setPreview(null);
    if (pendingPromotion || displayedState.isCheckmate || displayedState.isStalemate) return;
    if (!tryMove(from, to, false)) setSelectedPos(null);
  };

  const handlePromotionSelect = (pieceType: PieceType) => {
    if (!pendingPromotion) return;
    setPendingPromotion(null);
    doTreeMove(pendingPromotion.from, pendingPromotion.to, pieceType, false);
  };

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
    saveLastCourse(courseId);
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
    setSaveState(`Saved ${filename}`);
    setTimeout(() => setSaveState(''), 2500);
  };

  // ── status ───────────────────────────────────────────────────────────────────
  const turnName = displayedState.currentTurn === 'white' ? 'White' : 'Black';
  const status: { text: string; tone: 'white' | 'black' | 'warn' | 'bad' | 'info' } = displayedState.isCheckmate
    ? { text: `Checkmate — ${displayedState.currentTurn === 'white' ? 'Black' : 'White'} wins`, tone: 'bad' }
    : displayedState.isStalemate ? { text: 'Stalemate — draw', tone: 'warn' }
    : displayedState.isCheck ? { text: `${turnName} is in check`, tone: 'warn' }
    : isAnalysisMode ? { text: `${turnName} to move · exploring`, tone: 'info' }
    : { text: `${turnName} to move`, tone: displayedState.currentTurn };

  const SPEED_OPTIONS = [{ label: '1s', ms: 1000 }, { label: '3s', ms: 3000 }, { label: '5s', ms: 5000 }];

  // ── course catalog ──────────────────────────────────────────────────────────
  const allCards: DisplayCard[] = catalog.map((meta: CourseCardMeta) => {
    const c = courses[meta.id];
    const total = c?.lines.length ?? 0;
    const prog = loadProgress(meta.id);
    return {
      ...meta,
      playAs: c?.playAs ?? 'w',
      lines: total,
      learned: c ? c.lines.filter(l => prog.learn[l.id]).length : 0,
      practiced: c ? c.lines.filter(l => prog.practice[l.id]).length : 0,
    };
  });
  const q = courseSearch.trim().toLowerCase();
  const filteredCourses = allCards.filter(c =>
    (sideFilter === 'all' || c.playAs === sideFilter) &&
    (!q || c.name.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q)));
  const totalLines = allCards.reduce((sum, c) => sum + c.lines, 0);
  const learnedLines = allCards.reduce((sum, c) => sum + c.learned, 0);
  const lastCard = allCards.find(c => c.id === activeCourseId) ?? allCards[0];

  const canStepForward = childrenOf(tree, currentNodeId).length > 0;

  const playbackControls = (
    <div className="nav-controls">
      <button type="button" className="tool-btn icon" title="Start (↑)" onClick={goStart} disabled={currentNodeId === null}>⏮</button>
      <button type="button" className="tool-btn icon" title="Back (←)" onClick={stepBack} disabled={currentNodeId === null}>‹</button>
      <button type="button" className={`tool-btn icon play${isPlaying ? ' on' : ''}`} title={isPlaying ? 'Pause' : 'Auto-play'} onClick={() => {
        if (isPlaying) { setIsPlaying(false); return; }
        if (!canStepForward) setCurrentNodeId(null);
        setIsPlaying(true);
      }} disabled={!hasAnyMoves}>{isPlaying ? '❚❚' : '▶'}</button>
      <button type="button" className="tool-btn icon" title="Forward (→)" onClick={stepForwardWithAnim} disabled={!canStepForward}>›</button>
      <button type="button" className="tool-btn icon" title="End (↓)" onClick={goEnd} disabled={!canStepForward}>⏭</button>
      <div className="seg-mini">
        {SPEED_OPTIONS.map(({ label, ms }) => (
          <button key={ms} type="button" className={playSpeed === ms ? 'on' : ''} onClick={() => setPlaySpeed(ms)} title="Auto-play speed">{label}</button>
        ))}
      </div>
    </div>
  );

  const navItems: Array<{ view: ActiveView; label: string; icon: string }> = [
    { view: 'home', label: 'Home', icon: '⌂' },
    { view: 'openings', label: 'Openings', icon: '♘' },
    { view: 'analysis', label: 'Analysis', icon: '♟' },
    { view: 'create', label: 'Create', icon: '✎' },
    { view: 'master', label: 'Roadmap', icon: '☰' },
  ];

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <div className="laion-app">
      <div className="page-shell">

        {/* Sidebar nav */}
        <nav className="side-nav">
          <button className="wordmark" type="button" onClick={() => setActiveView('home')}>
            <span className="knight">♞</span>
            <span className="name">Laion<b>Chess</b></span>
          </button>
          <div className="main-nav">
            {navItems.map(item => (
              <button key={item.view} type="button"
                className={activeView === item.view || (item.view === 'openings' && activeView === 'trainer') ? 'active' : ''}
                onClick={() => setActiveView(item.view)}>
                <span className="ic">{item.icon}</span>{item.label}
              </button>
            ))}
          </div>
          <div className="side-nav-footer">
            <button className="btn btn-block" type="button" onClick={openNewGame}>＋ New / Import</button>
            <button className="btn btn-block" type="button" onClick={() => setShowExport(true)}>↧ Export</button>
            <SettingsMenu />
          </div>
        </nav>

        {/* Main scrollable content */}
        <div className="page-content">

        {activeView === 'home' && (
          <main className="home-view">
            <section className="hero">
              <span className="eyebrow">Opening repertoire trainer</span>
              <h1>Learn your openings.<br /><span className="accent">Then play them from memory.</span></h1>
              <p className="lead">
                {catalog.length} courses · {totalLines} lines with coach notes. Learn each line with guided arrows,
                recall it in Practice, and prove it in Drill against random variations.
              </p>
              <div className="cta-row">
                <button className="btn btn-primary btn-lg" type="button" onClick={() => setActiveView('openings')}>Browse openings →</button>
                <button className="btn btn-lg" type="button" onClick={() => setActiveView('analysis')}>Analysis board</button>
              </div>
            </section>

            {lastCard && (
              <section className="continue-card">
                <div className="mini"><MiniBoard fen={lastCard.fen} flipped={lastCard.playAs === 'b'} /></div>
                <div className="body">
                  <span className="eyebrow">Continue training</span>
                  <h3>{lastCard.name}</h3>
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${lastCard.lines ? Math.round((lastCard.learned / lastCard.lines) * 100) : 0}%` }} /></div>
                  <span className="muted">{lastCard.learned}/{lastCard.lines} lines learned · {lastCard.practiced}/{lastCard.lines} recalled</span>
                </div>
                <button className="btn btn-primary" type="button" onClick={() => openTrainerCourse(lastCard.id)}>Resume →</button>
              </section>
            )}

            <section className="home-section">
              <div className="section-row">
                <h2>Openings</h2>
                <button type="button" className="link-btn" onClick={() => setActiveView('openings')}>All {catalog.length} courses →</button>
              </div>
              <div className="course-grid compact">
                {allCards.slice(0, 4).map(card => (
                  <CourseCard key={card.id} card={card} onOpen={() => openTrainerCourse(card.id)} />
                ))}
              </div>
            </section>

            <section className="feature-grid">
              <button className="feature" type="button" onClick={() => setActiveView('openings')}>
                <div className="ic">♘</div>
                <h3>Opening trainer</h3>
                <p>Learn · Practice · Drill. The coach explains each move; mistakes flash, hints are one click away.</p>
              </button>
              <button className="feature" type="button" onClick={() => setActiveView('analysis')}>
                <div className="ic">♟</div>
                <h3>Analysis board</h3>
                <p>Stockfish, opening explorer, variations, PGN/FEN import and export, and the Laion spotting overlays.</p>
              </button>
              <button className="feature" type="button" onClick={() => setActiveView('create')}>
                <div className="ic">✎</div>
                <h3>Course creator</h3>
                <p>Build a repertoire tree on the board and export it as a trainable course JSON.</p>
              </button>
            </section>

            <section className="shortcuts">
              <span><kbd>←</kbd><kbd>→</kbd> step through moves</span>
              <span><kbd>↑</kbd><kbd>↓</kbd> start / end</span>
              <span><kbd>F</kbd> flip board</span>
              <span><kbd>Right-click</kbd> drag to draw arrows</span>
            </section>
          </main>
        )}

        {activeView === 'openings' && (
          <main className="catalog-view">
            <div className="page-head">
              <div>
                <span className="eyebrow">Repertoire training</span>
                <h1>Opening courses</h1>
                <p className="lead">Pick a course, learn the lines move by move, then drill them until they're automatic.</p>
              </div>
              <div className="stat-box">
                <strong>{learnedLines}<span>/{totalLines}</span></strong>
                <span>lines learned</span>
              </div>
            </div>

            <div className="catalog-bar">
              <div className="search-wrap">
                <span className="icon">⌕</span>
                <input className="input" value={courseSearch} onChange={e => setCourseSearch(e.target.value)} placeholder="Search openings…" />
              </div>
              <div className="segmented small">
                {([['all', 'All'], ['w', 'As White'], ['b', 'As Black']] as const).map(([key, label]) => (
                  <button key={key} type="button" className={sideFilter === key ? 'on' : ''} onClick={() => setSideFilter(key)}>
                    <span className="t">{label}</span>
                  </button>
                ))}
              </div>
              <button className="btn" type="button" onClick={() => setActiveView('create')}>✎ Create a course</button>
            </div>

            {coursesLoading && <div className="empty-state">Loading courses…</div>}
            {!coursesLoading && filteredCourses.length === 0 && <div className="empty-state">No courses match your search.</div>}
            <div className="course-grid">
              {filteredCourses.map(card => (
                <CourseCard key={card.id} card={card} onOpen={() => openTrainerCourse(card.id)} />
              ))}
            </div>
          </main>
        )}

        {activeView === 'trainer' && (
          activeCourse ? (
            <TrainerView
              course={activeCourse}
              spottingModes={spottingModes}
              setSpottingModes={setSpottingModes}
              onAnalysis={openAnalysisFromState}
              onBack={() => setActiveView('openings')}
            />
          ) : (
            <main className="catalog-view">
              <div className="empty-state">{coursesLoading ? 'Loading course…' : 'Course not found. Check public/courses/manifest.json.'}</div>
            </main>
          )
        )}

        {isBoardView && (
          <div className="board-page">
            <div className="board-main" ref={fitRef}>
              <div className="board-row">
                {activeView === 'analysis' && showEval && (
                  <EvalBar pawns={barPawns} mate={barMate} terminal={evalTerminal} height={boardSize} flipped={flipped} />
                )}
                <div className="board-stage">
                  <Board
                    arrows={boardArrows}
                    board={boardState.board}
                    selectedPos={preview ? null : selectedPos}
                    validMoves={preview ? [] : validMoves}
                    lastMove={boardLastMove}
                    checkSquare={boardCheckSquare}
                    isCheckmate={boardState.isCheckmate}
                    currentTurn={boardState.currentTurn}
                    onSquareClick={handleSquareClick}
                    onMove={handleDragMove}
                    canDrag={pos => !preview && !pendingPromotion && displayedState.board[pos.row][pos.col]?.color === displayedState.currentTurn}
                    onResize={n => setSetting('boardMax', n)}
                    overlay={spottingOverlay}
                    flipped={flipped}
                    interactiveOverlay={pendingPromotion ? (
                      <PromotionPicker
                        color={displayedState.currentTurn}
                        col={flipped ? 7 - pendingPromotion.to.col : pendingPromotion.to.col}
                        isWhitePromotion={(displayedState.currentTurn === 'white') !== flipped}
                        squarePx={boardSize / 8}
                        onSelect={handlePromotionSelect}
                        onCancel={() => setPendingPromotion(null)}
                      />
                    ) : undefined}
                    boardSize={boardSize}
                    hidePieceAt={animPiece?.to ?? null}
                    animOverlay={animPiece ? (
                      <AnimatedPiece anim={animPiece} boardSize={boardSize} flipped={flipped} onDone={() => setAnimPiece(null)} />
                    ) : undefined}
                  />
                  {(isAnalysisMode || preview) && <div className="analysis-frame" />}
                  {preview && (
                    <button type="button" className="review-chip" onClick={() => setPreview(null)}>Previewing engine line · click to return</button>
                  )}
                </div>
              </div>
              <div className="board-toolbar" style={{ width: boardSize + (activeView === 'analysis' && showEval ? 40 : 0) }}>
                {playbackControls}
                <span className="tb-spacer" />
                <SpottingPanel modes={spottingModes} onChange={setSpottingModes} />
                <button type="button" className="tool-btn" onClick={() => setFlipped(f => !f)} title="Flip board (F)">⇅ Flip</button>
              </div>
            </div>

            {activeView === 'analysis' && (
              <aside className="panel an-panel">
                <div className="panel-head">
                  <span className={`status-pill tone-${status.tone}`}>{status.text}</span>
                  <SettingsMenu />
                </div>
                <div className="toggle-row">
                  <PanelToggle on={showEval} label="Eval bar" onClick={() => setShowEval(v => !v)} />
                  <PanelToggle on={settings.engineEnabled} label="Engine" onClick={() => setSetting('engineEnabled', !settings.engineEnabled)} />
                  <PanelToggle on={showBook} label="Book" onClick={() => setShowBook(v => !v)} />
                </div>

                {settings.engineEnabled && (
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
                )}

                <MoveList
                  tree={tree}
                  currentNodeId={currentNodeId}
                  onNavigate={(id: string | null) => { setIsPlaying(false); setSelectedPos(null); setCurrentNodeId(id); }}
                />
                {isAnalysisMode && (
                  <button type="button" className="btn btn-sm" onClick={() => { setIsPlaying(false); setCurrentNodeId(mainLineTip); }}>↩ Back to main line</button>
                )}

                {showBook && (
                  <div className="section">
                    <div className="section-head">
                      <span>Common moves</span>
                      <div className="popover-host">
                        <button type="button" className={`tool-btn icon${showBookOptions ? ' on' : ''}`} onClick={() => setShowBookOptions(v => !v)} title="Filter options">⚙</button>
                        {showBookOptions && <div className="popover right"><BookFilters /></div>}
                      </div>
                    </div>
                    <CommonMoves rows={bookRows} loading={bookLoading} source={bookSource} onPlay={playBookMove} onHover={setHoverBookSan} />
                  </div>
                )}

                <div className="section">
                  <div className="section-head"><span>Position</span></div>
                  <div className="btn-row">
                    <button className="btn btn-sm" type="button" onClick={copyFen}>{copyFenMsg || 'Copy FEN'}</button>
                    <button className="btn btn-sm" type="button" onClick={copyPgn}>{copyPgnMsg || 'Copy PGN'}</button>
                    <button className="btn btn-sm" type="button" onClick={() => setShowExport(true)}>Export…</button>
                    <button className="btn btn-sm" type="button" onClick={openNewGame}>Import…</button>
                  </div>
                </div>
              </aside>
            )}

            {activeView === 'create' && (
              <aside className="panel creator-panel">
                <div className="panel-head">
                  <input className="title-input" value={courseTitle} onChange={e => setCourseTitle(e.target.value)} maxLength={60} aria-label="Course title" />
                  <SettingsMenu />
                </div>
                <div className="toggle-row">
                  <span className={`status-pill tone-${status.tone}`}>{status.text}</span>
                  {saveState && <span className="muted">{saveState}</span>}
                </div>
                <div className="toggle-row">
                  <PanelToggle on={showBook} label="Book" onClick={() => setShowBook(v => !v)} />
                  <PanelToggle on={showTop} label="Top 3 arrows" onClick={() => setShowTop(v => !v)} />
                  <div className="segmented small push">
                    <button type="button" className={courseSide === 'white' ? 'on' : ''} onClick={() => setCourseSide('white')}><span className="t">♔ White</span></button>
                    <button type="button" className={courseSide === 'black' ? 'on' : ''} onClick={() => setCourseSide('black')}><span className="t">♚ Black</span></button>
                  </div>
                </div>
                <div className="current-line">{activeLineText ? activeLineText : <span>Play moves on the board to build a line.</span>}</div>
                <div className="btn-row">
                  <button className="btn btn-sm" type="button" onClick={handleUndo} disabled={mainLineTip === null}>↶ Undo</button>
                  <button className="btn btn-sm" type="button" onClick={startFresh}>Clear</button>
                  <button className="btn btn-sm" type="button" onClick={() => openAnalysisFromState(displayedState)}>Analyse →</button>
                  <button className="btn btn-sm" type="button" onClick={openNewGame}>Import</button>
                  <button className="btn btn-sm btn-primary" type="button" onClick={downloadFoldedOpening} disabled={terminalPaths.length === 0}>↧ Save JSON</button>
                </div>

                {showBook && (
                  <div className="section">
                    <div className="section-head"><span>Common moves</span></div>
                    <BookFilters />
                    <CommonMoves rows={bookRows} loading={bookLoading} source={bookSource} onPlay={playBookMove} onHover={setHoverBookSan} />
                  </div>
                )}

                <div className="section">
                  <div className="section-head"><span>Course lines</span><span className="muted">{terminalPaths.length}</span></div>
                  <div className="saved-lines">
                    {terminalPaths.length === 0 ? <div className="empty-panel">No lines yet</div> : terminalPaths.map((path, index) => (
                      <button key={path.join('-')} className={`saved-line ${currentNodeId === path[path.length - 1] ? 'current' : ''}`} type="button" onClick={() => setCurrentNodeId(path[path.length - 1])}>
                        <span>#{index + 1}</span><strong>{lineSans(path, tree)}</strong><em>{path.length} ply</em>
                      </button>
                    ))}
                  </div>
                </div>
                <p className="hint-text">
                  Save JSON downloads a <code>laionchess.folded-opening.v1</code> file. Drop it into <code>public/courses/</code> and
                  add an entry to <code>manifest.json</code> to publish it as a course.
                </p>
              </aside>
            )}
          </div>
        )}

        {activeView === 'master' && (
          <main className="doc-view">
            <div className="page-head">
              <div>
                <span className="eyebrow">Roadmap</span>
                <h1>Implementation plan</h1>
                <p className="lead">What LaionChess does today and what comes next.</p>
              </div>
            </div>
            {[
              ['Current state', ['Vite + React + TypeScript app deployed under /LaionChess/.', 'Analysis board with PGN/FEN import/export, variations, Stockfish and an opening explorer.', 'Spotting overlays (Dalmacja / Lucyfer / King Path / King Shot / Laion Eye) persisted across all board screens.']],
              ['Trainer', ['Learn / Practice / Drill modes with coach notes, hint arrows, mistake flashes and per-mode progress.', 'Black repertoires are shown from Black\'s side; drag-and-drop or click to move.', `${catalog.length} courses with ${totalLines} lines across 1.e4 and 1.d4 repertoires for both colours.`]],
              ['Board', ['Right-click drag draws arrows and circles (Shift / Alt change colour); knight arrows bend like the move.', 'Keyboard: ← → step, ↑ ↓ start / end, F flips. Shortcuts are ignored while typing.', 'The board fits the window automatically; the corner handle sets a preferred size.']],
              ['Next', ['Spaced-repetition scheduling for Drill.', 'Timed mode for fast recall.', 'Import a course directly from the Create view without editing the manifest.']],
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
        <div className="modal-overlay" onClick={() => setShowNewGame(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            {ngView === 'choice' && (
              <>
                <h2 className="modal-title">New / Import</h2>
                <div className="choice-list">
                  <button type="button" className="choice" onClick={startFresh}><span className="ic">♟</span><span><strong>Standard position</strong><small>Start a fresh board</small></span></button>
                  <button type="button" className="choice" onClick={() => { setNgView('pgn'); setPgnText(''); setPgnError(''); }}><span className="ic">📄</span><span><strong>Load PGN</strong><small>Paste a game or open a .pgn file</small></span></button>
                  <button type="button" className="choice" onClick={() => { setNgView('fen'); setFenInput(currentFen); setFenError(''); }}><span className="ic">⌗</span><span><strong>Load FEN</strong><small>Set up any position</small></span></button>
                </div>
                <div className="modal-actions">
                  <button className="btn" type="button" onClick={() => setShowNewGame(false)}>Cancel</button>
                </div>
              </>
            )}
            {ngView === 'pgn' && (
              <>
                <h2 className="modal-title">Load PGN</h2>
                <textarea className="textarea" value={pgnText} onChange={e => { setPgnText(e.target.value); setPgnError(''); }} placeholder="Paste PGN here…" style={{ minHeight: 160 }} autoFocus />
                <label className="file-link">
                  Or open a .pgn file
                  <input type="file" accept=".pgn,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setPgnText((ev.target?.result as string) ?? ''); r.readAsText(f); }} />
                </label>
                {pgnError && <div className="form-error">{pgnError}</div>}
                <div className="modal-actions">
                  <button className="btn" type="button" onClick={() => setNgView('choice')}>← Back</button>
                  <button className="btn btn-primary" type="button" onClick={loadFromPgn}>Load game</button>
                </div>
              </>
            )}
            {ngView === 'fen' && (
              <>
                <h2 className="modal-title">Load FEN</h2>
                <textarea className="textarea mono" value={fenInput} onChange={e => { setFenInput(e.target.value); setFenError(''); }} style={{ minHeight: 64 }} autoFocus />
                <div className="form-note">pieces / turn / castling / en passant / halfmove / fullmove</div>
                <label className="file-link">
                  Or open a .fen file
                  <input type="file" accept=".fen,text/plain" hidden onChange={e => { const f = e.target.files?.[0]; if (!f) return; const r = new FileReader(); r.onload = ev => setFenInput(((ev.target?.result as string) ?? '').trim()); r.readAsText(f); }} />
                </label>
                {fenError && <div className="form-error">{fenError}</div>}
                <div className="modal-actions">
                  <button className="btn" type="button" onClick={() => setNgView('choice')}>← Back</button>
                  <button className="btn btn-primary" type="button" onClick={loadFromFen}>Load position</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── EXPORT MODAL ── */}
      {showExport && (
        <div className="modal-overlay" onClick={() => setShowExport(false)}>
          <div className="modal wide" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Export</h2>
            <div className="field">
              <div className="field-label">FEN position</div>
              <textarea className="textarea mono" value={currentFen} readOnly style={{ minHeight: 48 }} />
              <div className="btn-row">
                <button className="btn btn-sm" type="button" onClick={copyFen}>{copyFenMsg || 'Copy FEN'}</button>
                <button className="btn btn-sm" type="button" onClick={() => downloadBlob(currentFen, 'position.fen')}>↧ .fen</button>
              </div>
            </div>
            <div className="field">
              <div className="field-label">PGN game</div>
              <textarea className="textarea mono" value={currentPgn} readOnly style={{ minHeight: 120 }} />
              <div className="btn-row">
                <button className="btn btn-sm" type="button" onClick={copyPgn}>{copyPgnMsg || 'Copy PGN'}</button>
                <button className="btn btn-sm" type="button" onClick={() => downloadBlob(currentPgn, 'game.pgn')}>↧ .pgn</button>
                <button className="btn btn-sm" type="button" onClick={downloadFoldedOpening} disabled={terminalPaths.length === 0}>↧ Course JSON</button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" type="button" onClick={() => setShowExport(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
