import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Fits the board into its column: as large as the column width and the
 * viewport height allow, capped by the user's preferred size (resize handle).
 * The result is snapped to a multiple of 8 so every square is whole pixels.
 */
export function useFitBoardSize(
  preferred: number,
  opts: { reserveWidth?: number; reserveHeight?: number; min?: number } = {},
) {
  const { reserveWidth = 0, reserveHeight = 150, min = 240 } = opts;
  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState<{ w: number; h: number }>(() => ({
    w: typeof window === 'undefined' ? 800 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));

  useLayoutEffect(() => {
    const el = ref.current;
    const measure = () => {
      setAvail({ w: el ? el.clientWidth : window.innerWidth, h: window.innerHeight });
    };
    measure();
    window.addEventListener('resize', measure);
    const ro = el && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (el && ro) ro.observe(el);
    return () => { window.removeEventListener('resize', measure); ro?.disconnect(); };
  }, []);

  // On phones the preferred size (set with the drag handle, easy to nudge by
  // accident with a finger) is ignored: the board always fills the column.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 720;
  const cap = narrow ? Infinity : preferred;
  const raw = Math.min(cap, avail.w - reserveWidth, narrow ? Infinity : avail.h - reserveHeight);
  const size = Math.max(min, Math.floor(raw / 8) * 8);
  return { ref, size };
}

export interface BoardKeyHandlers {
  prev?: () => void;
  next?: () => void;
  first?: () => void;
  last?: () => void;
  flip?: () => void;
}

/** True when a key event belongs to a text field and must not drive the board. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/**
 * Keyboard navigation shared by every board screen:
 *   ← / →        previous / next move (hold to repeat)
 *   ↑ / Home     jump to the start
 *   ↓ / End      jump to the end
 *   F            flip the board
 * Ignored while typing in a field, with modifier keys held, or when disabled
 * (e.g. a modal is open).
 */
export function useBoardKeys(handlers: BoardKeyHandlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const h = ref.current;
      let fn: (() => void) | undefined;
      switch (e.key) {
        case 'ArrowLeft': fn = h.prev; break;
        case 'ArrowRight': fn = h.next; break;
        case 'ArrowUp': case 'Home': fn = h.first; break;
        case 'ArrowDown': case 'End': fn = h.last; break;
        case 'f': case 'F': if (!e.repeat) fn = h.flip; break;
      }
      if (!fn) return;
      e.preventDefault();
      // Keep focus off buttons so Space/Enter don't re-trigger the last click.
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
