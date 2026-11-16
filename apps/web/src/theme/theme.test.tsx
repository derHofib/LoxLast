import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, readThemeChoice, resolveTheme, THEME_STORAGE_KEY } from './theme';
import { ThemeSwitch } from './ThemeSwitch';

function mockSystemDark(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation(() => ({
      matches: dark,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe('Farbschema', () => {
  beforeEach(() => {
    window.localStorage.clear();
    delete document.documentElement.dataset['theme'];
    mockSystemDark(false);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('ohne gespeicherte Wahl gilt „system“ und folgt dem Betriebssystem', () => {
    expect(readThemeChoice()).toBe('system');
    expect(resolveTheme('system')).toBe('light');
    mockSystemDark(true);
    expect(resolveTheme('system')).toBe('dark');
  });

  it('ungültiger gespeicherter Wert fällt auf „system“ zurück', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'bunt');
    expect(readThemeChoice()).toBe('system');
  });

  it('applyTheme setzt data-theme', () => {
    expect(applyTheme('dark')).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('Umschalter wendet die Wahl an und speichert sie lokal', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitch />);
    expect(document.documentElement.dataset['theme']).toBe('light');
    expect(screen.getByRole('button', { name: 'System' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Dunkel' }));
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Dunkel' }).getAttribute('aria-pressed')).toBe(
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'System' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('gespeicherte Wahl wird beim Start übernommen', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    render(<ThemeSwitch />);
    expect(document.documentElement.dataset['theme']).toBe('dark');
  });
});
