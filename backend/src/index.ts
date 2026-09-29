import { openDb } from './db';
import { handleTasksRequest } from './api/tasks';
import { handleIngestRequest, handleNoteIngestRequest, handleStepsIngestRequest, handleClosingIngestRequest, handlePersonalIngestRequest, handleLinkIngestRequest } from './api/ingest';
import { handleConfigRequest } from './api/config';
import { broadcast, registerWs, unregisterWs } from './ws';
import { applyCors } from './cors';
import { startScheduler } from './scheduler';

const PORT = Number(process.env.PORT ?? 4000);
const DB_PATH = process.env.DB_PATH ?? './tasks.db';

const db = openDb(DB_PATH);
startScheduler(db, broadcast);

function route(req: Request, url: URL): Response | Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null);

  if (url.pathname.startsWith('/api/tasks')) {
    return handleTasksRequest(req, url, db, broadcast);
  }
  if (url.pathname.startsWith('/api/config')) {
    return handleConfigRequest(req, url, db, broadcast);
  }
  if (url.pathname === '/api/ingest' && req.method === 'POST') {
    return handleIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/ingest/note' && req.method === 'POST') {
    return handleNoteIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/ingest/steps' && req.method === 'POST') {
    return handleStepsIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/ingest/closing' && req.method === 'POST') {
    return handleClosingIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/ingest/personal' && req.method === 'POST') {
    return handlePersonalIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/ingest/link' && req.method === 'POST') {
    return handleLinkIngestRequest(req, db, broadcast);
  }
  if (url.pathname === '/api/health') {
    return new Response('ok');
  }
  return new Response('not found', { status: 404 });
}

Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws' && server.upgrade(req)) return undefined;
    return applyCors(req, await route(req, url));
  },
  websocket: {
    open(ws) { registerWs(ws); },
    close(ws) { unregisterWs(ws); },
    message() {},
  },
});

console.log(`agent-agenda backend on :${PORT} (db=${DB_PATH})`);
