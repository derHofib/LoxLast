import { Button, Card } from '@lastplan/ui';
import { useState } from 'react';
import { isCheckOnStartEnabled, setCheckOnStartEnabled } from './config';
import { useLibrary } from './libraryStore';
import { checkForLibraryUpdate, type UpdateOptions } from './update';

/**
 * Stand der Wallbox-Bibliothek und Aktion „Nach neuer Bibliothek suchen“ (ADR 0002).
 * Abgerufen wird nur auf Wunsch oder, wenn eingeschaltet, beim Start.
 */
export function LibraryPanel({ updateOptions }: { updateOptions?: UpdateOptions }) {
  const { source, version } = useLibrary();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [onStart, setOnStart] = useState(isCheckOnStartEnabled);

  async function check() {
    setBusy(true);
    setMessage(null);
    const result = await checkForLibraryUpdate(updateOptions);
    setBusy(false);
    if (result.status === 'updated') {
      setMessage(
        `Neue Bibliothek übernommen (Version ${result.version})${result.cached ? '.' : ', nur für diese Sitzung.'}`,
      );
    } else if (result.status === 'unchanged') {
      setMessage('Die Bibliothek ist aktuell.');
    } else {
      setMessage(`Keine neue Bibliothek übernommen: ${result.error}`);
    }
  }

  return (
    <Card
      title="Wallbox-Bibliothek"
      actions={
        <Button size="sm" variant="secondary" onClick={() => void check()} disabled={busy}>
          {busy ? 'Sucht …' : 'Nach neuer Bibliothek suchen'}
        </Button>
      }
    >
      <p>
        {source === 'gebündelt'
          ? 'Mit der App geliefert.'
          : `Nachgeladen, Version ${version ?? 'unbekannt'}.`}
      </p>
      <label className="library-panel__option">
        <input
          type="checkbox"
          checked={onStart}
          onChange={(e) => {
            setCheckOnStartEnabled(e.target.checked);
            setOnStart(e.target.checked);
          }}
        />{' '}
        Beim Start automatisch prüfen
      </label>
      <p role="status">{message}</p>
    </Card>
  );
}
