// Thin wrapper over the Paraglide-generated runtime. The $lib/paraglide folder is
// generated at build/dev time by the Vite plugin (gitignored) — see vite.config.ts.
// Use the active-locale get/set here so the rest of the app never imports the
// generated path directly.
export {
  getLocale,
  setLocale,
  locales,
  baseLocale,
  isLocale,
} from '$lib/paraglide/runtime';
export type { Locale } from '$lib/paraglide/runtime';
