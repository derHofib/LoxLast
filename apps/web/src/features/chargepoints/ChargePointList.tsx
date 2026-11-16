import { SearchField, Button } from '@lastplan/ui';
import { useId, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import type { ChargePoint, Project } from '@lastplan/core';
import { modelDisplayName, type LibraryIndex } from './libraryInfo';
import { groupPath } from './form';

export interface ChargePointListProps {
  project: Project;
  index: LibraryIndex;
  selectedIds: readonly string[];
  search: string;
  onSearch: (value: string) => void;
  onSelect: (ids: string[]) => void;
  onAdd: () => void;
  /** Ist der CSV-Import eingehängt (eigene Komponente), wird der Button aktiv. */
  onCsvImport?: (() => void) | undefined;
  canAdd: boolean;
}

/** Suchtext je Ladepunkt: Bezeichnung, Modell, IP, Gruppenpfad. */
export function matchesSearch(
  project: Project,
  index: LibraryIndex,
  cp: ChargePoint,
  query: string,
): boolean {
  const q = query.trim().toLocaleLowerCase('de-DE');
  if (!q) return true;
  return [
    cp.label,
    modelDisplayName(index, cp.libraryModelId),
    cp.network.ip,
    groupPath(project, cp.groupId),
  ]
    .join(' ')
    .toLocaleLowerCase('de-DE')
    .includes(q);
}

/**
 * Liste der Ladepunkte (Kap. 11.2, 300 px). Mehrfachauswahl wie im Dateimanager:
 * Strg/Cmd-Klick schaltet um, Umschalt-Klick wählt einen Bereich, Pfeiltasten bewegen,
 * Umschalt+Pfeil erweitert, Strg+A wählt alle sichtbaren, Leertaste schaltet um.
 */
export function ChargePointList({
  project,
  index,
  selectedIds,
  search,
  onSearch,
  onSelect,
  onAdd,
  onCsvImport,
  canAdd,
}: ChargePointListProps) {
  const visible = useMemo(
    () => project.chargePoints.filter((cp) => matchesSearch(project, index, cp, search)),
    [project, index, search],
  );
  const ids = visible.map((cp) => cp.id);
  const anchor = useRef<string | undefined>(undefined);
  const listRef = useRef<HTMLUListElement>(null);
  const csvHint = useId();
  const selected = new Set(selectedIds);
  // Fokusstelle: zuletzt gewählter sichtbarer Eintrag, sonst der erste
  const lead = [...ids].reverse().find((id) => selected.has(id)) ?? ids[0];

  const focusOption = (id: string | undefined) =>
    listRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.focus();

  const range = (from: string, to: string) => {
    const a = ids.indexOf(from);
    const b = ids.indexOf(to);
    if (a < 0 || b < 0) return [to];
    return ids.slice(Math.min(a, b), Math.max(a, b) + 1);
  };

  const onClick = (e: MouseEvent, id: string) => {
    if (e.shiftKey && anchor.current) {
      const r = range(anchor.current, id);
      onSelect(e.ctrlKey || e.metaKey ? [...selectedIds, ...r] : r);
    } else if (e.ctrlKey || e.metaKey) {
      anchor.current = id;
      onSelect(selected.has(id) ? selectedIds.filter((s) => s !== id) : [...selectedIds, id]);
    } else {
      anchor.current = id;
      onSelect([id]);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const current = (e.target as HTMLElement).dataset['id'];
    if (!current) return;
    const pos = ids.indexOf(current);
    const move = (to: number) => {
      const target = ids[Math.max(0, Math.min(ids.length - 1, to))];
      if (!target) return;
      e.preventDefault();
      if (e.shiftKey) {
        anchor.current ??= current;
        onSelect(range(anchor.current, target));
      } else {
        anchor.current = target;
        onSelect([target]);
      }
      focusOption(target);
    };
    if (e.key === 'ArrowDown') move(pos + 1);
    else if (e.key === 'ArrowUp') move(pos - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(ids.length - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      onSelect(ids);
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      anchor.current = current;
      onSelect(
        e.ctrlKey || e.metaKey || e.key === ' '
          ? selected.has(current)
            ? selectedIds.filter((s) => s !== current)
            : [...selectedIds, current]
          : [current],
      );
    }
  };

  return (
    <section className="cp-list" aria-label="Ladepunkte">
      <div className="cp-list__search">
        <SearchField
          label="Ladepunkte durchsuchen"
          placeholder="Suchen (/)"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onClear={() => onSearch('')}
        />
      </div>
      {visible.length === 0 ? (
        <p className="cp-list__empty">
          {project.chargePoints.length === 0
            ? 'Noch keine Ladepunkte.'
            : 'Kein Ladepunkt passt zur Suche.'}
        </p>
      ) : (
        <ul
          ref={listRef}
          className="cp-list__items"
          role="listbox"
          aria-label="Ladepunkte"
          aria-multiselectable="true"
          onKeyDown={onKeyDown}
        >
          {visible.map((cp) => (
            <li
              key={cp.id}
              data-id={cp.id}
              role="option"
              aria-selected={selected.has(cp.id)}
              tabIndex={cp.id === lead ? 0 : -1}
              className="cp-list__item"
              onClick={(e) => onClick(e, cp.id)}
            >
              <span className="cp-list__label">{cp.label}</span>
              <span className="cp-list__model">{modelDisplayName(index, cp.libraryModelId)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="cp-list__footer">
        <Button size="sm" onClick={onAdd} disabled={!canAdd}>
          + Ladepunkt
        </Button>
        <span aria-hidden="true">·</span>
        <Button
          size="sm"
          variant="text"
          onClick={onCsvImport}
          disabled={!onCsvImport}
          aria-describedby={onCsvImport ? undefined : csvHint}
        >
          CSV-Import
        </Button>
        {onCsvImport ? null : (
          <span id={csvHint} className="cp-list__hint">
            folgt
          </span>
        )}
      </div>
    </section>
  );
}
