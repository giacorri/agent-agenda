import { writable, derived } from 'svelte/store';
import type { Task } from '$lib/types';
import { api } from '$lib/api';
import { onWs } from '$lib/ws';
import { showTaskNotification } from '$lib/notify';

export const tasks = writable<Task[]>([]);
export const selectedTaskId = writable<string | null>(null);
// Card currently hovered in the agenda; AgendaView draws connectors from it to its
// linked tasks (blocked_by / blocks). null = nothing hovered.
export const hoveredTaskId = writable<string | null>(null);
// "Pick from the agenda" mode of the drawer's prerequisite picker: while set, the
// drawer is closed and clicking any card links it as a prerequisite of `childId`
// (instead of opening it), then reopens the drawer on the child. null = normal clicks.
export const linkPick = writable<{ childId: string; title: string } | null>(null);

export const pending = derived(tasks, ($t) => $t.filter(t => t.status === 'pending').sort(byDue));
export const completed = derived(tasks, ($t) => $t.filter(t => t.status === 'done').sort(byDue));

// No-deadline tasks ('' due_at) sort after dated ones instead of jumping to the top.
function byDue(a: Task, b: Task) {
  if (!a.due_at) return b.due_at ? 1 : 0;
  if (!b.due_at) return -1;
  return a.due_at.localeCompare(b.due_at);
}

function upsert(list: Task[], t: Task): Task[] {
  const i = list.findIndex(x => x.id === t.id);
  if (i < 0) return [...list, t];
  const copy = list.slice();
  const prev = copy[i];
  // Some broadcasts (note metadata, and task.due which goes through a lean row) don't
  // carry every derived field — keep what we already have when the payload omits it.
  // getTask-based updates DO send blocked_by/blocks (possibly empty), which win via ??.
  copy[i] = {
    ...t,
    note_count: t.note_count ?? prev.note_count,
    last_note: t.last_note ?? prev.last_note,
    blocked_by: t.blocked_by ?? prev.blocked_by,
    blocks: t.blocks ?? prev.blocks,
  };
  return copy;
}

export async function initTaskStream() {
  try {
    const initial = await api.list();
    tasks.set(initial);
  } catch (e) {
    console.error('agent-agenda: api.list failed', e);
  }
  onWs((m) => {
    if (m.type === 'task.created' || m.type === 'task.updated') {
      tasks.update(list => upsert(list, m.task));
    } else if (m.type === 'task.deleted') {
      tasks.update(list => list.filter(t => t.id !== m.id));
    } else if (m.type === 'task.due') {
      tasks.update(list => upsert(list, m.task));
      showTaskNotification(m.task);
    } else if (m.type === 'note.added') {
      // Live-update the card's at-a-glance progress when a new step lands.
      tasks.update(list => list.map(t => t.id === m.task_id
        ? { ...t, note_count: (t.note_count ?? 0) + 1,
            last_note: { body: m.note.body, kind: m.note.kind, created_at: m.note.created_at } }
        : t));
    }
  });
}
