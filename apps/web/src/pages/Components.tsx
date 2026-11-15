import {
  Button,
  Card,
  ChargePointChip,
  ClusterNode,
  FunctionBlock,
  GridNode,
  GroupNode,
  IoLegend,
  KpiTile,
  Notice,
  NumberField,
  ProgressBar,
  PropertyAdvanced,
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
  const [pq, setPq] = useState('');
  return (
    <main className="app-main app-stack">
      <h1>Komponenten</h1>
      <Card title="Buttons">
        <div className="list-head__actions">
          <Button variant="primary">Primär</Button>
          <Button>Sekundär</Button>
          <Button variant="text">Text-Button</Button>
          <Button variant="danger">Löschen</Button>
          <Button disabled>Deaktiviert</Button>
        </div>
      </Card>
      <Card title="Eingaben">
        <div className="demo-grid">
          <TextField label="Name" defaultValue="LP01" />
          <NumberField label="Sicherung" unit="A" defaultValue={56} change={{ from: 48, to: 56 }} />
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
          <KpiTile label="Störungen" value={2} tone="warning" />
        </div>
        <ProgressBar label="Auslastung" value={50} max={100} />
        <ProgressBar label="Auslastung hoch" value={85} max={100} />
        <ProgressBar label="Auslastung voll" value={100} max={100} />
        <div className="list-head__actions">
          <StatusBadge status="active">Aktiv</StatusBadge>
          <StatusBadge status="warning">Prüfen</StatusBadge>
          <StatusBadge status="error">Fehler</StatusBadge>
          <StatusBadge status="ready">Bereit</StatusBadge>
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
          <Notice kind="ok" title="Prüfung bestanden" />
          <Notice
            kind="warning"
            banner
            title="Strukturänderung erkannt: LP10 neu angelegt"
            actions={<Button size="sm">Export erzeugen</Button>}
          />
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
      <Card title="Hierarchie und Export-Vorschau">
        <div className="app-stack">
          <GridNode label="HAK · 250 A NH2" />
          <ClusterNode name="UV-TG1 · Ebene −1">
            <GroupNode name="Mieter">
              <ChargePointChip label="LP01" model="ABL eM4" phase="L1-L2-L3" selected />
            </GroupNode>
          </ClusterNode>
          <ClusterNode name="UV-TG2" error>
            <GroupNode name="Gäste">
              <ChargePointChip label="LP02" model="ABL eM4" phase="L2-L3-L1" />
            </GroupNode>
          </ClusterNode>
          <IoLegend />
          <div className="demo-grid">
            <FunctionBlock
              title="LM_Standort"
              inputs={['Netzzähler', 'Limit']}
              outputs={['Verfügbar']}
              params={['Reserve']}
            />
            <FunctionBlock title="WB_LP02" inputs={['Soll']} outputs={['Ist']} needsReview />
          </div>
        </div>
      </Card>
      <PropertyPanel
        title="Ladepunkt LP01"
        subtitle="Gruppe Mieter"
        filter={{ value: pq, onChange: setPq }}
        footer={<Button variant="primary">Übernehmen</Button>}
      >
        <PropertyGroup title="Häufig benötigt">
          <NumberField label="Maximal" unit="A" defaultValue={16} />
        </PropertyGroup>
        <PropertyAdvanced>
          <NumberField label="Port" defaultValue={502} />
        </PropertyAdvanced>
      </PropertyPanel>
    </main>
  );
}
