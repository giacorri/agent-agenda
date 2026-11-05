import type { Database } from 'bun:sqlite';
import { listTasks } from './db';
import { hiddenScopeTag } from './config-db';
import type { Task } from './types';

// Possible-duplicate check for a task about to be created: the open tasks that are
// probably about the same topic. Agents create tasks from their own wording, so two
// tasks on one topic rarely share a title; the summary and the tags carry the overlap.

export interface Similar { id: string; title: string; status: string; reason: string }

type Candidate = Pick<Task, 'title' | 'summary' | 'tags' | 'client'>;

// Short function words in the two languages the agenda is mostly written in.
const STOP = new Set(`della delle degli dello dalla dalle dagli nella nelle negli sulla sulle sugli
alla alle agli anche come cosa sono essere fare fatto quando prima dopo ogni tutti tutte tutto
senza dove questo questa quello quella oppure ancora solo così perché mentre però hanno viene
vanno serve servono altro altri altre loro nostro with from that this have into when what then
than they them there their about after before only also some more most just over each been were
will would should could`.split(/\s+/));

// Words of 4+ letters cut to 5 letters: a crude stem that folds Italian and English
// inflections (agente/agenti, orchestrazione/orchestrano) without a dictionary.
export function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w.slice(0, 5));
  }
  return out;
}

const common = (a: Set<string>, b: Set<string>) => [...a].filter(x => b.has(x));

// Thresholds measured on a real agenda of ~300 tasks: they catch the duplicates found
// there by hand and flag only a handful of related-but-distinct open pairs.
export function similarity(a: Candidate, b: Candidate, hidden: string | null): string | null {
  if (a.client && b.client && a.client.toLowerCase() !== b.client.toLowerCase()) return null;
  const ta = stems(a.title), tb = stems(b.title);
  const sharedTitle = common(ta, tb);
  if (sharedTitle.length >= 2 && sharedTitle.length >= 0.6 * Math.min(ta.size, tb.size)) {
    return 'similar title';
  }
  const sa = stems(`${a.title} ${a.summary ?? ''}`), sb = stems(`${b.title} ${b.summary ?? ''}`);
  const shared = common(sa, sb).length;
  const jaccard = shared / Math.max(1, new Set([...sa, ...sb]).size);
  const skip = new Set(['personal', hidden?.toLowerCase()]);
  const tagsB = new Set(b.tags.map(t => t.toLowerCase()));
  const sharedTags = a.tags.map(t => t.toLowerCase()).filter(t => tagsB.has(t) && !skip.has(t));
  if (jaccard >= 0.18) return `${shared} words in common`;
  if (jaccard >= 0.1 && sharedTags.length >= 2) return `${shared} words and tags ${sharedTags.join(', ')} in common`;
  return null;
}

export function findSimilarOpen(db: Database, c: Candidate, limit = 3): Similar[] {
  const hidden = hiddenScopeTag(db);
  const out: Similar[] = [];
  for (const t of listTasks(db)) {
    if (!['pending', 'in_progress', 'snoozed'].includes(t.status)) continue;
    const reason = similarity(c, t, hidden);
    if (reason) out.push({ id: t.id, title: t.title, status: t.status, reason });
    if (out.length >= limit) break;
  }
  return out;
}
