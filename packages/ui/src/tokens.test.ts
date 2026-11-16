// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  colorTokens,
  cssVar,
  darkColorTokens,
  renderTokensCss,
  type ColorTokenSet,
} from './tokens';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('Design-Tokens', () => {
  it('tokens.css ist aktuell (sonst: pnpm --filter @lastplan/ui gen:css)', () => {
    const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');
    expect(css).toBe(renderTokensCss());
  });

  it('enthält die Werte aus der Spezifikation', () => {
    const css = renderTokensCss();
    expect(css).toContain('--color-accent: #6DBE45;');
    expect(css).toContain('--radius-card: 16px;');
    expect(css).toContain('--control-height: 44px;');
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it('alle Farben sind 6-stellige Hex-Werte', () => {
    for (const value of Object.values(colorTokens)) expect(value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it('Dark-Set hat dieselben Schlüssel', () =>
    expect(Object.keys(darkColorTokens).sort()).toEqual(Object.keys(colorTokens).sort()));

  it('cssVar', () => expect(cssVar('accent')).toBe('var(--color-accent)'));

  describe.each([
    ['hell', colorTokens as ColorTokenSet],
    ['dunkel', darkColorTokens],
  ])('Kontraste WCAG 2.2 AA (%s)', (_name, t) => {
    const grounds = ['bg', 'surface', 'surface-sub', 'surface-muted'] as const;
    it.each(grounds)('Text und gedämpfter Text auf %s ≥ 4,5:1', (g) => {
      expect(contrast(t.text, t[g])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['text-muted'], t[g])).toBeGreaterThanOrEqual(4.5);
    });
    it('Text auf Akzent ≥ 4,5:1', () =>
      expect(contrast(t['text-on-accent'], t.accent)).toBeGreaterThanOrEqual(4.5));
    it('Fehler- und Warntext auf ihren Flächen und auf Karten ≥ 4,5:1', () => {
      expect(contrast(t['error-text'], t['error-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['error-text'], t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['warning-text'], t['warning-bg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['warning-text'], t.surface)).toBeGreaterThanOrEqual(4.5);
    });
    it('Anschlusssymbole auf Karten ≥ 3:1 (Grafik)', () => {
      for (const k of ['io-input', 'io-output', 'io-param'] as const)
        expect(contrast(t[k], t.surface)).toBeGreaterThanOrEqual(3);
    });
  });
});
