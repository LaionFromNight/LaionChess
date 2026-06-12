import { useState } from 'react';
import type { PvMove } from '../board/pv';
import {
  ENGINE_NAME, SEARCH_LEVELS_MS, HASH_OPTIONS_MB, MAX_LINES, searchLevelLabel,
} from '../board/engine';

export interface PanelLine {
  key: string;
  pawns: number;
  mate: number | null;
  moves: PvMove[];
}

interface EnginePanelProps {
  enabled: boolean;
  onToggle: () => void;
  showArrows: boolean;
  onToggleArrows: () => void;

  best: { pawns: number; mate: number | null } | null;
  depth: number;
  searching: boolean;
  lines: PanelLine[];

  /** Numbering context for the analysed position. */
  startMoveNum: number;
  whiteToMove: boolean;

  searchLevel: number;
  onSearchLevel: (n: number) => void;
  numLines: number;
  onNumLines: (n: number) => void;
  hashMb: number;
  onHashMb: (mb: number) => void;

  onPreviewMove: (move: PvMove) => void;
}

function evalLabel(pawns: number, mate: number | null): string {
  if (mate != null) return `${mate > 0 ? '' : '-'}#${Math.abs(mate)}`;
  const v = pawns;
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function evalClass(pawns: number, mate: number | null): string {
  const ahead = mate != null ? mate > 0 : pawns >= 0;
  return ahead ? 'pearl-white' : 'pearl-black';
}

export default function EnginePanel(props: EnginePanelProps) {
  const {
    enabled, onToggle, showArrows, onToggleArrows, best, depth, searching, lines,
    startMoveNum, whiteToMove, searchLevel, onSearchLevel, numLines, onNumLines,
    hashMb, onHashMb, onPreviewMove,
  } = props;

  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className={`ceval${enabled ? ' enabled' : ''}`}>
      <div className="ceval-head">
        <button
          type="button"
          className={`cmn-toggle ${enabled ? 'on' : 'off'}`}
          onClick={onToggle}
          title="Toggle engine analysis"
        >
          <span className="sw" />
        </button>

        {enabled && best && (
          <span className={`pearl ${evalClass(best.pawns, best.mate)}`}>{evalLabel(best.pawns, best.mate)}</span>
        )}

        <div className="ceval-engine">
          <span className="name">{ENGINE_NAME}</span>
          {enabled && (
            <span className="depth">{searching ? `d${depth}…` : `depth ${depth}`}</span>
          )}
        </div>

        {enabled && (
          <>
            <button
              type="button"
              className={`ceval-gear${showSettings ? ' active' : ''}`}
              onClick={() => setShowSettings(v => !v)}
              title="Engine settings"
            >⚙</button>
            <button
              type="button"
              className={`ceval-arrows${showArrows ? ' active' : ''}`}
              onClick={onToggleArrows}
              title="Show engine arrows"
            >➤</button>
          </>
        )}
      </div>

      {enabled && showSettings && (
        <div className="ceval-settings">
          <div className="setting">
            <label>Engine</label>
            <span className="setting-static">{ENGINE_NAME} · single-thread</span>
          </div>
          <div className="setting">
            <label>Search time</label>
            <input
              type="range" min={0} max={SEARCH_LEVELS_MS.length - 1} step={1}
              value={searchLevel}
              onChange={e => onSearchLevel(Number(e.target.value))}
            />
            <span className="range_value">{searchLevelLabel(SEARCH_LEVELS_MS[searchLevel])}</span>
          </div>
          <div className="setting">
            <label>Lines</label>
            <input
              type="range" min={1} max={MAX_LINES} step={1}
              value={numLines}
              onChange={e => onNumLines(Number(e.target.value))}
            />
            <span className="range_value">{numLines} / {MAX_LINES}</span>
          </div>
          <div className="setting">
            <label>Memory</label>
            <input
              type="range" min={0} max={HASH_OPTIONS_MB.length - 1} step={1}
              value={Math.max(0, HASH_OPTIONS_MB.indexOf(hashMb))}
              onChange={e => onHashMb(HASH_OPTIONS_MB[Number(e.target.value)])}
            />
            <span className="range_value">{hashMb}MB</span>
          </div>
          <div className="setting-note">Threads aren’t available: the GitHub-Pages build is single-threaded.</div>
        </div>
      )}

      {enabled && (
        <div className="pv-box">
          {lines.length === 0
            ? <div className="pv-empty">{searching ? 'Analysing…' : 'No lines (mate / stalemate).'}</div>
            : lines.map(line => (
              <div key={line.key} className="pv-line">
                <strong className={evalClass(line.pawns, line.mate)}>{evalLabel(line.pawns, line.mate)}</strong>
                <span className="pv-moves">
                  {renderPvMoves(line.moves, startMoveNum, whiteToMove, onPreviewMove)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function renderPvMoves(
  moves: PvMove[], startMoveNum: number, whiteToMove: boolean,
  onPreview: (m: PvMove) => void,
) {
  const nodes: React.ReactNode[] = [];
  let num = startMoveNum;
  let white = whiteToMove;

  moves.forEach((m, i) => {
    if (white || i === 0) {
      nodes.push(<span key={`n${i}`} className="pv-num">{num}{white ? '.' : '…'}</span>);
    }
    nodes.push(
      <span key={`m${i}`} className="pv-san" onClick={() => onPreview(m)}>{m.san}</span>,
    );
    if (!white) num += 1;
    white = !white;
  });

  return nodes;
}
