import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { expandRefs, type RepoTarget } from './stores/config';
import type { ConfigBundle } from './types';
import * as m from '$lib/paraglide/messages';

marked.setOptions({ gfm: true, breaks: true });

const LIST_LINE = /^\s*(\d+\.|[-*])\s+/;
const BLOCK_LINE = /^\s*(#{1,6}\s|>\s|```)/;

// Insert a blank line before each contiguous list block (and headings/blockquotes/fences)
// when one isn't already present. marked needs the blank line to start a real <ol>/<ul>
// even with breaks:true, otherwise it renders the items as plain text with <br>.
function normalizeBlocks(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) { out.push(line); continue; }

    const isBlockStart = LIST_LINE.test(line) || BLOCK_LINE.test(line);
    if (isBlockStart && out.length > 0) {
      const prev = out[out.length - 1];
      const prevIsBlank = prev.trim() === '';
      const prevIsList = LIST_LINE.test(prev);
      if (!prevIsBlank && !prevIsList) out.push('');
    }
    out.push(line);
  }
  return out.join('\n');
}

const SAFE_PROTOCOLS = /^(https?|mailto|file):/i;

const purifyConfig: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'a', 'p', 'br', 'strong', 'em', 'code', 'pre', 'blockquote',
    'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'del',
    'input', 'span',
  ],
  ALLOWED_ATTR: ['href', 'title', 'type', 'checked', 'disabled', 'class'],
  ALLOW_DATA_ATTR: false,
};

let configured = false;
function ensureConfigured() {
  if (configured || typeof window === 'undefined') return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      const href = node.getAttribute('href') || '';
      if (!SAFE_PROTOCOLS.test(href)) node.removeAttribute('href');
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noreferrer noopener');
    }
  });
  configured = true;
}

// A progress note reads like one point of a "what we did" recap: the first line is the
// headline (the outcome/lesson), the rest is the story. Split so the UI can lead with the
// headline. Single-line notes (or a headline with no body) have no headline — render whole.
export function splitNote(body: string): { headline: string; rest: string } {
  const nl = body.indexOf('\n');
  if (nl === -1) return { headline: '', rest: body };
  const headline = body.slice(0, nl).trim();
  const rest = body.slice(nl + 1).trim();
  if (!headline || !rest) return { headline: '', rest: body };
  return { headline, rest };
}

// `cfg` is optional: pass the reactive `$config` from a Svelte template so the render
// re-runs when config loads (ref linking depends on it); omit it elsewhere and it falls
// back to a one-time get(config) read inside expandRefs.
export function renderMarkdown(
  src: string,
  repo: RepoTarget | null = null,
  cfg?: ConfigBundle
): string {
  if (typeof window === 'undefined') return src;
  ensureConfigured();
  const html = marked.parse(expandRefs(normalizeBlocks(src), repo, cfg), { async: false }) as string;
  return withCopyButtons(DOMPurify.sanitize(html, purifyConfig));
}

const COPY_SVG =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';

// Added after sanitizing because DOMPurify drops <button>; the markup is static. The click
// is handled by one delegated listener (copyCodeOnClick) since {@html} can't bind events.
function withCopyButtons(html: string): string {
  if (!html.includes('<pre>')) return html;
  const label = m.td_copy_clipboard();
  const btn = `<button type="button" class="code-copy" aria-label="${label}" title="${label}">${COPY_SVG}</button>`;
  return html.replace(/<pre>/g, `<div class="code-block">${btn}<pre>`).replace(/<\/pre>/g, '</pre></div>');
}

// Capture-phase window listener: stops the click before it reaches a card/row that would
// otherwise open the task.
export function copyCodeOnClick(e: MouseEvent) {
  const btn = (e.target as Element | null)?.closest?.('.code-copy');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  const text = btn.parentElement?.querySelector('pre')?.textContent ?? '';
  navigator.clipboard.writeText(text.replace(/\n$/, '')).then(() => {
    btn.classList.add('ok');
    setTimeout(() => btn.classList.remove('ok'), 1500);
  }, () => {});
}
