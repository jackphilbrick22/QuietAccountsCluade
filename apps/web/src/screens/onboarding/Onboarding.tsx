import { useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { TRADE_OPTIONS, type SourceSystem, type TradeId } from "@qa/engine";
import { useApp } from "../../store/app";
import { SOFTWARE_GUIDES } from "../../content/software";
import { cx, Wordmark } from "../../components/ui";
import { Box, Btn, selectCls, smallInputCls } from "../../components/table";
import { FileDrop, toFileIns, type StagedFile } from "../../components/files";

export function Onboarding() {
  const go = useApp((s) => s.go);
  const order = useApp((s) => s.order);
  const createFromFiles = useApp((s) => s.createFromFiles);
  const createFromSample = useApp((s) => s.createFromSample);
  const select = useApp((s) => s.select);

  const [trade, setTrade] = useState<TradeId>("tree");
  const [software, setSoftware] = useState<SourceSystem>("jobber");
  const [name, setName] = useState("");
  const [first, setFirst] = useState("");
  const [signer, setSigner] = useState("");
  const [role, setRole] = useState<"owner" | "office">("office");
  const [address, setAddress] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [tried, setTried] = useState(false);

  const guide = SOFTWARE_GUIDES.find((g) => g.id === software) ?? SOFTWARE_GUIDES[SOFTWARE_GUIDES.length - 1]!;
  const ready = toFileIns(files);
  const missing = [!name.trim() && "business name", !first.trim() && "your first name", !ready.length && "at least one file"].filter(Boolean) as string[];

  const submit = async () => {
    setTried(true);
    if (missing.length) return;
    const newId = await createFromFiles(
      {
        name: name.trim(),
        trade,
        software,
        ownerName: first.trim(),
        ownerFirstName: first.trim().split(/\s+/)[0]!,
        signerName: (signer.trim() || first.trim()).split(/\s+/)[0]!,
        signerRole: signer.trim() && signer.trim().toLowerCase() !== first.trim().toLowerCase() ? role : "owner",
        mailingAddress: address.trim() || undefined,
      },
      ready,
    );
    select(newId, "owner");
    go({ area: "owner", tab: "drawer" });
  };

  const trySample = async () => {
    const newId = await createFromSample(trade, { launch: false });
    select(newId, "owner");
    go({ area: "owner", tab: "drawer" });
  };

  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-4 pt-5 pb-16 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Wordmark />
          <Btn variant="ghost" onClick={() => go(order.length ? { area: "owner", tab: "today" } : { area: "welcome", tab: "today" })}>
            <ArrowLeft size={15} /> Back
          </Btn>
        </header>

        <div className="flex flex-col gap-1">
          <h1 className="font-body text-[24px] font-bold tracking-tight">Find the money in your quotes</h1>
          <p className="text-[14px] text-ink-2">
            Three steps, about four minutes. Nothing goes out until you say so.{" "}
            <button type="button" className="cursor-pointer font-semibold text-accent-ink underline underline-offset-2" onClick={() => void trySample()}>
              No files handy? Use a sample
            </button>
          </p>
        </div>

        <Step n={1} title="Your business">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <F id="ob-trade" label="Trade">
              <select id="ob-trade" className={cx(selectCls, "w-full")} value={trade} onChange={(e) => setTrade(e.target.value as TradeId)}>
                {TRADE_OPTIONS.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </F>
            <F id="ob-software" label="Software you quote in">
              <select id="ob-software" className={cx(selectCls, "w-full")} value={software} onChange={(e) => setSoftware(e.target.value as SourceSystem)}>
                {SOFTWARE_GUIDES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </F>
            <F id="ob-name" label="Business name" error={tried && !name.trim()}>
              <input id="ob-name" className={smallInputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ridgeline Tree Co." autoComplete="organization" />
            </F>
            <F id="ob-first" label="Your first name" error={tried && !first.trim()}>
              <input id="ob-first" className={smallInputCls} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Dave" autoComplete="given-name" />
            </F>
            <F id="ob-signer" label="Who signs the notes" hint="Leave blank to sign them yourself.">
              <div className="flex gap-2">
                <input id="ob-signer" className={smallInputCls} value={signer} onChange={(e) => setSigner(e.target.value)} placeholder="Sarah" />
                <label htmlFor="ob-role" className="sr-only">
                  Their role
                </label>
                <select id="ob-role" className={selectCls} value={role} onChange={(e) => setRole(e.target.value as "owner" | "office")}>
                  <option value="office">Office</option>
                  <option value="owner">Owner</option>
                </select>
              </div>
            </F>
            <F id="ob-address" label="Mailing address" hint="Required at the bottom of every email by law (CAN-SPAM). You can add it later.">
              <input id="ob-address" className={smallInputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="14 Mill Rd, Concord, NH 03301" autoComplete="street-address" />
            </F>
          </div>
        </Step>

        <Step n={2} title={`Export from ${guide.label}`}>
          <p className="text-[13px] text-ink-3">{guide.note}</p>
          <div className="flex flex-col gap-3">
            <div className="rounded-md border border-line bg-bg p-3">
              <p className="text-[13.5px] font-bold">Main file: {guide.main.title}</p>
              <ol className="mt-1.5 list-decimal pl-5 text-[13.5px] text-ink-2">
                {guide.main.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              {guide.main.heads && <p className="mt-2 text-[12.5px] text-warn">{guide.main.heads}</p>}
            </div>
            {guide.extras.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[13px] font-semibold text-ink-2">These make the scan sharper (optional):</p>
                <ul className="divide-y divide-line rounded-md border border-line bg-surface">
                  {guide.extras.map((x) => (
                    <li key={x.title} className="flex flex-col gap-0.5 px-3 py-2 text-[13px]">
                      <span className="font-semibold">
                        {x.title} <span className="font-normal text-ink-3">· {x.steps.join(" · ")}</span>
                      </span>
                      <span className="text-ink-3">{x.why}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <FileDrop id="ob-files" files={files} onChange={setFiles} />
          {tried && !ready.length && <p className="text-[13px] text-bad">Add at least one exported file.</p>}
        </Step>

        <Step n={3} title="Find my money">
          <p className="text-[13.5px] text-ink-2">We read the files, clean them into one customer list, and show you every quote and past customer worth a follow-up, with a careful estimate of what comes back. Nothing is sent.</p>
          {tried && missing.length > 0 && <p className="text-[13px] text-bad">Still need: {missing.join(", ")}.</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Btn variant="primary" onClick={() => void submit()}>
              Find my money <ArrowRight size={15} />
            </Btn>
            <button type="button" className="cursor-pointer text-[13.5px] font-semibold text-ink-2 underline underline-offset-2 hover:text-ink" onClick={() => void trySample()}>
              No files handy? Use a sample {TRADE_OPTIONS.find((t) => t.id === trade)?.label.toLowerCase()} company
            </button>
          </div>
        </Step>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Box className="flex flex-col gap-3 p-4 sm:p-5">
      <h2 className="flex items-center gap-2.5 font-body text-[16px] font-bold tracking-normal">
        <span className="num grid size-6 shrink-0 place-items-center rounded-full bg-navy text-[12.5px] text-on-navy">{n}</span>
        {title}
      </h2>
      {children}
    </Box>
  );
}

function F({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: boolean; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={cx("text-[12.5px] font-semibold", error ? "text-bad" : "text-ink-2")}>
        {label}
        {error ? " (required)" : ""}
      </label>
      {children}
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </div>
  );
}
