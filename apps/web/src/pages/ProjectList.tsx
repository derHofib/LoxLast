import { createProject } from '@lastplan/core';
import { Button, Card, Notice, SearchField, TextField } from '@lastplan/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { repository, type ProjectSummary } from '../storage/db';
import { downloadProject, parseProjectJson, withFreshId } from '../storage/exchange';
import { LibraryPanel } from '../library/LibraryPanel';

const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

export function ProjectList() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    repository
      .list()
      .then(setProjects)
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(refresh, [refresh]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!projects) return [];
    return q
      ? projects.filter((p) =>
          [p.name, p.customer, p.address].some((v) => v?.toLowerCase().includes(q)),
        )
      : projects;
  }, [projects, query]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const project = createProject({ name });
    await repository.save(project);
    navigate(`/projekt/${project.id}/struktur`);
  }

  async function onImport(file: File) {
    const result = parseProjectJson(await file.text());
    if (!result.ok) {
      setImportErrors(result.errors);
      return;
    }
    setImportErrors([]);
    const project = withFreshId(result.project);
    await repository.save(project);
    navigate(`/projekt/${project.id}/struktur`);
  }

  async function onExport(id: string) {
    const p = await repository.get(id);
    if (p) downloadProject(p);
  }

  async function onDelete(p: ProjectSummary) {
    if (
      !window.confirm(
        `Projekt „${p.name}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`,
      )
    )
      return;
    await repository.remove(p.id);
    refresh();
  }

  return (
    <main className="app-main">
      <div className="list-head">
        <h1>Projekte</h1>
        <div className="list-head__actions">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="lp-visually-hidden"
            aria-label="Projektdatei wählen"
            tabIndex={-1}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImport(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()}>Importieren</Button>
          <Button variant="primary" onClick={() => setCreating(true)}>
            Neues Projekt
          </Button>
        </div>
      </div>

      {importErrors.length > 0 ? (
        <Notice
          kind="error"
          title="Import fehlgeschlagen"
          solution="Datei prüfen oder erneut aus LastPlan exportieren."
        >
          <ul>
            {importErrors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {loadError ? (
        <Notice
          kind="error"
          title="Projekte lassen sich nicht lesen"
          solution="Seite neu laden; bleibt der Fehler, Browser-Speicher prüfen (Privatmodus sperrt IndexedDB)."
        >
          {loadError}
        </Notice>
      ) : null}

      {creating ? (
        <Card title="Neues Projekt">
          <form onSubmit={(e) => void onCreate(e)} className="app-stack">
            <TextField
              label="Projektname"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="z. B. Tiefgarage Musterstraße 12"
              autoFocus
              required
            />
            <div className="list-head__actions">
              <Button type="submit" variant="primary" disabled={!newName.trim()}>
                Anlegen
              </Button>
              <Button onClick={() => setCreating(false)}>Abbrechen</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <SearchField
        label="Projekte durchsuchen"
        placeholder="Name, Kunde oder Adresse"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery('')}
      />

      {projects === null ? (
        <p>Lädt …</p>
      ) : projects.length === 0 ? (
        <Card>
          <p className="empty">
            Noch keine Projekte. Lege ein neues Projekt an oder importiere eine exportierte Datei.
          </p>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <p className="empty">Kein Projekt passt zu „{query}“.</p>
        </Card>
      ) : (
        <ul className="project-list">
          {visible.map((p) => (
            <li key={p.id} className="project-row">
              <div className="project-row__main">
                <Link to={`/projekt/${p.id}/struktur`} className="project-row__name">
                  {p.name}
                </Link>
                <span className="project-row__meta">
                  {[p.customer, p.address].filter(Boolean).join(' · ') || 'Ohne Kundenangabe'} ·{' '}
                  {p.chargePointCount} Ladepunkte · geändert {dateFmt.format(new Date(p.updatedAt))}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void onExport(p.id)}
                aria-label={`${p.name} exportieren`}
              >
                Exportieren
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void onDelete(p)}
                aria-label={`${p.name} löschen`}
              >
                Löschen
              </Button>
            </li>
          ))}
        </ul>
      )}
      <LibraryPanel />
    </main>
  );
}
