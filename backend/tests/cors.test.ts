import { expect, test } from 'bun:test';
import { allowedOrigin, applyCors } from '../src/cors';

const req = (origin?: string) =>
  new Request('http://x/api/health', { headers: origin ? { Origin: origin } : undefined });

test("'*' allows everyone", () => {
  expect(allowedOrigin('http://evil.example', ['*'])).toBe('*');
  const res = applyCors(req('http://evil.example'), new Response('ok'), ['*']);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res.headers.get('Vary')).toBeNull();
});

test('an allowlisted origin is echoed back, with Vary: Origin', () => {
  const allowed = ['http://localhost:4011', 'http://127.0.0.1:4011'];
  const res = applyCors(req('http://127.0.0.1:4011'), new Response('ok'), allowed);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:4011');
  expect(res.headers.get('Vary')).toBe('Origin');
});

test('an unlisted origin gets no Access-Control-Allow-Origin at all', () => {
  const res = applyCors(req('http://evil.example'), new Response('ok'), ['http://localhost:4011']);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(res.headers.get('Access-Control-Allow-Methods')).toContain('DELETE'); // still a valid preflight reply
});

test('no Origin header (curl, agent skills) is left alone', () => {
  const res = applyCors(req(), new Response('ok'), ['http://localhost:4011']);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  expect(res.status).toBe(200);
});
