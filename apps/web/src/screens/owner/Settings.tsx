import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";
import { fmtMoney, HOLIDAYS_LINE, mondayOf, playbook, type BusinessProfile } from "@qa/engine";
import { useApp, useAccount } from "../../store/app";
import { cx, Toggle } from "../../components/ui";
import { Box, Btn, ConfirmBtn, EmptyRow, PageHead, selectCls, shortDate, smallInputCls, Table, Td, Th, Tr } from "../../components/table";
import { FileDrop, KIND_LABEL, SOURCE_LABEL, toFileIns, type StagedFile } from "../../components/files";
import { hourLabel, WEEKDAYS } from "../../lib/labels";

type Updater = (b: BusinessProfile) => BusinessProfile;

/** Local draft of the business profile; edits are merged into the store 600ms after the last change. */
function useDraft(id: string, b: BusinessProfile) {
  const [draft, setDraft] = useState(b);
  const queue = useRef<Updater[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!queue.current.length) setDraft(b);
  }, [b]);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (!queue.current.length) return;
    const st = useApp.getState();
    const cur = st.accounts[id]?.dataset.business;
    const fns = queue.current;
    queue.current = [];
    if (!cur) return;
    const next = fns.reduce((x, f) => f(x), cur);
    const { id: _ignored, ...patch } = next;
    st.updateBusiness(id, patch);
    st.toast("Saved");
  }, [id]);
  const change = useCallback(
    (f: Updater) => {
      setDraft((d) => f(d));
      queue.current.push(f);
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 600);
    },
    [flush],
  );
  useEffect(() => () => flush(), [flush]);
  return [draft, change] as const;
}

export function Settings() {
  const { a, id } = useAccount();
  if (!a || !id) return null;
  // keyed so switching business starts a fresh draft
  return <SettingsForm key={id} id={id} b={a.dataset.business} />;
}

function SettingsForm({ id, b }: { id: string; b: BusinessProfile }) {
  const { a } = useAccount();
  const [draft, change] = useDraft(id, b);
  const set = <K extends keyof BusinessProfile>(k: K, v: BusinessProfile[K]) => change((x) => ({ ...x, [k]: v }));
  const rescan = useApp((s) => s.rescan);
  const markPaid = useApp((s) => s.markPaid);
  const importFiles = useApp((s) => s.importFiles);
  const removeAccount = useApp((s) => s.removeAccount);
  const reset = useApp((s) => s.reset);
  const toast = useApp((s) => s.toast);
  const [files, setFiles] = useState<StagedFile[]>([]);
  if (!a) return null;
  const v = draft;

  return (
    <div className="flex flex-col gap-6">
      <PageHead title="Settings" sub="Changes save as you type." />

      <Group title="Business & contact" sub="How notes are signed and where replies and hand-offs go.">
        <Grid>
          <Text id="s-name" label="Business name" value={v.name} onChange={(x) => set("name", x)} />
          <Text id="s-owner" label="Owner's full name" value={v.ownerName} onChange={(x) => set("ownerName", x)} />
          <Text id="s-owner-first" label="Owner's first name" hint="Used in the texts we send you." value={v.ownerFirstName} onChange={(x) => set("ownerFirstName", x)} />
          <Text id="s-cell" label="Owner's cell" hint="Hot leads are texted here." type="tel" value={v.ownerPhone ?? ""} onChange={(x) => set("ownerPhone", x || undefined)} />
          <Text id="s-signer" label="Who signs the notes" hint="First name only, e.g. Sarah." value={v.signerName} onChange={(x) => set("signerName", x)} />
          <F id="s-role" label="Their role">
            <select id="s-role" className={cx(selectCls, "w-full")} value={v.signerRole} onChange={(e) => set("signerRole", e.target.value as BusinessProfile["signerRole"])}>
              <option value="office">Office</option>
              <option value="owner">Owner</option>
            </select>
          </F>
          <Text id="s-reply" label="Reply-to email" type="email" value={v.replyTo ?? ""} onChange={(x) => set("replyTo", x || undefined)} />
          <Text id="s-phone" label="Business phone" type="tel" value={v.businessPhone ?? ""} onChange={(x) => set("businessPhone", x || undefined)} />
          <Text
            id="s-mail"
            label="Mailing address (required)"
            hint="The law (CAN-SPAM) requires a real postal address in the footer of every marketing email. No address, no sending."
            value={v.mailingAddress ?? ""}
            onChange={(x) => set("mailingAddress", x || undefined)}
            warn={!v.mailingAddress}
            wide
          />
          <Text id="s-city" label="City" value={v.city ?? ""} onChange={(x) => set("city", x || undefined)} />
          <Text id="s-state" label="State" hint="Two letters. Sets your season." value={v.state ?? ""} onChange={(x) => set("state", x.toUpperCase().slice(0, 2) || undefined)} />
        </Grid>
      </Group>

      <Group title="Voice" sub="How the notes read.">
        <div className="flex flex-col divide-y divide-line">
          <Toggle id="s-price" checked={v.voice.mentionPrice} onChange={(x) => change((d) => ({ ...d, voice: { ...d.voice, mentionPrice: x } }))} label="Mention the original price" sub="Off by default. Bringing up the old number can bring back the sticker shock." />
          <Toggle id="s-options" checked={v.voice.offerOptions} onChange={(x) => change((d) => ({ ...d, voice: { ...d.voice, offerOptions: x } }))} label="Offer smaller options" sub="Lets a note offer to split the job or do the key part first." />
          <Toggle id="s-freelook" checked={v.voice.freeLook ?? playbook(v.trade).freeLook} onChange={(x) => change((d) => ({ ...d, voice: { ...d.voice, freeLook: x } }))} label={'Say "No charge to look"'} sub="Only if you never charge to come out. Off by default where a visit is a paid service call." />
        </div>
        <SwapEditor swaps={v.voice.wordSwaps} onChange={(ws) => change((d) => ({ ...d, voice: { ...d.voice, wordSwaps: ws } }))} />
      </Group>

      <Group title="Pace" sub="When notes go out and who's worth a note. Size and age limits take effect on the next re-scan.">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-2 text-[13px] font-semibold text-ink-2">Send days</legend>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((w, i) => {
              const on = v.sendDays.includes(i);
              return (
                <label
                  key={w}
                  htmlFor={`s-day-${i}`}
                  className={cx(
                    "inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border py-1 pr-4 pl-1.5 text-[14px] font-semibold transition-colors has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent sm:min-h-10",
                    on ? "border-accent-edge bg-accent-soft text-accent-ink" : "border-line-2 bg-surface text-ink-2 hover:border-accent-line hover:bg-accent-wash",
                  )}
                >
                  <input
                    id={`s-day-${i}`}
                    type="checkbox"
                    className="peer sr-only"
                    checked={on}
                    onChange={(e) => change((d) => ({ ...d, sendDays: e.target.checked ? [...new Set([...d.sendDays, i])].sort() : d.sendDays.filter((x) => x !== i) }))}
                  />
                  <span className={cx("grid size-7 place-items-center rounded-full", on ? "bg-accent text-on-accent" : "border border-line-2 bg-surface-2 text-transparent")} aria-hidden="true">
                    <Check size={15} strokeWidth={3} />
                  </span>
                  {w}
                </label>
              );
            })}
          </div>
          <span className="mt-1 text-[12.5px] text-ink-3">{HOLIDAYS_LINE}</span>
          {!v.sendDays.length && <span className="text-[12.5px] text-bad">Pick at least one day, or nothing will go out.</span>}
        </fieldset>
        <Grid>
          <F id="s-win-start" label="Send window starts">
            <select id="s-win-start" className={cx(selectCls, "w-full")} value={v.sendWindow[0]} onChange={(e) => change((d) => ({ ...d, sendWindow: [Number(e.target.value), Math.max(Number(e.target.value) + 1, d.sendWindow[1])] }))}>
              {Array.from({ length: 23 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </F>
          <F id="s-win-end" label="Send window ends">
            <select id="s-win-end" className={cx(selectCls, "w-full")} value={v.sendWindow[1]} onChange={(e) => change((d) => ({ ...d, sendWindow: [Math.min(d.sendWindow[0], Number(e.target.value) - 1), Number(e.target.value)] }))}>
              {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </F>
          <Num id="s-weekly" label="New people per week" hint="Protects your sending reputation and your calendar." value={v.weeklyNewContacts} min={5} max={500} onChange={(x) => set("weeklyNewContacts", x)} />
          <Num id="s-minq" label="Smallest quote worth a note ($)" value={v.minQuoteValue} min={0} max={100000} onChange={(x) => set("minQuoteValue", x)} />
          <Num id="s-minage" label="Wait at least (days) after a quote" hint="Your own follow-up gets first go." value={v.minQuoteAgeDays} min={0} max={365} onChange={(x) => set("minQuoteAgeDays", x)} />
          <Num id="s-maxage" label="Ignore quotes older than (months)" value={v.maxQuoteAgeMonths} min={1} max={120} onChange={(x) => set("maxQuoteAgeMonths", x)} />
        </Grid>
      </Group>

      <Group title="Persistence" sub="How hard we follow up.">
        <Toggle id="s-seasonal" checked={v.persistence.seasonalCheckIn} onChange={(x) => change((d) => ({ ...d, persistence: { ...d.persistence, seasonalCheckIn: x } }))} label="Seasonal check-in" sub="One more note when the job's season comes back around. At most once a year." />
        <Grid>
          <Num id="s-maxnotes" label="Most notes to one person per year" value={v.persistence.maxNotesPerYear} min={1} max={12} onChange={(x) => change((d) => ({ ...d, persistence: { ...d.persistence, maxNotesPerYear: x } }))} />
          <Num
            id="s-holdout"
            label="Held back to measure lift (%)"
            hint="0–20%. These people get no notes, so we can prove what the notes caused."
            value={Math.round(v.persistence.holdoutPct * 100)}
            min={0}
            max={20}
            onChange={(x) => change((d) => ({ ...d, persistence: { ...d.persistence, holdoutPct: x / 100 } }))}
          />
        </Grid>
      </Group>

      <Group title="Open crew weeks" sub="Weeks you have open days. Only then will a note say you have openings.">
        <Text id="s-crewnote" label="What to say about openings" hint='e.g. "a couple of open days next week"' value={v.crewNote ?? ""} onChange={(x) => set("crewNote", x || undefined)} wide />
        <div className="flex flex-col gap-2">
          {v.openCrewWeeks.map((w, i) => (
            <div key={`${w}-${i}`} className="flex items-center gap-2">
              <label htmlFor={`s-week-${i}`} className="sr-only">
                Open week {i + 1}
              </label>
              <input
                id={`s-week-${i}`}
                type="date"
                className={cx(smallInputCls, "max-w-52")}
                value={w}
                onChange={(e) => e.target.value && change((d) => ({ ...d, openCrewWeeks: d.openCrewWeeks.map((x, j) => (j === i ? mondayOf(e.target.value) : x)) }))}
              />
              <span className="min-w-0 text-[12.5px] text-ink-3">week of {shortDate(w)}</span>
              <button type="button" aria-label={`Remove week of ${w}`} onClick={() => change((d) => ({ ...d, openCrewWeeks: d.openCrewWeeks.filter((_, j) => j !== i) }))} className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-ink-3 hover:bg-bad-soft hover:text-bad sm:size-9">
                <X size={15} />
              </button>
            </div>
          ))}
          <div>
            <Btn onClick={() => change((d) => ({ ...d, openCrewWeeks: [...d.openCrewWeeks, mondayOf(a.dataset.asOf)] }))}>
              <Plus size={15} /> Add a week
            </Btn>
          </div>
        </div>
      </Group>

      <Group title="Plan">
        <Grid>
          <F id="s-stage" label="Stage">
            <select id="s-stage" className={cx(selectCls, "w-full")} value={v.plan.stage} onChange={(e) => change((d) => ({ ...d, plan: { ...d.plan, stage: e.target.value as BusinessProfile["plan"]["stage"] } }))}>
              <option value="trial">Free round</option>
              <option value="paying">Paying</option>
              <option value="paused">Paused</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </F>
          <Num id="s-trial" label="Free round size (people)" value={v.plan.trialSize} min={10} max={1000} onChange={(x) => change((d) => ({ ...d, plan: { ...d.plan, trialSize: x } }))} />
          <Num id="s-price" label="Monthly price ($)" value={v.plan.monthlyPrice} min={0} max={10000} onChange={(x) => change((d) => ({ ...d, plan: { ...d.plan, monthlyPrice: x } }))} />
          <F id="s-paidon" label="First paid day">
            <input id="s-paidon" type="date" className={smallInputCls} value={v.plan.paidOn ?? ""} onChange={(e) => change((d) => ({ ...d, plan: { ...d.plan, paidOn: e.target.value || undefined } }))} />
          </F>
        </Grid>
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-3">
          {v.plan.stage !== "paying" && (
            <Btn
              onClick={() => {
                markPaid(id);
                toast("Marked as paying");
              }}
            >
              Mark paid today
            </Btn>
          )}
          <span>
            {v.plan.freeMonths.length ? `${v.plan.freeMonths.length} free month(s) under the guarantee: ${v.plan.freeMonths.map(shortDate).join(", ")}.` : "No free months so far."} {v.plan.stage === "paying" ? `${fmtMoney(v.plan.monthlyPrice)} a month.` : ""}
          </span>
        </div>
      </Group>

      <Group title="Data" sub="The files we've read. Add fresh exports any time; we merge them and look again.">
        <Table minWidth={620} label="Imported files" className="shadow-none!">
          <thead>
            <tr>
              <Th>File</Th>
              <Th>What</Th>
              <Th>From</Th>
              <Th right>Rows</Th>
              <Th right>Used</Th>
              <Th>Read on</Th>
            </tr>
          </thead>
          <tbody>
            {a.dataset.imports.map((f) => (
              <Tr key={f.id}>
                <Td className="max-w-[240px] truncate font-semibold" title={f.fileName}>
                  {f.fileName}
                </Td>
                <Td>{KIND_LABEL[f.kind]}</Td>
                <Td>{SOURCE_LABEL[f.source]}</Td>
                <Td right>{f.rows.toLocaleString("en-US")}</Td>
                <Td right>{f.accepted.toLocaleString("en-US")}</Td>
                <Td className="whitespace-nowrap">{shortDate(f.importedAt)}</Td>
              </Tr>
            ))}
            {!a.dataset.imports.length && <EmptyRow cols={6}>No files yet.</EmptyRow>}
          </tbody>
        </Table>
        <div className="flex flex-wrap gap-2">
          <Btn
            onClick={() => {
              rescan(id);
              toast("Scanned again with your current settings");
            }}
          >
            Re-scan now
          </Btn>
        </div>
        <FileDrop id="s-files" files={files} onChange={setFiles} />
        {files.length > 0 && (
          <div>
            <Btn
              variant="primary"
              disabled={!toFileIns(files).length}
              onClick={() => {
                const ins = toFileIns(files);
                void importFiles(id, ins).then(() => {
                  setFiles([]);
                  toast(`Read ${ins.length} file${ins.length === 1 ? "" : "s"} and scanned again`);
                });
              }}
            >
              Import {toFileIns(files).length} file{toFileIns(files).length === 1 ? "" : "s"}
            </Btn>
          </div>
        )}
      </Group>

      <Group title="Danger zone" danger>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13.5px] text-ink-2">Remove {b.name} and everything we know about it from this device.</span>
            <ConfirmBtn note="Remove this business?" confirmLabel="Yes, remove" onConfirm={() => void removeAccount(id)}>
              Remove business
            </ConfirmBtn>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-[13.5px] text-ink-2">Erase every business and start over.</span>
            <ConfirmBtn note="Erase everything?" confirmLabel="Yes, erase all" onConfirm={() => void reset()}>
              Erase all data
            </ConfirmBtn>
          </div>
        </div>
      </Group>
    </div>
  );
}

/* ------------------------------ form bits ------------------------------ */

function Group({ title, sub, children, danger }: { title: string; sub?: string; children: ReactNode; danger?: boolean }) {
  return (
    <Box className={cx("flex flex-col gap-5 p-5 sm:p-7", danger && "border-bad/30")}>
      <div className="flex flex-col gap-1">
        <h2 className={cx("text-[20px] sm:text-[22px]", danger && "text-bad")}>{title}</h2>
        {sub && <p className="text-[13.5px] text-ink-3">{sub}</p>}
      </div>
      {children}
    </Box>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">{children}</div>;
}

function F({ id, label, hint, children, wide }: { id: string; label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && <span className="text-[12.5px] text-ink-3">{hint}</span>}
    </div>
  );
}

function Text({ id, label, hint, value, onChange, type = "text", warn, wide }: { id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; type?: string; warn?: boolean; wide?: boolean }) {
  return (
    <F id={id} label={label} hint={hint} wide={wide}>
      <input id={id} type={type} className={cx(smallInputCls, warn && "border-warn")} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={warn || undefined} />
    </F>
  );
}

/** Number field that lets you clear and retype without fighting you. */
function Num({ id, label, hint, value, min, max, onChange }: { id: string; label: string; hint?: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);
  return (
    <F id={id} label={label} hint={hint}>
      <input
        id={id}
        inputMode="numeric"
        className={smallInputCls}
        value={text}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(String(value));
        }}
        onChange={(e) => {
          const t = e.target.value.replace(/[^0-9]/g, "");
          setText(t);
          if (t === "") return;
          const n = Math.max(min, Math.min(max, Number(t)));
          if (n !== value) onChange(n);
        }}
      />
    </F>
  );
}

function SwapEditor({ swaps, onChange }: { swaps: [string, string][]; onChange: (s: [string, string][]) => void }) {
  const fmt = (s: [string, string][]) => s.map(([f, t]) => `${f} → ${t}`).join("\n");
  const [text, setText] = useState(fmt(swaps));
  return (
    <F id="s-swaps" label="Word swaps" hint='One per line, like "estimate → quote". We use your words, not ours.'>
      <textarea
        id="s-swaps"
        rows={3}
        className={cx(smallInputCls, "py-2")}
        value={text}
        placeholder={"estimate → quote\nguys → crew"}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = e.target.value
            .split("\n")
            .map((l) => l.split(/\s*(?:→|->|=>|,)\s*/))
            .filter((p) => p.length === 2 && p[0]!.trim() && p[1]!.trim())
            .map((p) => [p[0]!.trim(), p[1]!.trim()] as [string, string]);
          if (JSON.stringify(parsed) !== JSON.stringify(swaps)) onChange(parsed);
        }}
      />
    </F>
  );
}
