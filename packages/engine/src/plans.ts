import type { Charge, ISODate, MonthCharge, Money, PlanState } from "./model.ts";

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

/**
 * Whether a plan bills a one pass's bookings: one that has started, and still once it went monthly after it ("Then
 * monthly if his list refills"). Its bookings stay billable by its terms, and its charges go through, whatever the plan
 * is now. Only a one pass ever starts (`startedOn`).
 */
export function billsPass(plan: Pick<PlanState, "startedOn">): boolean {
  return !!plan.startedOn;
}

/** Whether a plan's stage is one its kind runs through: a one pass is never "paying", a monthly plan never "done". */
export function stageFits(plan: Pick<PlanState, "kind" | "stage">): boolean {
  return (PLAN_STAGES[plan.kind ?? "monthly"] as readonly string[]).includes(plan.stage);
}

/** A new monthly plan: the free 150, then $497 a month if the owner says yes. */
export function monthlyPlan(): PlanState {
  return { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] };
}

/**
 * The first month is paid (BRIEF B5): the plan is monthly and paying from that day, at what was paid. A one pass's
 * owner too: the pass is done that day (if not before), and its bookings are still billed by its terms (billsPass).
 */
export function startMonthly(plan: PlanState, day: ISODate, price: Money): void {
  if (isOnePass(plan)) {
    plan.kind = "monthly";
    plan.doneOn ??= day;
  }
  Object.assign(plan, { stage: "paying", paidOn: day, monthlyPrice: price } satisfies Partial<PlanState>);
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

/** A month of the monthly plan's, not a one pass's booking. */
export function isMonth(c: Charge | MonthCharge): c is MonthCharge {
  return "month" in c;
}

/** A charge that holds its place under the cap: every one not refunded or skipped (one the owner disputes too, until Jack decides). */
export function holdsPlace(c: Pick<Charge, "status">): boolean {
  return c.status !== "refunded" && c.status !== "skipped";
}

/** What a one pass's owner has paid: its charges paid and not refunded, in dollars. */
export function passPaid(plan: Pick<PlanState, "charges">): number {
  return (plan.charges ?? []).filter((c) => c.status === "paid").reduce((n, c) => n + c.amount, 0) / 100;
}
