import type { BusinessProfile } from "@qa/engine";

/** What a Settings save sends (PATCH /api/businesses/:id): only what changed. A From name of null clears it. */
export type Patch = Partial<Omit<BusinessProfile, "voice" | "persistence" | "plan" | "fromName">> & { fromName?: string | null; voice?: Partial<BusinessProfile["voice"]>; persistence?: Partial<BusinessProfile["persistence"]>; plan?: Partial<BusinessProfile["plan"]> };

/** What the Settings form edits. */
const FIELDS: (keyof BusinessProfile)[] = ["name", "ownerName", "ownerPhone", "ownerEmail", "signerName", "signerRole", "trade", "timezone", "fromName", "fromEmails", "replyTo", "businessPhone", "mailingAddress", "city", "state", "sendDays", "sendWindow", "weeklyNewContacts", "minQuoteValue", "minQuoteAgeDays", "maxQuoteAgeMonths", "voice", "persistence", "plan"];

/**
 * The Settings form starts over from the saved profile whenever this changes: a save, or someone else's change to what
 * it edits. The server's own notes on the profile (an inbox check every 15 minutes, a hold) leave a draft alone.
 */
export function settingsKey(b: BusinessProfile): string {
  return JSON.stringify(FIELDS.map((k) => b[k] ?? null));
}

export function diff(a: BusinessProfile, b: BusinessProfile): Patch {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) {
    let v: unknown = b[k];
    if (JSON.stringify(v) === JSON.stringify(a[k])) continue;
    if (typeof v === "string") v = v.trim();
    if (v === "" || v === undefined) {
      // the API can't clear optional fields, so they're left; but the From name can be emptied (null): the inboxes go
      // back to "<signer> at <business>"
      if (k !== "fromName" || a.fromName === undefined) continue;
      v = null;
    }
    if (k === "voice") v = { mentionPrice: b.voice.mentionPrice, offerOptions: b.voice.offerOptions, ...(b.voice.freeLook !== undefined ? { freeLook: b.voice.freeLook } : {}) };
    if (k === "plan") {
      const p = b.plan;
      const yearly = p.billing === "annual";
      // a yearly plan sends its price too (left out, the server would keep it billed monthly); the paid years go whenever
      // they changed, whatever the billing (a year taken off before going monthly stays off)
      v = {
        stage: p.stage,
        trialSize: p.trialSize,
        monthlyPrice: p.monthlyPrice,
        ...(p.paidOn ? { paidOn: p.paidOn } : {}),
        billing: yearly ? "annual" : "monthly",
        ...(yearly && p.annualPrice !== undefined ? { annualPrice: p.annualPrice } : {}),
        ...(JSON.stringify(p.yearsPaidOn ?? []) !== JSON.stringify(a.plan.yearsPaidOn ?? []) ? { yearsPaidOn: p.yearsPaidOn ?? [] } : {}),
      };
    }
    out[k] = v;
  }
  return out as Patch;
}
