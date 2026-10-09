# The service film: storyboard

A silent loop of the service, told with our own software as the backdrop, one per trade page: lawn (the landscaping
page), cleaning, fence and tree, each for a made-up company of that trade, in that page's colours, fonts and logo mark.
Each is built to sit in a section of its page's white the way SmartLead's hero video sits on theirs: no edge, no cuts,
nothing to read aloud. Lawn and cleaning (the free 150, then monthly) run 35.5 s; fence and tree (the one pass) 34.4 s.
Section 10 is what changes from trade to trade; everything else holds for all four. Each film also has a phone cut
(section 11): the same film, framed by a camera close enough on what acts for a phone to read it.

- **Content:** `film/content.json` (lawn) and `film/content.<trade>.json`, written by `film/content.ts` (`pnpm --filter
  @qa/web film:content <trade>`). Every word and number on screen comes from there, except the few meaning chips named
  below, the app's own labels, and the phone's chrome. Paths like `featured.reply.text` below are keys in that file.
- **Company:** `film/profiles.ts` (one made-up company per trade: lawn, cleaning, fence, tree).
- **Look:** `film/src/theme.ts` (each trade page's tokens mapped onto the app's, its fonts, its logo mark; section 10).
- **Fonts:** `film/fonts/` (all SIL OFL 1.1, self-hosted, with `fonts.css`): Archivo for lawn, fence and tree, Instrument
  Sans and Instrument Serif for cleaning, as their pages set them; Inter for the phone in every film; Cal Sans and Inter
  for the violet app's look, which no trade film uses now.
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
  MP4 at 1280 × 596 for laptops at 1x; and the phone cut, 1080 × 1080 (section 11), for phones.
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
- **Fonts:** the trade page's display face for the client name, big figures and card titles, its text face for
  everything else, with the app's `num` figures; the phone's texts in Inter. All load from `film/fonts/fonts.css` before
  the first frame (the render stops if they don't). The hand-off text's 🌱 (🧽, 🪵, 🌳) needs a colour emoji font on
  the render machine (Noto Color Emoji is installed here).
- **Colours:** only the app's tokens (`apps/web/src/styles.css`, light theme) as the trade's page sets them
  (`film/src/theme.ts`), plus the phone's iOS colours. The canvas's glows, dots and ground, the window's hairline and
  the shadows take the trade's colours too; the violet and blue below are the app's own look, which no trade film
  uses now (section 10).

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
| 5 · Replies | 15.30–20.45 | The console: the first day's five rows change to `Sent`; `Sending` pops in · the view pans to Replies (1.65 s): its chips, the chip `We read every reply and answer it for you`, the app's line "Every reply to every note, read and sorted. The ones who want the work come first.", and the replies already in, sorted (lawn: Holly Evans, `Wants it done`; a film that shows five has three there) · the last two arrive 0.65 s apart: Raj Pierce's "Not interested, thanks." lands below Holly (the sort, as it happens), then Tom Hall's "Yes, still want it done. Any day next week works." on top (18.45 s), each labelled as it lands, the chips stepping with each · 0.6 s after his reply lands (labelled at 0.56 s), his row lifts; the rows under it make room; `We wrote back` fades into the space: "Thanks Tom. I'll give you a call tomorrow to get it on the schedule. Kyle" · a second chip beside the first: `We text you the ones who want the work. You call.` | Every reply is read, sorted and answered; the ones who want the work go to him. |
| 6 · Hand-off | 20.45–24.45 | The phone: `Thu, Feb 12 at 6:19 PM`, the hand-off text, word for word ("🌱 NEW — Tom Hall, 144 Bog Rd / Last job: Jun 6, 2025 · $55 · Mowing visit / … Best contact: (603) 959-9461 (anytime) …"), scrolled in at no more than 12 px a frame, then held · `Fri, Feb 13 at 10:47 AM`: he types `BOOKED 700 #DRN`, taps · our answer: "Booked: Tom Hall, $700. Added to your results." | Everything he needs to call is in one text; he books it and tells us in three words. |
| 7 · Results | 24.45–27.40 | Replies fade; the underline fades to Overview · two figures rise: `$4,725 Booked · 3 jobs` (the money in the page's own colour, its accent, as the trade page sets its money; the app's green is for a status) and `7 Asked to come back · 9 wrote back` · the ledger rises with the earlier bookings · his row slides in on top, tinted, and Booked counts to `$5,425 · 4 jobs` · the next two bookings land as the weeks go by, and with the last the figures reach the round's end: Booked `$9,975 · 6 jobs`, Asked `9 · 16 wrote back`. | His booking is in his results the moment he texts it. |
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
- **Render.** Playwright Chromium at 1280 × 596, device scale 1.5; a frame every 33.3 ms, each PNG piped to two
  ffmpeg encoders: H.264 High (preset slow, tune animation, CRF 20, aq-mode 3 against banding in the glows, yuv420p,
  BT.709 tagged, +faststart, no audio), and H.264 at 1280 × 596 (CRF 22) for phones. No WebM: on the trade pages a
  second encoding is page weight, and every browser plays the MP4.
- **Checks before anything is called done** (the render fails loudly on any of them):
  1. Seam: frame 0 vs t = 35.5, mean difference < 0.5 / 255.
  2. Edge: in every 15th frame the outer 30 output px are white (each channel ≥ 254).
  3. Words: every half second, the text actually visible on the page (phone included) has none of the section 4
     list, and "free" only inside the lines that carry its price.
  4. Fonts: Cal Sans and Inter are loaded before frame 0.
  5. Contact sheets (every 0.5 s, and each scene change at 0.1 s), looked at against SmartLead's.
- **Another trade.** Add its company to `profiles.ts` and its page's look to `src/theme.ts` (its tokens from its CSS,
  its fonts into `fonts/`, OFL only, its logo mark), run `pnpm --filter @qa/web film:content <trade>`, build, render
  with `--trade <trade>`. If `content.ts` refuses (names repeat, or no run has a reply whose figures agree), try another
  `sampleSeed` (`FILM_SAMPLE_SEED=film-<trade>-7 FILM_OUT=<file>` tries one without touching the film's file). Tree,
  painting and fence sell the one pass: section 10 has what changes (two exports, an old quote followed, the billable
  bookings, the pass's last text in place of the round's, and the pass promise).

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

## 9. As built (Oct 8, round 3; round 5's changes are in sections 10 and 11)

**Run it.** From `apps/web`:

```
pnpm film:content <trade>           # content(.<trade>).json from the software (in the repo); --picks lists the runs
pnpm film:build                     # vite build --config film/vite.config.ts → film/dist (ignored by git)
node film/render.mjs --trade <trade>                # → apps/site/public/film/<trade>/film.mp4, film-1280.mp4, start*.jpg, poster*.jpg
node film/render.mjs --trade <trade> --cut phone    # → film-phone.mp4 (1080 × 1080), start-phone.jpg, poster-phone.jpg (section 11)
node film/render.mjs --trade <trade> --frames <dir> && python3 film/sheets.py <dir> <sheets-dir> <trade>   # sheets
node film/render.mjs --trade <trade> --stills 0,12650,22000 --out <dir>                                 # moments
pnpm film:dev                       # the page in a browser: ?trade=fence&t=12650 shows a moment, ?play plays it, &cut=phone the phone cut
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

**Stills:** `start.jpg` is the film's first frame: what the page shows while the film loads, so playback starts where
the picture left off (never a cut back from a busy frame). `poster.jpg` is 22.0 s (the sorted replies, our answer to the
one we follow, both chips, and the hand-off text on his phone): the picture that waits for a viewer who'd rather press
play (reduced motion, or a browser that won't start it). Each comes at 1280 too (`start-1280.jpg`, `poster-1280.jpg`)
and for the phone cut (`start-phone.jpg`, `poster-phone.jpg`).

**Embed:** the trade pages' own (section 10, "On the pages"): a `<video>` with no `src` or poster until he opens it,
and the page picks the cut for his screen.

---

## 10. The four films (Oct 8, round 4)

Jack, Oct 8: "a drop down on each industry page… cleaning, fence, tree, and landscaping… the correct demonstration
industry info for each, like a cleaning company for cleaning… I love the video, just recreate them with correct color
scheme and info for each industry." The same film, the same craft and beats, made once per trade: its own made-up
company, its own words out of the software, its page's look.

### The look, per trade (`film/src/theme.ts`)

Each trade page's tokens (`apps/site/src/green.css` for lawn, `trade-<trade>.css` for the others, on top of
`soro.css`) mapped onto the app's tokens by the names the app's were made from (the table at the top of `theme.ts`):
the page's `--violet` is the film's `--accent`, its inks its inks, its `--soft`/`--soft-2` the film's sunken and grey
fills, its `--shadow` the cards' shadow; the canvas's two glows are the accent and the colour the page puts beside it
(`--gold`). The rail and the phone's thread header wear the trade's logo mark (`apps/site/src/assets/logo-mark-*.svg`,
imported, not copied).

| Trade | Page | Accent | Beside it | Faces |
|---|---|---|---|---|
| Lawn | `green.css` | field green `#1B5A31` | harvest yellow `#FFD23F` | Archivo: headings wide and heavy (`font-stretch` 112–118 %, weight 750–780), text at normal width |
| Cleaning | `trade-cleaning.css` | deep teal `#075156` | sunny yellow `#FEC827` | Instrument Sans (headings 500), Instrument Serif for the card title, as the page sets its section titles |
| Fence | `trade-fence.css` | cedar `#7A4423` | sky `#8FD0FF` | Archivo, as lawn |
| Tree | `trade-tree.css` | conifer `#1E4D33` | arborist orange `#FF8A2A` | Archivo, as lawn |

His phone is his, not the page: its texts stay in Inter (the stand-in for the iPhone's face), its bubbles iOS's.
The note card's chip "About their own job" carries the trade's own icon (sprout, sparkles, fence, a pine: round 6, the deciduous tree read as a bell at 14 px). The money (the
Booked figure, the ledger's values, the Charges figure) is in the page's accent, as each page colours its money (cedar on
fence, teal on cleaning); the app's green is only for a status (Sent, Sending). Instrument Sans's word space is narrow,
so on cleaning the " · " between the parts of a line gets a little more room (`.film-sep`).

### The companies (`film/profiles.ts`, every name web-searched Oct 8; the searches are beside each)

All four sit in real towns around Concord, NH, where the sample's customers live; PO boxes; customers' numbers in the
958/959 exchanges; the owner signs his or her own notes.

- **Lawn: Desrochers Lawn & Landscape**, Bow (section 4, unchanged). The free 150 and the monthly lines.
- **Cleaning: Theriault Home Cleaning**, Hopkinton; Nicole Theriault, signs as Nicole; PO Box 382, Hopkinton, NH 03229.
  Her export reaches us Sunday, Mar 1 at 8:52 PM; our text Monday, Mar 2 (cleaning's spring busy months). The one we
  follow is **Tim Green**, 67 Stark Hwy, Pembroke, a bi-weekly regular (59 visits, last Jun 2, 2025, $176 a visit; the
  List says he's worth $4,224 a year): "the regular cleaning", "We used to take care of the regular cleaning for you,
  and the last time was last June." He writes Wednesday at 12:27 PM, "Perfect timing actually, we were just talking
  about it. Let's go ahead."; we answer that Nicole will call today, and she texts BOOKED 3700 at 6:59 PM. The welcome
  text's first note is Gary Nguyen's deep clean from October 2024, "so you're due for another one" (round 6: it had
  said "coming up on when it's due" 17 months on). Its List and Notes table are regulars and deep cleans, three
  regulars in each, never more than two of a kind in a row. The round: $7,550 from 9 jobs; 19 asked to come back. The
  free 150 and the monthly lines.
- **Fence: Boisvert Fence Co.**, Pembroke; Marc Boisvert, signs as Marc; PO Box 117, Pembroke, NH 03275. His two exports
  (Quotes Report and Jobs Report) reach us Sunday, Mar 8 at 9:14 PM; our text Monday, Mar 9, as fence season opens. The
  pass: the whole list once, newest first, 1,246 people (every old quote that never booked and every past customer)
  from 10 inboxes in its 30 days. The welcome text's first note is Doug Turner's, for the privacy fence, and his is the
  Notes table's first row; its call list names Nancy Stone (vinyl fence in the backyard, $12,375), Diane Nelson
  (privacy fence, $9,475) and Ben Jensen (aluminum fence around the pool, $8,575). The one we follow (round 6) is
  **Priya Zimmerman**, 44 Hawthorne Way, Canterbury: quote #2506, May 26, 2025, $4,275, a white picket fence out front
  ("the picket fence out front"), never answered. She writes Thursday at 7:52 PM, "Yes! That's still on my list. Go
  ahead and schedule it."; we answer that Marc will call tomorrow, and he texts BOOKED 4675 at 9:46 AM Friday, re-priced
  up from the 10-month-old quote (the hand-off's heads-up). The pass: $106,325 from 31 jobs (the median of 60 runs is
  $104,650); he pays $1,000, the cap. (Round 5 followed Nancy Donovan's vinyl fence: a second Nancy, and the call list's
  job, beside the call list's Nancy Stone.)
- **Tree: Corriveau Tree Service**, Henniker; Derek Corriveau, signs as Derek; PO Box 506, Henniker, NH 03242. His two
  exports reach us Sunday, Apr 12 at 8:31 PM; our text Monday, Apr 13. The pass: 1,347 people from 11 inboxes. Its jobs
  are named with their work (round 6): "the stump grinding", "the willow removal", "the oak pruning by the lines", "the
  maple cabling", not "the stumps", "the willow". The one we follow is **Joan Lewis**, 133 Hopkinton Rd, Henniker:
  quote #1410, Oct 4, 2023, $850, a spruce removal in the back yard ("the spruce removal in the backyard"), never
  answered. She writes Thursday, Apr 30 at 11:26 AM, "Yeah let's do it. Same as the quote is fine."; we answer that
  Derek will call today, and he books it at 3:41 PM at $875, re-priced up from the 2½-year-old quote. The pass: $41,900
  from 46 jobs; $1,000, the cap. (The sample business is `film-tree-5`: seed 3's welcome text called three lot
  clearings in a row, and its first note's person shared a surname with every typical run's ledger.)

### How a film picks what it shows (rounds 5 and 6, Oct 8–9)

`content.ts` chooses, by rule, never by hand; each rule is something a critic or an owner caught:

- **The reply we follow** (`followable`, every reply of every typical run, best first): it's not the welcome text's
  first note's person, and on a one pass not for the same job either ("the birch by the driveway" twice reads as one
  template); his BOOKED comes no sooner than our answer promised ("today", "tomorrow after 5", "on Monday", counted from
  when the answer went), so the phone never contradicts the console; it prefers replies in the daytime (one at 3 AM
  makes the hand-off say "At 7am we'll write back"), times off the hour (a note at exactly 9:00 AM, a text at exactly
  7:00 PM read as scripted), on a one pass a quote a year old or more (the one nobody asked about again), and a round's
  last text that names him.
- **The run:** the best-scoring reply whose run keeps every name it fixes on screen (the one we follow, the ledger's
  rows, the welcome's first note, the call list) clear of a shared surname. A clash is a reason to take the next run,
  never to drop a row from the run's own ledger.
- **The Notes table** starts with the welcome text's first note (the note his phone shows him is the table's first row),
  and on a one pass never shows one job twice.
- **The List** on a one pass never shows one job twice (a fence shop's old quotes are privacy, vinyl, chain link,
  picket, split rail, wood, pool fences, gates and repairs), and has a past customer among its rows you can read
  ("Last job …"): a one pass's list is old quotes and past customers both.
- **The ledger** shows the four bookings before his, his, and the next two; the figures above it count the rest of the
  run as the last of them lands (a one pass's end is a beat of its own, below).

Round 6 (Oct 9), each again from a critic:

- **No name a viewer knows** (`FAMOUS`: Hank Hill, Rachel Green, Tim Allen, Tim Cook, Amy Adams…): the sample draws
  first and last names apart, so now and then they meet as somebody's. Never on screen, in any row or run.
- **No reply's line in two films** (`FILM_ORDER`: lawn, cleaning, fence, tree): the films sit side by side on the
  site, so each keeps clear of the lines the films before it show, compared by the simulator's line ("Yes. Is Tuesday
  possible?" and "…Thursday…" are one), and says which films after it need writing again. Lawn, the film Jack
  approved, comes first and is unchanged.
- **A reply reads as of its day**: none that puts off to the month or season it came in ("reach out again in March"
  written in March, "maybe in the spring" in April).
- **The call list and the one we follow:** never the call list's first names, and on a one pass never its jobs (round
  5's Nancy Donovan, a vinyl fence, under the call list's Nancy Stone, a vinyl fence). A lapsed regular followed was a
  regular: six visits or more (a "regular cleaning" of two visits and a $325 booking is none). On a one pass he books
  at or over the old quote (the hand-off says to re-price; a re-price after a year goes up).
- **First names that meet** where they're read together (two ledger rows, the welcome text's names, a name in the
  round's last text beside a different one in the ledger) cost a run's pick 150 points: a much better story carries
  one (lawn's two Sarahs, rows apart; cleaning's Tim Donovan in the last text beside Tim Green in the ledger, against a
  next-best story of a "regular" with two visits), an even one goes to the run without.
- **The one pass's figures add up** wherever Booked's jobs and the Billable bookings stand side by side (as his booking
  lands, and the ledger's last row): a run with a booking the billing doesn't count is passed over (tree's had 30 jobs
  beside 4 + 25).
- **The trade's everyday work shows** (`staple`, cleaning): three of the List's seven rows and three of the Notes
  table's five are regulars, never one job more than two rows in a row.
- **The Notes table's rows** prefer a time off the hour, a subject that names its job ("the chain link on Pine St", not
  "checking in from Boisvert Fence Co.") and fits its column whole, no first name or street twice, and on a one pass a
  few minutes apart (its first row is the welcome text's first note, the day's earliest: tree's goes at 7:00 AM).
- **The Replies view** never shows two avatars with the same initials ("JL" over "JL").

### What changes on a one pass (fence, tree)

| Beat | Lawn and cleaning | Fence and tree |
|---|---|---|
| 1 · Files | One export (`Jobs Report.csv`), the chip "one export" | Two (`Quotes Report.csv`, `Jobs Report.csv`), "two exports"; a row each in Files we've read; record chips Quotes · Jobs · Clients · years |
| 2 · List | The welcome text's "Going through your records, N past customers haven't been back."; "Last here" | Its first sentence, "In the last two years, 47% of your quotes never got a yes or a no."; "When": "Quoted Feb 2026" or "Last job …" |
| 3 · Note | A past customer's note | An old quote's note; a longer note takes a wider card before a taller one, measured, so the pair keeps 22 px under the tab rule and ends above the dissolve: 640, 720 or 800 wide, then 800 with its lines at 19 px and the row-to-card gap 12 (round 6: fence's sat 7 px under the tabs) |
| 4 · OK | "…then the rest of your 150 over the next few weeks"; the free-150 price line | "…then the rest of your 1,246, newest first… It's one pass through your list: the last notes go out April 7."; the pass promise |
| 6 · Hand-off | "Last job: …"; it scrolls in whole and holds | "Quote #2506: May 26, 2025 · $4,275 · picket fence out front" and the engine's re-price heads-up: taller than his screen, so it comes in on its top (a handover, as the welcome text's: the name, the quote, the heads-up, held 0.65 s once in), then scrolls gently to its end over 0.8 s on a sine (`T.handoff.end`, 21.65 s; round 5's 0.4 s read as a lurch), held 0.6 s before BOOKED; everything after it is 0.75 s later |
| 7 · Results | Booked; Asked to come back · N wrote back | Booked; **Billable bookings** "4 of 4 · 8 more past the cap" (the console's own figure, `billableBookings`), always adding up to Booked's jobs; the ledger lands the next two after his, the jobs counting with the money, and both figures with them (`billing.atLast`) |
| 8 · Close | The round's last text, his YES, our answer | **The pass's last text**, word for word: "Marc, your list is done. Asked 1,246, 132 wrote back, 61 wanted the work, 31 booked. You paid $1,000, the cap. / I'll check back next season." Nothing for him to answer, so the console answers it, once he's read it, one thing at a time (old words out, then the new in): the state pill from Sending to **Pass done** (the live console's word, 29.9 s), Booked to the **pass's end**, "$106,325 · 31 jobs · pass done Apr 10" (30.1 s: the weeks of bookings past the ledger's last row are their own beat, marked with the day it ended, not a jump as a row lands), then the Billable bookings figure to the console's own Charges figure, `$1,000 · paid, of $1,000` (30.3 s). The phone leaves 1.3 s sooner (30.9 s) |
| Offer | "Asked to come back" glides to the middle; the two monthly lines | **Booked**, at the pass's end, glides to the middle (the promise is per job that books); the pass promise, its two sentences on two lines, holds 0.2 s longer; the loop is 34.4 s |

The pass's last text needs what he paid: `content.ts` settles the pass's charges with the engine's own billing
(`settleCharges`, then each paid, `chargePaid`) at the moment the pass ends (`passEndIfDue`: every note sent, then a
few days for the replies to the last of them: a week if the list ran out early, three days once its end date has
passed, which is why "the last notes go out April 7" is followed by the last text on Friday, April 10), so "You paid
$1,000, the cap." is the engine's sentence on the engine's ledger. The Overview, the ledger and the last text all read
the run as it stood at that moment.

### As rendered (Oct 9, round 6)

`node film/render.mjs --trade <trade>` → `apps/site/public/film/<trade>/film.mp4` (1920 × 894), `film-1280.mp4` (1280 ×
596), `start.jpg` and `poster.jpg` (each at 1280 too); `--cut phone` → `film-phone.mp4` (1080 × 1080), `start-phone.jpg`,
`poster-phone.jpg` (section 11). Every render passed its checks (fonts, white edges, the seam, the words). Measured on
the rendered frames at 640 px (mean absolute grey difference between frames; SmartLead's largest is 3.8), no frame
jumping anywhere:

| Trade | Loop | Seam | Largest change (where) | film.mp4 | film-1280.mp4 | film-phone.mp4 |
|---|---|---|---|---|---|---|
| Lawn | 35.5 s | 0.000 | 2.66 (26.7 s, the round's last bookings landing) | 3.03 MB | 1.57 MB | 2.98 MB |
| Cleaning | 35.5 s | 0.000 | 2.94 (26.2 s, the same) | 3.18 MB | 1.64 MB | 3.09 MB |
| Fence | 34.4 s | 0.000 | 3.11 (27.4 s, the ledger's last row landing, its figures counting) | 3.48 MB | 1.75 MB | 3.17 MB |
| Tree | 34.4 s | 0.000 | 3.04 (27.4 s, the same) | 3.46 MB | 1.77 MB | 3.19 MB |

The phone cut's largest changes are its camera's moves (the whole picture moves while it does), all eased, none a
jump; its stillest stretches are his phone's texts. The lawn film's words are as Jack saw them (its content is
unchanged); it was rendered again for the info status's colour (Scheduled, in the page's green), its jobs counting
with the money, and its phone cut's new opening.

Round 5 against round 4's critics: the reply we follow lands, is labelled, then our answer opens (no empty gap; the
chips step once per arriving reply); the one pass's hand-off is never at rest mid-sentence (its top held 1.1 s, its end
0.6 s); its close holds 1.0 s on the phone, then the console answers (no 2.6 s freeze); the money is the page's colour;
the Notes table starts with the welcome text's note; the fence's jobs are a fence shop's mix; the tree's call list says
"lot clearing"; cleaning's " · " breathes; and "Can you call me after 5?" is answered "today after 5".

### On the pages (Oct 8)

**Oct 9: the drop-down became a film that plays in place.** Jack wanted it seen, not behind a row most people won't
open: the row is gone, and the film sits where the panel opened, playing by itself, muted and looping, while it's on
his screen, loading only once he's near it (`docs/STATUS.md`, Oct 9, has the rest). What follows is the Oct 8 drop-down;
its cuts, pictures and pause carry over, but for the square's strong still, now 20.0 s (section 11).

Each film plays on its own trade's page of the all-trades site (`lawn-site/`, `cleaning-site/`, `fence-site/`,
`tree-site/`), behind the "Want to see it run?" row under the three lines that say what we do. The site has its own
embed: `apps/site/build/render.ts` (`film()`) writes the row and a `<video data-film="/film/<trade>/">` with no `src`
or poster, and `apps/site/src/page.ts` does the rest when he opens it:

- **The cut for his screen:** the phone cut (`film-phone.mp4`, a square, section 11) on a phone held upright and on a
  tablet or window up to 900 px that's taller than a phone on its side (round 6: at 768 the wide film's words were 8
  px), as wide as 560; else the 1920 film where the screen has the pixels for it (a tablet at 2x), the 1280 one where
  it doesn't (a laptop at 1x). A phone on its side gets the wide film, never taller than his screen under the page's
  floating header (its white edges meet the page's white, so a film held to the height shows no bars), and full screen.
- **No cut back to the start:** while it loads it shows its own first frame (`start*.jpg`), so it starts where its
  picture leaves off. It starts once the panel has opened (0.48 s), not during the ease.
- **Never opens out of sight:** if the film would end below his screen, the page scrolls just enough to show it whole,
  the row still on screen under the page's floating header, and its Example line with it when they fit; on a short
  screen (a phone on its side) the film alone, whole under the header. The bar at the bottom of a phone steps aside
  while the open film is on his screen, and comes back once it's closed or scrolled away.
- **He can stop it:** a tap on the film, or the small button in its corner (a real toggle, `aria-pressed`), pauses and
  plays it. Off his screen (under a quarter showing) it rests, and it plays again when it's back, unless he paused it.
- **Reduced motion, or a browser that won't start it:** the strong still (`poster*.jpg`) under one big play in the
  middle (its class is `film-wait`: soro.css's `.big` is the money tiles' grid, which put the triangle at the button's
  left edge from 600 px up), named "Play the film" with no pressed state while it waits; nothing of the browser's own
  controls. A play cut off by his closing it (an AbortError) is no refusal.
- **Opened again** more than 3 s after he closed it, it starts from its beginning, not mid-story.
- **Full screen** on its own line under the caption, not on a phone (its cut is already its screen's shape); it waits
  a moment for the film's size, and falls back to an iPhone's own full screen.
- **A screen reader** hears the film named for what it shows ("we write, in the owner's name, to the people behind a
  fence company's old quotes, and its past customers, …") and described by the Example label and its sentence, nothing
  else.

- **The cold email pages** (`<trade>-cold-email-page/`, the link in each trade's "show me" reply, where an owner from
  an email lands) have the same row, closed, at the end of "What happens after you press start" (round 6). The lawn
  page's row says "a landscaping company", as the page calls him (its second line fits two lines on a phone).

The row's seconds are read from `film.mp4`'s own header at build time, so a new cut only needs re-rendering; the site's
tests (`apps/site/test/film.test.ts`) want every file of a trade there and the same length. To put a new trade's film on
its page: render it here (both cuts), add the trade to `FILM` in `apps/site/build/looks/make_trades.py` and a `film`
entry to its page in `apps/site/src/trades.ts`, then regenerate the pages.

### Engine changes made for these films (all true in the product)

- The owner texts write their counts with thousands separators ("the rest of your 1,246", "Asked 1,246"): a one pass's
  list runs past a thousand.
- The hand-off text's mark for cleaning is 🧽 and for painting 🎨 (they had the fallback 🔔).
- Round 5: our instant answer keeps the time a person asked to be called, when the day's call can keep it ("Can you
  call me after 5?" is answered "I'll give you a call at (603) 959-8809 today after 5"; "after 5", "after work"), and
  the hand-off says the same ("We already wrote back that you'll call them today after 5").
- Round 5: a tree company's lot-clearing quote is "the lot clearing", not "the lot"; a fence's vinyl privacy fence is
  "the vinyl fence" (in the backyard), and split rail and picket fences are named as such.
- Round 5: the fence sample business quotes what a New England fence shop does (split rail, picket and wood stockade
  fences beside the privacy, vinyl, pool, chain link, gate and repair quotes), so its old quotes read like a real book.
- Round 6: a tree company's jobs are named with the work quoted (`objectWork`): "the oak removal", "the maple pruning",
  "the stump grinding", "the maple cabling", "the hedge trimming", "the ash treatment" (storm work and clearing keep
  their object: "the maple", "the lot clearing"); a homeowner's reply still says the tree ("The spruce got worse over
  the winter"). A fence repair is "the fence repair".
- Round 6: work that came due well before the note goes is "so you're due for another one", not "you're coming up on
  when it's due again" (a deep clean every 6 months, the last one 17 months back).
- Round 6: the welcome text's call list names the biggest of each kind of job (another kind takes a place when it's
  worth half as much: a lawn shop's mowing stays), never one job at one amount twice, each with its whole amount
  ("$12,375", never "$12k", which rounded three vinyl fences alike); the summary keeps the 60 biggest to choose from.
- Round 6: a reader fix that matters to every owner: "Still need it. The oak got worse over the winter honestly. When
  can you come?" was filed as Later in April ("over the winter" read as next winter); a season something got worse in
  is the past, and it's a yes.

### Calls for Jack (round 4)

- **The one pass's numbers are big.** The pass is the whole list (every old quote and every past customer), so a
  fence shop with three years of quotes has 1,246 people on it and books 22 jobs worth $104,550 in a typical run (the
  middle of 60 runs); tree, 1,347 people and 32 jobs, $37,775. Against the pages' Nelson Fence (4 of 150) they're the
  same rate on a bigger list. A smaller sample business (a list of 400–500) would bring a fence run to 6–8 jobs.
- **The one we follow on a one pass is an old quote** (a year or more), so the hand-off says the price is old and to
  re-price, and his BOOKED is a little over or under the quote. Newer quotes book too; an old one shows the point.
- **The round's last text names its first bookings**, not the one we follow (lawn's names Tom Hall; cleaning's names
  four others, "+5 more"). It's the engine's close, in the order things came back; listing the biggest first would
  name Tim Green but changes the lawn film's text too.
- **Lawn and tree are both green**, as their pages are (tree is "the lawn page's cousin"); the films differ in the glow
  beside the green (yellow, orange), the logo mark, the company and every word. Giving the meaning chips each page's
  second colour (peach on tree, gold on lawn) would set them further apart, but changes the lawn film's look too.
- **The phone is Inter in all four**, not the page's face.
- **The old violet film is gone from `apps/web/film/out`** (it's in git's history at 3ea29c9); the four films are in
  `apps/site/public/film/<trade>/`.

### Calls for Jack (round 6)

- **Lawn and tree still share their green.** Tree's arborist orange is its page's button colour; giving tree's chips or
  count pills that orange (and lawn its gold) would set the two films apart, but changes the lawn film's look. Left as
  it was.
- **The landscaping page's film is a mowing company's** ("Lawn care", the mowing and the lawn program). A row about a
  spring clean-up, mulch or a patio would need the lawn sample to quote them; left as the film he approved.
- **The cold email pages now carry the film**, closed, at the end of "What happens after you press start". If the
  "show me" reply links somewhere else, the row comes off with one line in `make_trades.py`.
- **The statuses keep the app's green** (Sent, Sending, Wants it done): a status, not a look. The info status
  (Scheduled) now takes the page's accent on its wash.
- **Two small things the rules weigh rather than forbid:** cleaning's round's last text names a Tim Donovan while its
  ledger shows Tim Green (the next run's story is a "regular" with two visits); tree's Notes table starts at 7:00 AM,
  because its first row is the welcome text's first note, the day's earliest.
- **The Replies chips** step as the console counts them (Wanted the work, Later and Closed out leave out auto-replies
  and bounces, so they don't sum to Everything), as the live console does.

---

## 11. The phone cut (Oct 8, round 5)

On a 390 px phone the 1280-wide frame puts the app's 13 px text at 4 px: nothing in it reads. The phone cut is the same
film, the same clock and the same words, framed by a camera (`film/src/camera.ts`) in a square, `film-phone.mp4`,
1080 × 1080 (a 480 × 480 CSS page at 2.25, `?cut=phone`; `render.mjs --cut phone`; CRF 26, about 3 MB). On a phone it
shows 390 px across, so the console's text reads at 7–9 px (the note card, shown whole, at 6–7), his phone's texts at
9–10 px, all of it at the phone's own 3x pixels, against 4 px in the 1280-wide frame.

- **A camera, not a second layout.** Every shot is a point of the frame and a zoom (`z`: the square shows 480 / z frame
  px across): never more than the frame's height, never past its own pixels (0.66 ≤ z ≤ 1).
- **The shots:** where the loop begins and ends, the console's header and its whole row of tabs (z 0.65, round 6: its
  start frame had cut the tabs at "Settin…" over an empty square), in to his export and the list as it arrives (the
  left of the canvas, z 0.78), the note card whole (its measured width), its three chips close (z 0.8), the notes
  table, his phone whole with the console's column beside it (the notes' status flipping; z 0.92), his phone nearly
  alone for the hand-off and the last text (round 6: the strip beside it showed reply cards cut to their labels), the
  replies with our answer (z 0.68), the results (z 0.66) and the
  offer, centred.
- **It moves only when the film hands over,** on a sine, 0.7–1.3 s, never faster than the film's own pan: in with the
  rising row to the note, over to the chips once it's signed, back as the table rises, to the phone as it comes in, to
  the replies as the view pans to them, back to the phone for the hand-off, to the results, the phone for the last
  text, the offer, and home to where the loop began while everything fades (the seam holds).
- **Its edges melt into the page** on all four sides (14 px of white, then a fade: 44 px at the sides, where the camera
  cuts through the window, 26 at top and bottom), so it draws no box on the page's white.
- **Its own stills:** `start-phone.jpg` (frame 0) and `poster-phone.jpg` (20.0 s, the replies with our answer, filling
  the square and melting into the page on all four sides; `render.mjs --cut phone` picks it). Until Oct 9 it was 22.0 s,
  his phone with the hand-off, where the canvas beside it ends in a hard edge 70% across: on the page, a box with a
  right edge, under the big play of reduced motion or Low Power Mode.

