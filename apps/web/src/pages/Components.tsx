import {
  Button,
  Card,
  KpiTile,
  Notice,
  NumberField,
  ProgressBar,
  PropertyGroup,
  PropertyPanel,
  SearchField,
  SelectField,
  StatusBadge,
  Tabs,
  TextField,
} from '@lastplan/ui';
import { useState } from 'react';

/** Beispielseite je Komponente (Route /komponenten). */
export function Components() {
  const [tab, setTab] = useState('a');
  const [q, setQ] = useState('');
  return (
    <main className="app-main app-stack">
      <h1>Komponenten</h1>
      <Card title="Buttons">
        <div className="list-head__actions">
          <Button variant="primary">Primär</Button>
          <Button>Sekundär</Button>
          <Button variant="ghost">Dezent</Button>
          <Button variant="danger">Löschen</Button>
          <Button disabled>Deaktiviert</Button>
        </div>
      </Card>
      <Card title="Eingaben">
        <div className="demo-grid">
          <TextField label="Name" defaultValue="LP01" />
          <NumberField label="Sicherung" unit="A" defaultValue={16} changed />
          <NumberField
            label="Mindeststrom"
            unit="A"
            defaultValue={3}
            error="Mindestens 6 A (IEC 61851)"
          />
          <SelectField label="Priorität" hint="1 = höchste">
            <option>1</option>
            <option>2</option>
          </SelectField>
        </div>
        <SearchField
          label="Suche"
          placeholder="Suchen"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onClear={() => setQ('')}
        />
      </Card>
      <Card title="Kennzahlen, Balken, Status">
        <div className="demo-grid">
          <KpiTile label="Verfügbar" value={184} unit="A" sub="von 250 A" />
          <KpiTile label="Ladepunkte" value={48} />
        </div>
        <ProgressBar label="Auslastung" value={50} max={100} />
        <ProgressBar label="Auslastung hoch" value={85} max={100} />
        <ProgressBar label="Auslastung voll" value={100} max={100} />
        <div className="list-head__actions">
          <StatusBadge status="ok">In Ordnung</StatusBadge>
          <StatusBadge status="warning">Prüfen</StatusBadge>
          <StatusBadge status="error">Fehler</StatusBadge>
          <StatusBadge status="neutral">Unbekannt</StatusBadge>
        </div>
      </Card>
      <Card title="Meldungen">
        <div className="app-stack">
          <Notice
            kind="error"
            title="Summe der Mindestströme überschreitet das Limit"
            solution="Mindeststrom senken oder Cluster-Limit erhöhen."
          />
          <Notice kind="warning" title="Schieflast über 20 A" />
          <Notice kind="info" title="Projekt lokal gespeichert" banner />
        </div>
      </Card>
      <Card title="Tabs">
        <Tabs
          label="Beispiel"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'a', label: 'Struktur' },
            { id: 'b', label: 'Ladepunkte' },
          ]}
        >
          Inhalt von {tab === 'a' ? 'Struktur' : 'Ladepunkte'}
        </Tabs>
      </Card>
      <PropertyPanel
        title="Ladepunkt LP01"
        subtitle="Gruppe Mieter"
        footer={<Button variant="primary">Übernehmen</Button>}
      >
        <PropertyGroup title="Strom">
          <NumberField label="Maximal" unit="A" defaultValue={16} />
        </PropertyGroup>
      </PropertyPanel>
    </main>
  );
}
