import { createProject } from '@lastplan/core';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { command } from './history';
import { useProjectStore } from './projectStore';
import { useShortcuts } from './useShortcuts';

function Host() {
  useShortcuts();
  return <input aria-label="feld" />;
}

describe('Tastaturkürzel', () => {
  it('Strg+Z / Strg+Umschalt+Z / Strg+Y, nicht in Eingabefeldern', () => {
    const s = () => useProjectStore.getState();
    s().open(createProject({ name: 'A' }));
    s().execute(
      command('r', (d) => {
        d.name = 'B';
      }),
    );
    const { getByLabelText } = render(<Host />);
    fireEvent.keyDown(getByLabelText('feld'), { key: 'z', ctrlKey: true });
    expect(s().project?.name).toBe('B');
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(s().project?.name).toBe('A');
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(s().project?.name).toBe('B');
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true });
    expect(s().project?.name).toBe('B');
  });
});

describe('Löschen und Duplizieren per Tastatur', () => {
  it('Entf löscht die Auswahl, Strg+D dupliziert und wählt die Kopie', async () => {
    const { sampleProject } = await import('../test-fixtures');
    const { useEditorStore } = await import('./editorStore');
    const s = () => useProjectStore.getState();
    s().open(sampleProject());
    render(<Host />);
    const lp01 = s().project!.chargePoints[0]!;

    useEditorStore.getState().select(['site']);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(s().project!.chargePoints).toHaveLength(3); // Netzanschluss nicht löschbar

    useEditorStore.getState().select([lp01.id]);
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    expect(s().project!.chargePoints).toHaveLength(4);
    const copyId = useEditorStore.getState().selectedIds[0];
    expect(s().project!.chargePoints.find((c) => c.id === copyId)?.label).toBe('LP04');

    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(s().project!.chargePoints).toHaveLength(3);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(s().project!.chargePoints).toHaveLength(4);

    useEditorStore.getState().select([]);
    fireEvent.keyDown(document.body, { key: 'd', ctrlKey: true });
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect(s().project!.chargePoints).toHaveLength(4);
    fireEvent.keyDown(document.body, { key: 'x' });
  });
});
