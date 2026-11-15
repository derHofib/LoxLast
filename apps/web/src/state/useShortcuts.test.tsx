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
