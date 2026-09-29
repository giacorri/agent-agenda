import type { Database } from 'bun:sqlite';
import { dueTasks, updateTask } from './db';
import { nativeNotify } from './notify-native';
import type { WsMessage } from './types';

type Broadcast = (m: WsMessage) => void;

export function runSchedulerTick(db: Database, now: Date, broadcast: Broadcast) {
  const nowIso = now.toISOString();
  const due = dueTasks(db, nowIso);
  for (const t of due) {
    updateTask(db, t.id, { notified_at: nowIso });
    const updated = { ...t, notified_at: nowIso };
    broadcast({ type: 'task.due', task: updated });
    nativeNotify(updated);
  }
}

export function startScheduler(db: Database, broadcast: Broadcast, intervalMs = 30_000) {
  return setInterval(() => runSchedulerTick(db, new Date(), broadcast), intervalMs);
}
