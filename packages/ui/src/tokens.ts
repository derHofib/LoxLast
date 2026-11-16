/**
 * Design-Tokens (Kap. 10.1). Einzige Quelle der Wahrheit – tokens.css wird daraus erzeugt
 * (`pnpm --filter @lastplan/ui gen:css`), ein Test verhindert Abweichungen.
 *
 * Gestaltung angelehnt an die helle, grüne Loxone-Designsprache, aber ohne Loxone-Logo,
 * -Namen oder die Schrift „LOXONE Sans“ (ADR 0005).
 */

export const colorTokens = {
  bg: '#F4F3F1',
  surface: '#FFFFFF',
  'surface-sub': '#FAF9F7',
  'surface-muted': '#F4F3F1',
  border: '#E3E0DB',
  'border-strong': '#D6D2CC',
  'border-block': '#CFCAC3',
  text: '#262524',
  'text-muted': '#5E5A54',
  'text-on-accent': '#1C1B1A',
  /** Grün – NUR für Flächen, Linien, Balken, Markierungen, Buttons; NIE als Textfarbe. */
  accent: '#6DBE45',
  track: '#E8E5E0',
  error: '#C2410C',
  'error-text': '#9A3412',
  'error-bg': '#FDF4EF',
  'error-border': '#F0C9B4',
  warning: '#B7791F',
  'warning-text': '#7A5200',
  'warning-bg': '#FBF5E6',
  /** Eingang – Quadrat */
  'io-input': '#2F6FB0',
  /** Ausgang – Kreis */
  'io-output': '#4E9A2A',
  /** Parameter – Raute */
  'io-param': '#8A847C',
} as const;

export type ColorToken = keyof typeof colorTokens;
export type ColorTokenSet = Record<ColorToken, string>;

/**
 * Dark Mode (Meilenstein 10.1): warmes Dunkelgrau passend zur hellen Palette, gleiches Grün als
 * Akzent (nur Flächen/Linien, nie Text). Kontraste WCAG 2.2 AA – geprüft in tokens.test.ts.
 */
export const darkColorTokens: ColorTokenSet = {
  bg: '#171716',
  surface: '#212120',
  'surface-sub': '#1B1B1A',
  'surface-muted': '#2A2927',
  border: '#3A3835',
  'border-strong': '#4A4743',
  'border-block': '#55514C',
  text: '#ECEAE6',
  'text-muted': '#AAA59D',
  'text-on-accent': '#1C1B1A',
  accent: '#6DBE45',
  track: '#34322F',
  error: '#E8793F',
  'error-text': '#F4A57B',
  'error-bg': '#3A2218',
  'error-border': '#7A3A1E',
  warning: '#D9A441',
  'warning-text': '#E8C068',
  'warning-bg': '#33290F',
  'io-input': '#6FA8E0',
  'io-output': '#7CC156',
  'io-param': '#A39D94',
};

export const typography = {
  'font-sans': "'Source Sans 3', system-ui, sans-serif",
  'fs-xs': '12px',
  'fs-sm': '13px',
  'fs-md': '14px',
  'fs-base': '15px',
  'fs-lg': '16px',
  'fs-xl': '17px',
  'fs-2xl': '22px',
  'fs-kpi': '28px',
  'fw-regular': '400',
  'fw-semibold': '600',
  'fw-bold': '700',
} as const;

export const radii = {
  'radius-pill': '999px',
  'radius-card': '16px',
  'radius-md': '12px',
  'radius-sm': '10px',
  'radius-xs': '8px',
} as const;

/** 4er-Raster */
export const spacing = {
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-7': '28px',
  'space-8': '32px',
} as const;

export const sizes = {
  'header-height': '64px',
  'control-height': '44px',
  'control-height-sm': '40px',
  'shadow-block': '0 1px 2px rgba(38,37,36,.06)',
} as const;

/** Name der CSS-Variable zu einem Token, z. B. cssVar('accent') → 'var(--color-accent)'. */
export function cssVar(token: ColorToken): string {
  return `var(--color-${token})`;
}

function block(selector: string, entries: [string, string][]): string {
  return `${selector} {\n${entries.map(([k, v]) => `  --${k}: ${v};`).join('\n')}\n}\n`;
}

const colorEntries = (set: ColorTokenSet): [string, string][] =>
  Object.entries(set).map(([k, v]) => [`color-${k}`, v]);

/** Erzeugt den Inhalt von tokens.css. */
export function renderTokensCss(): string {
  return [
    '/* Automatisch erzeugt aus src/tokens.ts – nicht von Hand bearbeiten (pnpm --filter @lastplan/ui gen:css). */\n',
    block(':root', [
      ...colorEntries(colorTokens),
      ...Object.entries(typography),
      ...Object.entries(radii),
      ...Object.entries(spacing),
      ...Object.entries(sizes),
    ]),
    '/* Dark Mode (Meilenstein 10.1). */\n',
    block(':root[data-theme="dark"]', colorEntries(darkColorTokens)),
  ].join('\n');
}
