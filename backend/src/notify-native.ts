import type { Task } from './types';

// Fire a native macOS notification via osascript. The user-controlled text
// (title + body) is passed as AppleScript `argv`, never interpolated into the
// script source — so a crafted task title can't break out of the string and run
// arbitrary AppleScript. Body uses the task summary (there is no `description`).
export function nativeNotify(t: Task) {
  if (process.env.NATIVE_NOTIFY !== '1') return;
  const title = `agent-agenda: ${t.title}`;
  const body = t.summary ?? '';
  Bun.spawn([
    'osascript',
    '-e', 'on run argv',
    '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
    '-e', 'end run',
    body, title,
  ]).exited.catch(() => {});
}
