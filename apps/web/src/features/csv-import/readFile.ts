/** Größte akzeptierte Datei. 200 Ladepunkte sind wenige Kilobyte; alles darüber ist vermutlich falsch gewählt. */
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

/**
 * Dekodiert CSV-Bytes. UTF-8 (mit oder ohne BOM) ist Standard; gelingt das nicht, stammt die Datei
 * meist aus „CSV (Trennzeichen-getrennt)“ eines deutschen Excel und ist Windows-1252 kodiert.
 */
export function decodeCsvBytes(bytes: Uint8Array): {
  text: string;
  encoding: 'UTF-8' | 'Windows-1252';
} {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
  }
}

/** Liest eine Datei lokal im Browser (sie wird nirgends hochgeladen). */
export function readCsvFile(
  file: Blob,
): Promise<{ text: string; encoding: 'UTF-8' | 'Windows-1252' }> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CSV_BYTES) {
      reject(
        new Error(
          'Die Datei ist größer als 5 MB. Bitte nur die Ladepunkt-Tabelle als CSV speichern.',
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(decodeCsvBytes(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(new Error('Die Datei konnte nicht gelesen werden.'));
    reader.readAsArrayBuffer(file);
  });
}

/** Bietet einen Text als Datei zum Speichern an (lokal erzeugt, kein Server). */
export function downloadText(
  text: string,
  fileName: string,
  type = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // Erst nach dem Start des Downloads freigeben
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
