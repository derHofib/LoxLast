import '@testing-library/jest-dom/vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../../state/editorStore';
import { useProjectStore } from '../../state/projectStore';
import { sampleProject } from '../../test-fixtures';
import { renderStructure, type Rendered } from './testing';

let view: Rendered | undefined;
afterEach(() => {
  view?.stopChecks();
  view = undefined;
  useProjectStore.getState().close();
});

const project = () => useProjectStore.getState().project!;
const editor = () => useEditorStore.getState();
const button = (name: string | RegExp) => screen.findByRole('button', { name });
const keys = (k: string) => userEvent.keyboard(k);

describe('Darstellung', () => {
  it('zeigt Netzanschluss, Cluster, Gruppen und Ladepunkte als Buttons', async () => {
    view = renderStructure(sampleProject());
    expect(await button('Cluster UV-TG1 auswählen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gruppe Mieter auswählen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^LP01/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Netzanschluss HAK 250 A/ })).toBeInTheDocument();
    expect(screen.getByText(/Belegt 18 A von 125 A/)).toBeInTheDocument();
  });

  it('Cluster mit zu kleinem Limit: orange Meldung mit Text, Balken voll', async () => {
    const p = sampleProject();
    p.clusters[0]!.limitA = 10;
    view = renderStructure(p);
    const card = (await button('Cluster UV-TG1 auswählen')).closest(
      '.structure-box',
    ) as HTMLElement;
    expect(card.querySelector('.lp-node--error')).not.toBeNull();
    expect(within(card).getByText('Fehler')).toBeInTheDocument();
    expect(within(card).getByText(/Mindeststrom-Summe 18 A über Limit 10 A/)).toBeInTheDocument();
    expect(within(card).getByText(/Belegt 18 A von 10 A/)).toBeInTheDocument();
    expect(within(card).getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      expect.stringContaining('Limit erreicht'),
    );
  });

  it('Übersicht: Phasenlast, Prüfung, Simulation', async () => {
    view = renderStructure(sampleProject());
    await button('Cluster UV-TG1 auswählen');
    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
    const phases = screen.getByRole('group', { name: 'Phasenlast (Worst Case)' });
    expect(within(phases).getByText(/48 A von 170 A/)).toBeInTheDocument();
    expect(screen.getByText(/Schieflast 32 A \(zulässig 20 A\)/)).toBeInTheDocument();
    expect(screen.getByText(/Fehler, .* Hinweise?/)).toBeInTheDocument();
  });
});

describe('Anlegen', () => {
  it('„+ Cluster“, „+ Gruppe“, „+ Ladepunkt“ legen ein und wählen das neue Element aus', async () => {
    const { createProject } = await import('@lastplan/core');
    view = renderStructure(createProject({ name: 'Neu' }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '+ Cluster' }));
    const cluster = await button('Cluster UV-1 auswählen');
    expect(cluster).toHaveAttribute('aria-pressed', 'true');
    expect(editor().selectedIds).toEqual([project().clusters[0]!.id]);
    expect(screen.getByRole('heading', { level: 2, name: 'UV-1' })).toBeInTheDocument(); // Eigenschaften statt Übersicht

    await user.click(screen.getByRole('button', { name: '+ Gruppe' }));
    expect(await button('Gruppe Gruppe 1 auswählen')).toHaveAttribute('aria-pressed', 'true');
    expect(project().groups[0]!.clusterId).toBe(project().clusters[0]!.id);

    await user.click(screen.getByRole('button', { name: '+ Ladepunkt' }));
    expect(await button(/^LP01/)).toHaveAttribute('aria-pressed', 'true');
    expect(project().chargePoints[0]!.groupId).toBe(project().groups[0]!.id);
    expect(project().chargePoints[0]!.libraryModelId).not.toBe('');

    // Kürzel N: weiterer Ladepunkt in der Gruppe der Auswahl
    await keys('n');
    expect(project().chargePoints.map((c) => c.label)).toEqual(['LP01', 'LP02']);
    expect(project().chargePoints[1]!.groupId).toBe(project().groups[0]!.id);
    expect(editor().selectedIds).toEqual([project().chargePoints[1]!.id]);
  });

  it('„+ Ladepunkt“ ohne jede Struktur legt die fehlenden Ebenen mit an (ein Undo-Schritt)', async () => {
    const { createProject } = await import('@lastplan/core');
    view = renderStructure(createProject({ name: 'Leer' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Ladepunkt' }));
    expect(project().clusters).toHaveLength(1);
    expect(project().groups).toHaveLength(1);
    expect(project().chargePoints).toHaveLength(1);
    expect(useProjectStore.getState().past).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(project().chargePoints).toHaveLength(0);
  });

  it('N wird in Eingabefeldern nicht abgefangen', async () => {
    view = renderStructure(sampleProject());
    await button(/^LP01/);
    await userEvent.click(screen.getByRole('button', { name: 'Cluster UV-TG1 auswählen' }));
    const name = screen.getByLabelText('Name');
    await userEvent.type(name, 'n');
    expect(project().chargePoints).toHaveLength(3);
  });
});

describe('Auswahl und Pfeiltasten', () => {
  it('Klick wählt aus, Strg+Klick ergänzt, Pfeiltasten bewegen die Auswahl', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    const lp01 = await button(/^LP01/);
    await user.click(lp01);
    expect(editor().selectedIds).toEqual([project().chargePoints[0]!.id]);
    expect(screen.getByRole('heading', { name: 'LP01' })).toBeInTheDocument();

    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('button', { name: /^LP02/ }));
    await user.keyboard('{/Control}');
    expect(editor().selectedIds).toHaveLength(2);
    expect(screen.getByRole('heading', { name: '2 Elemente ausgewählt' })).toBeInTheDocument();

    await user.click(lp01);
    await user.keyboard('{ArrowDown}');
    expect(editor().selectedIds).toEqual([project().chargePoints[1]!.id]);
    expect(screen.getByRole('button', { name: /^LP02/ })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(editor().selectedIds).toEqual([project().groups[0]!.id]);
    await user.keyboard('{ArrowLeft}{ArrowRight}');
    expect(editor().selectedIds).toEqual([project().groups[0]!.id]);
    await user.keyboard('{Home}');
    expect(editor().selectedIds).toEqual(['site']);
    expect(screen.getByRole('heading', { name: 'Netzanschluss' })).toBeInTheDocument();
  });

  it('nur das ausgewählte Element ist per Tab erreichbar (Roving Tabindex)', async () => {
    view = renderStructure(sampleProject());
    await button(/^LP01/);
    expect(screen.getByRole('button', { name: /Netzanschluss/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /^LP01/ })).toHaveAttribute('tabindex', '-1');
    act(() => editor().select([project().chargePoints[0]!.id]));
    expect(screen.getByRole('button', { name: /^LP01/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /Netzanschluss/ })).toHaveAttribute('tabindex', '-1');
  });
});

describe('Prüfung: Sprung und Auto-Fix', () => {
  it('Klick auf eine Meldung wählt das Element aus und fokussiert es', async () => {
    const p = sampleProject();
    p.clusters[0]!.limitA = 10;
    view = renderStructure(p);
    await button('Cluster UV-TG1 auswählen');
    const finding = screen.getByRole('button', {
      name: /Fehler: .*Mindeststrom-Summe 18\sA über Limit 10\sA/,
    });
    await userEvent.click(finding);
    expect(editor().selectedIds).toEqual([p.clusters[0]!.id]);
    expect(editor().reveal?.ids).toEqual([p.clusters[0]!.id]);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cluster UV-TG1 auswählen' })).toHaveFocus(),
    );
    // Eigenschaften des Clusters zeigen die zugehörige Meldung weiter an
    expect(screen.getByRole('heading', { level: 2, name: 'UV-TG1' })).toBeInTheDocument();
    expect(screen.getAllByText(/Mindeststrom-Summe 18 A über Limit 10 A/).length).toBeGreaterThan(
      0,
    );
  });

  it('Meldung beheben über das Limit: Fehler verschwindet, Undo bringt ihn zurück', async () => {
    const p = sampleProject();
    p.clusters[0]!.limitA = 10;
    view = renderStructure(p);
    const user = userEvent.setup();
    await button('Cluster UV-TG1 auswählen');
    await user.click(screen.getByRole('button', { name: /Mindeststrom-Summe/ }));
    const limit = screen.getByLabelText('Limit');
    await user.clear(limit);
    await user.type(limit, '63');
    expect(screen.getByText('Geändert: 10 → 63 A')).toBeInTheDocument();
    await user.tab();
    expect(project().clusters[0]!.limitA).toBe(63);
    expect(screen.queryByText(/Mindeststrom-Summe 18 A über Limit/)).not.toBeInTheDocument();
    act(() => useProjectStore.getState().undo());
    expect(project().clusters[0]!.limitA).toBe(10);
    expect(screen.getAllByText(/Mindeststrom-Summe 18 A über Limit 10 A/).length).toBeGreaterThan(
      0,
    );
  });

  it('Auto-Fix: Vorschau, Bestätigung, ein Undo-Schritt', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await button('Cluster UV-TG1 auswählen');
    const before = project().chargePoints.map((c) => c.phaseRotation);
    await user.click(screen.getByRole('button', { name: /^Lösung: Phasenlage ändern/ }));
    const preview = screen.getByRole('group', { name: 'Lösungsvorschlag' });
    expect(within(preview).getByText(/LP01: Phasenlage L1-L2-L3 → L3-L1-L2/)).toBeInTheDocument();
    expect(project().chargePoints.map((c) => c.phaseRotation)).toEqual(before); // noch nichts geändert

    const pastBefore = useProjectStore.getState().past.length;
    await user.click(within(preview).getByRole('button', { name: 'Übernehmen' }));
    expect(project().chargePoints[0]!.phaseRotation).toBe('L3-L1-L2');
    expect(useProjectStore.getState().past).toHaveLength(pastBefore + 1);
    useProjectStore.getState().undo();
    expect(project().chargePoints.map((c) => c.phaseRotation)).toEqual(before);
  });

  it('Auto-Fix lässt sich abbrechen', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await button('Cluster UV-TG1 auswählen');
    await user.click(screen.getByRole('button', { name: /^Lösung: Phasenlage ändern/ }));
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('group', { name: 'Lösungsvorschlag' })).not.toBeInTheDocument();
  });
});

describe('Tastatur: Ausschneiden und Einfügen', () => {
  it('Strg+X, Ziel wählen, Strg+V verschiebt den Ladepunkt', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    const lp01 = project().chargePoints[0]!;
    const flotte = project().groups[1]!;
    await user.click(await button(/^LP01/));
    await keys('{Control>}x{/Control}');
    expect(editor().clipboard).toEqual({ mode: 'cut', ids: [lp01.id] });
    expect(screen.getByText(/1 Element ausgeschnitten/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Gruppe Flotte auswählen' }));
    await keys('{Control>}v{/Control}');
    expect(project().chargePoints.find((c) => c.id === lp01.id)?.groupId).toBe(flotte.id);
    expect(editor().clipboard).toBeNull();
    expect(editor().selectedIds).toEqual([lp01.id]);
    useProjectStore.getState().undo();
    expect(project().chargePoints.find((c) => c.id === lp01.id)?.groupId).toBe(
      project().groups[0]!.id,
    );
  });

  it('Einfügen am falschen Ziel verschiebt nichts und meldet es', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await user.click(await button(/^LP01/));
    await keys('{Control>}x{/Control}');
    await user.click(screen.getByRole('button', { name: 'Cluster UV-TG1 auswählen' }));
    await keys('{Control>}v{/Control}');
    expect(project().chargePoints[0]!.groupId).toBe(project().groups[0]!.id);
    expect(editor().clipboard).not.toBeNull();
    expect(
      screen.getByText(
        'Kein passendes Ziel ausgewählt. Gruppe, Cluster oder Netzanschluss wählen.',
      ),
    ).toBeInTheDocument();
    await keys('{Escape}');
    expect(editor().clipboard).toBeNull();
  });

  it('Gruppe lässt sich in einen anderen Cluster verschieben', async () => {
    const p = sampleProject();
    p.clusters.push({ id: 'zweiter', name: 'UV-TG2', limitA: 63 });
    view = renderStructure(p);
    const user = userEvent.setup();
    await user.click(await button('Gruppe Flotte auswählen'));
    await keys('{Control>}x{/Control}');
    await user.click(screen.getByRole('button', { name: 'Cluster UV-TG2 auswählen' }));
    await keys('{Control>}v{/Control}');
    expect(project().groups[1]!.clusterId).toBe('zweiter');
  });
});

describe('Drag & Drop', () => {
  const dt = () => ({ setData: () => undefined, effectAllowed: '', dropEffect: '' });
  const boxOf = (name: string) =>
    screen.getByRole('button', { name }).closest('.structure-box') as HTMLElement;

  it('Ladepunkt auf Gruppe ziehen: Ziele werden hervorgehoben, ungültige gesperrt', async () => {
    view = renderStructure(sampleProject());
    await button(/^LP01/);
    const chip = screen
      .getByRole('button', { name: /^LP01/ })
      .closest('.structure-chipwrap') as HTMLElement;
    fireEvent.dragStart(chip, { dataTransfer: dt() });
    expect(boxOf('Gruppe Flotte auswählen')).toHaveAttribute('data-drop', 'valid');
    expect(boxOf('Gruppe Mieter auswählen')).toHaveAttribute('data-drop', 'blocked'); // liegt schon dort
    expect(boxOf('Cluster UV-TG1 auswählen')).toHaveAttribute('data-drop', 'none'); // falsche Art: kein Ziel
    fireEvent.dragOver(boxOf('Gruppe Flotte auswählen'), { dataTransfer: dt() });
    expect(boxOf('Gruppe Flotte auswählen')).toHaveAttribute('data-drop', 'over');
    fireEvent.drop(boxOf('Gruppe Flotte auswählen'), { dataTransfer: dt() });
    expect(project().chargePoints[0]!.groupId).toBe(project().groups[1]!.id);
    expect(boxOf('Gruppe Flotte auswählen')).toHaveAttribute('data-drop', 'none');
  });

  it('ungültiger Drop ändert nichts', async () => {
    view = renderStructure(sampleProject());
    await button(/^LP01/);
    const chip = screen
      .getByRole('button', { name: /^LP01/ })
      .closest('.structure-chipwrap') as HTMLElement;
    fireEvent.dragStart(chip, { dataTransfer: dt() });
    fireEvent.drop(boxOf('Cluster UV-TG1 auswählen'), { dataTransfer: dt() });
    expect(project().chargePoints[0]!.groupId).toBe(project().groups[0]!.id);
    fireEvent.dragEnd(chip);
    expect(boxOf('Gruppe Flotte auswählen')).toHaveAttribute('data-drop', 'none');
  });

  it('Gruppe auf Cluster und Cluster auf Cluster ziehen; Cluster in Nachfahren ist gesperrt', async () => {
    const p = sampleProject();
    p.clusters.push(
      { id: 'zweiter', name: 'UV-TG2', limitA: 63 },
      { id: 'unter', name: 'Unter', limitA: 32, parentClusterId: p.clusters[0]!.id },
    );
    view = renderStructure(p);
    await button('Cluster UV-TG2 auswählen');
    fireEvent.dragStart(screen.getByRole('button', { name: 'Gruppe Flotte auswählen' }), {
      dataTransfer: dt(),
    });
    fireEvent.dragOver(boxOf('Cluster UV-TG2 auswählen'), { dataTransfer: dt() });
    fireEvent.drop(boxOf('Cluster UV-TG2 auswählen'), { dataTransfer: dt() });
    expect(project().groups[1]!.clusterId).toBe('zweiter');

    fireEvent.dragStart(screen.getByRole('button', { name: 'Cluster UV-TG1 auswählen' }), {
      dataTransfer: dt(),
    });
    expect(boxOf('Cluster Unter auswählen')).toHaveAttribute('data-drop', 'blocked');
    expect(boxOf('Cluster UV-TG2 auswählen')).toHaveAttribute('data-drop', 'valid');
    fireEvent.dragEnd(screen.getByRole('button', { name: 'Cluster UV-TG1 auswählen' }));

    fireEvent.dragStart(screen.getByRole('button', { name: 'Cluster Unter auswählen' }), {
      dataTransfer: dt(),
    });
    const site = screen
      .getByRole('button', { name: /Netzanschluss/ })
      .closest('.structure-box') as HTMLElement;
    expect(site).toHaveAttribute('data-drop', 'valid');
    fireEvent.dragOver(site, { dataTransfer: dt() });
    fireEvent.drop(site, { dataTransfer: dt() });
    expect(project().clusters.find((c) => c.id === 'unter')?.parentClusterId).toBeUndefined();
  });
});

describe('Drag & Drop auf das nächste passende Ziel', () => {
  const dt = () => ({ setData: () => undefined, effectAllowed: '', dropEffect: '' });
  it('Gruppe auf eine Gruppe landet im Cluster dieser Gruppe, Ladepunkt auf Ladepunkt in dessen Gruppe', async () => {
    const p = sampleProject();
    p.clusters.push({ id: 'zweiter', name: 'UV-TG2', limitA: 63 });
    p.groups.push({ id: 'gaeste', name: 'Gäste', clusterId: 'zweiter', priority: 3 });
    view = renderStructure(p);
    await button('Cluster UV-TG2 auswählen');
    const wrap = (name: RegExp) =>
      screen.getByRole('button', { name }).closest('.structure-chipwrap') as HTMLElement;

    fireEvent.dragStart(screen.getByRole('button', { name: 'Gruppe Flotte auswählen' }), {
      dataTransfer: dt(),
    });
    const gaesteBox = screen
      .getByRole('button', { name: 'Gruppe Gäste auswählen' })
      .closest('.structure-box') as HTMLElement;
    fireEvent.dragOver(gaesteBox, { dataTransfer: dt() });
    expect(
      screen.getByRole('button', { name: 'Cluster UV-TG2 auswählen' }).closest('.structure-box'),
    ).toHaveAttribute('data-drop', 'over');
    fireEvent.drop(gaesteBox, { dataTransfer: dt() });
    expect(project().groups.find((g) => g.id === project().groups[1]!.id)?.clusterId).toBe(
      'zweiter',
    );

    // Ladepunkt auf einen Ladepunkt in anderer Gruppe: Ziel ist dessen Gruppe
    fireEvent.dragStart(wrap(/^LP01/), { dataTransfer: dt() });
    fireEvent.dragOver(wrap(/^LP03/), { dataTransfer: dt() });
    fireEvent.drop(wrap(/^LP03/), { dataTransfer: dt() });
    expect(project().chargePoints[0]!.groupId).toBe(project().groups[1]!.id);
  });
});

describe('Eigenschaften', () => {
  it('Netzanschluss: Zahlenfeld mit Einheit, „Geändert“-Zustand, Übernahme beim Verlassen', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await user.click(await button(/Netzanschluss/));
    const fuse = screen.getByLabelText('Absicherung');
    expect(fuse).toHaveValue(250);
    await user.clear(fuse);
    await user.type(fuse, '200');
    expect(screen.getByText('Geändert: 250 → 200 A')).toBeInTheDocument();
    expect(project().site.gridConnectionFuseA).toBe(250);
    await user.tab();
    expect(project().site.gridConnectionFuseA).toBe(200);
    expect(screen.queryByText(/^Geändert:/)).not.toBeInTheDocument();
    expect(screen.getByText(/Verfügbar für Ladeinfrastruktur: 120 A/)).toBeInTheDocument();
  });

  it('ungültige Eingabe wird nicht übernommen, Escape verwirft', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await user.click(await button('Cluster UV-TG1 auswählen'));
    const limit = screen.getByLabelText('Limit');
    await user.clear(limit);
    expect(screen.getByText('Limit: bitte einen Wert eingeben')).toBeInTheDocument();
    await user.tab();
    expect(project().clusters[0]!.limitA).toBe(125);
    await user.clear(limit);
    await user.type(limit, '-5');
    expect(screen.getByText('Limit muss größer als 0 A sein')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(limit).toHaveValue(125);
  });

  it('Gruppe: Priorität, optionales Limit, Cluster wechseln', async () => {
    const p = sampleProject();
    p.clusters.push({ id: 'zweiter', name: 'UV-TG2', limitA: 63 });
    view = renderStructure(p);
    const user = userEvent.setup();
    await user.click(await button('Gruppe Flotte auswählen'));
    await user.selectOptions(screen.getByLabelText('Priorität'), '4');
    expect(project().groups[1]!.priority).toBe(4);
    const max = screen.getByLabelText('Gruppen-Limit');
    expect(max).toHaveValue(63);
    await user.clear(max);
    await user.tab();
    expect(project().groups[1]).not.toHaveProperty('maxA');
    await user.selectOptions(screen.getByLabelText('Cluster'), 'zweiter');
    expect(project().groups[1]!.clusterId).toBe('zweiter');
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Dienstwagen{Enter}');
    expect(project().groups[1]!.name).toBe('Dienstwagen');
  });

  it('Cluster: Untercluster anlegen und Elternteil wechseln', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await user.click(await button('Cluster UV-TG1 auswählen'));
    await user.click(screen.getByRole('button', { name: '+ Untercluster' }));
    expect(project().clusters[1]!.parentClusterId).toBe(project().clusters[0]!.id);
    expect(editor().selectedIds).toEqual([project().clusters[1]!.id]);
    await user.selectOptions(screen.getByLabelText('Übergeordnet'), '');
    expect(project().clusters[1]).not.toHaveProperty('parentClusterId');
  });

  it('Ladepunkt: Infos und Link „In Ladepunkte öffnen“', async () => {
    view = renderStructure(sampleProject());
    await userEvent.click(await button(/^LP03/));
    expect(screen.getByText('1-phasig auf L1')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'In Ladepunkte öffnen' });
    expect(link).toHaveAttribute('href', `/projekt/${project().id}/ladepunkte`);
    await userEvent.click(link);
    expect(editor().selectedIds).toEqual([project().chargePoints[2]!.id]);
  });

  it('Löschen mit Undo statt Rückfrage und Zurück zur Übersicht', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await user.click(await button(/^LP03/));
    await user.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(project().chargePoints).toHaveLength(2);
    expect(editor().selectedIds).toEqual([]);
    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeInTheDocument();
    useProjectStore.getState().undo();
    expect(project().chargePoints).toHaveLength(3);
    await user.click(await button(/^LP01/));
    await user.click(screen.getByRole('button', { name: 'Zurück zur Übersicht' }));
    expect(editor().selectedIds).toEqual([]);
  });
});

describe('Simulation', () => {
  it('„N Fahrzeuge laden“ zeigt Ergebnis je Ebene und Ladepunkt', async () => {
    view = renderStructure(sampleProject());
    const user = userEvent.setup();
    await button(/^LP01/);
    expect(screen.getByText(/3 Fahrzeuge laden: /)).toBeInTheDocument();
    const n = screen.getByLabelText('Anzahl ladender Fahrzeuge');
    await user.type(n, '1');
    expect(screen.getByText(/1 Fahrzeug lädt: /)).toBeInTheDocument();
    const perCp = screen.getByRole('heading', { name: 'Je Ladepunkt' })
      .nextElementSibling as HTMLElement;
    expect(within(perCp).getAllByRole('listitem')).toHaveLength(1);
    expect(within(perCp).getByText('LP01')).toBeInTheDocument();
    await user.clear(n);
    await user.type(n, '9');
    expect(screen.getByText('Bitte eine ganze Zahl von 0 bis 3 eingeben')).toBeInTheDocument();
    await user.clear(n);
    await user.type(n, '0');
    expect(screen.getByText(/0 Fahrzeuge laden: 0\s?kW/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Fahrzeuge laden'), '1');
    expect(screen.getByLabelText('Fahrzeuge laden')).toHaveValue('1');
  });
});
