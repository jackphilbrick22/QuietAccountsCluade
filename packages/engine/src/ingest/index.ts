import type { BusinessProfile, Dataset, ImportRecord, RecordKind } from "../model.ts";
import { parseTable, type Table } from "./csv.ts";
import { detect, type Detection } from "./detect.ts";
import { importTable } from "./normalize.ts";

export { parseTable, parseRows, sniffDelimiter, toCSV, type Table } from "./csv.ts";
export { detect, detectKind, detectSource, mapColumns, normHeader, type ColumnMapping, type Detection } from "./detect.ts";
export { importTable, linkRecords, mergePulled, parseLineItems, type PulledBatch } from "./normalize.ts";
export { FIELDS, KIND_FIELDS, type Field } from "./fields.ts";

export function emptyDataset(business: BusinessProfile, asOf: string): Dataset {
  return { business, customers: [], quotes: [], jobs: [], invoices: [], requests: [], imports: [], asOf };
}

export interface IngestResult {
  dataset: Dataset;
  record: ImportRecord;
  detection: Detection;
  table: Table;
}

/** Read one exported file and fold it into the dataset. */
export function ingestFile(
  dataset: Dataset,
  text: string,
  fileName: string,
  importedAt: string,
  opts: { kind?: RecordKind } = {},
): IngestResult {
  const table = parseTable(text);
  const detection = detect(table, fileName, opts.kind);
  const { dataset: next, record } = importTable(dataset, table, detection, { fileName, importedAt });
  return { dataset: next, record, detection, table };
}

/** Preview what a file is without importing it (for the "is this right?" screen). */
export function previewFile(text: string, fileName: string, kind?: RecordKind): { table: Table; detection: Detection } {
  const table = parseTable(text);
  return { table, detection: detect(table, fileName, kind) };
}
