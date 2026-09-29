import type { WsMessage } from './types';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:4010/ws';
type Cb = (m: WsMessage) => void;

let socket: WebSocket | null = null;
const listeners = new Set<Cb>();

// Reconnect with exponential backoff (capped), reset once a connection succeeds,
// so a backend that's down doesn't get hammered every 3s forever.
let retryDelay = 1000;
const MAX_DELAY = 30_000;

export function connectWs() {
  if (socket) return;
  socket = new WebSocket(WS_URL);
  socket.onopen = () => { retryDelay = 1000; };
  socket.onmessage = (e) => {
    try { const m: WsMessage = JSON.parse(e.data); for (const l of listeners) l(m); }
    catch {}
  };
  socket.onclose = () => {
    socket = null;
    setTimeout(connectWs, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MAX_DELAY);
  };
}

export function onWs(cb: Cb): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
