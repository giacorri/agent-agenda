// Optional Italian auto-accent, for typing Italian on a keyboard without accented
// keys: a vowel followed by an apostrophe (e.g. "perche'") becomes the
// grave-accented vowel ("perchè"). Kept as a pure
// transform so it's unit-testable; the caller re-places the DOM caret.

const ACC: Record<string, string> = {
  a: 'à', e: 'è', i: 'ì', o: 'ò', u: 'ù', A: 'À', E: 'È', I: 'Ì', O: 'Ò', U: 'Ù',
};
// Common Italian apostrophe-words (truncations like "po'") that must NOT be
// accented. Deliberately tiny blocklist: extend it if another one shows up.
const NO_ACCENT = new Set(['po', 'mo', 'be']);

// If the char just before `pos` is a vowel+apostrophe pair (and the word is not a
// troncamento), return the accented value and the caret to restore. Null otherwise.
export function applyAccent(v: string, pos: number): { v: string; caret: number } | null {
  if (pos >= 2 && v[pos - 1] === "'" && ACC[v[pos - 2]]) {
    let start = pos - 2;
    while (start > 0 && /[a-zA-Z]/.test(v[start - 1])) start--;
    const word = v.slice(start, pos - 1).toLowerCase(); // word incl. the vowel
    if (!NO_ACCENT.has(word)) {
      return { v: v.slice(0, pos - 2) + ACC[v[pos - 2]] + v.slice(pos), caret: pos - 1 };
    }
  }
  return null;
}

// Runnable self-check: `bun run src/lib/accent.ts`.
export function demo(): void {
  const a = (cond: unknown, msg: string) => { if (!cond) throw new Error('accent demo failed: ' + msg); };
  const at = (s: string) => applyAccent(s, s.length); // caret at end
  a(at("perche'")?.v === 'perchè', "perche' -> perchè");
  a(at("citta'")?.v === 'città', "citta' -> città");
  a(at("piu'")?.v === 'più', "piu' -> più");
  a(at("po'") === null, "po' stays (troncamento)");
  a(at("un'") === null, "un' stays (consonant before apostrophe)");
  a(at("l'") === null, "l' stays");
  a(at('ciao') === null, 'no apostrophe -> null');
  const r = applyAccent("perche' ok", 7); // mid-string, caret right after the pair
  a(r?.v === 'perchè ok' && r?.caret === 6, 'mid-string convert + caret');
  console.log('accent demo: ok');
}

if ((import.meta as unknown as { main?: boolean }).main) demo();
