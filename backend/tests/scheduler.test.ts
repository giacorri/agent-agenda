import { expect, test, beforeEach } from 'bun:test';
import { openDb, insertTask, getTask } from '../src/db';
import { runSchedulerTick } from '../src/scheduler';
import type { Task, WsMessage } from '../src/types';

const sample = (over: Partial<Task> = {}): Task => ({
  id: 'T1', title: 't', summary: null,
  due_at: '2026-06-09T10:00:00+02:00', remind_at: '2026-06-09T10:00:00+02:00',
  status: 'pending', priority: 2, tags: [], source: 'agent',
  agent_session: null, agent_cwd: null,
  created_at: '2026-06-09T09:00:00+02:00',
  completed_at: null, notified_at: null, ...over,
});

let db: ReturnType<typeof openDb>;
beforeEach(() => { db = openDb(':memory:'); });

test('emits task.due once when remind_at <= now', () => {
  insertTask(db, sample());
  const events: WsMessage[] = [];
  runSchedulerTick(db, new Date('2026-06-09T10:01:00+02:00'), (m) => events.push(m));
  expect(events.length).toBe(1);
  expect(events[0].type).toBe('task.due');
  expect(getTask(db, 'T1')?.notified_at).not.toBeNull();
});

test('does not re-emit after notified_at set', () => {
  insertTask(db, sample({ notified_at: '2026-06-09T10:00:30+02:00' }));
  const events: WsMessage[] = [];
  runSchedulerTick(db, new Date('2026-06-09T10:05:00+02:00'), (m) => events.push(m));
  expect(events.length).toBe(0);
});
