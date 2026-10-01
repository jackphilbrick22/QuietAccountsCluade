import { create } from "zustand";
import {
  addDays,
  approveAll as engineApproveAll,
  emptyDataset,
  emptyState,
  find,
  generateSample,
  handoffText,
  markContacted,
  planBatch,
  readFiles,
  simulate as engineSimulate,
  stopSequence,
  type AccountState,
  type BusinessProfile,
  type FileIn,
  type Reply,
  type ReplyIntent,
  type TradeId,
} from "@qa/engine";
import { getPref, load, remove as removeKey, save, setPref } from "../lib/persist";
import { getToken } from "../live/api";

export type Area = "welcome" | "onboarding" | "owner" | "ops" | "live";

export interface View {
  area: Area;
  tab: string;
  /** Detail id within the tab (a lead id, a breakage type...). */
  detail?: string;
}

export interface AccountMeta {
  id: string;
  sample: boolean;
  /** Days of activity that were simulated (not real). */
  simulatedDays: number;
  createdAt: string;
  paused?: boolean;
}

interface Store {
  ready: boolean;
  accounts: Record<string, AccountState>;
  meta: Record<string, AccountMeta>;
  order: string[];
  activeId?: string;
  rev: number;
  view: View;
  busy?: string;
  toastMsg?: { id: number; text: string };

  init(): Promise<void>;
  go(v: Partial<View>): void;
  select(id: string, area?: Area): void;
  toast(text: string): void;
  seedDemo(): Promise<void>;
  createFromSample(trade: TradeId, opts?: { simulateDays?: number; launch?: boolean }): Promise<string>;
  createFromFiles(profile: Partial<BusinessProfile> & { name: string; trade: TradeId }, files: FileIn[]): Promise<string>;
  launch(id: string, opts?: { startOn?: string; limit?: number }): void;
  simulate(id: string, days: number): Promise<void>;
  logOutcome(id: string, replyId: string, outcome: Reply["outcome"], value?: number): void;
  updateBusiness(id: string, patch: Partial<BusinessProfile>): void;
  rescan(id: string): void;
  /** Fold more exported files into an existing account, then re-scan. */
  importFiles(id: string, files: FileIn[]): Promise<void>;
  /** A person read an unclear reply and decided what it means. */
  sortReply(id: string, replyId: string, intent: ReplyIntent): void;
  approveAll(id: string): void;
  setPaused(id: string, paused: boolean): void;
  markPaid(id: string, on?: string): void;
  removeAccount(id: string): Promise<void>;
  reset(): Promise<void>;
}

export const today = (): string => new Date().toISOString().slice(0, 10);
const nowIso = (): string => new Date().toISOString().slice(0, 19);
const tick = () => new Promise<void>((r) => setTimeout(r, 30));

let toastSeq = 0;

function persist(get: () => Store) {
  const s = get();
  void save("index", { order: s.order, activeId: s.activeId, meta: s.meta, view: s.view });
  for (const id of s.order) void save(`acct:${id}`, s.accounts[id]);
}

function persistOne(get: () => Store, id: string) {
  const s = get();
  void save("index", { order: s.order, activeId: s.activeId, meta: s.meta, view: s.view });
  void save(`acct:${id}`, s.accounts[id]);
}

export const useApp = create<Store>((set, get) => ({
  ready: false,
  accounts: {},
  meta: {},
  order: [],
  rev: 0,
  view: { area: "welcome", tab: "today" },

  async init() {
    // Live console (the real server) when asked for by URL, or when the operator last used it and is signed in.
    const hash = typeof location !== "undefined" ? location.hash.replace("#", "") : "";
    const live = hash === "live" || (hash !== "ops" && getPref("mode") === "live" && !!getToken());
    const idx = await load<{ order: string[]; activeId?: string; meta: Record<string, AccountMeta>; view?: View }>("index");
    if (idx?.order?.length) {
      const accounts: Record<string, AccountState> = {};
      for (const id of idx.order) {
        const a = await load<AccountState>(`acct:${id}`);
        if (a) accounts[id] = a;
      }
      const order = idx.order.filter((id) => accounts[id]);
      if (order.length) {
        let view: View = idx.view && idx.view.area !== "onboarding" && idx.view.area !== "live" ? idx.view : { area: "owner", tab: "today" };
        if (hash === "ops") view.area = "ops";
        if (live) view = idx.view?.area === "live" ? idx.view : { area: "live", tab: "clients" };
        set({ accounts, order, meta: idx.meta ?? {}, activeId: idx.activeId && accounts[idx.activeId] ? idx.activeId : order[0], view, ready: true, rev: 1 });
        return;
      }
    }
    set({ ready: true, view: live ? (idx?.view?.area === "live" ? idx.view : { area: "live", tab: "clients" }) : get().view });
  },

  go(v) {
    set((s) => ({ view: { ...s.view, ...v, detail: v.detail ?? (v.tab && v.tab !== s.view.tab ? undefined : v.detail ?? s.view.detail) } }));
    if (v.area) {
      // remember Live vs Demo, and keep the URL bookmarkable (#live / #ops)
      setPref("mode", v.area === "live" ? "live" : "demo");
      try {
        const hash = v.area === "live" ? "#live" : v.area === "ops" ? "#ops" : "";
        if (location.hash !== hash) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
      } catch {
        /* sandboxed frames can refuse history changes */
      }
    }
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    void save("index", { order: get().order, activeId: get().activeId, meta: get().meta, view: get().view });
  },

  select(id, area) {
    set((s) => ({ activeId: id, view: { area: area ?? s.view.area, tab: area === "ops" ? "overview" : "today" } }));
    persist(get);
  },

  toast(text) {
    const id = ++toastSeq;
    set({ toastMsg: { id, text } });
    setTimeout(() => {
      if (get().toastMsg?.id === id) set({ toastMsg: undefined });
    }, 2600);
  },

  async createFromSample(trade, opts = {}) {
    const simDays = opts.simulateDays ?? 0;
    const start = addDays(today(), -simDays);
    set({ busy: "Building a sample business…" });
    await tick();
    const sample = generateSample({ trade, asOf: start });
    const id = `${sample.business.id}-${Date.now().toString(36)}`;
    const business: BusinessProfile = { ...sample.business, id };
    const state = emptyState(emptyDataset(business, start), `${start}T08:00:00`);
    set({ busy: "Reading the files…" });
    await tick();
    readFiles(state, sample.files, `${start}T08:00:00`);
    set({ busy: "Finding what's on the table…" });
    await tick();
    find(state, `${start}T08:01:00`);
    if (opts.launch) {
      planBatch(state, `${start}T08:02:00`, { startOn: nextSendDay(state, start), limitPeople: business.plan.trialSize, approve: true });
      business.plan.trialStartedOn = start;
    }
    if (simDays > 0) {
      set({ busy: `Playing ${simDays} days forward…` });
      await tick();
      engineSimulate(state, start, simDays);
    }
    const meta: AccountMeta = { id, sample: true, simulatedDays: simDays, createdAt: nowIso() };
    set((s) => ({ accounts: { ...s.accounts, [id]: state }, meta: { ...s.meta, [id]: meta }, order: [...s.order, id], activeId: s.activeId ?? id, busy: undefined, rev: s.rev + 1 }));
    persistOne(get, id);
    return id;
  },

  async seedDemo() {
    set({ busy: "Setting up three sample businesses…" });
    await tick();
    const tree = await get().createFromSample("tree", { simulateDays: 26, launch: true });
    const septic = await get().createFromSample("septic", { simulateDays: 75, launch: true });
    // septic: finished the free round and paid — second month running
    const sa = get().accounts[septic]!;
    const paidOn = addDays(today(), -40);
    sa.dataset.business.plan = { ...sa.dataset.business.plan, stage: "paying", paidOn };
    await get().createFromSample("lawn", { simulateDays: 0, launch: false });
    set({ activeId: tree, busy: undefined, view: { area: "owner", tab: "today" }, rev: get().rev + 1 });
    persist(get);
  },

  async createFromFiles(profile, files) {
    const id = `biz-${Date.now().toString(36)}`;
    const t = today();
    const business: BusinessProfile = {
      ...defaultBusiness(profile.trade),
      ...profile,
      id,
      createdOn: t,
    };
    const state = emptyState(emptyDataset(business, t), nowIso());
    set({ busy: "Reading your files…" });
    await tick();
    readFiles(state, files, nowIso());
    set({ busy: "Finding what's on the table…" });
    await tick();
    find(state, nowIso());
    const meta: AccountMeta = { id, sample: false, simulatedDays: 0, createdAt: nowIso() };
    set((s) => ({ accounts: { ...s.accounts, [id]: state }, meta: { ...s.meta, [id]: meta }, order: [...s.order, id], activeId: id, busy: undefined, rev: s.rev + 1 }));
    persistOne(get, id);
    return id;
  },

  launch(id, opts = {}) {
    const a = get().accounts[id];
    if (!a) return;
    const b = a.dataset.business;
    const startOn = opts.startOn ?? nextSendDay(a, a.dataset.asOf);
    const limit = opts.limit ?? (b.plan.stage === "trial" ? b.plan.trialSize : undefined);
    planBatch(a, `${a.dataset.asOf}T09:00:00`, { startOn, limitPeople: limit, approve: true });
    if (b.plan.stage === "trial" && !b.plan.trialStartedOn) b.plan.trialStartedOn = a.dataset.asOf;
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  async simulate(id, days) {
    const a = get().accounts[id];
    if (!a) return;
    set({ busy: `Playing ${days} days forward…` });
    await tick();
    const from = addDays(a.dataset.asOf, 1);
    engineSimulate(a, from, days);
    set((s) => ({ busy: undefined, meta: { ...s.meta, [id]: { ...s.meta[id]!, simulatedDays: (s.meta[id]?.simulatedDays ?? 0) + days } }, rev: s.rev + 1 }));
    persistOne(get, id);
  },

  logOutcome(id, replyId, outcome, value) {
    const a = get().accounts[id];
    if (!a) return;
    const at = `${a.dataset.asOf}T${new Date().toISOString().slice(11, 19)}`;
    markContacted(a, replyId, at, outcome, value);
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  updateBusiness(id, patch) {
    const a = get().accounts[id];
    if (!a) return;
    a.dataset.business = { ...a.dataset.business, ...patch };
    // re-render notes that haven't gone out with the new voice
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  rescan(id) {
    const a = get().accounts[id];
    if (!a) return;
    find(a, `${a.dataset.asOf}T09:00:00`);
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  async importFiles(id, files) {
    const a = get().accounts[id];
    if (!a || !files.length) return;
    set({ busy: "Reading your files…" });
    await tick();
    const now = `${a.dataset.asOf}T${new Date().toISOString().slice(11, 19)}`;
    readFiles(a, files, now);
    set({ busy: "Finding what's on the table…" });
    await tick();
    find(a, now);
    set((s) => ({ busy: undefined, rev: s.rev + 1 }));
    persistOne(get, id);
  },

  sortReply(id, replyId, intent) {
    const a = get().accounts[id];
    const r = a?.replies.find((x) => x.id === replyId);
    if (!a || !r) return;
    const at = `${a.dataset.asOf}T${new Date().toISOString().slice(11, 19)}`;
    const c = a.dataset.customers.find((x) => x.id === r.customerId);
    const name = c?.name ?? r.from;
    r.intent = intent;
    r.confidence = 1;
    const wants = intent === "wants_it" || intent === "wants_price" || intent === "question";
    if (c) stopSequence(a, c.id);
    if (wants) {
      r.status = "handed_off";
      r.handedOffAt = at;
      a.ownerMessages.push({ id: `om-${replyId}-${Date.now().toString(36)}`, at, kind: "handoff", text: handoffText(a, r), refs: c ? [{ kind: "customer", id: c.id }] : undefined });
    } else {
      r.status = "done";
      if ((intent === "stop" || intent === "complaint") && r.from) a.suppressions[r.from.toLowerCase()] = intent === "complaint" ? "complained" : "unsubscribed";
    }
    a.events.push({
      id: `ev-sort-${replyId}-${Date.now().toString(36)}`,
      at,
      agent: wants ? "dispatcher" : "inbox",
      kind: wants ? "win" : "action",
      title: wants ? `${name} sorted by a person — sent to the owner` : `${name} sorted by a person`,
      detail: `Marked as ${intent.replace(/_/g, " ")}.`,
      refs: c ? [{ kind: "customer", id: c.id }] : undefined,
    });
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  approveAll(id) {
    const a = get().accounts[id];
    if (!a) return;
    engineApproveAll(a, `${a.dataset.asOf}T09:00:00`);
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  setPaused(id, paused) {
    const a = get().accounts[id];
    if (a && paused) for (const t of a.touches) if (t.status === "approved") t.status = "planned";
    // resuming puts the held notes back on the schedule
    if (a && !paused) engineApproveAll(a, `${a.dataset.asOf}T09:00:00`);
    set((s) => ({ meta: { ...s.meta, [id]: { ...s.meta[id]!, paused } }, rev: s.rev + 1 }));
    persistOne(get, id);
  },

  markPaid(id, on) {
    const a = get().accounts[id];
    if (!a) return;
    a.dataset.business.plan = { ...a.dataset.business.plan, stage: "paying", paidOn: on ?? a.dataset.asOf };
    set((s) => ({ rev: s.rev + 1 }));
    persistOne(get, id);
  },

  async removeAccount(id) {
    set((s) => {
      const { [id]: _a, ...accounts } = s.accounts;
      const { [id]: _m, ...meta } = s.meta;
      const order = s.order.filter((x) => x !== id);
      return { accounts, meta, order, activeId: s.activeId === id ? order[0] : s.activeId, rev: s.rev + 1, view: order.length ? s.view : { area: "welcome", tab: "today" } };
    });
    await removeKey(`acct:${id}`);
    persist(get);
  },

  async reset() {
    for (const id of get().order) await removeKey(`acct:${id}`);
    await removeKey("index");
    set({ accounts: {}, meta: {}, order: [], activeId: undefined, view: { area: "welcome", tab: "today" }, rev: get().rev + 1 });
  },
}));

export function nextSendDay(a: AccountState, from: string): string {
  const days = a.dataset.business.sendDays;
  let d = addDays(from, 1);
  for (let i = 0; i < 14; i++) {
    const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (days.includes(wd)) return d;
    d = addDays(d, 1);
  }
  return addDays(from, 1);
}

export function defaultBusiness(trade: TradeId): BusinessProfile {
  return {
    id: "",
    name: "",
    trade,
    otherTrades: [],
    software: "unknown",
    ownerName: "",
    ownerFirstName: "",
    signerName: "",
    signerRole: "office",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/New_York",
    sendDays: [1, 2, 3, 4, 5],
    sendWindow: [7, 10],
    blackoutWeeks: [],
    minQuoteValue: 300,
    minQuoteAgeDays: 21,
    maxQuoteAgeMonths: 36,
    weeklyNewContacts: 75,
    openCrewWeeks: [],
    autoAck: false,
    voice: { mentionPrice: false, offerOptions: true, wordSwaps: [] },
    persistence: { seasonalCheckIn: true, maxNotesPerYear: 5, holdoutPct: 0 },
    channels: { email: "live", postcard: "coming_soon", sms: "coming_soon", call_task: "ready", voicemail: "coming_soon", retarget: "coming_soon" },
    plan: { stage: "trial", trialSize: 150, monthlyPrice: 497, freeMonths: [] },
    createdOn: today(),
  };
}

/** Subscribe a component to account changes. */
export function useAccount(): { a?: AccountState; id?: string; meta?: AccountMeta; rev: number } {
  const activeId = useApp((s) => s.activeId);
  const a = useApp((s) => (s.activeId ? s.accounts[s.activeId] : undefined));
  const meta = useApp((s) => (s.activeId ? s.meta[s.activeId] : undefined));
  const rev = useApp((s) => s.rev);
  return { a, id: activeId, meta, rev };
}
