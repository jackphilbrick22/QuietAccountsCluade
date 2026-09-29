import { ArrowRight, FileSpreadsheet, LayoutGrid, MailCheck, PhoneCall } from "lucide-react";
import { CLAIMS } from "@qa/engine";
import { useApp } from "../store/app";
import { Button, Card, Wordmark } from "../components/ui";

const STEPS = [
  { icon: FileSpreadsheet, title: "Drop in your quotes", body: "From Jobber, Housecall Pro, ServiceTitan, QuickBooks or a spreadsheet. About four minutes." },
  { icon: MailCheck, title: "We work every one of them", body: "Short notes from your office about their actual job. Every reply read, every stop honored." },
  { icon: PhoneCall, title: "You take the calls", body: "When someone wants the work, you get a text with everything you need to call them back." },
];

export function Welcome() {
  const go = useApp((s) => s.go);
  const seedDemo = useApp((s) => s.seedDemo);
  const order = useApp((s) => s.order);
  const facts = CLAIMS.filter((c) => ["jobber-two-reminders", "hcp-not-retroactive", "arbostar-2025-tree-conversion"].includes(c.id));
  return (
    <div className="min-h-full bg-bg">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 px-4 pt-6 pb-16 sm:px-6">
        <header className="flex items-center justify-between gap-3">
          <Wordmark />
          <div className="flex gap-1">
            {order.length > 0 && (
              <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => go({ area: "owner", tab: "today" })}>
                My account
              </Button>
            )}
            <Button variant="ghost" size="sm" aria-label="Operator console" className="whitespace-nowrap" onClick={() => (order.length ? go({ area: "ops", tab: "overview" }) : void seedDemo().then(() => go({ area: "ops", tab: "overview" })))}>
              <LayoutGrid size={15} /> <span className="hidden sm:inline">Operator console</span>
              <span className="sm:hidden">Ops</span>
            </Button>
          </div>
        </header>

        <section className="grid items-center gap-10 lg:grid-cols-[1.15fr_1fr]">
          <div className="flex flex-col gap-6">
            <span className="eyebrow">For tree, lawn, septic, fence, concrete and wash companies</span>
            <h1 className="text-[44px] leading-[1.02] font-extrabold sm:text-[62px]">
              Nothing left <span className="text-accent">on the table.</span>
            </h1>
            <p className="max-w-[54ch] text-[17.5px] text-ink-2">
              Your quotes and past customers are full of work you already paid to find. Quotes nobody answered, yeses that never got scheduled, customers who never came back. Quiet Accounts finds every one, follows up from your office, and texts you the ones who want the work.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button size="lg" onClick={() => go({ area: "onboarding", tab: "trade" })}>
                Find my money <ArrowRight size={18} />
              </Button>
              <Button size="lg" variant="secondary" onClick={() => void seedDemo()}>
                See it with a sample tree company
              </Button>
            </div>
            <p className="text-[13.5px] text-ink-3">First 150 free. No card, no contract, no sales call. Any month nobody asks for a price or a date, you don't pay.</p>
          </div>

          <Card className="flex flex-col gap-4 p-5 shadow-lift sm:p-6">
            <span className="eyebrow">What a tree company's drawer looks like</span>
            {[
              ["Quotes nobody answered", 414, "$1.03M"],
              ["Quotes filed away", 389, "$857k"],
              ["Hired you once, never came back", 610, "$891k"],
              ["Due for service again", 124, "$126k"],
              ["Said yes, never got scheduled", 5, "$22.8k"],
            ].map(([label, n, v]) => (
              <div key={label as string} className="flex items-center justify-between gap-3 border-t border-line pt-3 first:border-t-0 first:pt-0">
                <span className="flex min-w-0 flex-col">
                  <span className="font-semibold">{label}</span>
                  <span className="num text-[12.5px] text-ink-3">{(n as number).toLocaleString("en-US")} people</span>
                </span>
                <span className="num font-display text-[20px] font-bold">{v}</span>
              </div>
            ))}
            <p className="text-[12px] text-ink-3">From the sample business: 3 years of quotes from a two-crew tree service on Jobber. Yours will show your own numbers.</p>
          </Card>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <Card key={s.title} className="flex flex-col gap-2 p-5">
              <span className="flex items-center gap-2 text-accent">
                <s.icon size={20} />
                <span className="font-mono text-[11px] tracking-[0.1em] uppercase">Step {i + 1}</span>
              </span>
              <span className="font-display text-[18px] font-bold">{s.title}</span>
              <span className="text-[14px] text-ink-2">{s.body}</span>
            </Card>
          ))}
        </section>

        <section className="flex flex-col gap-4">
          <h2 className="text-[24px] font-bold">Why the money is still there</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {facts.map((f) => (
              <Card key={f.id} className="flex flex-col gap-2 p-5">
                <p className="text-[15px] font-semibold">{f.text}</p>
                <p className="mt-auto text-[12px] text-ink-3">{f.source}</p>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
