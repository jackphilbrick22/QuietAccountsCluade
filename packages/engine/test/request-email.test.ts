import { describe, expect, it } from "vitest";
import { readRequestEmail } from "../src/inbox/request.ts";
import { answerNewRequests, takeRequest } from "../src/runtime/agents.ts";
import { emptyState } from "../src/runtime/state.ts";
import { ASOF, ago, business, customer, dataset } from "./fixtures.ts";

const WEB_FORM = `---------- Forwarded message ---------
From: Wix Forms <no-reply@wix.com>
Date: Tue, Sep 29, 2026 at 6:12 PM
Subject: New form submission: Request a quote
To: <dave@ridgelinetree.com>

You have a new form submission.

Name: Karen Whitfield
Email: karen.whitfield@gmail.com
Phone: (603) 555-0142
Address: 14 Oak Ln, Concord NH
Message: There's a big oak leaning toward the garage.
It dropped a limb last week. Can someone come look?

Sent from your website.`;

const ANGI = `Begin forwarded message:

From: Angi Leads <leads@angi.com>
Subject: New lead: Tree Removal - Paul Brennan

Customer Name
Paul Brennan

Phone
603-555-0199

Email
pbrennan77@yahoo.com

Task
Tree Removal - Large (over 30 ft)

Zip Code
03301`;

const THUMBTACK = `---------- Forwarded message ---------
From: Thumbtack <no-reply@thumbtack.com>
Subject: Jess M. is looking for tree trimming

Jess M. needs tree trimming in Concord, NH.
Respond in the Thumbtack app to message Jess.`;

const HOMEOWNER = `---------- Forwarded message ---------
From: Rachel Moore <rachel.moore@outlook.com>
Date: Mon, Sep 28, 2026
Subject: Stump grinding?
To: Dave <dave@ridgelinetree.com>

Hi, do you grind stumps? We have three in the back yard from last year. Thanks, Rachel`;

describe("reading a forwarded request", () => {
  it("a website form: every labelled field, and a message that runs over two lines", () => {
    const r = readRequestEmail({ subject: "Fwd: New form submission: Request a quote", text: WEB_FORM, ignore: ["dave@ridgelinetree.com"] });
    expect(r.lead).toMatchObject({ name: "Karen Whitfield", email: "karen.whitfield@gmail.com", phone: "+16035550142", address: "14 Oak Ln, Concord NH", source: "your website", read: "labelled" });
    expect(r.lead!.job).toBe("There's a big oak leaning toward the garage. It dropped a limb last week. Can someone come look?");
  });
  it("an Angi lead laid out as label, then value", () => {
    const r = readRequestEmail({ subject: "Fwd: New lead: Tree Removal - Paul Brennan", text: ANGI });
    expect(r.lead).toMatchObject({ name: "Paul Brennan", email: "pbrennan77@yahoo.com", phone: "+16035550199", job: "Tree Removal - Large (over 30 ft)", source: "Angi" });
    // the platform's own address is never taken for the homeowner's
    expect(r.lead!.email).not.toMatch(/angi\.com/);
  });
  it("a Thumbtack alert with no contact: to a person, with where to answer", () => {
    const r = readRequestEmail({ subject: "Fwd: Jess M. is looking for tree trimming", text: THUMBTACK });
    expect(r.lead).toBeUndefined();
    expect(r.why).toContain("Thumbtack usually keeps their contact in its app");
  });
  it("a homeowner's own email, forwarded: they're the sender, their words are the job", () => {
    const r = readRequestEmail({ subject: "Fwd: Stump grinding?", text: HOMEOWNER, ignore: ["dave@ridgelinetree.com"] });
    expect(r.lead).toMatchObject({ name: "Rachel Moore", email: "rachel.moore@outlook.com", source: "a forwarded email" });
    expect(r.lead!.job).toContain("do you grind stumps");
  });
});

describe("a forwarded request goes on the always-on track", () => {
  const paying = () => business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } });
  it("adds the person and the request, answers from the office, texts the owner where it came from", () => {
    const st = emptyState(dataset({ business: paying(), customers: [customer("c1")] }), `${ASOF}T10:00:00`);
    const lead = readRequestEmail({ subject: "Fwd: New form submission", text: WEB_FORM }).lead!;
    const t = takeRequest(st, lead, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    expect(t.duplicate).toBe(false);
    const c = st.dataset.customers.find((x) => x.id === t.customerId)!;
    expect(c).toMatchObject({ name: "Karen Whitfield", firstName: "Karen", emails: ["karen.whitfield@gmail.com"], leadSource: "your website" });
    expect(answerNewRequests(st, `${ASOF}T10:06:00`)).toBe(1);
    const note = st.touches.find((x) => x.track === "new_request")!;
    expect(note.customerId).toBe(c.id);
    expect(note.body).toMatch(/Thanks for reaching out/);
    const text = st.ownerMessages.at(-1)!.text;
    expect(text).toContain("NEW REQUEST — Karen Whitfield, 14 Oak Ln");
    expect(text).toContain("Came in through your website; you forwarded it");
    // forwarded twice (the owner's filter and by hand): one request, one answer
    expect(takeRequest(st, lead, `${ASOF}T10:20:00`, `${ASOF}T10:20:00`).duplicate).toBe(true);
    expect(answerNewRequests(st, `${ASOF}T10:21:00`)).toBe(0);
  });
  it("someone already in the records is matched by email, not added again", () => {
    const st = emptyState(dataset({ business: paying(), customers: [customer("c9", { name: "Karen Whitfield", emails: ["karen.whitfield@gmail.com"] })] }), `${ASOF}T10:00:00`);
    const t = takeRequest(st, readRequestEmail({ text: WEB_FORM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    expect(t.customerId).toBe("c9");
    expect(st.dataset.customers).toHaveLength(1);
  });
});

describe("the ledger counts comebacks, not new requests", () => {
  it("a job booked after we answered someone's own request is theirs, not ours", async () => {
    const { markSent, markContacted, receiveReply } = await import("../src/runtime/agents.ts");
    const paying = business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } });
    const st = emptyState(dataset({ business: paying, customers: [] }), `${ASOF}T10:00:00`);
    takeRequest(st, readRequestEmail({ text: WEB_FORM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    answerNewRequests(st, `${ASOF}T10:06:00`);
    const note = st.touches.find((t) => t.track === "new_request")!;
    markSent(st, note.id, `${ASOF}T10:06:00`, "msg-1");
    expect(st.outreach).toHaveLength(0);
    const r = receiveReply(st, { from: "Karen Whitfield <karen.whitfield@gmail.com>", text: "Yes please, can you come Tuesday?", inReplyTo: "msg-1", receivedAt: `${ASOF}T11:00:00` });
    expect(r.opportunityId).toMatch(/^req:/);
    markContacted(st, r.id, `${ASOF}T12:00:00`, "booked", 2400);
    expect(st.recoveries).toHaveLength(0);
  });
});

describe("Every Month After is measured, not claimed", () => {
  it("the week's numbers count new requests answered and how many minutes it took", async () => {
    const { markSent } = await import("../src/runtime/agents.ts");
    const { weekNumbers } = await import("../src/reports/owner.ts");
    const { mondayOf } = await import("../src/util.ts");
    const paying = business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } });
    const st = emptyState(dataset({ business: paying, customers: [] }), `${ASOF}T10:00:00`);
    takeRequest(st, readRequestEmail({ text: WEB_FORM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    answerNewRequests(st, `${ASOF}T10:06:00`);
    markSent(st, st.touches.find((t) => t.track === "new_request")!.id, `${ASOF}T10:09:00`, "msg-1");
    const w = weekNumbers(st, mondayOf(ASOF));
    expect(w).toMatchObject({ requestsAnswered: 1, answerMinutes: 3, freshFollowed: 0 });
  });
});

/* ------------------------------------------------------------------ */
/* A forward carries the forwarder's words, signature and headers too  */
/* ------------------------------------------------------------------ */

const DAVE_SAYS = `Can you get back to this one?

Dave Ridge
Ridgeline Tree Co. | (603) 224-8811
office@ridgelinetree.com`;

const forwarded = (from: string, date: string, subject: string, to: string, body: string, above = DAVE_SAYS) => `${above}

---------- Forwarded message ---------
From: ${from}
Date: ${date}
Subject: ${subject}
To: ${to}

${body}`;

const RACHEL = forwarded("Rachel Moore <rachel.moore@outlook.com>", "Mon, Sep 28, 2026", "Stump grinding?", "Dave <dave@ridgelinetree.com>", "Hi, do you grind stumps? We have three in the back yard from last year. Thanks, Rachel");
const TOM = forwarded("Tom Baker <tbaker@gmail.com>", "Tue, Sep 29, 2026", "Tree down", "Dave <dave@ridgelinetree.com>", "Hi Dave, a birch came down across our driveway in the storm. Can someone come out this week? Tom");
const payingBiz = () => business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } });

describe("a forwarded request: the person is the innermost message, never the business", () => {
  it("the forwarder's signature above the forward is not the homeowner's number or address", () => {
    const r = readRequestEmail({ subject: "Fwd: Stump grinding?", text: RACHEL, from: "dave@ridgelinetree.com", ignore: ["dave@ridgelinetree.com"] });
    expect(r.lead).toMatchObject({ name: "Rachel Moore", email: "rachel.moore@outlook.com" });
    expect(r.lead!.phone).toBeUndefined();
    expect(r.lead!.job).toContain("do you grind stumps");
  });

  it("two homeowners forwarded with the same signature are two people", () => {
    const st = emptyState(dataset({ business: payingBiz(), customers: [] }), `${ASOF}T10:00:00`);
    const rachel = takeRequest(st, readRequestEmail({ subject: "Fwd: Stump grinding?", text: RACHEL }).lead!, `${ago(1)}T09:00:00`, `${ago(1)}T09:00:00`);
    const tom = takeRequest(st, readRequestEmail({ subject: "Fwd: Tree down", text: TOM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    expect(tom.customerId).not.toBe(rachel.customerId);
    expect(st.dataset.customers.find((c) => c.id === rachel.customerId)!.emails).toEqual(["rachel.moore@outlook.com"]);
  });

  it("someone on file with the same number but a different email is someone else: the answer goes to who asked", () => {
    const st = emptyState(dataset({ business: payingBiz(), customers: [customer("c-rachel", { name: "Rachel Moore", firstName: "Rachel", emails: ["rachel.moore@outlook.com"], phones: ["+16032248811"] })] }), `${ASOF}T10:00:00`);
    const t = takeRequest(st, { name: "Tom Baker", email: "tbaker@gmail.com", phone: "+16032248811", job: "A birch came down across the driveway", source: "a forwarded email", read: "loose" }, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    expect(t.customerId).not.toBe("c-rachel");
    expect(st.dataset.customers.find((c) => c.id === "c-rachel")!.emails).toEqual(["rachel.moore@outlook.com"]);
    answerNewRequests(st, `${ASOF}T10:06:00`);
    const note = st.touches.find((x) => x.track === "new_request")!;
    expect(st.dataset.customers.find((c) => c.id === note.customerId)!.emails).toEqual(["tbaker@gmail.com"]);
    expect(note.body).toMatch(/Hi Tom/);
    expect(st.ownerMessages.at(-1)!.text).toContain("NEW REQUEST — Tom Baker");
  });

  it("a phone-only form: the shop's own inbox (in To:, a signature or on its domain) is never the homeowner's email", () => {
    const form = forwarded(
      "Wix Forms <no-reply@wix.com>",
      "Tue, Sep 29, 2026 at 6:12 PM",
      "New form submission",
      "<office@ridgelinetree.com>",
      "Name: Karen Whitfield\nPhone: (603) 555-0142\nMessage: Big oak leaning toward the garage.\n\nThis message was sent to office@ridgelinetree.com. Questions? sales@ridgelinetree.com",
    );
    const r = readRequestEmail({ subject: "Fwd: New form submission", text: form, from: "dave@ridgelinetree.com", ignore: ["dave@ridgelinetree.com"], ignoreDomains: ["ridgelinetree.com"] });
    expect(r.lead).toMatchObject({ name: "Karen Whitfield", phone: "+16035550142", source: "your website" });
    expect(r.lead!.email).toBeUndefined();
  });

  it("the business's own numbers are never the homeowner's, even inside the forwarded message", () => {
    const form = forwarded("Wix Forms <no-reply@wix.com>", "Tue, Sep 29, 2026", "New form submission", "<dave@ridgelinetree.com>", "Name: Karen Whitfield\nEmail: karen.whitfield@gmail.com\nMessage: Big oak.\n\nRidgeline Tree Co. (603) 555-0100");
    const r = readRequestEmail({ subject: "Fwd: New form submission", text: form, ignorePhones: ["+16035550100", "+16035550199"] });
    expect(r.lead).toMatchObject({ name: "Karen Whitfield", email: "karen.whitfield@gmail.com" });
    expect(r.lead!.phone).toBeUndefined();
  });

  it("a free mailbox domain is never taken as the business's own", () => {
    const r = readRequestEmail({ subject: "Fwd: Tree down", text: TOM, ignore: ["dave.ridge@gmail.com"], ignoreDomains: ["gmail.com"] });
    expect(r.lead!.email).toBe("tbaker@gmail.com");
  });

  it("a forward of a forward (office manager, then the owner): the homeowner, not the office manager", () => {
    const inner = forwarded("Rachel Moore <rachel.moore@outlook.com>", "Mon, Sep 28, 2026", "Stump grinding?", "<sarah@ridgelinetree.com>", "Hi, do you grind stumps? We have three in the back yard from last year. Thanks, Rachel", "Dave, can you call her back? She sounds keen.\nSarah | office (603) 224-8800");
    const nested = forwarded("Sarah Office <sarah@ridgelinetree.com>", "Tue, Sep 29, 2026 at 9:02 AM", "Fwd: Stump grinding?", "Dave <dave@ridgelinetree.com>", inner, "FYI see below\n\nDave\n(603) 224-8811");
    // the server always passes the business's own domain (from its addresses): the office manager is the business
    const r = readRequestEmail({ subject: "Fwd: Fwd: Stump grinding?", text: nested, from: "dave@ridgelinetree.com", ignore: ["dave@ridgelinetree.com"], ignoreDomains: ["ridgelinetree.com"] });
    expect(r.lead).toMatchObject({ name: "Rachel Moore", email: "rachel.moore@outlook.com" });
    expect(r.lead!.phone).toBeUndefined();
    expect(r.lead!.job).toContain("do you grind stumps");
    expect(r.lead!.job).not.toMatch(/call her back|From:/);
  });
});

describe("a chain with two people in it", () => {
  it("a property manager forwarding a tenant: who's asking is a person's call, never a guess", () => {
    const tenant = forwarded("Jamie Lee <jamie.lee88@gmail.com>", "Mon, Sep 28, 2026", "Leak under sink", "Pat Morgan <pat@harborprops.com>", "Hi Pat, the kitchen sink in 4B is leaking again. Jamie 603-555-0142", "Can you get someone out to 14 Harbor St 4B? Bill us as usual.\nPat Morgan, 603-555-0199");
    const chain = forwarded("Pat Morgan <pat@harborprops.com>", "Tue, Sep 29, 2026", "Fwd: Leak under sink", "Dave <dave@acmeplumbing.com>", tenant, "");
    const r = readRequestEmail({ subject: "Fwd: Fwd: Leak under sink", text: chain, from: "dave@acmeplumbing.com", ignore: ["dave@acmeplumbing.com"], ignoreDomains: ["acmeplumbing.com"] });
    expect(r.lead).toBeUndefined();
    expect(r.why).toContain("more than one person");
  });
});

describe("one person, one answer", () => {
  it("the same form forwarded again the next morning: the owner hears it, nobody is answered twice", async () => {
    const { markSent, dueTouches } = await import("../src/runtime/agents.ts");
    const st = emptyState(dataset({ business: payingBiz(), customers: [] }), `${ago(1)}T18:00:00`);
    const lead = readRequestEmail({ subject: "Fwd: New form submission", text: WEB_FORM }).lead!;
    takeRequest(st, lead, `${ago(1)}T18:05:00`, `${ago(1)}T18:05:00`);
    expect(answerNewRequests(st, `${ago(1)}T18:05:00`)).toBe(1);
    markSent(st, st.touches.find((t) => t.track === "new_request")!.id, `${ago(1)}T18:06:00`, "msg-1");
    const again = takeRequest(st, lead, `${ASOF}T08:30:00`, `${ASOF}T08:30:00`);
    expect(again.duplicate).toBe(false);
    expect(answerNewRequests(st, `${ASOF}T08:30:00`)).toBe(1);
    expect(st.touches.filter((t) => t.track === "new_request")).toHaveLength(1);
    expect(dueTouches(st, `${ASOF}T08:31`).due).toHaveLength(0);
    expect(st.ownerMessages.at(-1)!.text).toContain("They already got our answer to an earlier request, so no second note went");
  });

  it("a Jobber request, then the same person's form forwarded: one answer", async () => {
    const { markSent } = await import("../src/runtime/agents.ts");
    const karen = customer("jc1", { name: "Karen Whitfield", firstName: "Karen", emails: ["karen.whitfield@gmail.com"] });
    const st = emptyState(dataset({ business: payingBiz(), customers: [karen], requests: [{ id: "jr1", customerId: "jc1", title: "the oak", status: "new", rawStatus: "New", createdOn: ASOF, createdAt: `${ASOF}T09:00:00` }] }), `${ASOF}T09:00:00`);
    expect(answerNewRequests(st, `${ASOF}T09:05:00`)).toBe(1);
    markSent(st, st.touches.find((t) => t.track === "new_request")!.id, `${ASOF}T09:06:00`, "msg-1");
    const t = takeRequest(st, readRequestEmail({ subject: "Fwd: New form submission", text: WEB_FORM }).lead!, `${ASOF}T10:00:00`, `${ASOF}T10:00:00`);
    expect(t.customerId).toBe("jc1");
    answerNewRequests(st, `${ASOF}T10:00:00`);
    expect(st.touches.filter((x) => x.track === "new_request")).toHaveLength(1);
  });

  it("an answer still waiting for 7am covers a second request that night too", () => {
    const st = emptyState(dataset({ business: payingBiz(), customers: [] }), `${ASOF}T22:00:00`);
    const lead = readRequestEmail({ subject: "Fwd: New form submission", text: WEB_FORM }).lead!;
    takeRequest(st, lead, `${ASOF}T22:05:00`, `${ASOF}T22:05:00`);
    answerNewRequests(st, `${ASOF}T22:05:00`);
    takeRequest(st, { ...lead, job: "Also a maple by the fence" }, `${ASOF}T22:30:00`, `${ASOF}T22:30:00`);
    answerNewRequests(st, `${ASOF}T22:30:00`);
    expect(st.touches.filter((x) => x.track === "new_request")).toHaveLength(1);
    expect(st.ownerMessages.at(-1)!.text).toContain("Our answer to their earlier request is already on its way");
  });
});

describe("a reply to our answer to a new request", () => {
  const setup = async () => {
    const { markSent } = await import("../src/runtime/agents.ts");
    const st = emptyState(dataset({ business: payingBiz(), customers: [] }), `${ASOF}T10:00:00`);
    takeRequest(st, readRequestEmail({ subject: "Fwd: New form submission", text: WEB_FORM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    answerNewRequests(st, `${ASOF}T10:05:00`);
    const note = st.touches.find((t) => t.track === "new_request")!;
    markSent(st, note.id, `${ASOF}T10:06:00`, "msg-1");
    return { st, note };
  };

  it("'Sounds good, thanks' joins the lead the owner already has: no second answer, no second hand-off", async () => {
    const { receiveReply, chase } = await import("../src/runtime/agents.ts");
    const { st, note } = await setup();
    const handoffs = st.ownerMessages.filter((m) => m.kind === "handoff").length;
    const r = receiveReply(st, { from: "Karen Whitfield <karen.whitfield@gmail.com>", text: "Sounds good, thanks!", inReplyTo: "msg-1", receivedAt: `${ASOF}T10:30:00` });
    expect(r.intent).toBe("wants_it");
    expect(r.ack).toBeUndefined();
    expect(r.followUpOf).toBe(note.opportunityId);
    expect(r.status).toBe("done");
    expect(st.ownerMessages.filter((m) => m.kind === "handoff").length).toBe(handoffs);
    expect(st.ownerMessages.at(-1)!.text).toMatch(/Karen Whitfield wrote back about their request: “Sounds good, thanks!”/);
    // nothing for the owner's SLA chase to nudge about
    expect(chase(st, `${ASOF}T18:00:00`)).toHaveLength(0);
  });

  it("a yes with a new number: the owner gets the number", async () => {
    const { receiveReply } = await import("../src/runtime/agents.ts");
    const { st } = await setup();
    const r = receiveReply(st, { from: "karen.whitfield@gmail.com", text: "Yes please, call my cell 603-224-1234 after 5.", inReplyTo: "msg-1", receivedAt: `${ASOF}T10:30:00` });
    expect(r.ack).toBeUndefined();
    expect(st.ownerMessages.at(-1)!.text).toContain("New number: (603) 224-1234");
  });

  it("a stop is still a stop", async () => {
    const { receiveReply } = await import("../src/runtime/agents.ts");
    const { st } = await setup();
    const r = receiveReply(st, { from: "karen.whitfield@gmail.com", text: "Please stop emailing me.", inReplyTo: "msg-1", receivedAt: `${ASOF}T10:30:00` });
    expect(r.intent).toBe("stop");
    expect(st.suppressions["karen.whitfield@gmail.com"]).toBe("unsubscribed");
    expect(r.followUpOf).toBeUndefined();
  });
});

describe("a yes to a follow-up is never taken for a thanks to a request answer", () => {
  it("with no thread (a platform reply) and a follow-up sent lately, it's a normal hand-off", async () => {
    const { markSent, receiveReply } = await import("../src/runtime/agents.ts");
    const paying = business({ plan: { stage: "paying", trialSize: 150, monthlyPrice: 497, freeMonths: [], paidOn: ago(40) } });
    const st = emptyState(dataset({ business: paying, customers: [customer("c1", { name: "Karen Whitfield", firstName: "Karen", emails: ["karen.whitfield@gmail.com"] })] }), `${ASOF}T10:00:00`);
    st.touches.push({ id: "fq1", opportunityId: "o-fence", customerId: "c1", channel: "email", step: 1, angle: "check_in", dueAt: `${ASOF}T08:00`, status: "approved", body: "About the fence", flags: [] } as never);
    markSent(st, "fq1", `${ASOF}T08:00:00`, "msg-fence");
    takeRequest(st, readRequestEmail({ text: WEB_FORM }).lead!, `${ASOF}T10:05:00`, `${ASOF}T10:05:00`);
    answerNewRequests(st, `${ASOF}T10:06:00`);
    markSent(st, st.touches.find((t) => t.track === "new_request")!.id, `${ASOF}T10:07:00`, "msg-req");
    const r = receiveReply(st, { from: "Karen Whitfield <karen.whitfield@gmail.com>", text: "Yes, let's go ahead with the fence quote. When can you start?", receivedAt: `${ASOF}T11:00:00` });
    expect(r.followUpOf).toBeUndefined();
    expect(r.status).toBe("handed_off");
    // it's recorded against the fence note, so the guarantee and the ledger count it as ours
    expect(r.touchId).toBe("fq1");
    expect(r.opportunityId).toBe("o-fence");
    expect(st.ownerMessages.filter((m) => m.kind === "handoff").at(-1)!.text).not.toMatch(/NEW REQUEST/i);
    const { guaranteeCheck } = await import("../src/reports/owner.ts");
    expect(guaranteeCheck(st, ASOF)!.asked.map((x) => x.id)).toContain(r.id);
  });
});
