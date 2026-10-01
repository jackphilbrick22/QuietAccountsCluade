import { randomUUID } from "node:crypto";
import { NotFound } from "./accounts.ts";
import { localIso } from "./clock.ts";
import type { Deps } from "./ops.ts";
import { ownerCommand, type OwnerCommandResult } from "./owner.ts";

/**
 * Owner texts by hand (SMS_PROVIDER=manual), while Twilio waits on carrier registration. Every text the dispatcher
 * would send waits on the console's "Texts to send" list; the operator texts it from his own phone and marks it sent.
 * What the owner texts back, he pastes on their client page: it's read by the same handler as the Twilio webhook, as
 * sent from the owner's cell on file, and the answer joins the list.
 */

export interface TextToSend {
  businessId: string;
  businessName: string;
  ownerFirstName: string;
  /** The owner's cell as it's on file now. */
  phone: string | null;
  messageId: string;
  at: string;
  kind: string;
  text: string;
}

export function textsToSend(d: Deps): TextToSend[] {
  const owners = new Map(d.accounts.repo.listBusinesses().map((b) => [b.id, b.profile]));
  return d.accounts.repo.manualOwnerMessages().map((m) => {
    const b = owners.get(m.business_id);
    return { businessId: m.business_id, businessName: b?.name ?? m.business_id, ownerFirstName: b?.ownerFirstName ?? "", phone: b?.ownerPhone ?? null, messageId: m.id, at: m.at, kind: m.kind, text: m.text };
  });
}

/** What a pasted text did, and whether the answer is on the list (`why` not, when it isn't). */
export type Pasted = OwnerCommandResult & { queued: boolean; why?: string };

/** A text the owner sent the operator's phone, read as if it came to our number. Refused without a cell on file. */
export async function pasteOwnerText(d: Deps, bid: string, text: string): Promise<Pasted | { refused: string }> {
  const b = d.accounts.peek(bid)?.state.dataset.business;
  if (!b) throw new NotFound("No such business");
  if (!b.ownerPhone) return { refused: `There's no cell on file for ${b.ownerFirstName || b.name}, so their text can't be read as theirs. Add their cell in Settings first.` };
  const res = await ownerCommand(d, b.ownerPhone, text);
  // one phone can run two clients: the answer is filed under the one the text was about
  const to = res.businessId ?? bid;
  const owner = d.accounts.peek(to)!.state.dataset.business;
  // STOP wins: once their texts are off, only the answer to the STOP itself goes back
  if (owner.ownerTextsOff && res.handled !== "texts_off") return { ...res, queued: false, why: "They texted STOP, so nothing goes to their phone until they text START." };
  const at = localIso(d.clock(), owner.timezone);
  d.accounts.repo.addManualOwnerMessage(to, { id: `om_reply_${at}_${randomUUID().slice(0, 8)}`, at, kind: "reply", text: res.reply });
  return { ...res, queued: true };
}
