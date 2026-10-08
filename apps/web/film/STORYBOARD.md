# The service film: storyboard

A 35.5-second silent loop of the service, told with our own software as the backdrop. It is built to sit in a section
of the site's white page the way SmartLead's hero video sits on theirs: no edge, no cuts, nothing to read aloud.

- **Content:** `film/content.json`, written by `film/content.ts` (`pnpm --filter @qa/web film:content lawn`). Every
  word and number on screen comes from there, except the few meaning chips named below, the app's own labels, and the
  phone's chrome. Paths like `featured.reply.text` below are keys in that file.
- **Company:** `film/profiles.ts` (one made-up company per trade; lawn first).
- **Fonts:** `film/fonts/` (Cal Sans and Inter, both SIL OFL 1.1, self-hosted, with `fonts.css`).
- **What the real screens look like:** `film/ref/app-screens-1.png`, `film/ref/app-screens-2.png` (the live console's
  client page for this company: Files, List, Notes, Replies, Overview; and the owner app's note card, reply and
  Recovered ledger), all rendered from this company's own account. To see any real screen with this company in it:
  `film:content lawn --states <dir>` writes the account at each step; put `5-end.json` into IndexedDB (`acct:<id>`
  plus an `index` entry) for the owner app and demo console, or into a local server's database (`Accounts.create`,
  then assign the state; worker off, log providers) for the live console.

---

## 1. The reference, measured

SmartLead's homepage hero (`.claude/worktrees/results/smartlead/hero.mp4`) studied frame by frame at 0.1 s. Its layout
space is 1280 × 596 CSS px; every distance below is in that space, which is also ours (section 2).

| | What it does |
|---|---|
| Frame | 1280 × 596 (2.148 : 1), 30 fps, 12.37 s, autoplay muted loop, no audio. The app window sits 21 px in from every edge. |
| Chrome | Navy top bar (43 px) and a left sidebar (52 px icon rail + 146 px panel). Never moves, never cuts. The only chrome change in the whole loop is the sidebar's second column folding away for the last scene (t 8.0–8.4) and coming back for the seam (t 11.9–12.2). |
| Canvas | Near-white (244, 245, 250) with a faint dot grid (dots (228, 229, 234), about 20 px apart) and two static radial glows: lavender (210, 210, 254) right of center, mint (223, 250, 247) left-center. The glows never move. The canvas's bottom fades toward white. |
| Pace | Five scenes in 12.4 s, 2.5–3 s each. Something is always moving; the longest still hold is 0.5 s (t 11.1–11.6), right before the exit. |
| Card in | Fade from 0 plus a rise of about 60 px, done by 0.45 s, ease-out (most of the travel in the first 0.25 s). No scale. |
| Chips in | A row of four status chips (icon + 13 px label, white pill) fades and rises in about 0.1 s behind the card, as a group with a slight stagger. A second ghosted row sits below at about 15 % opacity. |
| Typing | 104 characters in 1.1 s, decelerating: about 160 chars/s at first, 57 chars/s at the end. No caret visible. |
| Cursor | macOS arrow, about 20 px tall. It appears as a dot that grows to full size in about 0.3 s while already drifting; glides about 150 px in 0.4 s with an ease-out (74, 49, 24, 7 px per 0.1 s); settles 0.1 s; presses. When a scene ends it shrinks back to a dot and is gone in 0.2 s; the next one grows from a dot at a new place. |
| Press | The button dips to about 0.92 over 0.25 s and comes back over 0.15 s. The next scene starts 0.25 s after it comes back. |
| Handover | 0.4–0.5 s, never a cut. The outgoing scene drifts up a few px, blurs a little and fades in about 0.25 s; the incoming one is already at about 30 % on its first frame, rises about 10 px and is sharp by 0.3 s. The new scene's header leads its body by 0.1 s. |
| Pan | A workflow wider than the canvas pans sideways about 900 px (70 % of the frame) in 1.6 s, ease-in-out, while the cursor waits. |
| Lists | Either the whole table arrives as one block (blur to sharp, 0.3 s) or its rows stagger about 0.1 s apart. The last two visible rows sit at about 60 % and 20 % opacity: the list fades out toward the bottom edge instead of ending. |
| Focus | One row lifts (scale about 1.02, a stronger shadow) over 0.4 s; the other rows fade out in 0.2 s; a dotted connector with diamond nodes draws down from the row in 0.2–0.3 s; a panel fades and rises in at its end; a second connector and panel follow 0.4 s later; the panel's status pills stagger in. |
| Loop seam | The last 0.5 s drift everything up about 10 px with a blur and fade, and the loop ends on the exact empty canvas it began with (frame 1 vs the last: mean difference 0.5 / 255). |
| Meaning | No title cards, no voice, no music. The UI's own words carry it: a typed prompt, status chips, a table, a panel. |

---

## 2. Our frame

- **Size:** 1920 × 894 output pixels (2.148 : 1, SmartLead's own aspect), 30 fps, 35.5 s = 1,065 frames. A second
  MP4 at 1280 × 596 for small screens.
- **Layout space:** the film page is laid out at **1280 × 596 CSS px and rendered at device scale 1.5**. That keeps
  SmartLead's measurements usable as they are, and it puts the app's 13–14 px text at 20–21 output px, which still reads
  at 11–12 px when the video is shown about 1,100 px wide in a page section.
- **The white edge:** the outermost 20 CSS px (30 output px) on every side are pure `#FFFFFF`, in every frame, so the
  video has no visible edge on the site's white page. The app window inside has a 1 px hairline a shade lighter than
  `--line` (`#F3F2F7`), radius 18, a
  long soft violet shadow that has faded before the margin, and no bottom edge at all: the bottom 53 CSS px of the frame
  (y 526–579) dissolve into white, above everything, the phone's shadow included.
- **Regions** (CSS px):

```
 0 ┌──────────────────────────────────────────────────────────────────────────────────────────┐
   │ 20 px pure white                                                                         │
20 │  ┌────┬─────────────────────────────────────────────────────────────────────────────┐    │
   │  │ Re:│ [D]  Desrochers Lawn & Landscape  (state pill)                  ┌────────┐ │    │
   │  │    │      Lawn care · Bow, NH · owner Kyle Desrochers · signs as Kyle│ phone  │ │    │
   │  │ ▢  │ Overview  List  Notes  Replies  Texts to owner  Activity  Files │ (beats │ │    │
   │  │ ▢  │ ─────────────────────────────────────────────────────────────── │  4–8)  │ │    │
   │  │ ▢  │ content: full width (x 108–1236) in beats 1–3 and the offer,    │        │ │    │
   │  │    │ 854 wide (x 108–962) beside the phone from the Notes table on;  │        │ │    │
   │  │    │ each scene's block centred in the canvas under the tabs         └────────┘ │    │
   │  │    │ ░░░░░░░░░░░░░░░ the window dissolves to white (y 526–579) ░░░░░░░░░░░░░░░░ │    │
596└──┴────┴─────────────────────────────────────────────────────────────────────────────┴────┘
      20   80                                                                         1260
```

- **Rail** (x 20–80, white, right hairline): an icon rail like SmartLead's, so the window looks like a working app
  without a column of empty white: the Re: mark, then the live console's own nav (`apps/web/src/live/LiveShell.tsx`:
  Clients, Needs a person, Texts to send) as icons only, Clients selected. No words, so nothing in it can be misread
  ("Clients" would mean his own customers to a Jobber owner). Static.
- **Canvas** (x 80–1260): base `#F8F8FB`, dot grid 1 px dots `#E5E4EE` every 20 px, two static glows: violet
  `rgba(122, 92, 255, 0.20)` at 66 % / 46 %, and blue `rgba(62, 107, 240, 0.08)` at 30 % / 74 %. Cards are white.
- **Client header** (fixed): the live console's client page header (`apps/web/src/live/Client.tsx`), simplified: the
  46 px violet-gradient monogram `D`, the name in Cal Sans 25 px, one **state pill** that comes and goes (`Waiting for
  the owner's OK`, warn, beats 3–4; then `Sending`, ok, with its dot, from beat 5 until the exit), and the line `Lawn
  care · Bow, NH · owner Kyle Desrochers · signs as Kyle`. Left out: "← All clients", the buttons row, the ask card, and
  any plan or stage pill (he hasn't said yes to a plan, and "Free round" says free without its price).
- **Tabs** (x 108–1236, y 110–146): the client page's eight real tabs, 13.5 px. The active one is `--accent-ink` with a 2 px
  `--accent` underline. Between neighbouring tabs (List → Notes, Notes → Replies) the underline slides; between others
  (Files → List, Replies → Overview, Overview → Files) it fades out under the old tab and in under the new one. Only
  those two labels change colour, crossfading with it.
- **The phone** (x 994, y 62, 240 × 458): an iPhone drawn in CSS, his side of the service. It comes in once, beside the
  Notes table, and stays until the offer; its bottom (y 520) and its shadow end above the dissolve. While it's on
  screen the two sides take turns (section 3, Focus).
- **Fonts:** Cal Sans for the client name, big figures and card titles; Inter for everything else, with the app's `num`
  figures. Both load from `film/fonts/fonts.css` before the first frame (the render stops if they don't). The hand-off
  text's 🌱 needs a colour emoji font on the render machine (Noto Color Emoji is installed here).
- **Colours:** only the app's tokens (`apps/web/src/styles.css`, light theme), plus the phone's iOS colours.

---

## 3. Our motion vocabulary

All motion is computed from the film clock `t` (no CSS transitions or timers), so any frame renders the same every
time. Curves: **outCubic** (travel: a rise, a glide, a slot opening; it spreads over the whole move, so nothing darts
into place and then sits half there), **outQuad** (an opacity coming in), **sine** = `0.5 − 0.5 cos πp` (fades,
pans, scrolls, the rise of a row: starts and lands at rest), **out** = `cubic-bezier(.22, 1, .36, 1)` (only small pops
and count-ups), **in** = `cubic-bezier(.55, 0, 1, .45)` (only the drift and blur of an exit).

| Element | Spec |
|---|---|
| Card in | opacity 0 → 1 (outQuad), rise 40 px → 0 and blur 4 → 0 (outCubic), 480 ms: rise, blur and fade finish together. No scale, no clip. |
| Rows in | each: rise 10 px, blur 2 → 0, 420 ms; 70 ms stagger. A table's card grows with its rows (never an empty shell). |
| Chips in | the app's pill look, a lucide icon in `--accent`; each 380 ms, 90–110 ms stagger. |
| Out (a scene leaving) | opacity → 0 on a **sine**, so it lands softly on 0; drift up 8 px and blur → 5–6 px on the in-curve; 300–340 ms. |
| Handover | the incoming scene starts 120 ms after the out, already at 30 % (SmartLead's), rising 12 px, sharp by 400 ms. |
| Label change | a status pill or the phone's clock: the old label fades fully out (90–120 ms), then the new one fades in (110–180 ms) with a 4 px rise. Never two labels printed over each other. |
| Focus | while the phone is on screen, one side acts at a time: the acting side is at full strength and leads by 0.15–0.3 s; the other holds perfectly still and recedes to 84 % opacity; each switch eases over 300 ms. A phone event and a console event are at least 0.3 s apart. |
| Pan (Notes → Replies) | both panes slide 910 px in 1.65 s on a sine (peak about 29 px a frame at 30 fps); the frame they slide through runs from the rail to the phone with soft edges, and each pane fades as it nears an edge. The Replies pane already holds its first reply, so the pan lands on content. |
| A reply arriving | its place opens first (the rows under it slide down, 380 ms outCubic), then the row fades in there (420 ms); its label pops 560 ms after it arrives (read), and a closed-out reply's words then dim to 50 %. Arrivals 0.65 s apart. No row ever crosses another. |
| Our answer under a reply | its space opens first (the rows under it slide down, 380 ms outCubic), then the panel fades and rises 8 px into it (420 ms). No clip. |
| The row we follow | lifts (scale 1.012, a stronger shadow, 420 ms); the other rows fade in 200 ms; it rises only once they're under 10 %, so it never passes over a row you can still read; it draws in to the note's width as it rises (600 ms sine). |
| Typing | characters appear at a decelerating rate; a 1.5 px `--accent` caret while typing, gone 300 ms after. |
| Count-up | 650–700 ms out, landing exactly on the content value. |
| Phone in / out | in: rises 48 px (outCubic, 560 ms) with its opacity mostly there in the first 0.15 s (so its bezel never reads as a wireframe), scale 0.97 → 1. Out: opacity on a sine, drop 28 px, blur 5 px, 380 ms. |
| Thread handover | the welcome text (about 55 lines) is never scrolled through: its top shows first (the note he's saying OK to), then the view hands over (old view fades in 200 ms, drifting up 10 px and blurring; the new one comes in from nothing 140 ms later, rising 12 px and sharpening over 380 ms) to the paragraph that asks for his OK, centred. His OK hands over to the thread's end the same way. |
| Bubble in | ours, short (up to three lines): scale 0.92 → 1 from the tail corner, 320 ms. Ours, taller: rise 14 px and fade, 460 ms, no scale. His: rises 26 px out of the text field. A date line fades in above each new exchange. |
| Thread scroll | a later text scrolls up by its own height on a sine, never faster than 12 px a frame at its fastest (about 4.4 ms a px). |
| Phone typing | the field fills at 110 ms a character for OK and YES, 30 ms for BOOKED; the send arrow dips (press, 340 ms); once the press is done, the words fade from the field (100 ms) as the bubble rises into the thread. |
| Layers | every moving element is always in its own compositing layer (`will-change: opacity`), so text never re-rasterizes on the frame a fade starts. |

No cursor anywhere: nobody the owner could take for himself clicks around. The work happens on its own, and his part
happens on his phone.

**The phone:** 240 × 458, radius 38, a 6 px `#16161A` bezel, an island at the top. Status bar: the time of the message
on screen. Thread header: the Re: mark and "Quiet Accounts". A centred date line (11 px, `#6E6E73`, the day in
semibold) above each exchange. Incoming bubbles `#E9E9EB` with `#0A0A0B` text; his are SMS green `#34C759` with white
text. Inter 12.5 / 16.5 px, bubbles at most 84 % wide. Phone numbers underlined, as iOS shows them.

---

## 4. The company on screen

**Desrochers Lawn & Landscape**, Bow, New Hampshire. Owner **Kyle Desrochers**; the notes go out signed **Kyle**.
Notes carry **PO Box 214, Bow, NH 03304** (a box, so the address on screen is nobody's house). A mowing and lawn-care
shop on Jobber with five years of jobs (2021–2026) and 1,120 customers.

- Why it reads as real: a Franco-American family name, common in the Concord area, on a family-run lawn company in a
  real town, with its customers in the real towns around it (Concord, Hopkinton, Pembroke, Henniker, Boscawen…). Web
  searches on Oct 8 for "Desrochers Lawn", "Desrochers Landscaping" and "Desrochers Lawn & Landscape" found no such
  business in the US, and "Kyle Desrochers" turns up no lawn business. Names first tried and dropped: "Hartwell Lawn &
  Landscape" (a Hartwell Lawn Service exists in Georgia).
- Its records are the engine's sample generator run for this company (`generateSample({ trade: "lawn", seed:
  "film-lawn-27", businessName, ownerName, signerName })`), with the profile overridden (name, owner, town, PO box,
  addresses off screen at `desrocherslawn.com`) before the engine reads anything.
- **Why seed 27:** of the 30 seeds tried, it is one where nothing on screen gives the data away: the welcome text's
  call list leads with ordinary jobs ($3,135, $2,250, $2,100), not an outlier, and the run's names never share a
  surname. `content.ts` refuses to write a `content.json` in which two people on screen share a surname, a street
  shows twice, or a street is a Main St, and it picks the List's and the Notes table's rows and the other replies
  around the names the run fixes (the one we follow, the ledger, the call list). The List never shows two rows of the
  same worth, the Notes table has one note about another job (the lawn program), and the Replies view never shows two
  people with the same first name.
- **The one we follow: Tom Hall**, 144 Bog Rd, Chichester, a mowing regular: he had us every two weeks (33 visits)
  and stopped last June. A lawn owner believes every line about him: his last job is one $55 mowing visit on Jun 6,
  2025 (the hand-off text prints it), the List says he's worth $770 (his season), and Kyle books him for $700. He is
  chosen by rule (`content.ts`, `followable`): his last job is one visit, never a season's contract (a "Weekly mowing -
  season" dated in April ran all summer, so "last here April" would be wrong, and its renewal is no win-back); he is
  not the welcome text's first note's person, and his note reads differently from that one (the film shows both:
  Sarah's "last April", his "last June"); and Kyle's BOOKED text lands in working hours.
- Phone numbers: the sample's customers are (603) **555**-xxxx, which reads as fake. The content script keeps each
  number's last four digits and gives it the **958 or 959** exchange, which the North American plan reserves for line
  testing: it looks like any local number and is never anyone's. The welcome text's call list now writes numbers the
  way the hand-off does, `(603) 959-5599` (an engine change: owners read these too).
- Customer email addresses are never on screen.
- The season: lawn's spring selling window. His export reaches us **Sunday, Feb 8 at 9:47 PM** (when owners do their
  paperwork); our first text reaches him **Monday, Feb 9 at 8:02 AM**, so a night's work sits between his file and our
  text; the first notes go **Tuesday, Feb 10**; the round runs 45 days, and its last text reaches him **Thursday,
  Mar 5**. The welcome text's example dates are the engine's, from its own send date (`BUSY until Mar 3`).
- The replies and bookings are a simulated run of the round (the engine's simulator through the real Inbox reader;
  the owner calls back in working hours, 9 AM to 7 PM, so his BOOKED texts come in the daytime). Sixty runs were
  played; the film uses one that reached all 150 and whose result sits in the middle half of all of them
  (`generatedFrom.spread`: median $7,625; this run $9,975 from 6 jobs), never a lucky one. Within it, the reply the
  film follows is chosen as above, then for coming after the other kinds of reply (so the Replies view, which holds
  only replies from before his hand-off text, has something to sort).

### Nothing on screen may say

`example`, `sample`, `demo`, `simulated`, `test`, `placeholder`, `Live`; no `John Doe`, `lorem`, `123 Main St`, 555
numbers or suspiciously round figures. BRIEF §1 words: the monthly promise only as "Any month nobody asks to come back,
you don't pay."; never "money-back", "risk-free", "guaranteed X%", "free trial"; "free" only beside its price ("First
150 free, then $497/mo if you say yes.", the welcome text's last line, and the round's last text, whose bubble carries
"$497 a month keeps it going"); no Money Map, Reply Desk, Ready Text, Every Month After or Year Floor; Dow's never
named; no "guarantee" heading (the round's last text is shown without its "And the guarantee:" line). `content.ts`
refuses to write a `content.json` that breaks the first list; the render checks the page's own text against all of it.

---

## 5. Beat by beat

Times are seconds on the 35.5 s loop (`film/src/timeline.ts` is the source). "Chip" means a meaning chip, the only
words in the film that are ours rather than the software's: they all speak to the viewer, an owner like Kyle ("your",
"you"), as the offer does.

| Beat | Time | On screen and motion | Meaning |
|---|---|---|---|
| 0 | 0.00–0.30 | The window, the rail, the header with no pill, **Files** underlined, an empty canvas. Also the film's last frame. | — |
| 1 · Files | 0.30–2.30 | Chip `Your part: one export from Jobber, an OK by text, and the calls. We do the rest.` · his export arrives from him: `KD · Kyle Desrochers · Sun, Feb 8, 9:47 PM` with the file `Jobs Report.csv · Jobber` · **Files we've read** rises, its row counting to 3,645 · record chips `Jobs 3,645 · Clients 1,120 · 2021–2026`. The block is centred in the canvas. | His whole part, said once; the first of it is one file. |
| 2 · List | 2.30–4.91 | Handover. Chip `Going through your records, 525 past customers haven't been back.` (the welcome text's own line) · the people stagger in, their card growing with them, the list fading out toward the bottom · Tom Hall's row lifts by itself (3.80); the others fade in 0.2 s (4.15), and only then (4.31) does it rise to the top and draw in to the note's width. The underline slides List → Notes. | We find who stopped, and what each is worth; we pick who to write. |
| 3 · Note | 4.95–8.72 | The note card rises in under his row, the pair centred with room for its chips (`Note 1 · to Tom Hall · Tue, Feb 10`, subject `the mowing`), the body types itself in 1.4 s, the footer fades in · chips beside it, one at a time: `We write each one, in your name` · `About their own job` · `Nothing goes until you say OK` · row, card and chips fade out (7.60), then the Notes chips (`Waiting for approval 300 · Scheduled 0 · Sent 0 · All 300`, and `300 notes to 150 people`) and the Notes table rise, 854 wide, the card growing with its five rows (one about the lawn program), his tinted · the state pill `Waiting for the owner's OK` pops in. | A real note, in his name, about this person's own job; every one waits for him. |
| 4 · OK | 9.05–15.30 | The phone rises in beside the table; the console recedes · the welcome text arrives (`Mon, Feb 9 at 8:02 AM`) and rests on its top: what we found and the first note, word for word · a soft handover (10.80) to the paragraph that asks for his OK ("Reply OK and the first 25 go out Tuesday, February 10 … Nothing goes out until you say OK."), centred · he types `OK`, taps; the words leave the field as the green bubble rises, and the thread hands over to its end · 0.3 s later, the console: every row's label changes to `Scheduled` (old out, then new in), the chips count, the warn pill goes · then the phone: our answer, "Done — the first notes go out Feb 10. When someone asks to come back, you'll get a text with their name and number." | He approves the actual first note by text, and that text starts everything. |
| 5 · Replies | 15.30–20.45 | The console: the first day's five rows change to `Sent`; `Sending` pops in · the view pans to Replies (1.65 s): its chips, the chip `We read every reply and answer it for you`, the app's line "Every reply to every note, read and sorted. The ones who want the work come first.", and the first reply (Holly Evans, `Wants it done`) · Raj Pierce's "Not interested, thanks." arrives and lands below Holly (the sort, as it happens), then Tom Hall's "Yes, still want it done. Any day next week works." on top, 0.65 s apart, each labelled as it lands · his row lifts; the rows under it make room; `We wrote back` fades into the space: "Thanks Tom. I'll give you a call tomorrow to get it on the schedule. Kyle" · a second chip beside the first: `We text you the ones who want the work. You call.` | Every reply is read, sorted and answered; the ones who want the work go to him. |
| 6 · Hand-off | 20.45–24.45 | The phone: `Thu, Feb 12 at 6:19 PM`, the hand-off text, word for word ("🌱 NEW — Tom Hall, 144 Bog Rd / Last job: Jun 6, 2025 · $55 · Mowing visit / … Best contact: (603) 959-9461 (anytime) …"), scrolled in at no more than 12 px a frame, then held · `Fri, Feb 13 at 10:47 AM`: he types `BOOKED 700 #DRN`, taps · our answer: "Booked: Tom Hall, $700. Added to your results." | Everything he needs to call is in one text; he books it and tells us in three words. |
| 7 · Results | 24.45–27.40 | Replies fade; the underline fades to Overview · two figures rise: `$4,725 Booked · 3 jobs` and `7 Asked to come back · 9 wrote back` · the ledger rises with the three earlier bookings · his row slides in on top, tinted, and Booked counts to `$5,425 · 4 jobs` · the round's last two bookings land as the weeks go by: Booked `$9,975 · 6 jobs`, Asked `9 · 16 wrote back`. | His booking is in his results the moment he texts it. |
| 8 · Close | 27.40–32.20 | The phone: `Thu, Mar 5 at 9:00 AM`, the round's last text (its tally and its price line: "Kyle, the free 150 put 6 jobs back on your calendar, $9,975: … From 286 notes to 150 people, 16 wrote back and 9 asked to come back. $497 a month keeps it going … Cancel by text, any time."), the same figures the console shows · he types `YES`, taps · our answer, held 1.2 s: "Great — Jack will text you the payment link, and the next batch goes out next week." | He pays nothing until he's seen it work and said yes. |
| Offer | 32.20–34.75 | The phone, the ledger and the money leave (0.4 s) · the one number the promise depends on, `9 Asked to come back · 16 wrote back`, glides to the middle of the canvas · `First 150 free, then $497/mo if you say yes.` and `Any month nobody asks to come back, you don't pay.` rise under it, the largest words on screen · hold 1.3 s. | The offer, in the brief's words. |
| Exit | 34.75–35.50 | Everything drifts up, blurs and fades (0.6 s, landing softly); `Sending` fades; the underline fades to Files · the empty canvas, identical to frame 0. | — |

## 6. The loop seam

The last frame and the first must be the same picture: the rail, header with no pill, Files underlined, empty content,
the same glows. The render shoots t = 35.5 s (the loop's length, read from the page) as a check frame and compares it with frame 0: mean absolute difference
under 0.5 / 255. Nothing in the chrome carries state across the seam.

---

## 7. Building it

- **A film page, not the app.** `apps/web/film/index.html` with its own Vite config (`film/vite.config.ts`, root
  `film/`), and `film/src/`. It imports the app's tokens (`../src/styles.css`) and pieces (`Pill`, `Chip`, `LogoMark`,
  `Dot`, `KIND_LABEL`, `MATCH_LABEL`, the Unibox's intent labels via `content.ts`), so the film is the app's look by
  construction. It reads `content.json` (or `content.<trade>.json` from `?trade=`).
- **A clock, not timers.** `window.__film.seek(t)` sets the time, renders synchronously (`flushSync`), and resolves after
  two animation frames and `document.fonts.ready`.
- **Render.** Playwright Chromium at 1280 × 596, device scale 1.5; a frame every 33.3 ms, each PNG piped to three
  ffmpeg encoders: H.264 High (preset slow, tune animation, CRF 20, aq-mode 3 against banding in the glows, yuv420p,
  BT.709 tagged, +faststart, no audio), VP9 (CRF 32), and H.264 at 1280 × 596 (CRF 22) for small screens.
- **Checks before anything is called done** (the render fails loudly on any of them):
  1. Seam: frame 0 vs t = 35.5, mean difference < 0.5 / 255.
  2. Edge: in every 15th frame the outer 30 output px are white (each channel ≥ 254).
  3. Words: every half second, the text actually visible on the page (phone included) has none of the section 4
     list, and "free" only inside the lines that carry its price.
  4. Fonts: Cal Sans and Inter are loaded before frame 0.
  5. Contact sheets (every 0.5 s, and each scene change at 0.1 s), looked at against SmartLead's.
- **Another trade.** Add its company to `profiles.ts`, run `pnpm --filter @qa/web film:content <trade>`, render with
  `--trade <trade>`. If `content.ts` refuses (names repeat, or no run has a reply whose figures agree), try another
  `sampleSeed`. Tree, painting and fence sell the one pass: `offer.lines` then carries the engine's pass promise, and
  the close beat has no round's-last-text (the phone leaves after the hand-off).

---

## 8. Calls for Jack

- **The phone numbers.** On screen as (603) 959-9461: real-looking, but in an exchange reserved for testing, so it can
  never ring anyone. The alternative is the sample's own 555 numbers.
- **"Bow, NH" on the header line** is the console's own line. The company is made up; the town is real.
- **The welcome text is shown in two views**, never scrolled through: its top (what we found and the first note, word
  for word), then the paragraph that asks for his OK. Its BOOKED / NO / BUSY / PAUSE lines and its call-list paragraph
  pass between them; after his OK the thread's end shows, with the last lines of the call list and the price line
  above his green OK.
- **"Jack will text you the payment link"** is the server's own answer to his YES: Jack is named on screen once.
- **The money.** One typical run of this company's first round: $700 for Tom's season of mowing, and $9,975 from 6 jobs
  by the round's end (the round's median is $7,625). The offer ends on how many asked to come back (9), the number the
  promise depends on, not on a dollar figure.
- **Engine changes made for the film** (both are true in the product too): the welcome text's `BUSY until …` example
  is a date three weeks past the first notes (it said "Nov 15" in every month); and the simulator has the owner call
  back in working hours (9 AM to 7 PM), so no BOOKED text lands at 6:41 AM.
- **The length.** 35.5 s, against SmartLead's 12.4 s. One thing at a time, with the phone's texts held long enough to
  read, costs time. A shorter cut would drop a beat (the Overview, or the round's last text and his YES).
- **Left for later:** the export on screen is the sample's `Jobs Report.csv`; the ask on the site is Jobber's Visits
  report. The sample generator would need a Visits report export for lawn to show that file by name. And the engine
  dates a weekly-mowing season by its first visit ("last April" for a season that ran all summer); the film avoids
  following such a person, but the engine's scan and notes should treat a season as running through the season.

---

## 9. As built (Oct 8, round 3)

**Run it.** From `apps/web`:

```
pnpm film:content lawn              # content.json from the software (already in the repo); --picks lists the runs
pnpm film:build                     # vite build --config film/vite.config.ts → film/dist (ignored by git)
pnpm film:render                    # → film/out/quiet-accounts-film.{mp4,webm}, -1280.mp4, -poster.jpg, -first.jpg
node film/render.mjs --frames <dir> && python3 film/sheets.py <dir> <sheets-dir>   # contact sheets
node film/render.mjs --stills 0,12650,22000 --out <dir>                              # single moments
pnpm film:dev                       # the page in a browser: ?t=12650 shows a moment, ?play plays it
```

**The page.** `film/src/`: `timeline.ts` (every beat's time, the layout and who has the focus, as data), `motion.ts`
(the curves and the enter, leave, hand-in, pop, swap, press, count and typing functions, all pure functions of `t`),
`focus.ts` (which side acts), `Film.tsx` (the window, rail, header, tabs), `scenes/` (Files, List with the note card,
Notes with the pan, Replies, Money with the offer), `Phone.tsx`, `parts.tsx` (meaning chip, typed text, the app's
table look as grid rows).

**Measured** (the rendered frames at 640 px, mean absolute grey difference between frames): our largest
frame-to-frame change is 2.75 (2.93 in the MP4; SmartLead's 3.8), with no single-frame spike anywhere (no frame
changes more than three times as much as its neighbours); the seam is exact in the rendered frames (0.000) and 0.21 in
the MP4 (SmartLead's 0.20). The stills over 0.5 s are the welcome text's top (0.9 s), the paragraph that asks for his
OK (0.6 s), the hand-off text (0.5 s), our answer to his YES (1.3 s, as asked) and the offer (1.4 s). MP4 3.1 MB, WebM
2.5 MB, the 1280 × 596 MP4 1.6 MB.

**Poster:** `-poster.jpg` is 22.0 s (the sorted replies, our answer to Tom, both chips, and the hand-off text on his
phone), for browsers that won't autoplay; `-first.jpg` is frame 0, for a page that wants nothing to change when it
starts.

**Embed** (on the site's white, no border, no radius; the small file for phones):

```html
<video autoplay muted loop playsinline preload="metadata" poster="quiet-accounts-film-first.jpg" width="1920" height="894"
       style="width:100%;height:auto;display:block" aria-label="How Quiet Accounts brings a lawn company's past customers back">
  <source src="quiet-accounts-film-1280.mp4" type="video/mp4" media="(max-width: 800px)" />
  <source src="quiet-accounts-film.webm" type="video/webm" />
  <source src="quiet-accounts-film.mp4" type="video/mp4" />
</video>
```

(`media` on `<source>` is honoured by Chromium and Safari; elsewhere the first playable source wins, so the page can
also pick the file in script by `matchMedia` if it needs to.)
