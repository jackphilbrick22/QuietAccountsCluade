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
