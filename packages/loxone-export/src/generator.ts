import type { Project } from '@lastplan/core';

/**
 * Schnittstelle für den späteren Generator (Meilenstein 6/7). Enthält bewusst keine Kenntnis von
 * Loxone-Dateiformaten: Die Struktur kommt ausschließlich aus echten, vom Auftraggeber gelieferten
 * Dateien (TODO(verify)). Solange kein Generator eingehängt ist, ist der Export nicht verfügbar.
 */
export type ExportMode = 'templates' | 'project';

export interface ExportFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array;
}

export interface ExportOutput {
  file: ExportFile;
  /** Config-Version, für die erzeugt wurde (aus der Vorlage bzw. der .Loxone-Datei). */
  configVersion?: string;
}

export interface ExportGenerator {
  readonly mode: ExportMode;
  generate(project: Project): Promise<ExportOutput>;
}

const generators = new Map<ExportMode, ExportGenerator>();

/** Hängt einen Generator ein (ersetzt einen vorhandenen desselben Modus). */
export function registerGenerator(generator: ExportGenerator): void {
  generators.set(generator.mode, generator);
}

export function unregisterGenerator(mode: ExportMode): void {
  generators.delete(mode);
}

export function getGenerator(mode: ExportMode): ExportGenerator | undefined {
  return generators.get(mode);
}

/** Gibt es einen Generator für „Nur Vorlagen“? Bis zur Loxone-Vorlage: nein. */
export function templateGeneratorAvailable(): boolean {
  return generators.has('templates');
}

/** Hinweis für die Oberfläche, solange der Generator fehlt. */
export const TEMPLATE_MISSING_HINT =
  'Die Loxone-Vorlage fehlt noch. Benötigt: eine aus Loxone Config exportierte Modbus-Vorlage samt Config-Version.';
