import type { ServerWebSocket } from 'bun';
import type { WsMessage } from './types';

const clients = new Set<ServerWebSocket<unknown>>();

export function registerWs(ws: ServerWebSocket<unknown>) { clients.add(ws); }
export function unregisterWs(ws: ServerWebSocket<unknown>) { clients.delete(ws); }

export function broadcast(msg: WsMessage) {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    try { c.send(data); } catch {}
  }
}
