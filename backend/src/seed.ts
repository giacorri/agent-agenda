// Demo/mock seed — loads a neutral config + a spread of realistic tasks so the
// app looks alive for screenshots and local trials. The SHIPPED app stays empty;
// this is never run automatically. Generic English names only — no real data.
//
//   bun run src/seed.ts                 → seeds ./demo.db (never touches ./tasks.db)
//   DB_PATH=/tmp/x.db bun run src/seed.ts → seeds an explicit path
//
// Idempotent: it wipes the target DB's tasks/notes/config first, so re-running
// gives a clean, identical dataset. Dates are computed relative to *now*, so the
// demo always looks current no matter when you run it.
import type { Database } from 'bun:sqlite';
import { openDb, insertTask, insertNote, addDep } from './db';
import { bootstrap, reminderDefaults } from './config-db';
import { parseWhen } from './parse/when';
import { newId } from './ids';
import type { Task, TaskStatus, NoteKind, ConfigBundle } from './types';

// Default to a SEPARATE demo db so a real ./tasks.db is never clobbered.
const DB_PATH = process.env.DB_PATH ?? './demo.db';

// ---- demo config ----------------------------------------------------------
// Generic, product-neutral examples: work "services", personal "apps", people with
// avatars, clients with logos, ref shorthands, work/personal scopes and reminder
// defaults. All upserted via bootstrap() — no raw SQL.

// Tiny inline SVGs so the demo shows logos and avatars without shipping image files.
const svg = (body: string): string =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)}`;
const initials = (text: string, bg: string): string =>
  svg(`<circle cx="32" cy="32" r="32" fill="${bg}"/><text x="32" y="41" font-family="Helvetica,Arial,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${text}</text>`);

const LOGO_NORTHWIND = svg('<rect width="64" height="64" rx="14" fill="#1d4ed8"/><path d="M32 10 L42 34 L32 29 L22 34 Z" fill="#fff"/><path d="M32 54 L22 30 L32 35 L42 30 Z" fill="#93c5fd"/>');
const LOGO_GLOBEX = svg('<rect width="64" height="64" rx="14" fill="#047857"/><circle cx="32" cy="32" r="18" fill="none" stroke="#fff" stroke-width="4"/><ellipse cx="32" cy="32" rx="8" ry="18" fill="none" stroke="#fff" stroke-width="3"/><path d="M14 32 H50" stroke="#fff" stroke-width="3"/>');
const LOGO_ACME = svg('<rect width="64" height="64" rx="14" fill="#c2410c"/><path d="M32 12 L54 52 H10 Z" fill="#fff"/><path d="M32 28 L42 46 H22 Z" fill="#c2410c"/>');

const DEMO_CONFIG: ConfigBundle = {
  categories: [
    { key: 'platform', label: 'Platform', icon: 'server', color: '#5b9bd5', kind: 'service', sort: 0 },
    { key: 'billing', label: 'Billing', icon: 'database', color: '#e0a458', kind: 'service', sort: 1 },
    { key: 'mobile', label: 'Mobile App', icon: 'monitor', color: '#7aa874', kind: 'service', sort: 2 },
    { key: 'web-app', label: 'Web App', icon: 'globe', color: '#a78bfa', kind: 'service', sort: 3 },
    { key: 'reading', label: 'Reading List', icon: 'book', color: '#f472b6', kind: 'app', sort: 4 },
    { key: 'home', label: 'Home', icon: 'wrench', color: '#d97f7f', kind: 'app', sort: 5 },
  ],
  people: [
    { key: 'alex', label: 'Alex', role: 'Engineering lead', sort: 0, photo: initials('A', '#6366f1') },
    { key: 'sam', label: 'Sam', role: 'Product manager', sort: 1, photo: initials('S', '#0891b2') },
    { key: 'jordan', label: 'Jordan', role: 'Customer support', sort: 2, photo: initials('J', '#db2777') },
  ],
  clients: [
    { key: 'northwind', label: 'Northwind', sort: 0, logo: LOGO_NORTHWIND },
    { key: 'globex', label: 'Globex', sort: 1, logo: LOGO_GLOBEX },
    { key: 'acme', label: 'Acme Corp', sort: 2, logo: LOGO_ACME },
  ],
  refs: [
    { shorthand: 'platform', owner_repo: 'acme/platform', host: 'github.com' },
    { shorthand: 'billing', owner_repo: 'acme/billing', host: 'github.com' },
    { shorthand: 'mobile', owner_repo: 'acme/mobile', host: 'github.com' },
    { shorthand: 'web', owner_repo: 'acme/web-app', host: 'github.com' },
  ],
  scopes: [
    { key: 'work', label: 'Work', tag: '', sort: 0, icon: 'building' },
    { key: 'personal', label: 'Personal', tag: 'personal', sort: 1, icon: 'user' },
  ],
  settings: {
    default_remind_time: '09:30',
    default_remind_before_min: '0',
  },
};

// ---- date helpers ---------------------------------------------------------
// We lean on parseWhen so the demo uses the same natural-language date logic as
// real ingest. `when` strings are resolved relative to the current moment.
function dueFrom(when: string, db: Database): string {
  const d = reminderDefaults(db);
  const parsed = parseWhen(when, new Date(), { hour: d.hour, minute: d.minute });
  if (!parsed.ok) throw new Error(`seed: bad date "${when}": ${parsed.error}`);
  return parsed.iso;
}

// A due date relative to now without going through chrono — for dates we want
// firmly in the past (overdue / done), which forwardDate parsing would push ahead.
function offsetIso(days: number, hour = 10, minute = 0): string {
  const x = new Date();
  x.setDate(x.getDate() + days);
  x.setHours(hour, minute, 0, 0);
  return x.toISOString();
}

// ---- demo tasks -----------------------------------------------------------
// A spec is the minimal shape; we expand it into a full Task below. `due` is an
// ISO string relative to now, or '' for a general task with no deadline.
interface NoteSpec { body: string; daysAgo?: number; kind?: NoteKind }
interface TaskSpec {
  title: string;
  summary?: string;
  due: string;
  status?: TaskStatus;    // default 'pending'
  priority?: number;      // default 2
  services?: string[];
  tags?: string[];        // add 'personal' for personal-scoped tasks
  requester?: string;
  client?: string;
  steps?: string[];
  notes?: NoteSpec[];
  closing?: string;
  blockedBy?: string;     // title of a prerequisite task in this list
  doneDaysAgo?: number;   // for status 'done' → completed_at
}

function buildSpecs(db: Database): TaskSpec[] {
  return [
    {
      title: 'Roll out the new login rate limit',
      summary: 'Cap sign-in attempts per IP to stop the credential-stuffing wave.',
      due: offsetIso(0, 17, 0),          // later today
      status: 'in_progress',
      priority: 1,
      services: ['platform', 'web-app'],
      tags: ['security'],
      requester: 'alex',
      client: 'northwind',
      steps: ['Ship the limiter behind a flag', 'Watch error rates for 24h', 'Turn the flag on for everyone'],
      notes: [
        { body: 'Picked up. Plan: limiter in the auth middleware, config per environment.', daysAgo: 2 },
        { body: 'Staging looks clean: 0.2% of real users hit the cap, all retried fine.', daysAgo: 1 },
        { body: 'Flag wired up. Config knob in platform#214.', daysAgo: 0 },
      ],
      closing: 'Hi Alex, the login rate limit is live.\n\n- Max 10 attempts per minute per IP.\n- Real users are not affected (0.2% retried once).\n- Details and the config knob: platform#214.\n\nNothing left on your side.',
    },
    {
      title: 'Fix duplicate invoice emails',
      summary: 'Some customers got the same invoice twice after the retry change.',
      due: offsetIso(-1, 11, 0),         // overdue (yesterday)
      priority: 1,
      services: ['billing'],
      requester: 'jordan',
      client: 'globex',
      steps: ['Reproduce with a stuck job', 'Add an idempotency key on send'],
      notes: [
        { body: 'Cause: a retried job sends again without marking the email as sent. See billing#88.', daysAgo: 1 },
      ],
    },
    {
      title: 'Triage the mobile crash report',
      summary: 'Sam wants the top 5 crashes triaged before the planning call.',
      due: dueFrom('in 2 days', db),
      services: ['mobile'],
      requester: 'sam',
      steps: ['Export the crash list', 'Group by stack trace', 'Open an issue for each of the top 5'],
    },
    {
      title: 'Move billing reports to a read replica',
      summary: 'Take reporting queries off the primary database to cut month-end lock contention.',
      due: dueFrom('in 5 days', db),
      services: ['billing', 'platform'],
      requester: 'alex',
      client: 'acme',
      steps: ['Point reporting at the replica', 'Compare report totals for one week'],
      notes: [
        { body: 'Replica is up in staging. Lag stays under 200 ms at normal load.', daysAgo: 2 },
      ],
    },
    {
      title: 'Load-test the replica cutover',
      summary: 'Simulate month-end traffic against the replica before switching production.',
      due: dueFrom('in 7 days', db),
      services: ['billing'],
      client: 'acme',
      blockedBy: 'Move billing reports to a read replica',
    },
    {
      title: 'Draft the incident postmortem',
      summary: 'Write up the Friday outage: timeline, root cause, follow-ups.',
      due: dueFrom('in 3 days', db),
      status: 'in_progress',
      services: ['platform'],
      requester: 'alex',
      steps: ['Collect the timeline from chat', 'Confirm the root cause with the team', 'List the action items'],
      notes: [
        { body: 'Timeline drafted. Waiting on the database team to confirm the failover order.', daysAgo: 1 },
      ],
    },
    {
      title: 'Add CSV export to the reports page',
      summary: 'Northwind asked to download the monthly report as CSV.',
      due: dueFrom('in 4 days', db),
      services: ['web-app'],
      tags: ['feature'],
      requester: 'sam',
      client: 'northwind',
      steps: ['Add the export button', 'Stream the CSV from the API', 'Update the help page'],
      notes: [{ body: 'Spec agreed with Sam: same columns as the on-screen table. web#57', daysAgo: 1 }],
    },
    {
      title: 'Renew TLS certificates',
      summary: 'Both edge certificates expire at the end of the month. Renew early.',
      due: dueFrom('in 9 days', db),
      priority: 1,
      services: ['platform'],
      steps: ['Request the new certificates', 'Stage them', 'Swap them in the next quiet window'],
    },
    {
      title: 'Update the onboarding screenshots',
      summary: 'The first-run images still show the old sidebar.',
      due: dueFrom('next monday', db),
      priority: 3,
      services: ['web-app'],
    },
    {
      title: 'Write the API deprecation policy',
      summary: 'No deadline yet. Collect ideas as they come up.',
      due: '',                           // general task: no deadline, no reminder
      priority: 3,
      services: ['platform'],
      tags: ['docs'],
    },
    {
      title: 'Ship the dark mode toggle',
      summary: 'Long requested. The theme tokens already exist; it only needs the switch.',
      due: offsetIso(-3, 15, 0),
      status: 'done',
      services: ['mobile'],
      requester: 'sam',
      doneDaysAgo: 3,
      notes: [
        { body: 'Merged in mobile#142 and shipped in the latest build. No regressions reported.', daysAgo: 3 },
      ],
      closing: 'Hi Sam, dark mode is out in the latest mobile build (mobile#142). No regressions so far.',
    },
    {
      title: 'Archive stale feature flags',
      summary: 'Twelve flags have been fully on for over a quarter. Clean them up.',
      due: offsetIso(-2, 14, 0),
      status: 'done',
      priority: 3,
      services: ['platform'],
      doneDaysAgo: 2,
      notes: [
        { body: 'Removed 9 of 12. The other 3 still guard unfinished work.', daysAgo: 2 },
      ],
    },
    {
      title: 'Evaluate a second payment provider',
      summary: 'Parked: not needed until the next pricing change.',
      due: offsetIso(-10, 10, 0),
      status: 'shelved',
      priority: 3,
      services: ['billing'],
      notes: [{ body: 'Shelved after the planning call. Notes kept for later.', daysAgo: 8 }],
    },
    // ---- personal-scoped ----------------------------------------------------
    {
      title: 'Book a dentist appointment',
      summary: 'Six-month checkup is overdue.',
      due: dueFrom('tomorrow', db),
      tags: ['personal'],
    },
    {
      title: 'Finish "Designing Data-Intensive Applications"',
      summary: 'Two chapters left: consistency and consensus.',
      due: dueFrom('in 6 days', db),
      priority: 3,
      services: ['reading'],
      tags: ['personal'],
      steps: ['Chapter 8: distributed systems trouble', 'Chapter 9: consistency and consensus'],
    },
    {
      title: 'Fix the leaky kitchen tap',
      summary: 'Needs a new washer; already bought one.',
      due: dueFrom('this weekend', db),
      status: 'snoozed',
      priority: 3,
      services: ['home'],
      tags: ['personal'],
    },
  ];
}

// ---- assembly -------------------------------------------------------------
function specToTask(spec: TaskSpec, createdDaysAgo: number): Task {
  return {
    id: newId(),
    title: spec.title,
    summary: spec.summary ?? null,
    due_at: spec.due,
    remind_at: spec.due,                  // reminders at due time for the demo
    status: spec.status ?? 'pending',
    priority: spec.priority ?? 2,
    services: spec.services ?? [],
    tags: spec.tags ?? [],
    source: 'agent',
    requester: spec.requester ?? null,
    client: spec.client ?? null,
    closing: spec.closing ?? null,
    agent_session: null,
    agent_cwd: null,
    created_at: offsetIso(-createdDaysAgo, 9, 0),
    completed_at: spec.doneDaysAgo != null ? offsetIso(-spec.doneDaysAgo, 16, 0) : null,
    notified_at: null,
    steps: spec.steps ?? [],
  };
}

// Wipe the target DB so a re-run yields a clean, identical dataset. Only the
// demo tables are cleared — no schema drop, openDb() recreates everything.
function wipe(db: Database): void {
  for (const table of ['task_deps', 'notes', 'tasks', 'categories', 'people', 'clients', 'ref_mappings', 'scopes', 'settings']) {
    db.run(`DELETE FROM ${table}`);
  }
}

export function seed(path: string = DB_PATH): { tasks: number; notes: number; links: number } {
  const db = openDb(path);
  wipe(db);
  bootstrap(db, DEMO_CONFIG);

  const specs = buildSpecs(db);
  const ids = new Map<string, string>();
  let noteCount = 0;
  specs.forEach((spec, i) => {
    const task = specToTask(spec, 14 - i % 7);
    insertTask(db, task);
    ids.set(spec.title, task.id);
    for (const n of spec.notes ?? []) {
      insertNote(db, {
        id: newId(),
        task_id: task.id,
        body: n.body,
        kind: n.kind ?? 'text',
        // Today's notes land an hour ago, never in the future.
        created_at: n.daysAgo ? offsetIso(-n.daysAgo, 12, 0) : new Date(Date.now() - 3_600_000).toISOString(),
        agent_session: null,
      });
      noteCount++;
    }
  });

  let links = 0;
  for (const spec of specs) {
    if (!spec.blockedBy) continue;
    const child = ids.get(spec.title);
    const parent = ids.get(spec.blockedBy);
    if (!child || !parent) throw new Error(`seed: unknown prerequisite "${spec.blockedBy}"`);
    if (addDep(db, child, parent, new Date().toISOString()).ok) links++;
  }
  db.close();
  return { tasks: specs.length, notes: noteCount, links };
}

// Run when invoked directly (bun run src/seed.ts), not on import.
if (import.meta.main) {
  const result = seed(DB_PATH);
  console.log(
    `Seeded ${result.tasks} tasks, ${result.notes} notes and ${result.links} blocking link(s) into ${DB_PATH} ` +
    `(config: ${DEMO_CONFIG.categories.length} categories, ${DEMO_CONFIG.people.length} people, ` +
    `${DEMO_CONFIG.clients.length} clients, ${DEMO_CONFIG.scopes.length} scopes).`
  );
}
