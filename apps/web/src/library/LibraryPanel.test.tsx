import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryPanel } from './LibraryPanel';
import { resetToBundledLibrary } from './libraryStore';

afterEach(() => resetToBundledLibrary());

describe('LibraryPanel', () => {
  it('zeigt die gebündelte Bibliothek und meldet einen Netzwerkfehler', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('offline'));
    render(
      <LibraryPanel
        updateOptions={{
          fetchFn,
          cache: { read: () => Promise.resolve(undefined), write: () => Promise.resolve() },
        }}
      />,
    );
    expect(screen.getByText('Mit der App geliefert.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nach neuer Bibliothek suchen' }));
    expect(await screen.findByText(/Keine neue Bibliothek übernommen/)).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('Start-Prüfung ist standardmäßig aus und lässt sich einschalten', async () => {
    render(<LibraryPanel />);
    const box = screen.getByRole('checkbox', { name: 'Beim Start automatisch prüfen' });
    expect((box as HTMLInputElement).checked).toBe(false);
    await userEvent.click(box);
    expect((box as HTMLInputElement).checked).toBe(true);
    localStorage.clear();
  });
});
