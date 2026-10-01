/**
 * POST /api/businesses/:id/owner-messages/:mid/send: 200 with whether the text really went (a 409 when there was
 * nothing waiting to send, which the console shows as an error).
 */
export interface OwnerSendResult {
  ok?: boolean;
  delivery?: string;
  /** Why it didn't go, when it didn't ("No cell on file and no email on file. Pass it on yourself."). */
  error?: string | null;
}

/** What the operator is told after "Approve and send": what really happened, never "sent" unless it went. */
export function ownerSendToast(r: OwnerSendResult | undefined): string {
  if (r?.ok && r.delivery === "sent") return "Approved and sent to the owner";
  if (r?.ok && r.delivery === "manual") return "Approved: it's on Texts to send for you to text them";
  const why = r?.error ? ` ${r.error}` : "";
  switch (r?.delivery) {
    case "failed":
      return `Not sent: it failed.${why || " It's still in the queue to try again."}`;
    case "skipped":
      return `Not sent: skipped.${why}`;
    case "review":
      return "Not sent: it's back waiting for review.";
    case "pending":
      return "Approved, but it hasn't gone out yet. It's still queued.";
    default:
      return "Not sent: the server didn't say it went. Check Texts to the owner.";
  }
}

/**
 * POST /api/businesses/:id/replies/:rid/handoff and …/intent: where the hand-off text it made went, once the
 * dispatcher has run. No delivery when it made none (a label that hands nothing off, or a reply the owner has already).
 */
export interface HandoffResult {
  delivery?: string;
  channel?: string | null;
  error?: string | null;
}

/**
 * What the operator is told after handing a reply to the owner, or saying what it means (`marked`: "Marked a yes"):
 * where the hand-off text really went. By hand (SMS_PROVIDER=manual) it's on Texts to send, not texted yet.
 */
export function handoffToast(r: HandoffResult | undefined, o: { marked?: string; again?: boolean } = {}): string {
  const say = (what: string) => (o.marked ? `${o.marked} — ${what}` : what[0]!.toUpperCase() + what.slice(1));
  const why = r?.error ? ` ${r.error}` : "";
  switch (r?.delivery) {
    case undefined:
      return o.marked ?? "Nothing new to text: the owner has already called them";
    case "sent":
      return say(`${r.channel === "email" ? "emailed" : "texted"} to the owner${o.again ? " again" : ""}`);
    case "manual":
      return say("on Texts to send for you to text the owner");
    case "failed":
      return say(`not texted: it's waiting for you in Needs a person.${why}`);
    case "skipped":
      return say(`not texted.${why}`);
    default:
      return say("queued to text the owner");
  }
}

/**
 * The label on our answer to a text from the owner (Needs a person). By hand, the answer to a pasted text waits on
 * Texts to send, except while they've texted STOP: then only the answer to the STOP itself goes back.
 */
export function ourAnswerLabel(sms: string | undefined, handled: string | undefined): string {
  if (sms !== "manual") return "We texted back";
  return handled === "texts_off" ? "Our answer (on Texts to send)" : "Our answer (on Texts to send, unless they'd texted STOP)";
}
