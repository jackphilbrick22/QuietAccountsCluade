import { ArrowRight, FileSpreadsheet, KeyRound, LayoutGrid, MailCheck, PhoneCall, Quote } from "lucide-react";
import { CLAIMS } from "@qa/engine";
import { useApp } from "../store/app";
import { Button, Card, Wordmark } from "../components/ui";
import logoUrl from "../assets/logo-mark.svg";

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
    <div className="relative min-h-full overflow-x-clip bg-bg">
      {/* the site's soft violet glow behind the hero */}
      <div aria-hidden="true" className="pointer-events-none absolute top-[360px] left-1/2 h-[760px] w-[min(980px,150vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(150,120,255,0.18),rgba(150,120,255,0))]" />

      <header className="sticky top-0 z-30 px-4 pt-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1120px] items-center justify-between gap-2">
          <Wordmark />
          <div className="flex items-center gap-0.5 rounded-full border border-line bg-surface/90 p-1 shadow-soft backdrop-blur">
            {order.length > 0 && (
              <span className="hidden sm:block">
                <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => go({ area: "owner", tab: "today" })}>
                  Demo owner view
                </Button>
              </span>
            )}
            <Button variant="ghost" size="sm" aria-label="Demo console" className="px-3.5 whitespace-nowrap" onClick={() => (order.length ? go({ area: "ops", tab: "overview" }) : void seedDemo().then(() => go({ area: "ops", tab: "overview" })))}>
              <LayoutGrid size={15} className="hidden sm:inline" /> <span className="hidden sm:inline">Demo console</span>
              <span className="sm:hidden">Demo</span>
            </Button>
            <Button variant="ghost" size="sm" aria-label="Operator sign-in" className="px-3.5 whitespace-nowrap" onClick={() => go({ area: "live", tab: "clients" })}>
              <KeyRound size={15} className="hidden sm:inline" /> <span className="hidden sm:inline">Operator sign-in</span>
              <span className="sm:hidden">Sign in</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-[1120px] flex-col px-4 pb-24 sm:px-6">
        {/* hero: centred and calm, like the site */}
        <section className="flex flex-col items-center pt-12 text-center sm:pt-20">
          <span className="inline-flex max-w-[32ch] items-center justify-center rounded-[18px] bg-accent-soft px-4 py-1.5 text-center text-[13.5px] leading-[1.4] font-medium text-balance text-accent-ink sm:max-w-none sm:rounded-full sm:px-3.5 sm:text-[14px]">For tree, lawn, septic, fence, concrete and wash companies</span>
          <h1 className="mt-5 max-w-[12ch] text-[46px] leading-[1.02] [word-spacing:normal] sm:text-[78px]">
            Nothing left <span className="text-accent">on the table.</span>
          </h1>
          <p className="mt-6 max-w-[58ch] text-[17px] leading-relaxed text-ink-2 sm:text-[18.5px]">
            Your quotes and past customers are full of work you already paid to find. Quotes nobody answered, yeses that never got scheduled, customers who never came back. Quiet Accounts finds every one, follows up from your office, and texts you the ones who want the work.
          </p>
          <div className="mt-8 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center sm:justify-center">
            <Button size="lg" onClick={() => go({ area: "onboarding", tab: "trade" })}>
              Find my money <ArrowRight size={18} />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => void seedDemo()}>
              See it with a sample tree company
            </Button>
          </div>
          <p className="mt-5 max-w-[62ch] text-[14px] font-medium text-ink-3">First 150 free, then $497 a month if you say yes. No card, no contract, no sales call. Any month nobody asks to come back, you don't pay.</p>

          {/* the sample drawer, with the mark rising behind it (the site's hero card) */}
          <div className="relative mt-14 w-full max-w-[620px] pt-[78px] text-left sm:mt-16 sm:pt-[100px]">
            <img src={logoUrl} alt="" aria-hidden="true" width={120} height={120} className="absolute top-0 left-1/2 z-[1] size-[96px] -translate-x-1/2 -rotate-[7deg] rounded-[22%] drop-shadow-[0_22px_26px_rgba(91,63,232,0.32)] sm:size-[120px]" />
            <Card className="relative z-[2] flex flex-col gap-3 rounded-[28px] p-3 shadow-lift sm:p-4">
              <div className="px-2 pt-1">
                <span className="eyebrow">What a tree company's drawer looks like</span>
              </div>
              <div className="rounded-[20px] border border-accent-line bg-accent-wash px-4 py-1 sm:px-5">
                {[
                  ["Quotes nobody answered", 414, "$1.03M"],
                  ["Quotes filed away", 389, "$857k"],
                  ["Hired you once, never came back", 610, "$891k"],
                  ["Due for service again", 124, "$126k"],
                  ["Said yes, never got scheduled", 5, "$22.8k"],
                ].map(([label, n, v]) => (
                  <div key={label as string} className="flex items-center justify-between gap-4 border-t border-accent-line py-3.5 first:border-t-0">
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[15px] font-semibold">{label}</span>
                      <span className="num text-[13px] text-ink-3">{(n as number).toLocaleString("en-US")} people</span>
                    </span>
                    <span className="num shrink-0 font-display text-[24px] leading-none text-accent-ink sm:text-[28px]">{v}</span>
                  </div>
                ))}
              </div>
              <p className="px-2 pb-1 text-[12.5px] text-ink-3">From the sample business: 3 years of quotes from a two-crew tree service on Jobber. Yours will show your own numbers.</p>
            </Card>
          </div>
        </section>

        {/* how it works: three steps on soft panels */}
        <section className="mt-20 grid gap-4 sm:mt-28 md:grid-cols-3 md:gap-5">
          {STEPS.map((s, i) => (
            <div key={s.title} className="flex flex-col items-center gap-3 rounded-[24px] border border-line bg-sunken px-6 py-8 text-center">
              <span className="grid size-12 place-items-center rounded-[14px] border border-accent-line bg-accent-soft text-accent" aria-hidden="true">
                <s.icon size={22} />
              </span>
              <span className="text-[13.5px] font-semibold text-accent-ink">Step {i + 1}</span>
              <h3 className="text-[22px] sm:text-[24px]">{s.title}</h3>
              <p className="max-w-[34ch] text-[15px] text-ink-3">{s.body}</p>
            </div>
          ))}
        </section>

        <section className="mt-20 flex flex-col items-center gap-8 sm:mt-28 sm:gap-10">
          <h2 className="max-w-[20ch] text-center text-[34px] leading-[1.06] sm:text-[48px] sm:[word-spacing:normal]">Why the money is still there</h2>
          <div className="grid w-full gap-4 md:grid-cols-3 md:gap-5">
            {facts.map((f) => (
              <Card key={f.id} className="flex flex-col gap-3 rounded-[24px] p-6">
                <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-ink" aria-hidden="true">
                  <Quote size={17} />
                </span>
                <p className="text-[16px] leading-snug font-semibold">{f.text}</p>
                <p className="mt-auto border-t border-dashed border-line-2 pt-3 text-[12.5px] text-ink-3">{f.source}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
