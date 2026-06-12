import { useEffect, useState } from 'react';

// ── course model (matches public/courses/*.json `laionchess.course.v1`) ───────
export interface CoursePly {
  san: string;
  from?: string;   // algebraic, e.g. "e2" — advisory; the trainer re-resolves SAN
  to?: string;
  promo?: string;
  note?: string;   // coach text shown before a user (trainee) move
}
export interface CourseLine {
  id: string;
  name: string;
  tag: string;     // Main | Sideline | Trap | Punish | …
  plies: CoursePly[];
}
export interface Course {
  id: string;
  name: string;
  author?: string;
  playAs: 'w' | 'b';
  description?: string;
  lines: CourseLine[];
}

export interface CourseCardMeta {
  id: string;
  file: string;
  name: string;
  tag: string;
  tagClass?: string;
  desc: string;
  fen: string;
}

interface Manifest { courses: CourseCardMeta[] }

// ── folded-opening (Create export) → Course normalization ─────────────────────
interface FoldedMove { san: string; from: string; to: string; promotion?: string }
interface FoldedLine { id: string; name: string; moves: FoldedMove[] }
interface FoldedOpening {
  schema: string; id: string; title: string; sideToTrain: 'white' | 'black'; lines: FoldedLine[];
}

function isFolded(raw: unknown): raw is FoldedOpening {
  return !!raw && typeof raw === 'object' && (raw as { schema?: string }).schema === 'laionchess.folded-opening.v1';
}

function normalize(raw: unknown, meta: CourseCardMeta): Course {
  if (isFolded(raw)) {
    return {
      id: raw.id || meta.id,
      name: raw.title || meta.name,
      playAs: raw.sideToTrain === 'black' ? 'b' : 'w',
      description: meta.desc,
      lines: (raw.lines ?? []).map(l => ({
        id: l.id,
        name: l.name,
        tag: 'Line',
        plies: (l.moves ?? []).map(m => ({ san: m.san, from: m.from, to: m.to, promo: m.promotion })),
      })),
    };
  }
  // assume laionchess.course.v1 shape
  return raw as Course;
}

const BASE = import.meta.env.BASE_URL;

interface CoursesState {
  catalog: CourseCardMeta[];
  courses: Record<string, Course>;
  loading: boolean;
}

/** Loads the course manifest + every listed course file from public/courses/. */
export function useCourses(): CoursesState {
  const [state, setState] = useState<CoursesState>({ catalog: [], courses: {}, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const manifest: Manifest = await fetch(`${BASE}courses/manifest.json`).then(r => r.json());
        const entries = manifest.courses ?? [];
        const courses: Record<string, Course> = {};
        await Promise.all(entries.map(async (meta) => {
          try {
            const raw = await fetch(`${BASE}courses/${meta.file}`).then(r => r.json());
            courses[meta.id] = normalize(raw, meta);
          } catch {
            /* skip a single broken course file */
          }
        }));
        if (!cancelled) setState({ catalog: entries, courses, loading: false });
      } catch {
        if (!cancelled) setState({ catalog: [], courses: {}, loading: false });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}
