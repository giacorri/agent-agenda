import type { Task } from './types';

let perm: NotificationPermission = 'default';

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (typeof Notification === 'undefined') return 'denied';
  if (Notification.permission !== 'default') { perm = Notification.permission; return perm; }
  perm = await Notification.requestPermission();
  return perm;
}

export function showTaskNotification(t: Task) {
  if (typeof Notification === 'undefined' || perm !== 'granted') return;
  const n = new Notification(t.title, {
    body: t.description ?? '',
    tag: `agent-agenda-${t.id}`,
    requireInteraction: true,
  });
  n.onclick = () => { window.focus(); n.close(); };
}
