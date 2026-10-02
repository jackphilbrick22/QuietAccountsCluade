import { describe, expect, it } from "vitest";
import { addDays, generateSample } from "@qa/engine";
import { runAudit, whenStopped, WHEN } from "../src/audit.ts";
import { withFile, type Signup } from "../src/form.ts";
import { CLEANING_ASOF, cleaningClientList, cleaningClients, deepCleanBookings, deepCleanClients, invoicesReport, LAWN_ASOF, lawnClients, seasonalClients, visitsReport, type BookedClient, type LawnClient } from "../../../packages/engine/test/lawn-fixtures.ts";

/** The audit a dropped file gets, in the browser's worker: past customers on their own are a result, as quotes are. */
const opts = { company: "Green Acre Lawn", signer: "Pat" };
const visits = (clients: LawnClient[]) => [{ name: "Visits Report.csv", text: visitsReport(clients, "newest") }];
const BOOKINGS = "Booking ID,Customer Name,Email,Service,Frequency,Booking Date,Price,Status";
/** Four cleaning clients every other week from March, the last of them in May: gone quiet by October. */
const bookings = (services: string[]) =>
  [BOOKINGS, ...Array.from({ length: 24 }, (_, i) => `${7000 + i},Ann Lee ${i % 4},ann${i % 4}@gmail.com,${services[i % services.length]},Every other week,2026-0${3 + Math.floor(i / 8)}-${10 + (i % 8)},160.00,Completed`)].join("\n");

describe("a file with past customers and no quotes", () => {
  const clients = lawnClients();
  const lapsed = clients.filter((c) => c.lapsed);
  const r = runAudit(visits(clients), { ...opts, trade: "lawn", today: LAWN_ASOF });
  const lastDone = (c: LawnClient) => c.visits.filter((v) => v.done).at(-1)!.date;
  const paidBy = (c: LawnClient) => c.visits.filter((v) => v.done && v.date > addDays(lastDone(c), -365)).reduce((s, v) => s + v.amount, 0);

  it("is a result: every lapsed regular, when they stopped and what they paid in their last year", () => {
    expect([r.quotes, r.silent.count, r.hottest]).toEqual([0, 0, undefined]);
    expect(r.past).toMatchObject({ people: 15, regulars: 15, paid: lapsed.reduce((s, c) => s + paidBy(c), 0) });
    // a mowing shop counts this year in months and the years before by season: this May and June, then last season
    const span = (from: string, to: string) => lapsed.filter((c) => lastDone(c) >= from && lastDone(c) <= to);
    const thisYear = span("2026-05-15", LAWN_ASOF);
    const lastSeason = span("2025-01-01", "2025-12-31");
    expect(thisYear.length + lastSeason.length).toBe(15);
    expect(r.past!.when).toEqual([
      { label: "Last 3 months", people: thisYear.length, paid: thisYear.reduce((s, c) => s + paidBy(c), 0) },
      { label: "Last season", people: lastSeason.length, paid: lastSeason.reduce((s, c) => s + paidBy(c), 0) },
    ]);
  });

  it("writes the first note to one of the lapsed regulars, in the engine's words, with his company and name in it", () => {
    const note = r.past!.note!;
    const c = lapsed.find((x) => x.name === note.name)!;
    expect(c).toBeDefined();
    expect(note.body).toMatch(new RegExp(`^Hi ${c.name.split(" ")[0]},\\n\\nPat at Green Acre Lawn\\. We used to take care of the mowing for you`));
    expect(note.body.endsWith("\n\nPat")).toBe(true);
    expect(note.foot).toBe(`Green Acre Lawn · [your business address]\nYou're getting this sales note because we've worked for you before.\nReply "stop" and you won't hear from us again.`);
    expect(note.notes).toBeGreaterThanOrEqual(2);
  });

  it("a lawn invoices file on its own, the brief's case: the same people, months and money as its visits, and the note", () => {
    const inv = runAudit([{ name: "Invoices Report.csv", text: invoicesReport(clients) }], { ...opts, trade: "lawn", today: LAWN_ASOF });
    expect([inv.quotes, inv.hasPastWork]).toEqual([0, true]);
    const { note, ...numbers } = inv.past!;
    expect(numbers).toEqual({ people: 15, regulars: 15, paid: r.past!.paid, when: r.past!.when });
    expect(lapsed.map((c) => c.name)).toContain(note!.name);
    expect(note!.body).toMatch(new RegExp(`^Hi ${note!.name.split(" ")[0]},\\n\\nPat at Green Acre Lawn\\. We used to take care of the mowing for you`));
  });

  it("writes to a lapsed regular before anyone whose work came due, though a fall clean-up paid more", { timeout: 60_000 }, () => {
    // October: July's three and last season's two regulars stopped; last fall's clean-ups (at $2,500 here) and aeration come due
    const seasonal = seasonalClients("2026-10-15").map((c) => (c.story === "fallCleanup" ? { ...c, visits: c.visits.map((v) => (v.recurring ? v : { ...v, amount: 2500 })) } : c));
    const s = runAudit(visits(seasonal), { ...opts, trade: "lawn", today: "2026-10-15" });
    expect(s.past).toMatchObject({ people: 9, regulars: 5 });
    expect(seasonal.filter((c) => c.story === "stoppedJuly2026" || c.story === "stoppedAfter2025").map((c) => c.name)).toContain(s.past!.note!.name);
    expect(s.past!.note!.body).toContain("We'd love to have you back on the schedule.");
  });

  it("a Visits report whose mowing visits carry no amounts (fixed-price jobs): who and when, and no money, not the clean-up alone", { timeout: 60_000 }, () => {
    const fixed = runAudit([{ name: "Visits Report.csv", text: visitsReport(clients, "newest", false) }], { ...opts, trade: "lawn", today: LAWN_ASOF });
    const { note, ...numbers } = fixed.past!;
    // the same people and months as the report that carries them, the $175 fall clean-up one of them had no figure
    expect(numbers).toEqual({ people: 15, regulars: 15, when: r.past!.when.map(({ label, people }) => ({ label, people })) });
    expect(numbers.paid).toBeUndefined();
    expect(lapsed.map((c) => c.name)).toContain(note!.name);
    // and what goes to /start with the file carries no figure either
    const s: Signup = { company: opts.company, first: opts.signer, cell: "603-555-0122", software: "jobber", trade: "lawn", offer: "monthly", ref: "page=lawn", website: "" };
    expect(JSON.parse(JSON.stringify(withFile(s, [], fixed))).audit.past).toEqual({ people: 15 });
  });

  it("a cleaning shop's regulars still on the schedule, whose first deep clean came due again, haven't stopped: only those who did count", () => {
    const people = deepCleanClients();
    const d = runAudit([{ name: "Bookings.csv", text: deepCleanBookings(people) }], { ...opts, trade: "lawn", today: CLEANING_ASOF });
    expect(d.trade).toBe("cleaning");
    const gone = people.filter((c) => c.stopped);
    const last = (c: BookedClient) => c.bookings.at(-1)!.date;
    const paid = (cs: BookedClient[]) => cs.reduce((s, c) => s + c.bookings.reduce((t, b) => t + b.price, 0), 0);
    const span = (label: string) => gone.filter((c) => whenStopped(last(c), CLEANING_ASOF, false) === label);
    // the three who stopped in July and June, and the one whose deep clean in February was all; none of the ten cleaned this month
    expect(d.past).toMatchObject({ people: 4, regulars: 3, paid: paid(gone) });
    expect(d.past!.when).toEqual(["Last 3 months", "3–12 months"].map((label) => ({ label, people: span(label).length, paid: paid(span(label)) })));
    expect(d.past!.when.map((w) => w.people)).toEqual([2, 2]);
    // the note goes to one of them, a regular who stopped
    expect(gone.filter((c) => c.bookings.length > 1).map((c) => c.name)).toContain(d.past!.note!.name);
  });

  it("a cleaning client list: by months, with nothing it would have to guess at to show what they paid", () => {
    const people = cleaningClients();
    const c = runAudit([{ name: "Clients.csv", text: cleaningClientList(people, true) }], { ...opts, trade: "cleaning", today: CLEANING_ASOF });
    const gone = people.filter((p) => p.daysAgo >= (p.frequency === "Weekly" || p.frequency === "Every other week" ? 21 : 45));
    const months = (p: (typeof people)[number]) => whenStopped(p.lastCleaning, CLEANING_ASOF, false);
    expect(c.past).toMatchObject({ people: gone.length, regulars: gone.filter((p) => p.frequency !== "One-time").length });
    expect(c.past!.paid).toBeUndefined();
    expect(c.past!.when).toEqual(["Last 3 months", "3–12 months", "Over a year ago"].map((label) => ({ label, people: gone.filter((p) => months(p) === label).length })));
    expect(c.past!.when.map((w) => w.people)).toEqual([gone.filter((p) => p.daysAgo <= 90).length, gone.filter((p) => p.daysAgo > 90 && p.daysAgo < 365).length, gone.filter((p) => p.daysAgo >= 365).length]);
  });
});

describe("when they stopped", () => {
  it("a lawn or landscape shop: this year in months, then last season and before it, as the owner counts them", () => {
    const at = (on: string, asOf: string) => whenStopped(on, asOf, true);
    expect(["2026-08-01", "2026-07-03", "2025-10-30", "2024-09-01"].map((on) => at(on, "2026-10-15"))).toEqual(["Last 3 months", "3–12 months", "Last season", "Before last season"]);
    // in January, last summer is last season, though October was three months ago
    expect(["2026-10-20", "2026-06-01", "2025-08-01"].map((on) => at(on, "2027-01-15"))).toEqual(["Last season", "Last season", "Before last season"]);
  });

  it("every other trade by months", () => {
    expect(["2026-07-01", "2025-10-01", "2025-09-01"].map((on) => whenStopped(on, "2026-09-29", false))).toEqual(["Last 3 months", "3–12 months", "Over a year ago"]);
    expect(WHEN).toEqual(["Last 3 months", "3–12 months", "Last season", "Before last season", "Over a year ago"]);
  });

  it("a mowing shop's file in October and in January", { timeout: 60_000 }, () => {
    const at = (asOf: string) => runAudit(visits(seasonalClients(asOf)), { ...opts, trade: "lawn", today: asOf }).past!.when.map((w) => [w.label, w.people]);
    // October: July's three who stopped mid-season; last season's two, and last fall's clean-ups and aeration come due
    expect(at("2026-10-15")).toEqual([["3–12 months", 3], ["Last season", 6]]);
    // January: July's three are last season now, and the two who stopped after 2025 the season before
    expect(at("2027-01-15")).toEqual([["Last season", 3], ["Before last season", 2]]);
  });
});

describe("a file with quotes, on a one-pass page", () => {
  const sample = generateSample({ trade: "tree", asOf: "2026-10-01" });
  const r = runAudit(sample.files, { company: "Tall Pine Tree", signer: "Ryan", trade: "tree", today: "2026-10-01" });

  it("keeps the quote result, with its note to a quote nobody answered, and adds the past customers beside it", () => {
    expect(r.trade).toBe("tree");
    expect(r.silent.count).toBeGreaterThan(100);
    expect(r.hottest!.body).toMatch(/^Hi \w+,\n\n.*\bRyan\b.*\bTall Pine Tree\b[\s\S]*\n\nRyan$/);
    // the footer's reason is a quote's
    expect(r.hottest!.foot).toMatch(/^Tall Pine Tree · \[your business address\]\nYou're getting this sales follow-up because you asked us for a price\./);
    expect(r.past!.people).toBeGreaterThan(100);
    expect(r.past!.note!.body).toContain("Ryan at Tall Pine Tree");
    expect(r.past!.note!.name).not.toBe(r.hottest!.name);
  });
});

describe("the trade", () => {
  const audit = (text: string, trade?: "lawn" | "tree" | "cleaning", name = "export.csv") => runAudit([{ name, text }], { ...opts, trade, today: "2026-10-01" }).trade;

  it("reads invoice subjects, so an invoices-only export says what the shop does", () => {
    const csv = ["Invoice #,Client name,Client email,Subject,Issued date,Total ($),Balance ($),Status", ...Array.from({ length: 30 }, (_, i) => `${100 + i},Pat Lee ${i % 6},pat${i % 6}@gmail.com,Weekly mowing,2025-0${4 + (i % 5)}-1${i % 9},55.00,0.00,Paid`)].join("\n");
    expect(audit(csv, undefined, "Invoices Report.csv")).toBe("lawn");
  });

  it("reads 'Standard Cleaning' and 'Recurring Cleaning' as cleaning, bedrooms and all, even dropped on /lawn", () => {
    expect(audit(bookings(["Recurring Cleaning (Biweekly)", "Standard Cleaning (3 Bed / 2 Bath)"]), "lawn", "Bookings.csv")).toBe("cleaning");
    expect(audit(bookings(["Recurring Cleaning"]), undefined, "Bookings.csv")).toBe("cleaning");
  });

  it("takes the page's trade when the titles can't tell, or tie", () => {
    // "Weekly service" fits lawn, landscape and cleaning alike
    const vague = bookings(["Weekly service"]);
    expect(audit(vague, "cleaning", "Bookings.csv")).toBe("cleaning");
    expect(audit(vague, "lawn", "Bookings.csv")).toBe("lawn");
    expect(audit(bookings(["Visit"]), "tree", "Bookings.csv")).toBe("tree");
    expect(audit(bookings(["Visit"]), undefined, "Bookings.csv")).toBe("general");
  });

  it("only picks among the trades the page's offer sells: mowing visits dropped on /tree stay a tree shop's", { timeout: 60_000 }, () => {
    const mowing = visitsReport(lawnClients(), "newest");
    expect(audit(mowing, "tree", "Visits Report.csv")).toBe("tree");
    expect(audit(mowing, "lawn", "Visits Report.csv")).toBe("lawn");
  });

  it("keeps what the titles read when the page's trade wins: his mowing is still mowing in the note, on /tree and in a fence shop's file", { timeout: 60_000 }, () => {
    const note = (clients: LawnClient[]) => {
      const r = runAudit(visits(clients), { company: "Tall Pine", signer: "Ryan", trade: "tree", today: LAWN_ASOF });
      return [r.trade, r.past!.note!.body.split("\n")[2]];
    };
    const mowing = "Ryan at Tall Pine. We used to take care of the mowing for you, and the last time was last November. We'd love to have you back on the schedule.";
    expect(note(lawnClients())).toEqual(["tree", mowing]);
    // five fence repairs among the mowing make it a fence shop's file; the weekly mowing customer still reads as mowing
    const fenced = lawnClients().map((c) => ({ ...c, visits: c.visits.map((v) => (v.title === "Spring cleanup" ? { ...v, title: "Fence repair" } : v)) }));
    expect(note(fenced)).toEqual(["fence", mowing]);
  });
});
