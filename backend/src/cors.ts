// CORS is decided here, once per response, instead of by each handler. CORS_ORIGIN is
// '*' or a comma-separated allowlist; a request whose Origin is not listed gets no
// Access-Control-Allow-Origin at all, so the browser rejects the preflight and hides
// the response from the page. Non-browser clients (curl, the agent skills) ignore it.
const ALLOWED = (process.env.CORS_ORIGIN ?? '*').split(',').map((s) => s.trim()).filter(Boolean);

export function allowedOrigin(origin: string | null, allowed: string[] = ALLOWED): string | null {
  if (allowed.includes('*')) return '*';
  return origin !== null && allowed.includes(origin) ? origin : null;
}

export function applyCors(req: Request, res: Response, allowed: string[] = ALLOWED): Response {
  const origin = allowedOrigin(req.headers.get('Origin'), allowed);
  if (origin !== null) res.headers.set('Access-Control-Allow-Origin', origin);
  if (origin !== '*') res.headers.append('Vary', 'Origin'); // the answer depends on the caller
  res.headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
