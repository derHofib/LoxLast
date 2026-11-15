import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
}

export interface TabsProps {
  tabs: readonly TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Inhalt des aktiven Tabs (role=tabpanel). */
  children?: ReactNode;
}

/** Tabs nach WAI-ARIA: Pfeiltasten, Pos1/Ende, nur aktiver Tab im Tab-Fokus. */
export function Tabs({ tabs, value, onChange, label, children }: TabsProps) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (target) {
      onChange(target.id);
      refs.current[next]?.focus();
    }
  }

  return (
    <>
      <div role="tablist" aria-label={label} className="lp-tabs">
        {tabs.map((t, i) => {
          const selected = t.id === value;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel`}
              tabIndex={selected ? 0 : -1}
              className={`lp-tab${selected ? ' lp-tab--active' : ''}`}
              onClick={() => onChange(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {children !== undefined ? (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`}>
          {children}
        </div>
      ) : null}
    </>
  );
}
