// ── Spaced repetition (Leitner boxes) ─────────────────────────────────────────
// Every line you recall cleanly moves up a box and comes back later; a line
// you stumble on drops to box 0 and comes back in 10 minutes. "Due" lines are
// what the Drill serves first and what Home counts as "due for review".
import type { Course } from './useCourses';

export interface SrsEntry { box: number; due: number }
export type SrsState = Record<string, SrsEntry>;

const MIN = 60_000, DAY = 86_400_000;
/** Wait after a clean recall, per box (box 0 = just learned / just failed). */
const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];

const key = (courseId: string) => `laionchess-srs-${courseId}`;

export function loadSrs(courseId: string): SrsState {
  try { return JSON.parse(localStorage.getItem(key(courseId)) ?? '{}'); } catch { return {}; }
}

function saveSrs(courseId: string, s: SrsState) {
  try { localStorage.setItem(key(courseId), JSON.stringify(s)); } catch { /* ignore */ }
}

/** Record a review. `ok` = recalled without mistakes or hints. */
export function reviewLine(courseId: string, lineId: string, ok: boolean, now = Date.now()): SrsState {
  const s = loadSrs(courseId);
  const cur = s[lineId];
  const box = ok ? Math.min((cur?.box ?? 0) + 1, INTERVALS.length - 1) : 0;
  s[lineId] = { box, due: now + (ok ? INTERVALS[box] : INTERVALS[0]) };
  saveSrs(courseId, s);
  return s;
}

/** Schedule a freshly learned line (first review in 10 minutes) if it isn't scheduled yet. */
export function seedLine(courseId: string, lineId: string, now = Date.now()): SrsState {
  const s = loadSrs(courseId);
  if (!s[lineId]) { s[lineId] = { box: 0, due: now + INTERVALS[0] }; saveSrs(courseId, s); }
  return s;
}

export function dueIds(course: Course, s: SrsState, now = Date.now()): string[] {
  return course.lines.filter(l => s[l.id] && s[l.id].due <= now).map(l => l.id);
}

/** Due counts across all courses (for Home). */
export function dueSummary(courses: Record<string, Course>, now = Date.now()) {
  const per = Object.values(courses).map(c => ({ course: c, due: dueIds(c, loadSrs(c.id), now).length }));
  return { total: per.reduce((n, p) => n + p.due, 0), top: per.filter(p => p.due).sort((a, b) => b.due - a.due) };
}

/** Human-friendly "next review" label. */
export function nextLabel(e: SrsEntry | undefined, now = Date.now()): string {
  if (!e) return '';
  const d = e.due - now;
  if (d <= 0) return 'due';
  if (d < 60 * MIN) return `${Math.ceil(d / MIN)}m`;
  if (d < DAY) return `${Math.ceil(d / (60 * MIN))}h`;
  return `${Math.ceil(d / DAY)}d`;
}
