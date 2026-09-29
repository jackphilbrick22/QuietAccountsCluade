import { z } from "zod";
import { KIND_FIELDS, type Detection, type Field, type RecordKind, type Table } from "@qa/engine";
import type { Llm } from "./llm.ts";

/**
 * When the Reader can't confidently map a spreadsheet (odd headers, no status column, etc.),
 * ask Claude which column is which. Only fields the engine knows are accepted, and only
 * headers that exist in the file.
 */
export async function suggestMapping(llm: Llm, table: Table, detection: Detection): Promise<Partial<Record<Field, number>> | null> {
  const allowed = KIND_FIELDS[detection.kind as RecordKind];
  const Schema = z.object({
    kind: z.enum(["quote", "job", "invoice", "client", "request", "visit"]),
    mapping: z.array(z.object({ field: z.enum(allowed as [Field, ...Field[]]), header: z.string() })),
  });
  const sample = table.rows.slice(0, 6).map((r) => r.map((c) => c.slice(0, 40)).join(" | ")).join("\n");
  const out = await llm.structured(Schema, {
    purpose: "reader.mapping",
    effort: "low",
    maxTokens: 1500,
    system: "You map spreadsheet columns exported from field-service software (Jobber, Housecall Pro, QuickBooks, homemade sheets) to canonical fields. Only map a header when you are confident. Never invent headers.",
    user: `Detected kind: ${detection.kind}\nAllowed fields: ${allowed.join(", ")}\nHeaders: ${table.headers.join(" | ")}\nFirst rows:\n${sample}`,
  });
  if (!out) return null;
  const idx = new Map(table.headers.map((h, i) => [h.trim().toLowerCase(), i]));
  const mapping: Partial<Record<Field, number>> = {};
  for (const m of out.mapping) {
    const i = idx.get(m.header.trim().toLowerCase());
    if (i !== undefined && !(m.field in mapping)) mapping[m.field] = i;
  }
  return Object.keys(mapping).length ? mapping : null;
}
