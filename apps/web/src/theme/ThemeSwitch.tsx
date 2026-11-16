import { Button } from '@lastplan/ui';
import { useEffect, useState } from 'react';
import {
  applyTheme,
  readThemeChoice,
  THEME_CHOICES,
  writeThemeChoice,
  type ThemeChoice,
} from './theme';

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Hell', dark: 'Dunkel' };

/** Umschalter in der Kopfzeile: System / Hell / Dunkel. */
export function ThemeSwitch() {
  const [choice, setChoice] = useState<ThemeChoice>(readThemeChoice);

  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system' || typeof window.matchMedia !== 'function') return;
    // Bei „System“ dem Betriebssystem folgen, auch während die App offen ist.
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);

  return (
    <div className="theme-switch" role="group" aria-label="Darstellung">
      {THEME_CHOICES.map((c) => (
        <Button
          key={c}
          size="sm"
          variant="ghost"
          aria-pressed={choice === c}
          onClick={() => {
            writeThemeChoice(c);
            setChoice(c);
          }}
        >
          {LABEL[c]}
        </Button>
      ))}
    </div>
  );
}
