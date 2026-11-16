/**
 * Farbschema (Meilenstein 10.1): System / Hell / Dunkel. Die Wahl liegt nur lokal im Browser
 * (localStorage), es wird nichts übertragen. „System“ folgt `prefers-color-scheme`.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'lastplan.theme';
export const THEME_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

function isChoice(value: unknown): value is ThemeChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Gespeicherte Wahl; ohne (oder bei gesperrtem/ungültigem Speicher) „system“. */
export function readThemeChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Speicher gesperrt: Wahl gilt nur für diese Sitzung.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

/** Setzt `data-theme` am <html>-Element; die Tokens in tokens.css hängen daran. */
export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);
  document.documentElement.dataset['theme'] = resolved;
  return resolved;
}
