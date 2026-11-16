import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  beforeEach(() => {
    window.location.hash = '#/';
  });

  it('zeigt leere Projektübersicht, legt Projekt an und wechselt Tabs', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(/Noch keine Projekte/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Neues Projekt' }));
    await user.type(screen.getByLabelText('Projektname'), 'Tiefgarage Nord');
    await user.click(screen.getByRole('button', { name: 'Anlegen' }));

    expect(await screen.findByRole('tab', { name: 'Struktur' })).toBeTruthy();
    expect(screen.getAllByText('Tiefgarage Nord').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: 'Export' }));
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Export' }).getAttribute('aria-selected')).toBe(
        'true',
      ),
    );
    expect(await screen.findByText('Wird erzeugt')).toBeTruthy();
  });

  it('Umbenennen ist per Rückgängig-Button umkehrbar', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('link', { name: 'Tiefgarage Nord' }));
    const input = await screen.findByLabelText('Projektname');
    await user.clear(input);
    await user.type(input, 'Neu');
    await user.tab();
    await waitFor(() => expect(screen.getAllByText('Neu').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Projektname') as HTMLInputElement).value).toBe(
        'Tiefgarage Nord',
      ),
    );
  });

  it('Komponentenseite ist erreichbar', async () => {
    window.location.hash = '#/komponenten';
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Komponenten' })).toBeTruthy();
  });
});
