import { beforeEach, describe, expect, it } from 'vitest';
import { sampleProject } from '../test-fixtures';
import { useEditorStore } from './editorStore';

const e = () => useEditorStore.getState();

beforeEach(() => useEditorStore.setState({ selectedIds: [], reveal: null, clipboard: null }));

describe('Editor-Zustand', () => {
  it('Auswahl, Umschalten, Leeren', () => {
    e().select(['a', 'b', 'a']);
    expect(e().selectedIds).toEqual(['a', 'b']);
    e().toggle('b');
    e().toggle('c');
    expect(e().selectedIds).toEqual(['a', 'c']);
    e().clearSelection();
    expect(e().selectedIds).toEqual([]);
  });

  it('Sprung aus Prüfmeldung setzt Auswahl und neues Sprungziel', () => {
    e().revealIds(['x']);
    const first = e().reveal?.nonce;
    e().revealIds(['x']);
    expect(e().selectedIds).toEqual(['x']);
    expect(e().reveal?.nonce).not.toBe(first);
  });

  it('Ausschneiden und Aufräumen nach Löschen', () => {
    const p = sampleProject();
    const [lp01, lp02] = p.chargePoints;
    e().select(['site', lp01!.id, 'weg']);
    e().cut([lp02!.id, 'weg']);
    e().prune(p);
    expect(e().selectedIds).toEqual(['site', lp01!.id]);
    expect(e().clipboard).toEqual({ mode: 'cut', ids: [lp02!.id] });
    const before = e();
    e().prune(p); // nichts zu tun → Zustand bleibt identisch
    expect(e()).toBe(before);
    e().prune(null);
    expect(e().selectedIds).toEqual(['site']);
    expect(e().clipboard).toBeNull();
    e().cut([]);
    expect(e().clipboard).toBeNull();
    e().cut(['a']);
    e().clearClipboard();
    expect(e().clipboard).toBeNull();
  });
});
