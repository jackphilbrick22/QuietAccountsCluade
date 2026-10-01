import { isOnePass, monthName, passLate, plural, type BusinessProfile } from "@qa/engine";

/**
 * What the Plan button asks for. The free round fills up to its 150 and a one pass takes the whole list (paced on the
 * server by its inboxes and end date), so neither is capped here; a paying plan plans four weeks at its weekly pace.
 */
export function planRequest(b: BusinessProfile): { limit?: number } {
  return b.plan.stage === "trial" || isOnePass(b.plan) ? {} : { limit: b.weeklyNewContacts * 4 };
}

/**
 * Why a one pass won't be done by its end date, and what to do about it; nothing when it will (the date it can meet is
 * the end date or sooner). Once its notes are approved (the owner's OK), more inboxes don't change them: only the end
 * date is left to set.
 */
export function lateLine(b: BusinessProfile, opts: { approved: boolean }): string | undefined {
  const { pace, targetEndOn } = b.plan;
  const late = passLate(b.plan);
  if (!pace || !late || !targetEndOn) return undefined;
  const day = (x: string) => `${monthName(x).slice(0, 3)} ${Number(x.slice(8))}`;
  if (opts.approved) return `This pass can't finish by ${day(targetEndOn)}: its notes are approved as they are, and the last of them finish by ${day(late.canMeet)}. Set the end date to ${day(late.canMeet)}.`;
  const more = late.moreInboxes ? `${plural(late.moreInboxes, "more inbox", "more inboxes")} would: add them in Settings and plan again before the owner's OK, or set the end date to ${day(late.canMeet)}.` : `No number of inboxes would: set the end date to ${day(late.canMeet)}.`;
  return `This pass can't finish by ${day(targetEndOn)} on ${plural(pace.inboxes, "inbox", "inboxes")}: the soonest is ${day(late.canMeet)}. ${more}`;
}
