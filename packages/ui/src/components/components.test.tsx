import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Button,
  Card,
  KpiTile,
  Notice,
  NumberField,
  ProgressBar,
  SearchField,
  SelectField,
  StatusBadge,
  Tabs,
  TextField,
} from '..';

describe('Button', () => {
  it('ist standardmäßig type=button und löst onClick aus', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Speichern</Button>);
    const b = screen.getByRole('button', { name: 'Speichern' });
    expect(b.getAttribute('type')).toBe('button');
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('Felder', () => {
  it('verknüpft Label, Fehler und zeigt „Geändert“', () => {
    render(<TextField label="Name" error="Pflichtfeld" changed />);
    const input = screen.getByLabelText(/Name/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Pflichtfeld');
    expect(screen.getByText('Geändert')).toBeTruthy();
  });
  it('Zahlenfeld zeigt Einheit', () => {
    render(<NumberField label="Limit" unit="A" defaultValue={32} />);
    expect(screen.getByLabelText('Limit')).toHaveProperty('type', 'number');
    expect(screen.getByText('A')).toBeTruthy();
  });
  it('Select rendert Optionen', () => {
    render(
      <SelectField label="Priorität" defaultValue="2">
        <option value="1">1</option>
        <option value="2">2</option>
      </SelectField>,
    );
    expect((screen.getByLabelText('Priorität') as HTMLSelectElement).value).toBe('2');
  });
});

describe('SearchField', () => {
  it('leert über Button', () => {
    const onClear = vi.fn();
    render(<SearchField label="Suchen" value="abc" onChange={() => {}} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Suche leeren' }));
    expect(onClear).toHaveBeenCalled();
  });
});

describe('Anzeige', () => {
  it('Card, KPI, Status', () => {
    render(
      <Card title="Anlage">
        <KpiTile label="Limit" value={250} unit="A" />
        <StatusBadge status="warning">Prüfen</StatusBadge>
      </Card>,
    );
    expect(screen.getByRole('heading', { name: 'Anlage' })).toBeTruthy();
    expect(screen.getByText('Prüfen')).toBeTruthy();
  });
  it('ProgressBar nennt Zustand als Text', () => {
    render(<ProgressBar label="Auslastung" value={100} max={100} />);
    expect(screen.getByText('Limit erreicht')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
  });
  it('Notice zeigt Lösung, Fehler als alert', () => {
    render(<Notice kind="error" title="Import fehlgeschlagen" solution="Datei prüfen" />);
    expect(screen.getByRole('alert').textContent).toContain('Lösung: Datei prüfen');
  });
});

describe('Tabs', () => {
  function Demo() {
    const [v, setV] = useState('a');
    return (
      <Tabs
        label="Bereiche"
        value={v}
        onChange={setV}
        tabs={[
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
          { id: 'c', label: 'C' },
        ]}
      >
        Inhalt {v}
      </Tabs>
    );
  }
  it('Pfeiltasten wechseln und umlaufen', () => {
    render(<Demo />);
    const a = screen.getByRole('tab', { name: 'A' });
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'B' }), { key: 'End' });
    expect(screen.getByRole('tab', { name: 'C' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'C' }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel').textContent).toBe('Inhalt a');
  });
});
