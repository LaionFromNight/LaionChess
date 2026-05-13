import type { GameState, Move, PieceType, Position } from './types';
import { executeMove } from './logic';
import { resolveSan } from './san';
import type { PgnGame, PgnMoveNode } from './pgn';
import { exportPgn } from './pgn';

export interface MoveNode {
  id: string;
  move: Move;
  state: GameState;     // position after this move; moveHistory stripped
  parentId: string | null;
  children: string[];   // children[0] = main line continuation
}

export interface GameTree {
  initialState: GameState;
  nodes: Record<string, MoveNode>;
  rootChildren: string[]; // rootChildren[0] = main line first move
}

let _nextId = 0;
function genId(): string { return `n${_nextId++}`; }

export function createGameTree(initialState: GameState): GameTree {
  return {
    initialState: { ...initialState, moveHistory: [] },
    nodes: {},
    rootChildren: [],
  };
}

export function addNode(
  tree: GameTree,
  parentId: string | null,
  move: Move,
  newState: GameState,
): { tree: GameTree; nodeId: string } {
  const id = genId();
  const node: MoveNode = {
    id,
    move,
    state: { ...newState, moveHistory: [] },
    parentId,
    children: [],
  };

  const nodes: Record<string, MoveNode> = { ...tree.nodes, [id]: node };
  let rootChildren = tree.rootChildren;

  if (parentId === null) {
    rootChildren = [...rootChildren, id];
  } else {
    const parent = nodes[parentId];
    nodes[parentId] = { ...parent, children: [...parent.children, id] };
  }

  return { tree: { ...tree, nodes, rootChildren }, nodeId: id };
}

export function getNodeState(tree: GameTree, nodeId: string | null): GameState {
  if (nodeId === null) return tree.initialState;
  return tree.nodes[nodeId]?.state ?? tree.initialState;
}

export function findChildByMove(
  tree: GameTree,
  parentId: string | null,
  from: Position,
  to: Position,
  promotion?: PieceType,
): string | null {
  const children = parentId === null ? tree.rootChildren : (tree.nodes[parentId]?.children ?? []);
  for (const childId of children) {
    const m = tree.nodes[childId]?.move;
    if (!m) continue;
    if (
      m.from.row === from.row && m.from.col === from.col &&
      m.to.row === to.row && m.to.col === to.col &&
      (m.promotion ?? undefined) === (promotion ?? undefined)
    ) return childId;
  }
  return null;
}

export function getMainLinePath(tree: GameTree): string[] {
  const path: string[] = [];
  let children = tree.rootChildren;
  while (children.length > 0) {
    const mainId = children[0];
    path.push(mainId);
    children = tree.nodes[mainId]?.children ?? [];
  }
  return path;
}

export function getMainLineTip(tree: GameTree): string | null {
  const path = getMainLinePath(tree);
  return path.length > 0 ? path[path.length - 1] : null;
}

export function isOnMainLine(tree: GameTree, nodeId: string): boolean {
  let current: string | null = nodeId;
  while (current !== null) {
    const node: MoveNode | undefined = tree.nodes[current];
    if (!node) return false;
    const siblings = node.parentId === null ? tree.rootChildren : (tree.nodes[node.parentId]?.children ?? []);
    if (siblings[0] !== current) return false;
    current = node.parentId;
  }
  return true;
}

export function getPathToNode(tree: GameTree, nodeId: string | null): string[] {
  if (nodeId === null) return [];
  const path: string[] = [];
  let current: string | null = nodeId;
  while (current !== null) {
    path.unshift(current);
    current = tree.nodes[current]?.parentId ?? null;
  }
  return path;
}

export function deleteSubtree(tree: GameTree, nodeId: string): GameTree {
  const toDelete = new Set<string>();
  function collect(id: string) {
    toDelete.add(id);
    for (const childId of tree.nodes[id]?.children ?? []) collect(childId);
  }
  collect(nodeId);

  const node = tree.nodes[nodeId];
  const nodes: Record<string, MoveNode> = {};
  for (const [id, n] of Object.entries(tree.nodes)) {
    if (!toDelete.has(id)) nodes[id] = n;
  }

  let rootChildren = tree.rootChildren;
  if (node?.parentId === null) {
    rootChildren = rootChildren.filter(id => !toDelete.has(id));
  } else if (node?.parentId && nodes[node.parentId]) {
    nodes[node.parentId] = {
      ...nodes[node.parentId],
      children: nodes[node.parentId].children.filter(id => !toDelete.has(id)),
    };
  }

  return { ...tree, nodes, rootChildren };
}

// ── PGN ↔ Tree ───────────────────────────────────────────────────────────────

export function treeToPgnGame(
  tree: GameTree,
  tags?: Record<string, string>,
): PgnGame {
  const tip = getMainLineTip(tree);
  const finalState = tip ? tree.nodes[tip].state : tree.initialState;
  let result: '1-0' | '0-1' | '1/2-1/2' | '*' = '*';
  if (finalState.isCheckmate) result = finalState.currentTurn === 'white' ? '0-1' : '1-0';
  else if (finalState.isStalemate) result = '1/2-1/2';

  const initColor: 'w' | 'b' = tree.initialState.currentTurn === 'white' ? 'w' : 'b';
  const initNum = tree.initialState.fullmoveNumber;

  // siblings = [mainId, ...altIds]; each altId is an alternative to mainId
  function buildSeq(
    siblings: string[],
    moveNum: number,
    color: 'w' | 'b',
  ): PgnMoveNode[] {
    if (siblings.length === 0) return [];
    const mainId = siblings[0];
    const mainNode = tree.nodes[mainId];

    const pgnNode: PgnMoveNode = {
      moveNumber: moveNum,
      color,
      san: mainNode.move.san ?? '?',
      nags: [],
      commentsBefore: [],
      commentsAfter: [],
      variations: [],
    };

    for (let i = 1; i < siblings.length; i++) {
      pgnNode.variations.push({ moves: buildSeq([siblings[i]], moveNum, color) });
    }

    const nextColor: 'w' | 'b' = color === 'w' ? 'b' : 'w';
    const nextNum = color === 'b' ? moveNum + 1 : moveNum;
    return [pgnNode, ...buildSeq(mainNode.children, nextNum, nextColor)];
  }

  const moves = buildSeq(tree.rootChildren, initNum, initColor);
  return {
    tags: {
      Event: '?', Site: '?', Date: '????.??.??',
      Round: '?', White: '?', Black: '?', Result: result,
      ...tags,
    },
    moves,
    result,
  };
}

export function pgnGameToTree(game: PgnGame, initialState: GameState): GameTree {
  const nodes: Record<string, MoveNode> = {};
  const rootChildren: string[] = [];

  function processVariation(
    parentId: string | null,
    state: GameState,
    pgnMoves: PgnMoveNode[],
  ) {
    let curParentId = parentId;
    let curState = state;

    for (const pgnMove of pgnMoves) {
      const resolved = resolveSan(curState, pgnMove.san);
      if (!resolved) continue;

      const newState = executeMove(curState, resolved.from, resolved.to, resolved.promotionPiece);
      const lastMove = newState.moveHistory[newState.moveHistory.length - 1];
      const id = genId();

      nodes[id] = {
        id,
        move: lastMove,
        state: { ...newState, moveHistory: [] },
        parentId: curParentId,
        children: [],
      };

      if (curParentId === null) {
        rootChildren.push(id);
      } else {
        nodes[curParentId].children.push(id);
      }

      // Variations are alternatives from curParentId/curState (BEFORE this move)
      for (const variation of pgnMove.variations) {
        processVariation(curParentId, curState, variation.moves);
      }

      curParentId = id;
      curState = newState;
    }
  }

  processVariation(null, initialState, game.moves);

  return {
    initialState: { ...initialState, moveHistory: [] },
    nodes,
    rootChildren,
  };
}

export function getMainLineMoves(tree: GameTree): Move[] {
  return getMainLinePath(tree).map(id => tree.nodes[id].move);
}
