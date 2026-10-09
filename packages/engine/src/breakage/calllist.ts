import type { Dataset, Money, Opportunity } from "../model.ts";
import { round2 } from "../util.ts";
import { isCallListReason } from "./caution.ts";
import type { ScanResult } from "./detect.ts";

/**
 * The owner's call list: people worth money that a note shouldn't (or can't) reach. Quotes over the
 * call-over amount deserve the owner's own voice, and people with only a phone number can't be emailed.
 * We never call or text a homeowner ourselves, so these are handed to the owner, biggest first.
 */
export interface CallList {
  people: number;
  value: Money;
  /** Quotes at or over the call-over amount. */
  bigQuotes: number;
  /** People with a phone number and no email we can use. */
  phoneOnly: number;
  top: CallListEntry[];
}

export interface CallListEntry {
  customerId: string;
  name: string;
  phone: string;
  job?: string;
  value: Money;
  why: "big_quote" | "phone_only";
}

/** How many of the biggest the summary keeps: enough for the welcome text to find its three of different kinds. */
const CALL_LIST_KEPT = 60;

export function callList(ds: Dataset, result: ScanResult, limit = CALL_LIST_KEPT): CallList {
  const byId = new Map(ds.customers.map((c) => [c.id, c]));
  const best = new Map<string, { o: Opportunity; why: CallListEntry["why"] }>();
  for (const o of result.opportunities) {
    // "no contact info" means no email or postcard; a phone still reaches them. Every other hold stands.
    if (o.type === "unpaid_invoice" || (o.suppressed && o.suppressed !== "no_contact_info")) continue;
    const c = byId.get(o.customerId);
    if (!c?.phones.length) continue;
    const why = o.caution?.some(isCallListReason) ? "big_quote" : !o.channels.includes("email") ? "phone_only" : undefined;
    if (!why) continue;
    const prev = best.get(o.customerId);
    if (!prev || o.value > prev.o.value) best.set(o.customerId, { o, why });
  }
  const all = [...best.values()].sort((a, b) => b.o.value - a.o.value);
  return {
    people: all.length,
    value: round2(all.reduce((s, x) => s + x.o.value, 0)),
    bigQuotes: all.filter((x) => x.why === "big_quote").length,
    phoneOnly: all.filter((x) => x.why === "phone_only").length,
    top: all.slice(0, limit).map(({ o, why }) => {
      const c = byId.get(o.customerId)!;
      return { customerId: c.id, name: c.name, phone: c.phones[0]!, job: o.jobPhrase?.replace(/^the /, ""), value: o.value, why };
    }),
  };
}
