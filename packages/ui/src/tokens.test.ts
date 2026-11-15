// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorTokens, cssVar, darkColorTokens, renderTokensCss } from './tokens';

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
});
