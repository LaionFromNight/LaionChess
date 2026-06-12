import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { GameTree } from '../chess/tree';
import { renderSanForMoveList } from '../chess/san';

// ─── Props ────────────────────────────────────────────────────────────────────

interface MoveListProps {
  tree: GameTree;
  currentNodeId: string | null;
  onNavigate: (id: string | null) => void;
  boardSize?: number;
}

// ─── Variation view model ─────────────────────────────────────────────────────

interface VariationView {
  id: string;            // "M3V1" | "M3V1-H1V1" | "M3V1-H1V1-H2V1" | ...
  parentId: string | null;
  depth: number;         // 0 = H0 (direct under main line), 1 = H1, ...
  moveNum: number;       // fullmove number where variation starts
  startColor: 'w' | 'b';
  startNodeId: string;   // first node of this variation
  children: VariationView[];
}

type ViewMode =
  | { type: 'default' }
  | { type: 'variation'; variationId: string };

// ─── Row model ────────────────────────────────────────────────────────────────

interface MainRow {
  moveNum: number;
  whiteId: string | null;
  blackId: string | null;
  afterWhiteVars: Array<{ id: string; moveNum: number; color: 'w' | 'b' }>;
  afterBlackVars: Array<{ id: string; moveNum: number; color: 'w' | 'b' }>;
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Generic row builder. Walk the tree from an initial siblings list,
 * pairing white+black moves per row.
 *
 * Default view:  buildRowsFromSiblings(tree, tree.rootChildren, initNum, initColor)
 * Variation view: buildRowsFromSiblings(tree, [varView.startNodeId], varView.moveNum, varView.startColor)
 */
function buildRowsFromSiblings(
  tree: GameTree,
  initialSiblings: string[],
  startMoveNum: number,
  startColor: 'w' | 'b',
): MainRow[] {
  const rows: MainRow[] = [];
  let siblings = initialSiblings;
  let moveNum = startMoveNum;
  let color = startColor;

  // Game / variation starts on black's move (FEN position)
  if (color === 'b' && siblings.length > 0) {
    const blackMainId = siblings[0];
    rows.push({
      moveNum,
      whiteId: null,
      blackId: blackMainId,
      afterWhiteVars: [],
      afterBlackVars: siblings.slice(1).map(id => ({ id, moveNum, color: 'b' as const })),
    });
    siblings = tree.nodes[blackMainId]?.children ?? [];
    moveNum++;
    color = 'w';
  }

  while (siblings.length > 0) {
    const whiteMainId = siblings[0];
    const whiteAltIds = siblings.slice(1);
    const blackSiblings = tree.nodes[whiteMainId]?.children ?? [];
    const blackMainId = blackSiblings[0] ?? null;
    const blackAltIds = blackSiblings.slice(1);

    rows.push({
      moveNum,
      whiteId: whiteMainId,
      blackId: blackMainId,
      afterWhiteVars: whiteAltIds.map(id => ({ id, moveNum, color: 'w' as const })),
      afterBlackVars: blackAltIds.map(id => ({ id, moveNum, color: 'b' as const })),
    });

    siblings = blackMainId ? (tree.nodes[blackMainId]?.children ?? []) : [];
    moveNum++;
  }

  return rows;
}

/**
 * Build one VariationView, walking its main line and collecting nested
 * alternatives (sub-variations) as children recursively.
 */
function buildVariationView(
  tree: GameTree,
  startNodeId: string,
  moveNum: number,
  startColor: 'w' | 'b',
  id: string,
  parentId: string | null,
  depth: number,
): VariationView {
  const children: VariationView[] = [];
  let childIdx = 0;
  let curId: string | null = startNodeId;
  let curNum = moveNum;
  let curColor = startColor;

  while (curId !== null) {
    const node: import('../chess/tree').MoveNode | undefined = tree.nodes[curId];
    if (!node) break;

    const nextColor: 'w' | 'b' = curColor === 'w' ? 'b' : 'w';
    const nextNum = curColor === 'b' ? curNum + 1 : curNum;

    // node.children = [mainContinuation, subAlt1, subAlt2, ...]
    // subAlts are alternatives to the main continuation = sub-variations of this view
    const mainContId: string | null = node.children[0] ?? null;
    const subAltIds = node.children.slice(1);

    for (const subAltId of subAltIds) {
      childIdx++;
      const childId = `${id}-H${depth + 1}V${childIdx}`;
      children.push(
        buildVariationView(tree, subAltId, nextNum, nextColor, childId, id, depth + 1),
      );
    }

    curId = mainContId;
    curNum = nextNum;
    curColor = nextColor;
  }

  return { id, parentId, depth, moveNum, startColor, startNodeId, children };
}

/**
 * Collect all H0 VariationViews (direct alternatives on the main line)
 * together with their nested children. Walk the main line and pick up
 * alternatives at each step, assigning stable M{num}V{idx} IDs.
 */
function buildAllH0Views(tree: GameTree): VariationView[] {
  const h0Views: VariationView[] = [];
  let siblings = tree.rootChildren;
  let moveNum = tree.initialState.fullmoveNumber;
  let color: 'w' | 'b' = tree.initialState.currentTurn === 'white' ? 'w' : 'b';
  const varCountPerMove: Record<number, number> = {};

  const nextIdx = (num: number): number => {
    varCountPerMove[num] = (varCountPerMove[num] ?? 0) + 1;
    return varCountPerMove[num];
  };

  // FEN black-first edge case
  if (color === 'b' && siblings.length > 0) {
    const blackMainId = siblings[0];
    for (const altId of siblings.slice(1)) {
      const idx = nextIdx(moveNum);
      h0Views.push(buildVariationView(tree, altId, moveNum, 'b', `M${moveNum}V${idx}`, null, 0));
    }
    siblings = tree.nodes[blackMainId]?.children ?? [];
    moveNum++;
    color = 'w';
  }

  while (siblings.length > 0) {
    const whiteMainId = siblings[0];
    const whiteAltIds = siblings.slice(1);

    for (const altId of whiteAltIds) {
      const idx = nextIdx(moveNum);
      h0Views.push(buildVariationView(tree, altId, moveNum, 'w', `M${moveNum}V${idx}`, null, 0));
    }

    const blackSiblings = tree.nodes[whiteMainId]?.children ?? [];
    const blackMainId = blackSiblings[0] ?? null;
    const blackAltIds = blackSiblings.slice(1);

    for (const altId of blackAltIds) {
      const idx = nextIdx(moveNum);
      h0Views.push(buildVariationView(tree, altId, moveNum, 'b', `M${moveNum}V${idx}`, null, 0));
    }

    siblings = blackMainId ? (tree.nodes[blackMainId]?.children ?? []) : [];
    moveNum++;
  }

  return h0Views;
}

/** DFS search through the full variation tree. */
function findVariationById(views: VariationView[], id: string): VariationView | null {
  for (const view of views) {
    if (view.id === id) return view;
    const found = findVariationById(view.children, id);
    if (found) return found;
  }
  return null;
}

// ─── VarContent — inline variation renderer ──────────────────────────────────

interface VarContentProps {
  tree: GameTree;
  startId: string;
  moveNum: number;
  color: 'w' | 'b';
  isFirst: boolean;
  currentNodeId: string | null;
  onNavigate: (id: string | null) => void;
  activeRef: React.MutableRefObject<HTMLSpanElement | null>;
}

/**
 * Renders one variation as inline-wrapping content.
 * Sub-variations are embedded inline with parentheses.
 */
function VarContent({
  tree, startId, moveNum, color, isFirst, currentNodeId, onNavigate, activeRef,
}: VarContentProps) {
  const node = tree.nodes[startId];
  if (!node) return null;

  const isActive = startId === currentNodeId;
  const nextColor: 'w' | 'b' = color === 'w' ? 'b' : 'w';
  const nextNum = color === 'b' ? moveNum + 1 : moveNum;
  const mainContId = node.children[0] ?? null;
  const altContIds = node.children.slice(1);

  return (
    <>
      {(color === 'w' || isFirst) && (
        <span style={{ color: '#555', fontSize: 10, userSelect: 'none' }}>
          {moveNum}{color === 'b' ? '...' : '.'}{' '}
        </span>
      )}
      <span
        ref={isActive ? (el) => { activeRef.current = el; } : undefined}
        style={{
          cursor: 'pointer',
          fontWeight: isActive ? 700 : 400,
          color: isActive ? '#00ff88' : color === 'w' ? '#bdbdbd' : '#6cc5c8',
          backgroundColor: isActive ? 'rgba(0,255,136,0.12)' : 'transparent',
          borderRadius: 2,
          padding: '0 2px',
        }}
        onClick={() => onNavigate(startId)}
      >
        {renderSanForMoveList(node.move.san ?? '?', color)}
      </span>
      {altContIds.map(altId => (
        <span key={altId} style={{ color: '#555' }}>
          {' ('}
          <VarContent
            tree={tree} startId={altId} moveNum={nextNum} color={nextColor}
            isFirst currentNodeId={currentNodeId} onNavigate={onNavigate} activeRef={activeRef}
          />
          {')'}
        </span>
      ))}
      {mainContId && (
        <>
          {' '}
          <VarContent
            tree={tree} startId={mainContId} moveNum={nextNum} color={nextColor}
            isFirst={false} currentNodeId={currentNodeId} onNavigate={onNavigate} activeRef={activeRef}
          />
        </>
      )}
    </>
  );
}

// ─── MoveList ────────────────────────────────────────────────────────────────

export default function MoveList({ tree, currentNodeId, onNavigate, boardSize }: MoveListProps) {
  const activeRef = useRef<HTMLSpanElement | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>({ type: 'default' });

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentNodeId]);

  const h0Views = useMemo(() => buildAllH0Views(tree), [tree]);

  // Validate current viewMode: if the variation no longer exists in the tree
  // (e.g. after new game or undo), fall back to default silently.
  const effectiveViewMode: ViewMode = useMemo(() => {
    if (viewMode.type === 'default') return viewMode;
    const varView = findVariationById(h0Views, viewMode.variationId);
    if (!varView || !tree.nodes[varView.startNodeId]) return { type: 'default' };
    return viewMode;
  }, [viewMode, h0Views, tree]);

  const initMoveNum = tree.initialState.fullmoveNumber;
  const initColor: 'w' | 'b' = tree.initialState.currentTurn === 'white' ? 'w' : 'b';

  const rows = useMemo((): MainRow[] => {
    if (effectiveViewMode.type === 'default') {
      return buildRowsFromSiblings(tree, tree.rootChildren, initMoveNum, initColor);
    }
    const varView = findVariationById(h0Views, effectiveViewMode.variationId)!;
    return buildRowsFromSiblings(tree, [varView.startNodeId], varView.moveNum, varView.startColor);
  }, [tree, effectiveViewMode, h0Views, initMoveNum, initColor]);

  // Buttons: Default always first, then context-dependent variation buttons.
  // null = "Default" sentinel in the array.
  const visibleButtons = useMemo((): Array<VariationView | null> => {
    if (effectiveViewMode.type === 'default') {
      return h0Views.length > 0 ? [null, ...h0Views] : [];
    }
    const active = findVariationById(h0Views, effectiveViewMode.variationId)!;
    return [null, active, ...active.children];
  }, [effectiveViewMode, h0Views]);

  const showInlineVariations = effectiveViewMode.type === 'default';
  const showButtonBar = visibleButtons.length > 0;

  // ── Chip style ──────────────────────────────────────────────────────────────

  function chipStyle(nodeId: string, color: 'w' | 'b'): React.CSSProperties {
    const isActive = nodeId === currentNodeId;
    return {
      display: 'inline-block',
      padding: '1px 5px',
      borderRadius: 3,
      cursor: 'pointer',
      fontSize: 13,
      fontWeight: isActive ? 700 : 400,
      color: isActive ? '#00ff88' : color === 'w' ? '#e0e0e0' : '#00ffff',
      backgroundColor: isActive ? 'rgba(0,255,136,0.15)' : 'transparent',
      outline: isActive ? '1px solid rgba(0,255,136,0.35)' : 'none',
      whiteSpace: 'nowrap',
      transition: 'background 0.12s',
    };
  }

  const hoverOn = (e: React.MouseEvent<HTMLSpanElement>, nodeId: string) => {
    if (nodeId !== currentNodeId)
      (e.currentTarget as HTMLSpanElement).style.backgroundColor = 'rgba(255,255,255,0.06)';
  };
  const hoverOff = (e: React.MouseEvent<HTMLSpanElement>, nodeId: string) => {
    if (nodeId !== currentNodeId)
      (e.currentTarget as HTMLSpanElement).style.backgroundColor = 'transparent';
  };

  // ── Variation button handlers ────────────────────────────────────────────────

  const handleVariationClick = (view: VariationView) => {
    setViewMode({ type: 'variation', variationId: view.id });
    // Navigate board to parent position — the position BEFORE the first variation move.
    const parentId = tree.nodes[view.startNodeId]?.parentId ?? null;
    onNavigate(parentId);
  };

  const handleDefaultClick = () => {
    setViewMode({ type: 'default' });
    // Board position is preserved; the user can navigate from there.
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const panelHeight = '220px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>

      {/* ── Move panel ── */}
      <div style={{
        width: '100%',
        height: panelHeight,
        overflowY: 'auto',
        backgroundColor: '#0d1117',
        border: '1px solid #00ffff20',
        borderRadius: 8,
        fontFamily: "'Segoe UI', monospace",
        display: 'flex',
        flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #00ffff20',
          color: '#00ffff',
          fontSize: 11,
          letterSpacing: 2,
          textTransform: 'uppercase',
          fontWeight: 700,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 4,
        }}>
          <span>Moves</span>
          {effectiveViewMode.type === 'variation' && (
            <span style={{
              fontSize: 9, color: '#ff9f43', fontWeight: 700,
              letterSpacing: 0.5, textTransform: 'none', fontFamily: 'monospace',
              maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {effectiveViewMode.variationId}
            </span>
          )}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {rows.length === 0 ? (
            <div style={{ color: '#333', fontSize: 12, padding: '8px 12px' }}>No moves yet</div>
          ) : rows.map(row => {
            const allVars = [...row.afterWhiteVars, ...row.afterBlackVars];
            const rowKey = `${row.moveNum}-${row.whiteId ?? 'b'}`;

            return (
              <div key={rowKey} style={{ marginBottom: 1 }}>

                {/* N. white  black */}
                <div style={{ display: 'flex', alignItems: 'center', padding: '1px 8px', gap: 2 }}>
                  <span style={{
                    color: '#444', fontSize: 11, userSelect: 'none',
                    minWidth: 24, textAlign: 'right', flexShrink: 0, paddingRight: 3,
                  }}>
                    {row.moveNum}.
                  </span>

                  {row.whiteId ? (
                    <span
                      ref={row.whiteId === currentNodeId ? el => { activeRef.current = el; } : undefined}
                      style={chipStyle(row.whiteId, 'w')}
                      onClick={() => onNavigate(row.whiteId!)}
                      onMouseEnter={e => hoverOn(e, row.whiteId!)}
                      onMouseLeave={e => hoverOff(e, row.whiteId!)}
                    >
                      {renderSanForMoveList(tree.nodes[row.whiteId]?.move.san ?? '?', 'w')}
                    </span>
                  ) : (
                    <span style={{ minWidth: 48, display: 'inline-block' }} />
                  )}

                  {row.blackId && (
                    <span
                      ref={row.blackId === currentNodeId ? el => { activeRef.current = el; } : undefined}
                      style={chipStyle(row.blackId, 'b')}
                      onClick={() => onNavigate(row.blackId!)}
                      onMouseEnter={e => hoverOn(e, row.blackId!)}
                      onMouseLeave={e => hoverOff(e, row.blackId!)}
                    >
                      {renderSanForMoveList(tree.nodes[row.blackId]?.move.san ?? '?', 'b')}
                    </span>
                  )}
                </div>

                {/* Inline variation lines — default view only */}
                {showInlineVariations && allVars.map(v => (
                  <div
                    key={`var-${v.id}`}
                    style={{
                      margin: '1px 8px 2px 36px',
                      paddingLeft: 6,
                      borderLeft: '2px solid rgba(255,160,50,0.30)',
                      fontSize: 11,
                      lineHeight: 1.7,
                      color: '#888',
                      wordBreak: 'break-word',
                    }}
                  >
                    <span style={{ color: '#555', userSelect: 'none' }}>(</span>
                    <VarContent
                      tree={tree}
                      startId={v.id}
                      moveNum={v.moveNum}
                      color={v.color}
                      isFirst
                      currentNodeId={currentNodeId}
                      onNavigate={onNavigate}
                      activeRef={activeRef}
                    />
                    <span style={{ color: '#555', userSelect: 'none' }}>)</span>
                  </div>
                ))}

              </div>
            );
          })}
        </div>
      </div>

      {/* ── Variation switcher buttons ── */}
      {showButtonBar && (
        <div style={{
          width: '100%',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 3,
          padding: '2px 0',
        }}>
          {visibleButtons.map(v => {
            const isDefault = v === null;
            const isActiveBtn = isDefault
              ? effectiveViewMode.type === 'default'
              : effectiveViewMode.type === 'variation' && effectiveViewMode.variationId === v!.id;

            return (
              <button
                key={isDefault ? '__default' : v!.id}
                onClick={isDefault ? handleDefaultClick : () => handleVariationClick(v!)}
                style={{
                  padding: '3px 7px',
                  fontSize: 10,
                  fontWeight: isActiveBtn ? 700 : 400,
                  border: `1px solid ${isActiveBtn
                    ? (isDefault ? '#00ff8870' : '#88cc4470')
                    : '#2a2a3a'}`,
                  borderRadius: 4,
                  cursor: 'pointer',
                  backgroundColor: isActiveBtn
                    ? (isDefault ? 'rgba(0,255,136,0.12)' : 'rgba(136,204,68,0.12)')
                    : 'transparent',
                  color: isActiveBtn
                    ? (isDefault ? '#00ff88' : '#88cc44')
                    : '#555',
                  letterSpacing: 0.5,
                  fontFamily: 'monospace',
                  transition: 'all 0.15s',
                  whiteSpace: 'nowrap',
                  lineHeight: 1.4,
                }}
              >
                {isDefault ? 'Default' : v!.id}
              </button>
            );
          })}
        </div>
      )}

    </div>
  );
}
