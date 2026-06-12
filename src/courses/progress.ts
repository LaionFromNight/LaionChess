export type TrainerMode = 'learn' | 'practice';

export interface Progress {
  learn: Record<string, boolean>;
  practice: Record<string, boolean>;
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
      return { learn: parsed.learn ?? {}, practice: parsed.practice ?? {} };
    }
  } catch { /* ignore */ }
  return { learn: {}, practice: {} };
}

export function saveProgress(courseId: string, progress: Progress): void {
  try { localStorage.setItem(progressKey(courseId), JSON.stringify(progress)); } catch { /* ignore */ }
}

export function countDone(progress: Progress, mode: TrainerMode): number {
  return Object.values(progress[mode]).filter(Boolean).length;
}
