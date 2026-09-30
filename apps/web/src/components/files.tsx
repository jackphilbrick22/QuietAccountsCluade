/** Drop zone + "is this right?" preview for exported CSV/TSV files. Shared by onboarding and Settings → Data. */
import { useRef, useState } from "react";
import { FileSpreadsheet, Upload, X } from "lucide-react";
import { decodeText, previewFile, type FileIn, type RecordKind, type SourceSystem } from "@qa/engine";
import { cx, Pill } from "./ui";
import { selectCls } from "./table";

export const KIND_LABEL: Record<RecordKind, string> = {
  quote: "Quotes / estimates",
  job: "Jobs",
  invoice: "Invoices",
  client: "Clients / customers",
  request: "Requests",
  visit: "Visits",
};

export const SOURCE_LABEL: Record<SourceSystem, string> = {
  jobber: "Jobber",
  housecall_pro: "Housecall Pro",
  servicetitan: "ServiceTitan",
  quickbooks: "QuickBooks",
  arborgold: "Arborgold",
  singleops: "SingleOps",
  yardbook: "Yardbook",
  lmn: "LMN",
  aspire: "Aspire",
  service_autopilot: "Service Autopilot",
  workiz: "Workiz",
  zenmaid: "ZenMaid",
  gorilladesk: "GorillaDesk",
  spreadsheet: "Spreadsheet",
  unknown: "Unknown software",
};

export interface StagedFile {
  key: string;
  name: string;
  text: string;
  size: number;
  detectedKind?: RecordKind;
  kind?: RecordKind;
  source?: SourceSystem;
  rows: number;
  columns: number;
  mapped: number;
  confidence: number;
  warnings: string[];
  error?: string;
}

const ACCEPT = [".csv", ".tsv", ".txt"];

function okName(name: string): boolean {
  const n = name.toLowerCase();
  return ACCEPT.some((x) => n.endsWith(x));
}

async function stage(f: File): Promise<StagedFile> {
  const base: StagedFile = { key: `${f.name}-${f.size}-${f.lastModified}`, name: f.name, text: "", size: f.size, rows: 0, columns: 0, mapped: 0, confidence: 0, warnings: [] };
  if (!okName(f.name)) return { ...base, error: "Not a CSV/TSV file. In Excel use File → Save As → CSV." };
  try {
    // not f.text(): that is always UTF-8, and Excel's classic CSV is Windows-1252
    const text = decodeText(new Uint8Array(await f.arrayBuffer()));
    const { table, detection } = previewFile(text, f.name);
    return {
      ...base,
      text,
      detectedKind: detection.kind,
      source: detection.source,
      rows: table.rows.length,
      columns: table.headers.length,
      mapped: Object.keys(detection.mapping.fields).length,
      confidence: detection.kindConfidence,
      warnings: detection.warnings,
      error: table.rows.length ? undefined : "No rows found in this file.",
    };
  } catch (e) {
    return { ...base, error: `Couldn't read this file (${e instanceof Error ? e.message : "unknown error"}).` };
  }
}

/** Files ready for the engine (skips ones that errored). */
export function toFileIns(files: StagedFile[]): FileIn[] {
  return files.filter((f) => !f.error).map((f) => ({ name: f.name, text: f.text, kind: f.kind }));
}

export function FileDrop({ id, files, onChange }: { id: string; files: StagedFile[]; onChange: (f: StagedFile[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [reading, setReading] = useState(false);
  const add = async (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setReading(true);
    const staged = await Promise.all(arr.map(stage));
    setReading(false);
    const keys = new Set(staged.map((s) => s.key));
    onChange([...files.filter((f) => !keys.has(f.key)), ...staged]);
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void add(e.dataTransfer.files);
        }}
        className={cx("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors", over ? "border-accent bg-accent-soft/50" : "border-line-2 bg-surface")}
      >
        <Upload size={22} className="text-ink-3" aria-hidden="true" />
        <p className="text-[14px] font-semibold">Drag your exported files here</p>
        <p className="text-[12.5px] text-ink-3">CSV, TSV or TXT. Drop as many as you have: quotes, clients, jobs, invoices.</p>
        <label htmlFor={id} className="mt-1 inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-line-2 bg-surface px-3 text-[13.5px] font-semibold hover:bg-surface-2">
          <FileSpreadsheet size={15} /> Choose files
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          multiple
          accept={[...ACCEPT, "text/csv", "text/tab-separated-values", "text/plain"].join(",")}
          className="sr-only"
          onChange={(e) => {
            if (e.target.files) void add(e.target.files);
            e.target.value = "";
          }}
        />
        {reading && <p className="text-[12.5px] text-ink-3" role="status">Reading…</p>}
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface" aria-label="Files to import">
          {files.map((f) => (
            <li key={f.key} className="flex flex-col gap-1.5 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13.5px] font-semibold" title={f.name}>
                  {f.name}
                </span>
                {f.error ? (
                  <span className="text-[12.5px] text-bad">{f.error}</span>
                ) : (
                  <span className="text-[12.5px] text-ink-3">
                    <span className="num">{f.rows.toLocaleString("en-US")}</span> rows · {f.source ? SOURCE_LABEL[f.source] : "—"} · matched <span className="num">{f.mapped}</span> of <span className="num">{f.columns}</span> columns
                    {f.warnings.length ? ` · ${f.warnings[0]}` : ""}
                  </span>
                )}
              </div>
              {!f.error && (
                <div className="flex items-center gap-2">
                  {f.confidence < 0.5 && <Pill tone="warn">Check type</Pill>}
                  <label htmlFor={`${id}-kind-${f.key}`} className="sr-only">
                    What's in {f.name}
                  </label>
                  <select
                    id={`${id}-kind-${f.key}`}
                    className={selectCls}
                    value={f.kind ?? f.detectedKind ?? "quote"}
                    onChange={(e) => onChange(files.map((x) => (x.key === f.key ? { ...x, kind: e.target.value as RecordKind } : x)))}
                  >
                    {(Object.keys(KIND_LABEL) as RecordKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                        {k === f.detectedKind ? " (detected)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => onChange(files.filter((x) => x.key !== f.key))}
                className="grid size-8 shrink-0 cursor-pointer place-items-center self-end rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink sm:self-auto"
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
