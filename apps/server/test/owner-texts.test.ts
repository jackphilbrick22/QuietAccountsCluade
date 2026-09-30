import { afterEach, describe, expect, it } from "vitest";
import { leadCode, type OwnerMessage } from "@qa/engine";
import { deliverOwnerMessages } from "../src/core/ops.ts";
import { readAmount, readLeadText } from "../src/core/owner.ts";
import { tick } from "../src/core/worker.ts";
import { ProviderError, type OwnerNotifier } from "../src/contracts.ts";
import { LogEmailProvider } from "../src/providers/email.ts";
import { LogNotifier } from "../src/providers/sms.ts";
import { addLead, harness, type Harness } from "./harness.ts";

let open: Harness[] = [];
const make = (...a: Parameters<typeof harness>) => {
  const h = harness(...a);
  open.push(h);
  return h;
};
afterEach(() => {
  for (const h of open) h.close();
  open = [];
});

const state = (h: Harness, bid: string) => h.d.accounts.peek(bid)!.state;
const reply = (h: Harness, bid: string, rid: string) => state(h, bid).replies.find((r) => r.id === rid)!;
const pushOwner = (h: Harness, bid: string, m: Partial<OwnerMessage> & { id: string }) =>
  h.d.accounts.withAccount(bid, (s) => {
    s.ownerMessages.push({ at: "2026-09-29T09:30:00", kind: "handoff", text: "🌳 NEW — Kim Tran\nText back BOOKED + amount, DONE, or NO · #AAA", ...m });
  });

describe("reading an owner's text about a lead (n12, n38)", () => {
  it("never takes digits in the #code, dates, times or phone numbers as the amount", () => {
    expect(readAmount("booked #RK9")).toBe(0);
    expect(readAmount("booked 2400 #G3K")).toBe(2400);
    expect(readAmount("BOOKED $2,400.50 #K7Q")).toBe(2400.5);
    expect(readAmount("booked 2.4k")).toBe(2400);
    expect(readAmount("sold it 5k!")).toBe(5000);
    expect(readAmount("booked for 10/15 at 3pm")).toBe(0);
    expect(readAmount("booked, call 603-555-0142")).toBe(0);
    expect(readAmount("booked 3 trees for 1800")).toBe(1800);
  });
  it("a plain yes is never a booking, and 'no answer' wins over 'yes'", () => {
    expect(readLeadText("Yes, called her, no answer")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("yes left a voicemail")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("Yes, keep it going")).toBeUndefined();
    expect(readLeadText("yes")).toBeUndefined();
    expect(readLeadText("scheduled a site visit tuesday")).toBeUndefined();
    expect(readLeadText("booked 2400 #G3K")).toEqual({ outcome: "booked", amount: 2400 });
    expect(readLeadText("2400 #G3K")).toEqual({ outcome: "booked", amount: 2400 });
    expect(readLeadText("booked #RK9")).toEqual({ outcome: "booked", amount: 0 });
    expect(readLeadText("didn't book, too pricey")).toEqual({ outcome: "lost", amount: 0 });
    expect(readLeadText("No")).toEqual({ outcome: "lost", amount: 0 });
    expect(readLeadText("no problem")).toBeUndefined();
    expect(readLeadText("sent her a price")).toEqual({ outcome: "quoted", amount: 0 });
    expect(readLeadText("called")).toEqual({ outcome: undefined, amount: 0 });
    // "won't" is never a win
    expect(readLeadText("She won't go above 1200")).toBeUndefined();
    expect(readLeadText("He won't pick up")).toEqual({ outcome: "no_answer", amount: 0 });
    expect(readLeadText("won it, 3200")).toEqual({ outcome: "booked", amount: 3200 });
  });
});

describe("one owner, two businesses on one cell (n4, n48)", () => {
  it("SKIP searches the name as written first, even when a word in it is also a business's short name", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    await addLead(h, "aaa-tree", "r-a", "John Bbb", "2026-09-29T08:00:00");
    await addLead(h, "bbb-tree", "r-b", "John Doe", "2026-09-29T09:00:00");
    expect(await h.sms("SKIP John Bbb")).toBe("AAA Tree: Done — John Bbb is off the list. We won't write to them again.");
    expect(state(h, "bbb-tree").dataset.customers.find((c) => c.name === "John Doe")!.doNotContact).toBeFalsy();
  });

  it("a #code with CANCEL is about the lead, never the whole service", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    expect(await h.sms(`Cancel #${leadCode("r1")}`)).toContain("To cancel the whole service, text CANCEL on its own");
    expect(state(h, "ridge").dataset.business.plan.stage).not.toBe("cancelled");
  });

  it("while one business waits for its OK, an old lead in the other never turns a change to the note into a command", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.business("bbb-tree", { name: "BBB Tree" });
    await addLead(h, "bbb-tree", "r-bbb-old", "Kim Tran", "2026-09-10T10:00:00");
    await h.d.accounts.withAccount("aaa-tree", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
    });
    for (const text of ["No, say Hey instead of Hi", "Hold on, can you change the greeting to Hey AAA", "Free quote, not free estimate AAA", "Go with Hey instead of Hi AAA", "Add that we won Best of Concord 2025", "Say we won't email them again", "Say we sent them an estimate last year"])
      expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(reply(h, "bbb-tree", "r-bbb-old").status).toBe("handed_off");
    expect(state(h, "bbb-tree").recoveries).toEqual([]);
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);
    // a lead that just came in: a short "no" with more after it is still about the note; a booking is about the lead
    await addLead(h, "bbb-tree", "r-bbb-new", "Al Moss", "2026-09-29T09:20:00");
    for (const text of ["No, say Hey", "No, too pushy"]) expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(reply(h, "bbb-tree", "r-bbb-new").status).toBe("handed_off");
    // the close is out for BBB: "Ok but…" is a change to AAA's note, never a yes to BBB's plan
    await h.d.accounts.withAccount("bbb-tree", (s) => {
      s.ownerMessages.push({ id: "om-close-bbb", at: "2026-09-25T09:00:00", kind: "close", text: "Your free round is done…" });
    });
    for (const text of ["Ok but say Hey instead of Hi", "Sure, change the sign-off to Mike"]) expect(await h.sms(text), text).toMatch(/^AAA Tree: Got it — we'll make that change/);
    expect(state(h, "bbb-tree").events.some((e) => /said yes to keep going/.test(e.title))).toBe(false);
    expect(await h.sms(`booked 2400 #${leadCode("r-bbb-new")}`)).toContain("Booked: Al Moss, $2,400");
    expect(await h.sms("booked 1800")).not.toMatch(/make that change/);
  });

  it("a trial owner texting MONTHLY or YEARLY goes to Jack for the payment link; nothing turns paying on a text", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    await h.d.accounts.withAccount("aaa-tree", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
    });
    for (const text of ["Monthly", "yearly"]) {
      expect(await h.sms(text)).toMatch(/it is\. Jack will text you the payment link\./);
      expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
      expect(state(h, "aaa-tree").awaitingOwnerOk).toBeTruthy();
    }
    expect(h.d.accounts.repo.ownerTexts("aaa-tree").every((t) => t.handled === "accepted_close" && t.needs_person)).toBe(true);
  });

  it("books by the #code in the text, pauses and cancels only the one named, and asks instead of guessing", async () => {
    const h = make();
    await h.business("aaa-tree", { name: "AAA Tree" });
    const second = await h.business("bbb-tree", { name: "BBB Tree" });
    expect(String((second.warnings as string[])[0])).toMatch(/AAA Tree uses the same cell.*PAUSE BBB/);
    await addLead(h, "aaa-tree", "r-aaa-1", "Dan Ruiz", "2026-09-29T08:00:00");
    await addLead(h, "bbb-tree", "r-bbb-1", "Kim Tran", "2026-09-29T09:00:00");

    // the code on BBB's hand-off text finds BBB's lead, and the $ is the amount, not the code's digits
    const booked = await h.sms(`booked 2400 #${leadCode("r-bbb-1")}`);
    expect(booked).toBe("BBB Tree: Booked: Kim Tran, $2,400. Added to your results. 1 more waiting.");
    expect(reply(h, "bbb-tree", "r-bbb-1")).toMatchObject({ outcome: "booked", outcomeValue: 2400 });
    expect(state(h, "bbb-tree").recoveries.map((r) => r.value)).toEqual([2400]);
    expect(reply(h, "aaa-tree", "r-aaa-1").status).toBe("handed_off");

    // no code: the one lead still waiting across both is unambiguous
    expect(await h.sms("booked 1800")).toContain("AAA Tree: Booked: Dan Ruiz, $1,800.");
    // two waiting (one each): ask, never guess
    await addLead(h, "aaa-tree", "r-aaa-2", "Bea Cole", "2026-09-29T09:10:00");
    await addLead(h, "bbb-tree", "r-bbb-2", "Al Moss", "2026-09-29T09:20:00");
    const which = await h.sms("booked 900");
    expect(which).toMatch(/^Which one\? 2 are waiting: Al Moss \(BBB Tree\) #\w{3}, Bea Cole \(AAA Tree\) #\w{3}\. Text it again with the code, like "BOOKED 900 #\w{3}"\.$/);
    expect(reply(h, "aaa-tree", "r-aaa-2").status).toBe("handed_off");
    expect(reply(h, "bbb-tree", "r-bbb-2").status).toBe("handed_off");

    // service commands need the business when the phone runs two
    expect(await h.sms("PAUSE")).toBe('This number runs AAA Tree and BBB Tree. Which one? Text it again with the name, like "PAUSE AAA" or "PAUSE BBB".');
    expect(h.d.accounts.peek("aaa-tree")!.paused || h.d.accounts.peek("bbb-tree")!.paused).toBe(false);
    expect(await h.sms("pause bbb")).toBe("BBB Tree: Paused. No notes will go out until you text RESUME.");
    expect(h.d.accounts.peek("bbb-tree")!.paused).toBe(true);
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);

    expect(await h.sms("CANCEL")).toMatch(/Which one\?.*"CANCEL AAA" or "CANCEL BBB"/);
    expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
    expect(await h.sms("cancel BBB")).toMatch(/^BBB Tree: Done — cancelled\..*Text UNDO BBB by .* tomorrow/);
    // UNDO puts a (non-yearly) cancel back by itself, the same day
    expect(await h.sms("undo")).toMatch(/^BBB Tree: Back on\. Nothing was lost\./);
    expect(state(h, "bbb-tree").dataset.business.plan.stage).toBe("trial");
    expect(await h.sms("cancel BBB")).toMatch(/^BBB Tree: Done — cancelled/);
    expect(state(h, "bbb-tree").dataset.business.plan.stage).toBe("cancelled");
    expect(state(h, "aaa-tree").dataset.business.plan.stage).toBe("trial");
    expect(h.d.accounts.peek("aaa-tree")!.paused).toBe(false);

    const status = await h.sms("status");
    expect(status.split("\n")).toHaveLength(2);
    expect(status).toMatch(/^AAA Tree: So far:.*\nBBB Tree: So far:.*\$2,400 booked\.$/);
    // every text is on file for the operator
    expect(h.d.accounts.repo.ownerTexts("bbb-tree").map((t) => t.handled)).toContain("cancel");
  });

  it("ignores a From with fewer than ten digits, even for a client with no cell", async () => {
    const h = make();
    await h.business("no-cell", { ownerPhone: undefined });
    expect(await h.sms("CANCEL YES", "")).toMatch(/don't recognize this number/);
    expect(await h.sms("pause", "+1555")).toMatch(/don't recognize this number/);
    expect(state(h, "no-cell").dataset.business.plan.stage).toBe("trial");
  });
});

describe("one owner, one business: what a text does (n12, n38, n48)", () => {
  it("'Yes' to the close goes to the operator, not onto the newest lead", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Beth Gallagher", "2026-09-29T08:00:00");
    await pushOwner(h, "ridge", { id: "om-close", kind: "close", text: "Dave, the free 150 is done. Say yes by Friday 2 and the next batch goes out next week." });
    expect(await h.sms("Yes, let's keep going")).toBe("Great — Jack will text you the payment link, and the next batch goes out next week.");
    expect(reply(h, "ridge", "r1")).toMatchObject({ status: "handed_off" });
    expect(reply(h, "ridge", "r1").outcome).toBeUndefined();
    const review = (await h.api("GET", "/api/review")).json.items as { kind: string; handled?: string; text?: string; seq?: number }[];
    const yes = review.find((i) => i.kind === "owner_text")!;
    expect(yes).toMatchObject({ handled: "accepted_close", text: "Yes, let's keep going" });
    // "Called her, no answer" is a no answer, and stays out of the ledger
    expect(await h.sms("Yes, called her, no answer")).toBe("Got it — no answer from Beth Gallagher. Try again tomorrow.");
    expect(reply(h, "ridge", "r1").outcome).toBe("no_answer");
    expect(state(h, "ridge").recoveries).toEqual([]);
    // handled: the item leaves the queue
    await h.api("POST", `/api/businesses/ridge/owner-texts/${yes.seq}/done`);
    expect(((await h.api("GET", "/api/review")).json.items as { kind: string }[]).some((i) => i.kind === "owner_text")).toBe(false);
  });

  it("a code ending in a digit is never the amount, and a corrected amount replaces the first", async () => {
    const h = make();
    await h.business("ridge");
    let rid = "r-0";
    for (let i = 0; !/\d$/.test(leadCode(rid)); i++) rid = `r-${i}`;
    const code = leadCode(rid);
    await addLead(h, "ridge", rid, "Kim Tran", "2026-09-29T08:00:00");
    expect(await h.sms(`booked #${code}`)).toBe(`Booked: Kim Tran. What's the job worth? Text "booked 2400 #${code}".`);
    expect(state(h, "ridge").recoveries).toEqual([]);
    expect(await h.sms(`booked 240 #${code}`)).toBe("Booked: Kim Tran, $240. Added to your results.");
    expect(await h.sms(`booked 2400 #${code}`)).toBe("Booked: Kim Tran, $2,400. Added to your results.");
    expect(state(h, "ridge").recoveries.map((r) => r.value)).toEqual([2400]);
  });

  it("with two leads waiting, a text with no code asks which; with the code it acts", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await addLead(h, "ridge", "r2", "Dan Ruiz", "2026-09-29T09:00:00");
    expect(await h.sms("booked 2400")).toBe(`Which one? 2 are waiting: Dan Ruiz #${leadCode("r2")}, Kim Tran #${leadCode("r1")}. Text it again with the code, like "BOOKED 2400 #${leadCode("r2")}".`);
    expect(state(h, "ridge").replies.every((r) => r.status === "handed_off")).toBe(true);
    expect(await h.sms(`NO #${leadCode("r1")}`)).toBe("Got it — Kim Tran marked not a fit. 1 more waiting.");
    expect(await h.sms("booked 2400")).toBe("Booked: Dan Ruiz, $2,400. Added to your results.");
  });

  it("a text we can't read goes to the operator with a reply that says so", async () => {
    const h = make();
    await h.business("ridge");
    expect(await h.sms("my truck broke down, call me when you can")).toMatch(/^Thanks — Jack will read this and get back to you\./);
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; text: string; handled: string }[];
    expect(items).toEqual([expect.objectContaining({ kind: "owner_text", text: "my truck broke down, call me when you can", handled: "unrecognized" })]);
    const log = (await h.api("GET", "/api/businesses/ridge/owner-texts")).json as { body: string }[];
    expect(log[0]!.body).toBe("my truck broke down, call me when you can");
    // "don't email the Johnsons" is a skip; with no Johnsons on file it goes to the operator too, and says so
    expect(await h.sms("don't email the Johnsons, they're family")).toBe(`I couldn't find "the johnsons" in your records. Jack will check and take them off by hand.`);
  });
});

describe("carrier keywords and cancelling (n27)", () => {
  it("STOP turns our texts off (hand-offs go by email instead), START turns them back on", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    const email = h.d.email as LogEmailProvider;
    await h.business("ridge");
    const stop = await h.sms("STOP");
    expect(stop).toBe("OK — no more texts from us. Your follow-ups keep running; hot leads and reports come to dave@ridgelinetree.com instead. Text START to get texts again. To end the service itself, text CANCEL.");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toMatchObject({ by: "owner" });
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("trial");
    await pushOwner(h, "ridge", { id: "om-1" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(notifier.sent).toHaveLength(0);
    expect(email.sent.at(-1)).toMatchObject({ to: "dave@ridgelinetree.com", fromName: "Quiet Accounts" });
    expect(email.sent.at(-1)!.text).toContain("The owner texted STOP, so this came by email.");
    expect(h.d.accounts.repo.ownerMessages("ridge")[0]).toMatchObject({ delivery: "sent", channel: "email" });

    expect(await h.sms("start")).toBe("Texts are back on.");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toBeUndefined();
    await pushOwner(h, "ridge", { id: "om-2", at: "2026-09-29T09:40:00" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(notifier.sent).toHaveLength(1);
  });

  it("after CANCEL nothing more goes to the owner: no Friday report, no reminders, no queued texts", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Kim Tran", "2026-09-29T08:00:00");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.touches.push({ id: "t1", opportunityId: "o1", customerId: "c-r1", channel: "email", step: 1, angle: "check_in", dueAt: "2026-09-29T08:00", status: "sent", sentAt: "2026-09-29T08:00:00", body: "Hi Kim", flags: [] });
    });
    expect(await h.sms("cancel")).toMatch(/^Done — cancelled\. No more notes, no more charges\./);
    await pushOwner(h, "ridge", { id: "om-late", kind: "info", text: "Heads up" });
    for (const at of ["2026-10-02T20:30:00Z", "2026-10-09T20:30:00Z", "2026-10-16T20:30:00Z"]) {
      h.setNow(at); // Fridays, 4:30pm New York
      await tick(h.d);
    }
    expect(notifier.sent).toEqual([]);
    const s = state(h, "ridge");
    expect(s.ownerMessages.filter((m) => m.kind === "weekly" || m.kind === "sla_nudge")).toEqual([]);
    expect(h.d.accounts.repo.ownerMessages("ridge").find((m) => m.id === "om-late")!.delivery).toBe("skipped");
    // START afterwards turns texts on, but never un-cancels
    expect(await h.sms("RESUME")).toMatch(/You're cancelled, so nothing's running/);
    expect(state(h, "ridge").dataset.business.plan.stage).toBe("cancelled");
  });
});

describe("owner messages never vanish into a log (n46)", () => {
  it("no cell: emailed through the mail provider; no email route either: failed, in the review queue", async () => {
    const h = make();
    const email = h.d.email as LogEmailProvider;
    await h.business("mail-only", { ownerPhone: undefined });
    await h.business("nothing", { ownerPhone: undefined, ownerEmail: undefined });
    const ov = (await h.api("GET", "/api/businesses/mail-only")).json as { readiness: { ready: boolean; gaps: { id: string; level: string }[] } };
    expect(ov.readiness.gaps.find((g) => g.id === "no_owner_cell")?.level).toBe("blocker");
    await pushOwner(h, "mail-only", { id: "om-a" });
    await pushOwner(h, "nothing", { id: "om-b" });
    await deliverOwnerMessages(h.d);
    expect(h.d.accounts.repo.ownerMessages("mail-only")[0]).toMatchObject({ delivery: "sent", channel: "email" });
    expect(email.sent.at(-1)!.text).toContain("No cell on file, so this came by email.");
    expect(h.d.accounts.repo.ownerMessages("nothing")[0]).toMatchObject({ delivery: "failed", channel: null });
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; businessId: string; delivery?: string }[];
    expect(items).toEqual([expect.objectContaining({ kind: "owner_message", businessId: "nothing", delivery: "failed" })]);
  });

  it("a carrier opt-out (Twilio 21610) switches the owner to email and tells the operator", async () => {
    const refused: OwnerNotifier = {
      name: "twilio",
      notify: async () => {
        throw new ProviderError("Twilio 400 (21610): Attempt to send to unsubscribed recipient", "twilio", 400, false);
      },
    };
    const h = make({ notifier: refused });
    await h.business("ridge");
    await pushOwner(h, "ridge", { id: "om-1" });
    await deliverOwnerMessages(h.d, "ridge");
    expect(state(h, "ridge").dataset.business.ownerTextsOff).toMatchObject({ by: "carrier" });
    expect(h.d.accounts.repo.ownerMessages("ridge")[0]).toMatchObject({ delivery: "sent", channel: "email" });
    const items = (await h.api("GET", "/api/review")).json.items as { kind: string; title?: string }[];
    expect(items.find((i) => i.kind === "alert")!.title).toMatch(/refuses our texts/);
  });
});

describe("reminders survive a restart (n17, n53)", () => {
  it("SKIP survives a deploy: the person stays off the list", async () => {
    const h = make();
    await h.business("ridge");
    await addLead(h, "ridge", "r-erin", "Erin Grant", "2026-09-29T08:00:00");
    // one more save first, so the lists are ones the database has already seen
    await h.d.accounts.withAccount("ridge", () => {});
    expect(await h.sms("Don't email Erin Grant, they're family")).toContain("Erin Grant is off the list");
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state.dataset.customers.find((c) => c.id === "c-r-erin")!.doNotContact).toBe(true);
  });

  it("a renewal ask is never asked twice after a deploy, however many texts came since", async () => {
    const h = make();
    await h.business("ridge");
    await h.d.accounts.withAccount("ridge", (s) => {
      s.ownerMessages.push({ id: "om-renewal", at: "2026-09-20T09:00:00", kind: "renewal", text: "Your year with us ends Oct 20.", refs: [{ kind: "year_end", id: "2026-10-20" }] });
    });
    for (let i = 0; i < 320; i++) h.d.accounts.repo.db.run("INSERT INTO owner_messages (business_id, id, at, kind, text, delivery, data) VALUES (?, ?, ?, 'handoff', 'x', 'sent', ?)", "ridge", `om-h-${i}`, `2026-09-2${1 + (i % 8)}T10:00:00`, JSON.stringify({ id: `om-h-${i}`, at: "2026-09-21T10:00:00", kind: "handoff", text: "x" }));
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state.ownerMessages.some((m) => m.id === "om-renewal")).toBe(true);
  });

  it("the wait for the OK, the quiet rate before we started and a CANCEL all survive a deploy", async () => {
    const h = make();
    await h.business("ridge");
    const before = { rate: 0.42, quiet: 21, quotes: 50, value: 61200, on: "2026-09-29" } as never;
    await h.d.accounts.withAccount("ridge", (s) => {
      s.awaitingOwnerOk = "2026-09-29T09:00:00";
      s.quietBefore = before;
    });
    const a = h.restart();
    open.push(a);
    expect(a.d.accounts.peek("ridge")!.state).toMatchObject({ awaitingOwnerOk: "2026-09-29T09:00:00", quietBefore: before });
    expect(await a.sms("OK")).toContain("the first notes go out");
    expect(await a.sms("CANCEL")).toMatch(/Done — cancelled/);
    const b = a.restart();
    open.push(b);
    expect(b.d.accounts.peek("ridge")!.state.cancelled?.stageBefore).toBe("trial");
    expect(await b.sms("UNDO")).toMatch(/^Back on\./);
    expect(b.d.accounts.peek("ridge")!.state.dataset.business.plan.stage).toBe("trial");
    const c = b.restart();
    open.push(c);
    expect(c.d.accounts.peek("ridge")!.state.cancelled).toBeUndefined();
  });

  it("a lead nudged twice is never nudged again after a deploy, however many texts came since", async () => {
    const h = make();
    const notifier = h.d.notifier as LogNotifier;
    await h.business("ridge");
    await addLead(h, "ridge", "r1", "Bill Iverson", "2026-09-29T10:00:00");
    for (const at of ["2026-09-29T18:30:00Z", "2026-09-30T14:30:00Z"]) {
      h.setNow(at);
      await tick(h.d);
    }
    const nudges = () => notifier.sent.filter((m) => /still waiting/.test(m.text)).length;
    expect(nudges()).toBe(2);
    // 320 later owner texts push the nudges out of the recent-messages window
    for (let i = 0; i < 320; i++) h.d.accounts.repo.db.run("INSERT INTO owner_messages (business_id, id, at, kind, text, delivery, data) VALUES (?, ?, ?, 'info', 'x', 'sent', ?)", "ridge", `om-x-${i}`, `2026-10-01T09:${String(i % 60).padStart(2, "0")}:00`, JSON.stringify({ id: `om-x-${i}`, at: "2026-10-01T09:00:00", kind: "info", text: "x" }));
    const after = h.restart();
    open.push(after);
    const n2 = after.d.notifier as LogNotifier;
    for (const at of ["2026-10-01T14:30:00Z", "2026-10-02T14:30:00Z"]) {
      after.setNow(at);
      await tick(after.d);
    }
    expect(n2.sent.filter((m) => /still waiting/.test(m.text))).toEqual([]);
    expect(after.d.accounts.peek("ridge")!.state.replies[0]!.nudges).toBe(2);
  });
});


