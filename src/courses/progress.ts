export type TrainerMode = 'learn' | 'practice' | 'drill';

export interface Progress {
  learn: Record<string, boolean>;
  practice: Record<string, boolean>;
  drill: Record<string, boolean>;
}

/**
 * The Scotch course uses the well-known key the prototype + Home + Openings read.
 * Other courses get a namespaced key so progress is tracked per course.
 */
export function progressKey(courseId: string): string {
  return courseId === 'scotch-game'
    ? 'laionchess-scotch-progress'
    : `laionchess-progress-${courseId}`;
}

export function loadProgress(courseId: string): Progress {
  try {
    const raw = localStorage.getItem(progressKey(courseId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return { learn: parsed.learn ?? {}, practice: parsed.practice ?? {}, drill: parsed.drill ?? {} };
    }
  } catch { /* ignore */ }
  return { learn: {}, practice: {}, drill: {} };
}

export function saveProgress(courseId: string, progress: Progress): void {
  try { localStorage.setItem(progressKey(courseId), JSON.stringify(progress)); } catch { /* ignore */ }
}

export function countDone(progress: Progress, mode: TrainerMode): number {
  return Object.values(progress[mode]).filter(Boolean).length;
}

/** Remembers the last opened course so Home can offer "continue training". */
const LAST_KEY = 'laionchess-last-course';
export function loadLastCourse(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}
export function saveLastCourse(id: string): void {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* ignore */ }
}
