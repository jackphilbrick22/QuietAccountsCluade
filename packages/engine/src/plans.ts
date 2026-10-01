import type { PlanState } from "./model.ts";

/**
 * The two offers' plans (BRIEF §2). Monthly: the free 150, then a month at a time on the owner's yes. One pass: the
 * whole list once, paid per booking, done when the list is. A plan with no kind is monthly.
 */
export const PLAN_STAGES = {
  monthly: ["trial", "paying", "paused", "cancelled"],
  one_pass: ["running", "done", "paused", "cancelled"],
} as const satisfies Record<NonNullable<PlanState["kind"]>, readonly PlanState["stage"][]>;

/** The one pass's terms: $250 a billable booking, never more than four, booked within 60 days of the reply, about 30 days. */
export const ONE_PASS = { pricePerBooking: 250, capBookings: 4, windowDays: 60, days: 30, freeFirst: 0 } as const;

export function isOnePass(plan: Pick<PlanState, "kind">): boolean {
  return plan.kind === "one_pass";
}

/** Whether a plan's stage is one its kind runs through: a one pass is never "paying", a monthly plan never "done". */
export function stageFits(plan: Pick<PlanState, "kind" | "stage">): boolean {
  return (PLAN_STAGES[plan.kind ?? "monthly"] as readonly string[]).includes(plan.stage);
}

/** A new monthly plan: the free 150, then $497 a month if the owner says yes. */
export function monthlyPlan(): PlanState {
  return { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] };
}

/** A new one pass with its terms filled in: running, though it hasn't started until it's first planned. */
export function onePassPlan(over: Partial<PlanState> = {}): PlanState {
  const { pricePerBooking, capBookings, windowDays, freeFirst } = ONE_PASS;
  return { kind: "one_pass", stage: "running", trialSize: 0, monthlyPrice: 0, freeMonths: [], pricePerBooking, capBookings, windowDays, freeFirst, ...over };
}

/**
 * A one pass that won't be done by its end date: the date its notes can meet, and how many more inboxes would meet the
 * end date (none: no number would). Nothing when the date it can meet is the end date or sooner.
 */
export function passLate(plan: Pick<PlanState, "pace" | "targetEndOn">) {
  const late = plan.pace?.late;
  return late && plan.targetEndOn && late.canMeet > plan.targetEndOn ? late : undefined;
}
