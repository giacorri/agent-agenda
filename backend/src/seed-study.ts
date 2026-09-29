// Study-mode demo seed — a mock "student install" for previewing exam mode.
// Seeds a separate DB (default ./study-demo.db) with one study scope, three exam
// subjects (each with an icon, exam date and review buffer) and their topics,
// spread across the study window so progress + pace read realistically.
//
//   bun run src/seed-study.ts                    → seeds ./study-demo.db
//   DB_PATH=/data/study-demo.db bun run src/seed-study.ts
//
// Idempotent: wipes the target DB first. Dates are relative to *now*, so exams
// stay a week / two weeks / a month out no matter when it runs.
import type { Database } from 'bun:sqlite';
import { openDb, insertTask, insertNote } from './db';
import { bootstrap } from './config-db';
import { newId } from './ids';
import type { Task, TaskStatus, ConfigBundle, Category } from './types';

const DB_PATH = process.env.DB_PATH ?? './study-demo.db';
const DAY = 86_400_000;

// ISO at a fixed time-of-day, `days` from now (negative = past).
function offset(days: number, hour = 9, minute = 30): string {
  const d = new Date(Date.now() + days * DAY);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

// Evenly spread `count` due dates across [startDays … endDays] (relative to now),
// mirroring distributeDueDates but keeping past dates so history looks lived-in.
function spread(startDays: number, endDays: number, count: number): string[] {
  const start = Date.now() + startDays * DAY;
  const end = Date.now() + endDays * DAY;
  return Array.from({ length: count }, (_, i) => {
    const frac = count <= 1 ? 1 : (i + 1) / count;
    const d = new Date(start + frac * (end - start));
    d.setHours(9, 30, 0, 0);
    return d.toISOString();
  });
}

// ---- subjects -------------------------------------------------------------
interface TopicSpec { title: string; status?: TaskStatus; summary?: string; note?: string; steps?: string[]; }
interface SubjectSpec {
  key: string; label: string; icon: string; color: string;
  examInDays: number; startDaysAgo: number; reviewDays: number;
  topics: TopicSpec[];
}

const SUBJECTS: SubjectSpec[] = [
  {
    key: 'linear-algebra', label: 'Linear Algebra', icon: 'chart', color: '#5b9bd5',
    examInDays: 4, startDaysAgo: 11, reviewDays: 2,
    // Nearest exam, 2 review days before it: four units done, now on eigenvalues.
    topics: [
      {
        title: 'Vectors and matrices', status: 'done',
        summary: 'The building blocks.\n- Vector spaces, span, linear independence\n- Matrix operations\n- Transpose and inverse',
      },
      {
        title: 'Linear systems', status: 'done',
        summary: 'Solving Ax = b.\n- Gaussian elimination\n- Row echelon form, rank\n- Rouché-Capelli theorem',
      },
      {
        title: 'Determinants', status: 'done',
        summary: 'Determinant and its properties.\n- Laplace expansion\n- Effect of row operations\n- Cramer\'s rule',
      },
      {
        title: 'Linear maps', status: 'done',
        summary: 'Maps between vector spaces.\n- Kernel and image\n- Rank-nullity theorem\n- Change of basis',
      },
      {
        title: 'Eigenvalues and eigenvectors', status: 'in_progress',
        summary: 'Characteristic polynomial and diagonalization.\n- Eigenvalues, eigenspaces\n- Algebraic vs geometric multiplicity\n- Diagonalization\n- Spectral theorem for symmetric matrices',
        note: 'Reached eigenvalues: characteristic polynomial and eigenspaces done. Diagonalization and the spectral theorem are left.',
        steps: ['Diagonalization exercises', 'Algebraic vs geometric multiplicity', 'Spectral theorem', 'Past exam: eigenvalue section'],
      },
      {
        title: 'Inner product spaces', status: 'pending',
        summary: 'Geometry in vector spaces.\n- Inner products and norms\n- Orthogonality\n- Gram-Schmidt\n- Orthogonal projections, least squares',
      },
    ],
  },
  {
    key: 'organic-chem', label: 'Organic Chemistry', icon: 'spark', color: '#e0a458',
    examInDays: 14, startDaysAgo: 6, reviewDays: 3,
    // On track: keeping up with the planned deadlines.
    topics: [
      { title: 'Bonding and molecular structure', status: 'done', summary: 'Hybridization, resonance, polarity.' },
      { title: 'Alkanes and conformations', status: 'done', summary: 'Nomenclature, Newman projections, ring strain.' },
      { title: 'Stereochemistry', status: 'pending', summary: 'Chirality, R/S configuration, enantiomers and diastereomers.' },
      { title: 'Substitution and elimination', status: 'pending', summary: 'SN1/SN2, E1/E2, competing pathways.', note: 'Working through the SN1 vs SN2 decision table.' },
      { title: 'Alkenes and alkynes', status: 'pending', summary: 'Addition reactions, Markovnikov rule, hydrogenation.' },
      { title: 'Aromatic compounds', status: 'pending', summary: 'Aromaticity, electrophilic aromatic substitution.' },
    ],
  },
  {
    key: 'world-history', label: 'World History', icon: 'book', color: '#a78bfa',
    examInDays: 29, startDaysAgo: 3, reviewDays: 4,
    // Furthest exam, ahead: started early, plenty of runway.
    topics: [
      { title: 'Early civilizations', status: 'done', summary: 'Mesopotamia, Egypt, the Indus valley, early China.' },
      { title: 'Classical empires', status: 'done', summary: 'Greece, Rome, the Han and Maurya empires.' },
      { title: 'The medieval world', status: 'pending', summary: 'Feudal Europe, the Islamic caliphates, the Silk Road.' },
      { title: 'Age of exploration', status: 'pending', summary: 'Ocean trade routes, the Columbian exchange, early colonial empires.' },
      { title: 'Revolutions', status: 'pending', summary: 'The American, French and Industrial revolutions.' },
      { title: 'The world wars', status: 'pending', summary: 'Causes, major fronts and the post-war order.' },
      { title: 'Decolonization and the Cold War', status: 'pending', summary: 'Independence movements, the bipolar world, its end.' },
    ],
  },
];

const SETTINGS = { default_remind_time: '09:30', default_remind_before_min: '0', 'study.review_days': '3' };

function subjectCategory(s: SubjectSpec, sort: number): Category {
  return {
    key: s.key, label: s.label, icon: s.icon, color: s.color, kind: 'subject', sort,
    exam_date: offset(s.examInDays, 9, 0),
    start_date: offset(-s.startDaysAgo, 9, 0),
    review_days: s.reviewDays,
  };
}

function wipe(db: Database): void {
  for (const t of ['notes', 'tasks', 'categories', 'people', 'clients', 'ref_mappings', 'scopes', 'settings']) {
    db.run(`DELETE FROM ${t}`);
  }
}

export function seedStudy(path: string = DB_PATH): { subjects: number; topics: number } {
  const db = openDb(path);
  wipe(db);

  const config: ConfigBundle = {
    categories: SUBJECTS.map((s, i) => subjectCategory(s, i)),
    people: [],
    clients: [],
    refs: [],
    scopes: [{ key: 'study', label: 'Study', tag: 'study', sort: 0, icon: 'book', type: 'study' }],
    settings: SETTINGS,
  };
  bootstrap(db, config);

  let topicCount = 0;
  for (const s of SUBJECTS) {
    const dues = spread(-s.startDaysAgo, s.examInDays - s.reviewDays, s.topics.length);
    s.topics.forEach((topic, i) => {
      const status = topic.status ?? 'pending';
      const due = dues[i];
      const task: Task = {
        id: newId(),
        title: topic.title,
        summary: topic.summary ?? null,
        due_at: due,
        remind_at: due,
        status,
        priority: 2,
        services: [s.key],
        tags: ['study'],
        source: 'agent',
        requester: null,
        client: null,
        closing: null,
        agent_session: null,
        agent_cwd: null,
        created_at: offset(-s.startDaysAgo - 1, 8, 0),
        completed_at: status === 'done' ? due : null,
        notified_at: null,
        steps: topic.steps ?? [],
      };
      insertTask(db, task);
      topicCount++;
      if (topic.note) {
        insertNote(db, {
          id: newId(), task_id: task.id, body: topic.note, kind: 'text',
          created_at: offset(-1, 12, 0), agent_session: null,
        });
      }
    });
  }

  db.close();
  return { subjects: SUBJECTS.length, topics: topicCount };
}

if (import.meta.main) {
  const r = seedStudy(DB_PATH);
  console.log(`Seeded ${r.subjects} subjects + ${r.topics} topics into ${DB_PATH}.`);
}
