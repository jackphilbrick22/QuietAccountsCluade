import { runAudit, type AuditFile, type AuditOptions } from "./audit.ts";

/** Runs the audit off the main thread so the page keeps moving while a few thousand rows are read. */
export interface AuditRequest {
  id: number;
  files: AuditFile[];
  opts: AuditOptions;
}

self.onmessage = (e: MessageEvent<AuditRequest>) => {
  const m = e.data;
  try {
    self.postMessage({ id: m.id, result: runAudit(m.files, m.opts) });
  } catch (err) {
    self.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
