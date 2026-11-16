import { useState } from 'react';
import { CsvImportDialog } from '../csv-import';
import { ChargePointsView } from './ChargePointsView';

/** Tab „Ladepunkte“: Ansicht plus CSV-Import-Dialog (5.C). */
export function ChargePointsTab() {
  const [csvOpen, setCsvOpen] = useState(false);
  return (
    <>
      <ChargePointsView onCsvImport={() => setCsvOpen(true)} />
      <CsvImportDialog open={csvOpen} onClose={() => setCsvOpen(false)} />
    </>
  );
}
