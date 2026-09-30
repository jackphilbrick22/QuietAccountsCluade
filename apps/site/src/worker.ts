import { runAudit, sampleAudit, type AuditFile, type AuditOptions } from "./audit.ts";
import type { TradeId } from "@qa/engine";

/** Runs the audit off the main thread so the page keeps moving while a few thousand quotes are read. */
export type AuditRequest = { id: number; files: AuditFile[]; opts: AuditOptions } | { id: number; sample: TradeId; opts: AuditOptions };

self.onmessage = (e: MessageEvent<AuditRequest>) => {
  const m = e.data;
  try {
    const result = "sample" in m ? sampleAudit(m.sample, m.opts) : runAudit(m.files, m.opts);
    self.postMessage({ id: m.id, result });
  } catch (err) {
    self.postMessage({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
