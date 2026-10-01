import type { BusinessProfile } from "@qa/engine";
import type { SequencerProvider } from "../contracts.ts";
import { ProviderError } from "../contracts.ts";
import { localIso } from "./clock.ts";
import { holdPlatform, type Deps } from "./ops.ts";

/**
 * A client's sending inboxes in Instantly (the sequencer). Its notes go only from its own inboxes, each named for it
 * ("Sarah at Capital City Landscaping") and in no campaign this server didn't make; one inbox sends for one client.
 * Jack's cold email runs in the same workspace, from other inboxes and in other campaigns: whatever comes from there
 * is logged and left alone.
 */

/** A refused client's inboxes are checked again after this long; a change in Settings checks them at once. */
const RECHECK_MS = 15 * 60_000;

/**
 * Whether a client still holds its inboxes, so no other client may have them: until it's cancelled. One that lets
 * them go forgets its check (holdSending's cancel): another client may have them renamed, so if it ever takes them
 * back they're named for it again.
 */
export function holdsInboxes(b: BusinessProfile): boolean {
  return b.plan.stage !== "cancelled";
}

/** The first of `inboxes` another client still holds, and that client's name. */
export function inboxTaken(d: Deps, bid: string, inboxes: readonly string[]): { inbox: string; by: string } | undefined {
  for (const other of d.accounts.repo.listBusinesses()) {
    if (other.id === bid || !holdsInboxes(other.profile)) continue;
    const inbox = inboxes.find((x) => other.profile.fromEmails?.includes(x));
    if (inbox) return { inbox, by: other.profile.name };
  }
  return undefined;
}

/**
 * Why a homeowner can't be answered from the inbox their reply came in on, if they can't: it sends for another client
 * now, named for that client, so the answer would go out under the other business's name.
 */
export function answerRefused(d: Deps, bid: string, inbox: string): string | undefined {
  const taken = inboxTaken(d, bid, [inbox.trim().toLowerCase()]);
  return taken && `${taken.inbox} sends for ${taken.by} now, and one inbox sends for one client: answer them by hand`;
}

/** Why this client can't be planned: with Instantly, it has no inbox of its own to send from. */
export function noInbox(d: Deps, b: BusinessProfile): string | undefined {
  if (d.email.kind !== "sequencer" || b.fromEmails?.length) return undefined;
  return "Add this client's own sending inbox first (Settings, “Notes come from (inboxes)”). In Instantly its notes go only from its own inboxes.";
}

const clean = (s?: string) => (s ?? "").replace(/\s+/g, " ").trim();

/** The name on a client's inboxes: its From name (first word, then the rest), else the signer "at <business>". */
export function senderName(b: BusinessProfile): { first: string; last: string } {
  const from = clean(b.fromName);
  if (!from) return { first: clean(b.signerName), last: `at ${clean(b.name)}` };
  const [first, ...rest] = from.split(" ");
  return { first: first!, last: rest.join(" ") };
}

/** The clients that send from this inbox (a cancelled one too: late replies to its notes still come in on it). */
export function clientsOn(d: Deps, inbox: string): string[] {
  const x = inbox.trim().toLowerCase();
  return d.accounts.repo.listBusinesses().filter((b) => b.profile.fromEmails?.includes(x)).map((b) => b.id);
}

/**
 * Why an event from Instantly is cold email and none of any client's business, if it is: it came in a campaign this
 * server didn't make, or (with no campaign on it) at an inbox no client sends from or sent from before (one taken off
 * in Settings still gets the replies, and the stops, to the notes it sent). It's logged and nothing more.
 */
export function coldEvent(d: Deps, where: { campaignId?: string; inbox?: string }): string | undefined {
  if (d.email.kind !== "sequencer") return undefined;
  if (where.campaignId) return d.accounts.repo.campaign(d.email.name, where.campaignId) ? undefined : `campaign ${where.campaignId} isn't one this server made`;
  const x = where.inbox?.trim().toLowerCase();
  if (x) return d.accounts.repo.listBusinesses().some((b) => b.profile.fromEmails?.includes(x) || b.profile.pastInboxes?.includes(x)) ? undefined : `${where.inbox} isn't any client's inbox`;
  return undefined;
}

/**
 * Before a client's notes go out (handed to Instantly, or its campaigns turned back on): it has inboxes of its own
 * that no other client holds, in no campaign this server didn't make, each named for it and read back; and the
 * campaigns made for it earlier carry its current send days, window, timezone and inboxes. Checked before the first
 * activation, then again whenever the inboxes, the signer or the name change; another client holding one of them is
 * looked at every time. A refusal is kept on the client (the console and the review queue say why) and holds its
 * notes like a pause; Instantly out of reach waits a minute. A paused or cancelled client has nothing to check: its
 * hold already says why nothing goes.
 */
export async function readyToSend(d: Deps, bid: string, seq: SequencerProvider): Promise<boolean> {
  const l = d.accounts.peek(bid);
  if (!l) return false;
  const b = l.state.dataset.business;
  if (b.plan.stage === "cancelled" || b.plan.stage === "paused" || l.paused) return true;
  return (await checkInboxes(d, bid, seq)) && (await updateCampaigns(d, bid, seq));
}

async function checkInboxes(d: Deps, bid: string, seq: SequencerProvider): Promise<boolean> {
  const s = d.accounts.peek(bid)!.state;
  const b = s.dataset.business;
  const inboxes = b.fromEmails ?? [];
  const name = senderName(b);
  const key = JSON.stringify([inboxes, name.first, name.last]);
  const was = b.senders;
  const at = localIso(d.clock(), b.timezone);
  // another client holding one of them is looked at every time (it's local): a restore brings that about with nothing
  // changed here
  const taken = inboxTaken(d, bid, inboxes);
  if (was?.key === key && (was.refused ? Date.parse(`${at}Z`) - Date.parse(`${was.at}Z`) < RECHECK_MS : !taken)) return !was.refused;
  // nothing of theirs is in Instantly or waiting to go: checked when there is
  if (!was && !d.accounts.repo.campaignsOf(seq.name, bid).length && !s.touches.some((t) => t.status === "approved")) return true;
  let refused = !inboxes.length ? "it has no sending inbox of its own; add one in Settings" : taken ? `${taken.inbox} already sends for ${taken.by}, and one inbox sends for one client` : undefined;
  try {
    refused ??= await nameInboxes(d, seq, bid, inboxes, name);
  } catch (e) {
    d.log(`[senders] ${bid}: couldn't check its inboxes in ${seq.name}: ${(e as Error).message}`);
    return false;
  }
  const before = was?.refused;
  await d.accounts.withAccount(bid, (st) => {
    st.dataset.business.senders = { key, at, ...(refused ? { refused } : {}) };
    if (refused && refused !== before) st.events.push({ id: `ev_senders_${at}`, at, agent: "guard", kind: "warning", title: "Nothing goes out for this client until its inboxes are fixed", detail: `${refused}.` });
    if (!refused) st.events.push({ id: `ev_senders_${at}`, at, agent: "sender", kind: "action", title: `Its inboxes send as “${clean(`${name.first} ${name.last}`)}” in Instantly`, detail: `${inboxes.join(", ")}: name set and read back, in no campaign this server didn't make.` });
  });
  // one open alert at most, with the reason as it is now
  if (!refused || refused !== before) closeInboxAlerts(d, bid);
  if (refused && refused !== before) d.accounts.repo.addAlert({ businessId: bid, at: d.clock().toISOString(), kind: "senders", title: `${b.name}: nothing goes out until its inboxes are fixed`, detail: `${refused}. Checked again within 15 minutes, or as soon as Settings change.` });
  return !refused;
}

/** Closes the client's open alerts about its inboxes in Needs a person: fixed, or no longer anyone's to fix (a cancel). */
export function closeInboxAlerts(d: Deps, bid: string): void {
  for (const a of d.accounts.repo.openAlerts(bid)) if (a.kind === "senders") d.accounts.repo.finishAlert(bid, a.seq, d.clock().toISOString());
}

/**
 * Each inbox: in no campaign this server didn't make and none another client still sends in (looked at first, so a
 * cold campaign's sender, or another client's, is never renamed), then named for the client and read back. Why one
 * can't send for it, if one can't. Instantly out of reach throws.
 */
async function nameInboxes(d: Deps, seq: SequencerProvider, bid: string, inboxes: string[], name: { first: string; last: string }): Promise<string | undefined> {
  const want = clean(`${name.first} ${name.last}`);
  // the client a campaign was made for, when it's another one that still holds its inboxes and sends (a held one's
  // campaigns get its new inboxes before they restart)
  const otherClient = (id: string) => {
    const by = d.accounts.repo.campaign(seq.name, id)?.businessId;
    const b = by && by !== bid ? d.accounts.peek(by)?.state.dataset.business : undefined;
    return b && holdsInboxes(b) && !b.platformPaused ? b : undefined;
  };
  for (const inbox of inboxes) {
    try {
      const campaigns = await seq.inboxCampaigns(inbox);
      const cold = campaigns.find((c) => !d.accounts.repo.campaign(seq.name, c.id));
      if (cold) return `${inbox} is in “${cold.name || cold.id}”, a campaign this server didn't make; take it out in Instantly, since client inboxes never send cold email`;
      // moved here from another client: its campaign lets go of it first (its own update, as its Settings changed), or
      // that client's notes would go out under this one's name
      for (const c of campaigns) {
        const by = otherClient(c.id);
        if (by) return `${inbox} is still in “${c.name || c.id}”, ${by.name}'s campaign; it sends for this client once that campaign stops sending from it`;
      }
      await seq.setInboxName(inbox, name);
      const got = await seq.inboxName(inbox);
      if (clean(got.first) !== name.first || clean(got.last) !== name.last) return `${inbox} reads “${clean(`${got.first} ${got.last}`)}” in Instantly, not “${want}”`;
    } catch (e) {
      if (!(e instanceof ProviderError) || e.retryable || !e.status) throw e;
      return e.status === 404 ? `Instantly has no inbox ${inbox}; connect it there first` : `Instantly wouldn't name ${inbox} (${e.message})`;
    }
  }
  return undefined;
}

/**
 * A campaign is made once, so a later change to the send days, window, timezone, pace or inboxes goes to every
 * campaign made for the client before, once per change. False until they all have it (tried again next minute).
 * Until a new list of inboxes is there, its campaigns are held: they'd go on sending from an inbox it no longer has.
 */
async function updateCampaigns(d: Deps, bid: string, seq: SequencerProvider): Promise<boolean> {
  const repo = d.accounts.repo;
  const b = d.accounts.peek(bid)!.state.dataset.business;
  const inboxes = b.fromEmails ?? [];
  const key = JSON.stringify([b.sendDays, b.sendWindow, b.timezone, b.weeklyNewContacts, inboxes]);
  const was = repo.mark(bid, "campaigns");
  if (was === key) return true;
  const campaigns = repo.campaignsOf(seq.name, bid);
  try {
    for (const c of campaigns)
      await seq.updateCampaign(b, c.id, { instant: c.kind === "instant" }).catch((e: unknown) => {
        // deleted in Instantly: nothing there to update
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
      });
  } catch (e) {
    d.log(`[senders] ${bid}: couldn't update its campaigns in ${seq.name}: ${(e as Error).message}`);
    // a new list, or none sent yet (campaigns made back when clients sent from the server's pool)
    const moved = !was || JSON.stringify((JSON.parse(was) as unknown[]).at(-1)) !== JSON.stringify(inboxes);
    if (moved && !b.platformPaused) await holdPlatform(d, bid, "an inbox change its campaigns in Instantly don't have yet");
    await d.accounts.withAccount(bid, (s) => {
      const at = localIso(d.clock(), s.dataset.business.timezone);
      const id = `ev_campaigns_${at.slice(0, 10)}`;
      if (!s.events.some((ev) => ev.id === id)) s.events.push({ id, at, agent: "guard", kind: "warning", title: "Couldn't update this client's campaigns in Instantly — nothing new goes out until they are; retrying every minute", detail: (e as Error).message });
    });
    return false;
  }
  repo.setMark(bid, "campaigns", key);
  if (campaigns.length)
    await d.accounts.withAccount(bid, (s) => {
      const at = localIso(d.clock(), s.dataset.business.timezone);
      s.events.push({ id: `ev_campaigns_${at}`, at, agent: "sender", kind: "action", title: `Updated ${campaigns.length === 1 ? "its campaign" : `its ${campaigns.length} campaigns`} in Instantly`, detail: "Send days, hours, timezone and inboxes as they are in Settings now." });
    });
  return true;
}
