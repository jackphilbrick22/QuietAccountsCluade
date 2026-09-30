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
