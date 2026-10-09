# Quiet Accounts — build status

Updated every loop iteration. Newest first.

## 2026-10-09 — the film plays on the page

Jack (Oct 9): the film is good enough to be a feature of the website; behind a drop-down most people won't see it, so
it should just be there and play where it is, on its own.
- The "Want to see it run?" row and its panel are gone. On the lawn, cleaning, fence and tree pages the film sits under
  the three lines that say what we do (on their cold email pages, at the end of "What happens after you press start"),
  as wide as the section, its white edges in the page's white, with the Example line under it, word for word.
- It plays by itself, muted, looping and in place, as smartlead.ai's does, while a quarter of it is on his screen; off
  screen it rests (battery), and it plays again when it's back, unless he paused it. Pause: a tap on the film, or its
  button (a real toggle, shown on touch screens and on keyboard focus, and there from the start, so Tab comes to it
  before "Full screen"), as WCAG 2.2.2 asks of anything moving over 5 s. "Pause" always pauses, even while the film
  rests; a pause in the browser's own full screen player is kept too.
- It costs nothing until he's near it: no src and no poster in the page; three-quarters of a screen away the page picks
  the cut (the square one on a phone, the 1280 or 1920 film) and its first frame. A visitor who never scrolls that near
  it loads none of it; on a tall screen whose first view reaches that far (an iPad Pro held upright, a 2560 × 1300
  window), it loads straight away.
- Nothing on the page moves when it loads: the box has its shape from the stylesheet before anything loads, the square
  one by the same media query the page picks the square cut with (a test holds the two equal). A phone turned on its
  side mid-film gets the wide cut at the same moment, playing or paused as it was.
- Reduced motion, or a phone saving data (Save-Data): it doesn't start on its own; its strong still waits under one big
  play, and nothing heavier than that picture loads until he taps. A browser that refuses to start it (an iPhone in Low
  Power Mode) gets the same still and play; a pause before it started is no refusal.
- Kept: the phone's bottom bar steps aside while the film is on screen; full screen for the wide cuts; the film's
  spoken label and description. Painting and every other page stay without a film.
- Reviewed by three critics (real devices, look and page flow, code and tests). Fixed: on a tablet held upright and a
  phone held sideways the pause floated in the white beside the picture (the film's box is now the picture itself);
  "Full screen" took the three lines' headline type on the trade pages; with scripts off, the browser showed its own
  dark, empty player (now there's no film); a film that can't load or decode now shows its strong still, with no
  button that does nothing; turning a phone and back before the new cut loaded restarted the film; a tap on the film
  in full screen fought the browser's own player. The square's strong still (`poster-phone.jpg`, what reduced motion
  and Low Power Mode show) is now 20.0 s, the replies with our answer filling the square, not his phone beside the
  canvas's hard edge.
- Checked in Chromium with WebM stand-ins for the films (this Chromium plays no H.264) and the pages' own fonts: the
  lawn, cleaning, fence and tree pages and the fence cold email page at 390 (a phone at 2x) and 1280, each playing a
  few seconds in, and the whole fence page at 390. After the review, the same way at 390, 768 × 1024, 844 × 390,
  932 × 430 and 1280: the pause on the picture, full screen and back, Tab to the pause, a film that can't decode,
  scripts off, and a phone turned twice in a moment. Still for Jack: open one page on his iPhone and watch it start on
  its own, with Low Power Mode off and on.
- The zip for Netlify: `pnpm build:site` writes apps/site/dist.zip (not in git). For Jack to download, the latest one
  is also on its own branch, `site-zip` (quietaccounts-site.zip and a README; replaced, never added to, so the main
  branch's history doesn't carry 37 MB a build).
- Not live yet (Oct 9). Jack asked to put it live, but the live quietaccounts.com isn't this build alone: its Oct 8
  deploy (from outside this repo) adds the Jobber app's functions, 72 redirects, /privacy, /terms, a renewal letter
  page with a link to it on the trade pages, its own start form markup, and /for/<company> pages that need the old
  assets. Deploying this build would remove them, so nothing was deployed. The site-zip README says how to merge it
  into the folder the site is deployed from. The ten preview links (the trade pages and their cold email
  pages, published as artifacts) were updated in place with this build.
- Engine 1,800, server 632, site 496 (485 before the review).

## 2026-10-09 — a film per trade, behind a drop-down on its page

Jack (Oct 8): a drop-down on each industry page ("want to see demo"), starting with cleaning, fence, tree and
landscaping, each film with its own industry's company and info and its page's colours, fitting the page without
breaking it up; and mockups of the pages with the film in them.
- Four films in apps/site/public/film/<trade>/ (lawn, cleaning, fence, tree): the 1920-wide film, a 1280-wide cut and
  a square phone cut (a camera follows the action so the app's text reads on a 390 px phone), each with its posters,
  about 8 MB a trade. The lawn film is the Oct 8 one re-made in the lawn page's green; the violet one is gone from
  apps/web/film/out (it's at 3ea29c9).
- Each film wears its page's look (apps/web/film/src/theme.ts: accent, the colour beside it, faces, logo mark) and
  has its own made-up company in a real town near Concord, NH, web-searched for clashes (apps/web/film/profiles.ts):
  Desrochers Lawn & Landscape (Bow), Theriault Home Cleaning (Hopkinton), Boisvert Fence Co. (Pembroke), Corriveau
  Tree Service (Henniker). Every word on screen is the engine's or the
  server's output for that company. Fence and tree run the one pass ($250 a booking, never more than $1,000); lawn and
  cleaning the monthly plan.
- The page: under the three lines that say what we do, a quiet row, "Want to see it run? 34–35 seconds of it working for
  a <trade> company. No sound." Closed, nothing of the film loads; open, it plays in place, muted and looping, scrolled
  into view under the header, with pause and full screen; the cut fits the screen (phone, 1280, 1920). Also on the
  cold email pages, closed, at the end of "What happens after you press start". Painting waits for its own film.
- Engine changes the films brought (reviewed Oct 9, kept): a service long past due says "so you're due for another
  one", not "coming up on when it's due"; tree work is named with what was quoted ("the oak removal", "the maple
  pruning", "the hedge trimming"); fence knows split rail, picket and stockade, and calls a repair "the fence repair";
  replies like "the oak got worse over the winter" read as the past, not a time to do the work; the welcome text's
  call list names three different kinds of job with their whole amounts; owner texts put thousands separators in
  counts ("Asked 1,206"); an ack keeps the time asked ("tomorrow after 5"); cleaning and painting get their own
  hand-off marks; the fence sample quotes split rail, picket and stockade. Tests updated.
- Calls for Jack (apps/web/film/STORYBOARD.md §10 has them all):
  - The caption under the film says "Example · A made-up <trade> company. The notes and texts are what our software
    writes." The site's rule labels every example; the film itself says nothing of the kind. One line in
    apps/site/build/render.ts if he wants it gone.
  - Lawn and tree are both green, as their pages are; they differ in the glow beside it, the logo, company and words.
  - The one pass is the whole list, so fence and tree show big numbers (about 1,250 people and 22 fence jobs).
  - The landscaping page's film is a mowing company's, the film he approved.
  - H.264 playback was checked frame by frame in the renderer, not in Safari or Chrome on a real phone: open one page
    on his iPhone before sending traffic to it.
- Mockups: every trade page at 1280 and 390, closed and open (published as an artifact for Jack).
- Engine 1,800, server 632, site 483.

## 2026-10-08 — the service film

Jack (Oct 8): a demo video of the service, with the software as its backdrop, made like the video on smartlead.ai's
homepage (clean, smooth, no jump cuts, fits a page), with a made-up lawn company that looks real.
- apps/web/film/out/quiet-accounts-film.mp4 (35.5 s silent loop, 1920x894, 30 fps, 3.1 MB), .webm (2.5 MB), a
  1280-wide MP4 (1.6 MB) for small screens, and a poster. Embed it like SmartLead does: autoplay, muted, loop,
  playsinline. Its edges are white, so it sits on the site's white page with no border.
- The story, in the operator console's page for one client with the owner's phone for his part: his Jobber export
  comes in; the 525 past customers who haven't been back; a note to one of them typing itself in his name; nothing
  goes until he texts OK; the notes go out and every reply is read, sorted and answered; the hand-off text; his BOOKED
  text; Booked climbing on Overview; the round's last text and his YES; "First 150 free, then $497/mo if you say yes."
  and "Any month nobody asks to come back, you don't pay."; back to the empty canvas it began on.
- The company is made up and reads as real: Desrochers Lawn & Landscape, Bow, NH, owner Kyle Desrochers (no business by
  that name found Oct 8), a PO box for its address, (603) 958/959 phone numbers (reserved, they reach nobody). Every
  note, text, reply and figure is the engine's or the server's own output for that company (apps/web/film/content.ts);
  nothing on screen says example, sample or demo.
- Built as a page of its own (apps/web/film, own Vite config, the app's tokens and pieces), every frame a function of
  one clock, rendered frame by frame in Chromium and encoded with ffmpeg; the render checks the loop seam, white edges,
  the words rules and the fonts. Another trade: add its company to film/profiles.ts and re-render
  (`pnpm --filter @qa/web film:content <trade>`, then `film:build` and `film:render --trade <trade>`). The one-pass
  trades (tree, painting, fence) get the pass's promise automatically.
- Reviewed twice against SmartLead's frames (motion) and as a lawn owner who'd never heard of us (message).
- Engine changes it brought: the welcome text's BUSY example date now falls three weeks after the first notes (it said
  "Nov 15" in every month) and its call list writes phone numbers as (603) 555-0122, not +16035550122; the simulator's
  owner calls land in working hours. Tests updated.
- Left: 35.5 s is longer than SmartLead's 12 s (a shorter cut would drop a beat); the screen shows Jobber's Jobs report
  where the site asks for the Visits report; three labels for the same thing ("Wants it done", "Wanted the work",
  "Asked to come back"); a few generated names repeat a first name in the ledger.
- Engine 1,795, server 632, site 422.

## 2026-10-04 — the app on Jack's phone, like an app

Jack asked for the software on his iPhone "as an app but not an actual app": a home-screen web app. The app now has a
web app manifest (opens the live console, full screen, white), the violet "Re:" icon at iPhone and Android sizes
(apple-touch-icon 180, 192, 512), and the iPhone tags for full-screen use; the server serves those files (mountWeb in
apps/server/src/main.ts, tested). The phone header now wraps instead of clipping "Sign out" when the fonts are slow.
Until the server is deployed there is nothing to add: the claude.ai demo link (Quiet Accounts App) can go on the home
screen only as a shortcut to claude.ai.

## 2026-10-04 — the app in the site's violet look

Jack (Oct 3): the main website was redesigned (the violet look on main-site/ and cold-email-page/, apps/site/src/soro.css,
built on site-monday and now on this branch); make the software fit it. Look only: no wording, behaviour, data or API
changes (checked: every user-visible string is the same, some only moved or wrapped).
- Tokens (apps/web/src/styles.css) carry the site's design system under the names the app already used: white ground,
  the violet accent with its gradient, lavender tints, quiet greys, the site's soft violet shadows, a violet focus ring,
  and violet-tuned dark tokens in the same three-state pattern. Cal Sans headings over Inter (Google Fonts, as the site);
  the mono eyebrow is the site's lavender chip. Every text/fill pair checked at WCAG AA in both themes.
- The violet "Re:" mark replaces the orange one (same file names, so the server's /logo-mark.svg still serves it).
- Shared pieces: gradient pill primary buttons, white pill secondary, cards and boxes with the site's radii, line and
  shadow, 52px fields, lavender chips and status pills, pill nav with gradient count badges, lavender table hovers.
- Owner app and Welcome (a centred hero like the site's), onboarding, the demo console and the live console each got a
  pass at 390 and 1280 in both themes, then a screenshot critique against the site (16 issues, all fixed): empty tables
  on phones, word spacing in Cal Sans, tables that pushed past 390px, 44px tap targets.
- Left: the trade pages keep their own colours (green, aqua, cedar...); the app takes the main site's violet. Some live
  states were styled from code without real data (charges tables, a saved card, a brake that's on).
- Engine 1,795, server 629, site 422; the web build passes.

## 2026-10-01 — the two-offer brief (docs/BRIEF.md)

Jack's brief replaces the one big $497 offer with two: monthly for lawn and cleaning (first 150 free, then $497 a
month if the owner says yes; any month nobody asks to come back is free) and a one pass for tree, painting and fence
($250 per booked job, never more than $1,000). Built on top of this branch's later fixes, not reset to 2726e98.
Phase A, then B, then C, one commit per item, `pnpm check` green before each.

- Before the brief work: a third narrow check on the second verification pass found one regression, fixed
  (4f90adb). An owner's "Yes - deposit received" or "Yes - verbal" reads as a yes again, and a queued follow-up stops
  when its quote's status is one a person has to read (the hold only stopped new plans).

- **A1. Switch off what neither offer sells.**
  - New-request answering and the yearly plan sit behind FEATURE_NEW_REQUESTS and FEATURE_YEARLY, both off. Off
    means no always-on track (no answers to new requests, no day-2 fresh-quote follow-up), no requests+ address in
    any API or console response, no instant campaign; an email to a requests address is plain mail in the review
    queue. RENEW, YEARLY and ANNUAL change nothing and go to Jack; the trial's MONTHLY yes still works; no renewal
    ask, no year settle, no year offer at the close. CANCEL is final: no UNDO in its reply, UNDO not honoured (the
    operator's Restore plan has nothing to restore). No "within 5 business days" or "Jack will put everything back
    himself today" reaches an owner.
  - New accounts: autoAck off (a person reads every reply) and holdout 0; migration 4 moved existing accounts once.
  - Forecasts and fit tiers are gone from everything owners and visitors see, and gate nothing.
  - Trade detection (the site audit too), the console's menus and sign-up use only lawn, landscape, cleaning, tree,
    fence and painting; "Standard Cleaning" reads as cleaning. The other 14 playbooks stay in code.
  - Each plan works only the leaks the trade's offer sells, in one engine rule; a person whose first leak isn't sold
    is planned on their next one that is. "People still to work" counts the same people a plan can pick.
  - The console has no Jobber login or sync; Money Map is List, Reply Desk is Replies, Ready Text is Hand-off text.
  - The current site lost its two "7am to 8pm" lines and its part headings are plain words (A7 replaces it).
  - Left: the welcome text still opens with the shop's quiet quotes on lawn and cleaning (A6's wording pass); the
    demo's sample businesses keep a 10% holdout and auto-answers; a few operator hints mention "Yearly".
  - Brief notes: "the always-on track" also drove the day-2 fresh-quote follow-up and shorter detection windows, so
    all of it is behind FEATURE_NEW_REQUESTS; the planner's types filter only saw each person's top leak, so it now
    picks each person's first sold leak (on the 10k tree sample, 8,006 workable people).
  - Engine 1,342, server 311.

- **A2. Read lawn and cleaning exports** (engine only).
  - Jobber's Visits report reads as visits: every visit its own record under its client, the same result
    newest-first or oldest-first, with its date, job number, amount ("Visit based", or the one-off job's share) and
    crew ("Assigned to"). "Visit completed" is Yes/No; a visit not marked done counts as missed only when a later
    visit of the job, or the crew's own marking, has gone past it. A one-off job's visits are one job.
  - A Visits or bookings file is the whole calendar for the days it covers: a re-sent report replaces the earlier
    one's visits for its clients on those days.
  - Bookings exports (Booking ID, Service, Frequency, Booking Date, Price, Status) read as visits, not won quotes.
  - Client lists: "Last Visit", "Last Appointment", "Last Booking Date", "Last Cleaning", "Last Service" are the last
    visit; a frequency column sets the lapse, otherwise the trade's longest quiet spell (45 days for cleaning); lawn
    and landscape lists wait for B2.
  - A recurring job's single row (jobs report or sync) that ended months ago is a lapsed regular.
  - The ledger counts one job's visits as one booking; visits still on the calendar never count.
  - Readiness asks lawn, landscape and cleaning shops for the visits export first, never quotes.
  - Fixtures: a 40-client, 1,640-visit Jobber Visits report (newest-first, oldest-first, and amounts blank) gives 40
    customers with their full history, all 15 lapsed regulars found, 0 of the 25 active flagged; a bookings export
    with the same results; a cleaning client list with "Last Cleaning", with and without a frequency.
  - Left: lawn off-season and in-season values (B2); BookingKoala, Launch27, ZenMaid columns (C2); a crew that marks
    most clients daily but bills a few monthly reads those few's unmarked visits as missed (different "Assigned to"
    names keep them apart); leftover calendar visits of a never-closed job can still count as a comeback or a
    "crew nearby" line; Jobber's longer headers ("Service state/province", "Service ZIP/postal code") map the same
    way but have no test.
  - Brief notes: "Visit completed" is Yes/No, not a date; the 7-7 tie came from "Job #" scoring for jobs; the
    brief's bookings columns have no customer columns (the fixture adds them; real names wait for C2).
  - Engine 1,390. Checks under a 4-CPU load of 8-14 from parallel agents: the only failures were time limits (the
    10k-quote performance test, two copy tests, four server files), each green when rerun on its own; the scan
    takes the same time with and without A2 at the same load.

- **A3. The sender's name and per-client inboxes.**
  - A client's sending inboxes are a list (fromEmails); an existing account's one address became its one inbox.
    With Instantly, a client with no inbox of its own isn't planned and nothing of its goes out; the server-wide
    INSTANTLY_SENDING_ACCOUNTS pool is gone.
  - One inbox sends for one client (one helper, `holdsInboxes`, that B3 extends with "one pass done"), checked in
    Settings, Restore plan and before every send.
  - Before a client's first activation and whenever its inboxes, signer or name change, each inbox is checked: in
    no campaign this server didn't make, in no other sending client's campaign, named for the client ("Sarah" / "at
    Capital City Landscaping", or the From name split at its first word), and the name read back. A refusal holds
    the client like a pause, shows on its page and in Needs a person (one alert per client), and is retried every 15
    minutes or at once on a Settings change.
  - Later changes to send days, hours, timezone, pace or inboxes go to the client's existing Instantly campaigns.
  - Cold email: webhook and reply-check events from campaigns the server didn't make, or inboxes no client uses or
    used, are only logged (no Claude read, no queue item); an error on an unused inbox warns nobody.
  - Also fixed: every Settings save was resetting trade, timezone and signer role to their defaults (zod's
    `.partial()` keeps `.default()`).
  - Brief notes: the three Instantly calls run campaigns-check first, so an inbox in a cold campaign is refused
    before it is renamed (renaming first would change the cold campaign's sender name); accounts without fromEmail
    used to send from the server pool and now send nothing until they get an inbox.
  - Left: the one-pass inbox math (B3); ending a pass must clear the inbox check the way a cancel does (B3); the
    new-client form has no inbox field (add it in Settings).
  - Server 340.

- **A4. Booking texts that get lost or invented.**
  - A booking text with no #code, when nobody is waiting and its only fit is a lead the owner already told us about
    (BOOKED 2400 after DONE, or "She booked us for 2400" after QUOTED), replies "Got it, Jack will match it." and goes
    to Needs a person with the business and the text; nothing is recorded until Jack places it. Still placed: the
    lead's code typed without "#" ("Booked 2400 KAR"), and the amount alone right after "What's the job worth?". A
    no-code booking with exactly one lead waiting still books it.
  - Every booking text that gets "Which one?" goes to Needs a person, code or no code.
  - A phone number (7+ digits however written: 6035550142, 603-555-0142, (603) 555-0142, 555-0142) is never an
    amount, and nothing over $100,000 is ever recorded, in the rules and in Claude's second read; the text goes to
    Jack and books nothing.
  - Brief note: at this branch the no-code BOOKED after DONE didn't say "Nobody's waiting": it booked $2,400 onto the
    lead just marked reached (a later fix let recently reported leads match). "(603) 555-0142" was read as $603.
  - Server 345.

- **A5. Owner texts without Twilio.**
  - SMS_PROVIDER=manual is the production default until Twilio clears (used when the setting is unset and the server
    has production secrets); dev and tests keep the log; SMS_PROVIDER=twilio changes nothing.
  - Every owner text waits on the console's "Texts to send" list (all clients, newest first): business, owner's
    first name, cell, the text, Copy and Sent. Money texts reach it only after Jack approves them in Needs a person.
  - Each client's Overview has "Paste their reply": it goes through the same handler as the Twilio webhook, from
    the owner's cell on file. OK starts the first round, BOOKED 2400 #code records the booking, PAUSE and CANCEL work;
    our answer goes on the list. A client with no cell on file is refused with the reason.
  - CANCEL clears that client's list (except a refund we owe and the answer to the CANCEL); STOP wins (waiting texts
    go by email or to Needs a person). The console says where a hand-off went ("On Texts to send…").
  - Left: NOT OURS (B4); reminders to an owner who hasn't called a lead count from the hand-off, not from when Jack
    texts it; two older toasts still say "Texted to the owner".
  - Server 361.

- **A6. Small ones.**
  - Guarantee words follow the plan's kind through one engine helper: "asked to come back" (monthly, and a plan with
    no kind), "wanted the work" (one pass). The rule underneath is unchanged. No owner text, console screen or the
    site's Friday example says "price or a date"; the Friday line reads "Asked to come back: 3"; the monthly close
    promises "everyone who drops off each month".
  - The welcome text on lawn, landscape and cleaning opens with the past customers who haven't been back; tree,
    painting and fence keep the quiet quotes. The monthly welcome ends "The first 150 are free, then $497 a month if
    you say yes."
  - "put me back on", "same day as before" (as a request, or as the reply's last words) and "can you come back"
    read as wanting it back; things put back, complaints and an old day told rather than asked for don't.
  - New accounts send Monday to Friday, 7-10 a.m.; existing accounts keep their days.
  - Settings edits trade and time zone (an unknown zone is refused). Sign-up guesses the time zone from the cell's
    area code (US and Canada) and the alert asks Jack to check it.
  - The console shows the engine's real brakes: 3% bounces after 40 sends, 0.1% complaints after 300, 1% "who is
    this?" replies after 100 (they were wrong in four screens).
  - A server sending for real won't start with sign-ups on and no SIGNUP_ORIGINS.
  - Notes no longer say "that's on us for not following up", "I'll get you an updated price this week", "We've got
    openings coming up" or "Always glad to help a past customer"; a past customer's subject is the job, not the
    street; the linter flags those promises.
  - Brief notes: "same day as before" matched bare caught complaints and "Same day as before. We're good for now",
    which would have charged that month, so it needs a request around it; the operator console's "want a price or
    date" (no "a") was missed by the brief's grep and is reworded too.
  - Engine 1,469, server 374.

- **A7. Site: the lawn page and the front page.**
  - The public site is two pages, plain Vite, no framework: `/` (logo, one line, the two offer cards, footer) and
    `/lawn` (the monthly page from reference/lawn-page.html with every §5 monthly edit).
  - /lawn's hero holds "Your company name" and "Start my free 150 →" with "then $497/mo if you say yes" beside it.
    The first press sends nothing: it shows his first note with his company in it (signed "Sarah", an example name,
    until he types his own) and the text he'd get. The same button then sends the rest, with the consent box. A ?co=
    link opens it filled in. One form per page; every button scrolls to it; sticky bar on phones.
  - The note and the owner text are the engine's own words, rendered at build time from a fixture (a lawn customer
    who stopped weekly mowing); no engine code reaches the browser; a test checks the page against the engine.
  - The form posts JSON to {VITE_SERVER_URL}/start, or to Netlify Forms (a hidden static form "start" with a
    honeypot); any error offers an sms: link to Jack with the company filled in. /start takes `offer` and `trade`
    (the operator alert shows both) and `ref` (page, ?src=, UTM, cut to 200).
  - claims.ts: landscaping lead costs (about $118 search, about $37 Local Services) and the Jobber facts confirmed on
    the live Help Center (up to two reminders, at most 90 days out; Campaigns reaches only people who qualify after
    it's set up; a monthly add-on). "$29/month" is on no live Help Center page any more, so the site doesn't say it.
  - `pnpm build:site` writes apps/site/dist plus dist.zip. Every built page passes a word-ban check; at 390px the
    headline, promise and button sit in the first screen (Playwright check).
  - Brief notes: Housecall Pro's export path is Jobs → Actions → Export (no filter step); the reference form sent
    "hcp", which /start recorded as unknown software; the sticky price line needs two lines at 390px.
  - Left: the file drop is C1; Lighthouse not run (not available here). /lawn keeps the reference page's one Friday
    line; the old site's unused example Friday text (apps/site/src/friday.ts) and its server test are gone.

- **A8. Deploy kit, not a deploy.** Nothing was deployed.
  - A root Dockerfile (Node 22, pnpm from packageManager via corepack) builds the console and runs the server and
    worker in one process; a .dockerignore. tsx is a server dependency now (it runs the server).
  - The database is /data/quiet-accounts.db on a mounted volume. The worker backs it up nightly (`VACUUM INTO`
    /data/backups/quiet-accounts-YYYY-MM-DD.db, once a UTC day from 07:00 UTC, newest 14 kept; BACKUP_DIR moves them)
    and never fills the disk: it drops the oldest copies first, and if the copy still won't fit it writes nothing and
    says so on the health page. A failed copy leaves no partial file and retries an hour later.
  - .env.example lists every setting, marked required, optional or coming, with what happens without it; a test
    fails if a new setting isn't listed. Updated at merge for A1's flags, A3's removed sending pool and A5's manual.
  - README.md "Run it": one always-on host with a disk (Fly, Render, Railway with a volume, or a VPS; not
    serverless; one copy), the settings, the webhook URLs, the volume size (about 16 times the database), backups and
    restore. The VPS command publishes the port on 127.0.0.1 only, behind Caddy or nginx.
  - The health page: GET /api/health/setup (operator only) and a Setup box in the console: Instantly webhooks (OK,
    failing or not set up, and the last delivery), the SMS mode, the Stripe mode (manual, test or live, never the
    key) and the last backup.
  - Left: the Dockerfile hasn't run under real Docker (no daemon here; each stage was run by hand and the result
    booted and backed up); Render's and Railway's proxy hop counts unconfirmed; the Setup box is desktop-only.
  - Server 389.

- **Re-check of A2 and A3** (their last fixes had not been reviewed again): 24 reported, 20 confirmed, 18 fixed.
  - A2 (14 confirmed, 7 serious, all about what the ledger counts, which B4 bills from): a re-sent client list now
    keeps one last-visit date per client (it was stacking dates, so the month's drop-offs were missed and each list
    added a $0 booking); an owner's BOOKED keeps its date and is never taken off the ledger because the job's first
    visit isn't done yet; "schedule stopped" is judged per job, so a rebooked regular's new job counts and the old
    job's leftovers don't; a never-closed job's Active status no longer hides the lapse its visits show; a job made
    before the first note is never a comeback; visits removed by a re-sent report stay removed after a restart; a
    BOOKED text and the same booking seen in visits later are one booking; a quote tracker with a "Booking Date"
    column reads as quotes again; skipped, no-show and lockout visits aren't work done; a Visits report without "Job
    type" doesn't turn multi-day one-off jobs into weekly regulars. Left: two visits of one job on consecutive days
    can still set a rhythm.
  - A3 (6 confirmed): an answer never goes from an inbox that went to another client, even after a cancel; an inbox
    alert marked handled comes back while the client is still refused; the 15-minute inbox check no longer throws
    away Jack's unsaved Settings edits; emptying "Notes come from (name)" goes back to "<signer> at <business>".
  - Engine 1,489, server 395 (timing tests rerun alone under load).

- **B1. Site: the tree page, plus painting and fence.**
  - /tree, /painting and /fence from reference/cold-email-page.html, each one HTML file and one trades.ts entry on
    A7's shared pieces. The form sits in the hero: company name and "Get my first note →" show his first note and the
    text he'd get without sending; the rest sends offer one_pass and the page's trade. Every button carries "$250 per
    booked job, never more than $1,000"; the consent box adds the $250 sentence; no free offer anywhere.
  - Each page's note and text are the engine's own words to its own example customer (an old tree quote, a painting
    estimate, a fence quote). The calculator uses Nelson Fence's 2.7% and adds "You'd pay $X, that's Y% of it"
    (X = min(jobs, 4) × $250); ?q= sets the quote count and shows the Google-reviews line, ?j= the average job; each
    starting number says "Example" until he slides it.
  - Results lead with Nelson Fence; every result carries the label; tree and fence show Dow's only with the family
    disclosure and Capital City as "a landscaper's past customers"; painting never names Dow's. claims.ts has the
    painting lead cost ($138, LocaliQ). "When do I pay?" is the pricing card word for word.
  - The front page links /tree and /painting; nothing links /fence. The sticky header now sticks; every word on a
    solid background meets WCAG AA contrast. Lighthouse on a phone (local build): performance 98, accessibility 100
    on /, /lawn, /tree, /painting and /fence.
  - Brief notes: the painting "Why $250?" line in §5 ("Our two old-quote shops each booked 4 from 150") counts Dow's,
    which §1 forbids there, so painting says Nelson Fence alone; tree and fence name both shops with the disclosure.
    The reference CSS's overflow-x: hidden on html and body stopped the sticky header sticking.
  - Left: what the pages promise for billing (the $250 pay link, NOT OURS, the whole list in about four weeks) needs
    B3 and B4 before the first one-pass booking; /cleaning is C3.
  - Also: a flaky server test that "forged" an owner link by changing its last two characters to "xx" (the real link
    about 1 time in 4,096) now never picks the link's own characters; the links' 144-bit MAC was never the problem.
  - Site 108, engine 1,489, server 395.

- **B2. Lawn seasons.**
  - Lawn and landscape mowing and maintenance run in a growing season set by where the business is (the profile's
    state, else the mailing address; the north's season with neither). New Hampshire is mid-April to October 31,
    about 28 weeks. The playbook's arrays alone said about 35, so the north's season opens six weeks later.
  - A regular is gone only when he didn't come back in the first four weeks of his usual season, or stopped mid-season
    missing three of his usual visits. His season ends where the shop's own regular work ended that year (where three
    in four of its regulars still on it in the last six weeks had stopped), or earlier if he usually stops earlier. So
    nobody who was here at the end of his season is flagged over the winter.
  - A weekly regular is worth 28 weeks of visits, not 52. Lawn client lists follow the season, and a lawn shop can
    start from one.
  - Clean-ups, aeration and mulch are due in their season and wait outside it. A lawn shop's past customers hear from
    it only in fall clean-up season (September 1 to mid-November in the north) or January to March; nothing in summer
    or December. The lapsed regulars' second note carries the matching fall or spring line.
  - Each note belongs to one selling season and never goes out in another: a pause or a late OK can't send the fall
    line in January; notes past their season are never sent or handed to Instantly, and ones Instantly holds are taken
    back. An OK that lands past the window rewrites those notes for the next window's first send day and says so.
  - The sample shop mows in season only.
  - Fixture: scans on Oct 15, Jan 15, Mar 1 and Jun 15 flag 0 active customers; October finds last season's fall
    clean-up customers; January to March finds lapsed regulars with spring wording; nothing is planned in December.
    Minnesota and Georgia shops ending early October and November 1 flag nobody active either.
  - Left: notes a pause holds past their season are cancelled, not rewritten (the next plan picks them up); warm
    states use the north's selling months; in March, last fall's clean-up customers get a clean-up due-again note
    (the playbook treats spring and fall clean-up as one service).
  - Merge notes: A2's tests that plan in August now plan from September 1; the January-window tests pin Tue-Thu sends.
    With A6's Monday-to-Friday sends, a lawn shop's January round could start on January 1 (fixed by the holiday
    rule below, Jack's Oct 1 yes).
  - Engine 1,534, server 405, site 108.

- **B3. One-pass mode.**
  - A plan has a kind: monthly (as before, and any plan with no kind) or one pass, with its own terms ($250 a booking,
    at most 4 charged, booked within 60 days of the reply, 0 or 150 free first, done 30 days after its first send day)
    and stages (running, done, paused, cancelled). The operator API and Settings take them and refuse a stage that
    isn't the kind's. A sign-up from a one-pass page gets a one pass that starts when Jack first plans it.
  - Every gate checks the kind first: the owner's OK to the first note applies; the 150 limit, nightly top-up, the
    $497 billing check and the free-round close don't; the whole list goes once, newest first, with no holdout, no 40%
    share per leak and no 150-day rescan; the console's Plan button takes the whole list.
  - Pacing (engine `paceOnePass`): the steadiest daily pace that gets the last first note out 12 days before the end
    date, with follow-ups modelled as Instantly sends them (+4 and +5 days, ahead of new people) and no inbox over 30 a
    day. When the date can't be met, the pass is planned to the soonest date it can meet, and an alert names that date
    and how many more inboxes would meet the first. A late OK, BUSY and OPEN pace the pass again.
  - Instantly: a one pass's campaigns send up to 30 a day per inbox and start no one ahead of the pace (each person is
    handed over on their first note's day); each inbox's daily limit of 30 is written with its name and read back.
  - The end: the worker marks the pass done once nothing is left to send and its last replies have had time; done
    stops everything, frees its inboxes for another client, and closes its alerts.
  - Owner texts: its own welcome (newest first, the last notes' day, the one-pass promise; "free" only on a freeFirst
    pass); the end text "Asked 412, 38 wrote back, 9 wanted the work, 6 booked." with the ledger's bookings and no
    "You paid" line until B4, then monthly if 30 or more a month come due, else "I'll check back next season". It
    always waits for Jack's OK. MONTHLY from a one-pass owner goes to Jack. No one-pass text says $497.
  - Who gets monthly: `refillRate` (past customers we can email who stopped or came due in the last 12 months, a month
    on average), shown in the console when a free 150 or a one pass ends.
  - The console shows the plan kind, list size, sent so far against the end date, and "— of 4" and "—" placeholders
    for billable bookings and charges until B4.
  - Fixture: a 600-person pass on five inboxes gets its last first note out by the end date minus 12 days; on three it
    raises the alert naming the date it can meet; neither has a holdout, a rescan or a top-up.
  - Brief notes: with the brief's own rules, 600 people with three notes fit on four inboxes in a 30-day pass (three
    don't, five leave room); the tests assert the number the engine computes. "It rescans after 150 days" only put
    people back in a count; planning already skipped them. A one pass needs a "not started" state the brief doesn't
    list: a running pass with no start day.
  - Merge notes: B2 and B3 both rewrote the OK to the first note; it now does both (a late OK paces a one pass again,
    and notes the move takes past their season are written again for the next window).
  - Left: the "You paid" clause, charges and the CANCEL reply's "no more charges" wording (B4); the fresh export at
    the end (B6); with direct mail (not Instantly) follow-ups go on the templates' own days.
  - Engine 1,596, server 443, site 108.

- **Re-check 2 of A2 and B2** (the ledger and seasons code where B2 and B3 met it; findings verified, then fixed).
  - A2 (12): an owner's NO after a BOOKED holds once visits replace the booking; a BOOKED and a later list or Jobs
    report are one booking, never a second $0 one; a record with no price keeps the owner's figure; a re-pointed list
    booking never comes back under the same id; a job begun before our note is never a comeback; a job cancelled before
    any work comes off even when the next Visits report covers only a range; a customer back on his own never-closed
    job stays counted; an Active job protects a regular when the export ends today.
  - B2 (9): a free 150 planned late in a selling window is planned whole (whoever can't start before it closes starts
    in the next one, and the welcome text says when); a lawn shop's free round isn't closed while some of the 150
    haven't heard from us; the close names the next batch's real day, never "next week" in December. With no visits of
    his own, a regular's season opens mid-April everywhere (no March flags in warm states). Two missed monthly bills is
    gone mid-season. The season is read only as far as the records reach, so active regulars aren't "stopped" between
    exports; in season, records over two weeks old hold the nightly top-up and Jack is asked once for a fresh export.
    A visit past its day on an old calendar isn't done work. A note 1 taken back at season's end is never planned
    twice. Plow customers aren't lapsed mowing regulars.
  - Merge notes: B3's one pass keeps its paced days (the next-window roll-over is for a limited round only), and the
    welcome text keeps B3's one-pass wording with B2's "the last N from <day>" on the monthly one.
  - Engine 1,625, server 446, site 108.

- **B4. $250 per booking, capped at $1,000.**
  - The count: `billableBookings` (engine) reads the ledger and the replies by customer.
    - A real reply to one of the pass's own notes: not stop, not interested, wrong person, complaint, out-of-office or bounce; never a new-request answer or a reply to a note from before the pass. A reply read before its note's sent event counts too (the note it stopped was the pass's).
    - Booked within 60 days of the first such reply, dated by the day the booking was made (job created, quote approved, invoice issued, BOOKED text or console entry). With only the work date, it's that date. A quote goes by its approved day, never the day it became a job: the very quote the pass chased too, and a job made from an approved quote, even when the job is what the ledger saw first. A quote approved before the pass wrote to them (approved, never scheduled) goes by the day its job was made. The same day decides the cancel.
    - One per customer, whatever the booking ids. Four within the cap: it counts charges not refunded or cancelled, and a disputed charge holds its place until Jack decides.
    - Not "not ours". Made before any cancel, by text or in Settings; a booking the day of the cancel counts as after it.
    - A job cancelled before the work, or a quote whose job was, isn't a booking. Neither is a booking the owner texted whose export shows the job only cancelled (every job of theirs since the first note).
    - freeFirst: the first N written to (by first note sent) are free and outside the cap.
    - The rest of a lawn or cleaning list: cleaning bills only if the customer is back on a regular schedule; lawn only a season or one job over $500.
  - A pass gone monthly (the owner's yes to the end text, set up in Settings) still bills its own bookings by its terms (`billsPass`):
    - The worker keeps settling and charging them. Paid outside and NOT OURS still work, and the CANCEL reply counts what's still owed.
    - The console keeps the pass's box, "The one pass before this plan", with its charges and the card.
    - The pass is done the day it went monthly (if not before), and its notes end there, so a reply to a monthly note never bills $250.
  - The charge log, kept on the plan:
    - One charge per pass and customer: its booking, the lead's code, $250, status, Stripe ids, times and reason.
    - Once a charge exists it's the record. A booking that drops out before the charge cancels it, with the reason. After the charge it never refunds by itself: Jack gets "Refund X's $250?" in Needs a person. If that customer books again, the question goes away and the $250 stands for the new booking. Money paid after its charge was cancelled stays his to decide.
    - A Settings save or any plan patch never touches it.
  - Owner texts, each with the lead's #code, always wait for Jack's OK. His OK sends only the text he approved; any other made meanwhile still waits for him:
    - Booking 1: the /pay link.
    - Bookings 2–4: "on your card ending 4242 on <day>". The card is charged one business day after the text reaches the owner (sent, or marked Sent on Texts to send), never before the day it names.
      - Until it reaches him (on Texts to send, back with Jack after a STOP, a failed send), nothing is charged and the day in the text moves on with today, on the list too.
      - Approved again, it counts from then.
    - The cap text, once, after the fourth charge is paid. A declined card's link text. A refund text.
    - They still go to a cancelled one-pass owner.
    - The end text now says "You paid $X" ("You paid $1,000, the cap.").
    - The one-pass CANCEL reply (a pass gone monthly's too) says what booked before today is still owed, otherwise "no more charges".
    - No one-pass text says $497.
  - NOT OURS #code (the only new owner-text rule; the paste box too):
    - Before the charge it's cancelled, its place freed, its waiting text withdrawn, and the booking comes off the ledger.
    - After the charge, Jack refunds or keeps it, and it holds its place meanwhile.
    - A lead with no charge yet comes off the bookings, and its customer gets a cancelled charge for the pass, so a job a later export brings isn't charged either.
    - A lead's code whose customer has a charge acts on that charge.
  - Stripe (fetch client, form-encoded bodies, Idempotency-Key on every write):
    - /pay/{signed link}:
      - Each unpaid open makes a fresh cards-only Checkout that saves the card (key {charge}:checkout:{n}) and expires the one before. A paid one says so; /pay/thanks is the success page. No raw Checkout URL is ever sent.
      - Marking a charge paid outside expires its open Checkout.
      - A second payment that gets through anyway asks Jack to refund that payment; the charge stays paid.
      - Replace all links kills the link, and each unpaid link's text goes again for Jack's OK with the new one.
    - The worker charges saved cards from their day, once the text reached the owner: PaymentIntent made unconfirmed (key {charge}:pi), its id stored, then confirmed off-session.
    - Stripe refusing it outright (a 4xx with no PaymentIntent, such as a deleted customer) fails it, so the link takes over.
    - A charge left mid-charge (a restart, a lost answer, a 5xx) is read back by its id after 10 minutes, then confirmed, waited on, paid or failed.
    - Refunds go through Stripe on Jack's OK.
  - POST /webhooks/stripe:
    - The signature is checked against the raw body (HMAC-SHA256, 5 minutes, timing-safe).
    - Each event is taken once by its id, and each change is guarded by the charge's status.
    - A link charge is paid only by checkout.session.completed with paid; a declined try inside Checkout changes nothing.
  - Operator API:
    - Mark a charge paid outside the software.
    - Paste a Stripe customer id: its default card, else the newest; without a key, only the id is kept.
    - Decide a refund, a NOT OURS or a second payment.
    - Send a link charge's text again.
  - Without a key: each approved charge waits in Needs a person as "Send the $250 link" or "Charge his saved card" (from its day, once its text reached the owner), with Done.
  - Settings: STRIPE_WEBHOOK_SECRET and STRIPE_ALLOW_LIVE. A live key is refused without STRIPE_ALLOW_LIVE=true; a key without the webhook secret is refused on a server with production secrets. .env.example, the README and the Setup box match.
  - Console:
    - Billable bookings "x of 4" and what's paid.
    - Each charge and where it stands ("the card a business day after its text reaches him" until it has), with "Paid outside" and "Send the link again".
    - The paid-twice question.
    - The card on file, with a box to paste a Stripe customer id.
  - Fake Stripe models idempotency keys, declines, processing, lost answers, expired sessions, a deleted customer and replayed webhooks. Every "Done when" case has a test.
  - Brief notes:
    - "One business day later" counts from when the text reached the owner, not from Jack's OK: in manual SMS mode the OK only puts it on Texts to send.
    - With a key, a link charge goes heads_up → link_sent at Jack's OK. "approved" is a card charge waiting for its day, or any charge without a key.
    - Booking 1's text names a /pay link, which exists only with a key. Without one it says "I'll text you the link." and Jack sends his own.
    - A booking dated the day of the cancel counts as after it.
    - A second booking that comes before the first link is paid waits for it, so "your first $250" stays true.
    - A charge in flight counts as charged for NOT OURS.
    - The off-session confirm answers a decline itself, so payment_intent.payment_failed is usually moot.
    - "Then monthly if his list refills": a pass's bookings stay billable for 60 days after each reply, so they're still billed once the plan is monthly.
  - Left:
    - Not checked against live or test-mode Stripe (no key was given). The Live steps say how.
    - A link the owner leaves unpaid isn't flagged by itself: it shows as "Link sent", and the bookings after it wait for it.
    - charge.refunded and card disputes (chargebacks) aren't handled: refunds are marked when Stripe's refund call answers, and chargebacks are Jack's.
    - The cap text isn't sent again if a refund frees a place and the cap fills again.
    - "One business day" didn't skip holidays (it does now: see Holidays below).
    - HELP doesn't list NOT OURS (no owner-text wording changes beyond the brief).
    - A late reply to a pass's note after it went monthly also counts as "asked to come back" that month. So one booking can bill $250 and also make that month paid. That's Jack's call.
    - A cancelled pass taken straight to monthly loses its cancel day, as any plan back from cancelled does, so its bookings after the cancel bill again.
  - Engine 1,662, server 488, site 108.

- **B5. Monthly billing on the saved card.**
  - The first $497:
    - The owner's yes after the free 150 (or MONTHLY in it) asks for the first month. Its text waits for Jack's OK: "Dave, here's the link for your first month, $497: [/pay link]. It saves your card, and I text before every charge. Any month nobody asks to come back, you don't pay."
    - The link uses the same Customer, cards-only Checkout, setup_future_usage and webhook rules as a booking's. If the link is opened again days later, it reuses the Customer its first Checkout made, so it never makes a second one after Stripe has forgotten the key.
    - Paid, the plan is paying from that day. Jack doesn't set Paying by hand any more.
    - Asked once: a second yes changes nothing.
    - At another monthly price (set in Settings), the texts, the Checkout and each charge use that price.
    - With the yearly plan sold (FEATURE_YEARLY), a plain yes, a trial's YEARLY and a one pass's YEARLY are still Jack's to settle by hand. Needs a person says so with its own note instead of saying a first month's text is waiting.
  - A one pass's owner going monthly (a yes to the end text, or MONTHLY, even while the pass is still running):
    - He gets the same first-month link. With his card saved, the first month goes on it the B4 way: text, Jack's OK, then charged one business day after it reached him.
    - Paid, the plan is monthly from that day. The pass is done that day (if it wasn't already), and its bookings are still billed by its terms. Only the monthly plan's notes from then on count toward a month.
  - Each month after:
    - The pre-charge text two days before now carries its month's charge. Its last line: "Your next month starts November 20: $497 goes on your card ending 4242 that day." With no card saved, it carries the /pay link.
    - It always waits for Jack's OK, even with AUTO_SEND_BILLING_TEXTS=true.
    - The saved card is charged off-session on the charge date, never before it and never unless that text reached the owner (sent, or marked sent on Texts to send). B4's PaymentIntent handling covers it: stored before confirming, read back after a restart.
    - A text that reaches the owner on or after the charge date (Jack approved it late, it sat on Texts to send, or the worker made it late) goes the booking's way. The card is charged one business day after the text reached him, and the last line names that day before it goes, on Texts to send too: "...goes on your card ending 4242 on Monday, November 23."
    - A free month: no charge, and the free-month text goes as before.
    - A month's charge id is the business and the month: charged once.
    - A declined month fails, and its link text ("Your $497 for the month from November 20 didn't go through…") waits for Jack's OK.
  - No subscription and no renewing link: nothing is charged but by this path.
  - CANCEL by text, or Cancelled in Settings:
    - Every month not charged yet (and a first month asked for) is cancelled and its texts withdrawn. A cancel the day before charges nothing.
    - A month already going through is left to settle. The owner's reply says so, and the text lands in Needs a person. If it's paid, the plan stays cancelled.
    - A later month that was declined or left unpaid on or before the cancel day stays for Jack. The owner's reply says it "is still unpaid, so Jack will look at it", and the text lands in Needs a person.
  - The yearly plan is never charged by this path, nor is a month of a paid year (or of a year in no paid year).
  - Without a key:
    - The first month waits in Needs a person as "Send the $497 link", and each month (from its charge day, once its pre-charge text reached the owner) as "Charge his saved card", each with Done.
    - Done is now by the charge's id.
    - Jack pastes the customer id as before.
  - Two fixes where the one pass meets the monthly plan (B4's two "Left" items):
    - A reply to the pass's notes never counts toward a month being paid, so one booking can't both bill $250 and make a month paid. The same goes for a reply we can't tie to a note from someone the pass wrote to, even if the monthly plan wrote to them since.
    - A cancelled pass taken to monthly keeps its cancel day, and no later cancel (by text or in Settings) moves it.
  - Console: a "Monthly charges" box (each month, its amount, where it stands, Paid outside, Send the link again) beside the pass's charges, and the card on file. Needs a person shows months as "Charge to collect" and "Charge to decide".
  - Brief notes:
    - The pre-charge text never said what would be charged. It now names the amount and the card.
    - A month is charged on its own date, not "one business day after the text" like a booking, because its text goes two days before. Only a text that reaches the owner on or after that date goes the booking's way.
  - Left:
    - Not checked against live or test-mode Stripe (no key was given).
    - A first-month link or a month's link left unpaid isn't flagged by itself: it shows as "Link sent".
    - A paid month can't be refunded from the console, except a second payment or one paid after a cancel. Jack refunds others in Stripe.
    - The fee totals (feesPaid) still count months from the first paid day and the free months, not from what was actually charged.
  - Engine 1,679, server 514, site 108.

- **B6. "Did it book?" check-ins.**
  - After each hand-off the owner gets "Did Karen Whitfield book? Reply BOOKED $amount #K7Q, or NO #K7Q." two days later and again at 14 days (engine `checkIn`, in the worker's daily checks from 9am local).
    - Weekdays only: one due on a weekend goes on the Monday.
    - It keeps asking until we know whether the lead booked. DONE, QUOTED and NO ANSWER don't say, so the check-ins go on after them. It stops on BOOKED or NO, on a text with the lead's code that went to Jack as one that could go either way, on a booking in the records for them from a month before they wrote back, or on a charge for them.
    - Someone who writes again after the owner's call and is handed over anew is asked about on the new lead's days, not both.
    - Never about someone who said stop (unsubscribed or complained), someone the owner took off the list (SKIP), or a lead marked lost.
    - A customer with no name on file is named by the address they wrote from.
  - One text a day at most: the day's check-ins go in one, a line and a code each.
    - An owner with two businesses on one cell gets one a day: the second's go the next weekday.
  - None while a question a bare yes or no answers is out to that owner's phone, on any of his businesses: the close, the renewal, or a one pass's offer to keep going monthly, even while that waits for Jack's OK. Otherwise his yes or no would be read as the answer to it.
    - One that comes due meanwhile is delayed, not dropped: its week runs from the last day the question held it, so it goes on the first weekday the question is no longer out, as long as nobody knows yet whether the lead booked. That holds however long the question was out, for example a close left at trial for three weeks after the owner's Yes while he takes his time paying.
    - If both of a lead's days passed during the hold, he is asked once.
    - The ask for a fresh export doesn't hold them: a bare yes or no while it's out acts on nothing and goes to Jack (below).
  - Answers without a code: a lead he was asked about counts as one he told us about lately (14 days). After DONE, a bare NO gets "Is that about Karen Whitfield? To mark that lead not a fit, text NO #K7Q. Jack will read this too." A bare yes after a check-in gets the usual "Got it. About a lead? Text BOOKED + amount + the #code, DONE, or NO." and goes to Jack too.
  - Nothing to a cancelled or paused client (PAUSE, or Paused in Settings), or an owner who texted STOP.
    - One still on Texts to send when he texts STOP is dropped, never emailed or passed to Jack.
    - One held up by a pause goes within a week of its day (or of the last day a question held it), or not at all.
  - It's an ordinary owner text: on Texts to send by hand, to the owner with Twilio.
    - Each goes once: the count is kept on the lead and each day's text has one id, so neither a second worker run nor a restart sends it again. The day a question last held it is kept on the lead too, so a restart keeps the hold.
  - The end of a one pass: once it's done (by the worker or in Settings), and if anyone gave its notes a real answer, the owner is asked once for a fresh export ("Dave, one last thing: can you send me a fresh export of your jobs and quotes, the way you sent the first one? I'll check it against everyone who wrote back."). It always waits for Jack's OK, like the end text.
    - It goes with the end text. When the end text offers to keep going monthly, it goes once that offer has closed (three weeks after the end text was written), so his "Sure" to the ask is never read as a yes to monthly. If someone writes back with a real answer after the pass is done, it's asked then.
    - Once Jack has let it go (sent, or on Texts to send), it's a question a bare yes or no answers, for three weeks from when it was written or until an import after it is read. A bare "No" gets "Got it — Jack will read this and get back to you. About a lead? Text NO and the #code." and a bare yes gets "Got it — Jack will read this and get back to you. About a lead? Text BOOKED + amount + the #code." Both go to Jack (Needs a person: "answered the ask for a fresh export with a no / a yes"), and neither marks a lead, however many are waiting. A yes while the close, the renewal or the monthly offer is out on his other business asks which business he means.
  - Every file import after the ask (the console, the owner's import address) is matched against everyone who wrote back, by B4's rules. The export can come as several files in any order (Jobber's Quotes and Visits reports are two emails).
    - The billable bookings each import brought wait in Needs a person as "Booking to confirm", with "Confirm it" and "Not from the pass". No money text goes for them until Jack answers.
    - Confirmed: B4's path (its text for his OK, then the link or the card).
    - Not from the pass: its customer gets a cancelled charge for the pass, so it never bills, whatever a later export or a BOOKED text brings.
    - One past the cap waits too. It isn't listed while the cap is full, and shows once a refund frees a place. One leaves the list once its customer has a charge (paid outside, or NOT OURS).
    - A booking already past the cap from a BOOKED text before the import isn't the import's: once a place frees, it takes B4's path without waiting for Jack.
    - Jack hears about each file that brought a booking, and once if the first brought none.
    - Bookings found any other way keep B4's path: BOOKED texts, console entries, a Jobber sync.
  - Console: "Booking to confirm" in Needs a person; texts labelled "Did it book?" and "Ask for a fresh export"; the owner view lists check-ins with hand-offs.
  - Brief notes:
    - The "queue item (in manual mode)" is the Texts to send list, as for every owner text.
    - The export isn't asked for when nobody gave the pass's notes a real answer: nothing could bill, and the end text has just said "0 wrote back".
    - A Jobber sync isn't an export, so it keeps B4's path.
    - No new owner-text commands. Three routing changes: a lead he was asked about counts as one he told us about lately; a bare yes after a check-in goes to Jack too; and a bare yes or no while the export ask is out goes to Jack, never to a lead.
  - Left:
    - A Jobber-connected pass is asked for an export too, and its hourly sync isn't held.
    - Check-ins don't skip holidays.
    - A free-text reply with the code that we can't read ("#K7Q she's away till November") goes to Jack but doesn't stop the day-14 check-in.
    - Jack can't withdraw the export ask, only approve it.
    - When the end text offers monthly, the ask waits the full three weeks even if the owner answered the offer sooner, or Jack never sent the end text. The same goes for a check-in held by that offer or by a close left at trial after the owner's Yes: it waits for the question's three weeks, or for Jack to change the stage.
    - While the export ask is out, a bare NO meant for a check-in goes to Jack instead of marking the lead: the owner needs NO and the #code, as the check-in text asks. A sent ask with no file stays open for its full three weeks, even after the owner says no.
  - Merge notes: built beside B5. The check-ins and the export ask sit with B5's first month and pre-charge texts (both still wait for Jack); a check-in is held while the close, the renewal or a one pass's monthly offer is out.
  - Engine 1,701, server 549, site 108.

- **Holidays. No notes on US holidays.** This is your Oct 1 answer to B2's merge note.
  - **The holidays.** The engine works them out for each year (`holidayOn`), with no table to maintain:
    - New Year's Day, Memorial Day (the last Monday of May), July 4, Labor Day (the first Monday of September), Thanksgiving (the fourth Thursday of November) and the Friday after, Christmas Eve and Christmas Day.
    - When New Year's, July 4 or Christmas falls on a Saturday, the Friday before is held too; on a Sunday, the Monday after.
    - Days are the client's own local days.
  - **Planning skips them.** These all move with it:
    - monthly rounds and their follow-ups;
    - a one pass's pace. Across Thanksgiving week it sends nothing Thursday or Friday and still meets its date, or names the date it can meet;
    - the free round's dates and the welcome text's days;
    - a late OK;
    - BUSY's day. The BUSY reply now names the real first send day, never a weekend or a holiday.
    - A lawn shop's January round in 2027 starts Monday January 4, not New Year's Day.
  - **Sent from the server.** A note planned for a holiday before this change waits for the next send day ("A holiday: Thanksgiving"). An answer to a new request waits too (that feature is off). Owner texts still go.
  - **Instantly.** Its campaign schedule only takes days of the week plus a start and end date. It can't leave out a date (https://developer.instantly.ai/api-reference/campaign/create-campaign), so the worker does it instead:
    - On the client's local holiday it reads the state of each of that client's own campaigns in Instantly and pauses only the ones sending (Active or Running Subsequences). It hands the client nothing new that day. The next day it turns back on only the ones it paused. Each tick re-checks.
    - A campaign Instantly stopped itself (Bounce Protect, Accounts Unhealthy) or you paused by hand is left as it was, before and after the holiday.
    - If Instantly won't give a campaign's state that day, the campaign is paused with the others and turned back on with them.
    - A restart that hadn't gone through when the holiday came (the worker is still retrying it) is turned back on after the holiday with the others.
    - It never touches your cold campaigns.
    - It never turns a campaign back on while the owner's PAUSE, the bounce brake or any other hold is on. A RESUME or a cleared brake on a holiday waits until the next day.
    - A client with no campaign yet gets none made that day.
    - When the server works out the day the platform will really send a lawn follow-up, it skips holidays too. A note 2 whose day lands on Thanksgiving is judged by the next send day after it. If that's past the season, the note is cancelled ("Out of season") and not handed over.
  - **Billing.** A business day is never a holiday: a card booking texted the Wednesday before Thanksgiving is charged Monday. A month whose date is a holiday is charged the next business day, and its pre-charge text names that day ("...on Monday, November 30"). This closes B4's "One business day doesn't skip holidays".
  - **Wording.** Settings (console and owner) and the owner's schedule say "Never on a US holiday: ...". The schedule marks each holiday.
  - **Merge notes.**
    - B2's tests that started the January round on January 1, 2027 now start it Monday January 4.
    - A senders test that resumed on the day after Thanksgiving now resumes on the Monday after.
    - The sending platform has one new call, `campaignRunning`.
  - **Left:**
    - Clients in Canadian time zones get the US holidays; there are no other countries.
    - With Instantly, an answer to a new request held over a holiday is dropped (and the owner told) the day after, not that day. That feature is off.
    - The site pages' "The first notes go out the next weekday morning" isn't true the day before a holiday. That's for the site work.
    - Not checked against live Instantly.
  - Merge notes: B6's check-ins are owner texts, so they still go on a holiday (on weekdays).
  - Engine 1,715, server 562, site 108.

- **C1. The site audit for past customers.**
  - The "Got it, <name>. One thing left." step now has the other way to send the file, after "forward that email": "Have the file already? Drop it here.", with a plain file picker for phones. It's read on his screen in the audit's worker, which loads only with the first file (Vite `?worker`, its own file; the page's script stays about 10 kB with no engine). A second file joins the first, up to five. A file that won't read (a folder, say), or a worker that won't load, doesn't block the next file: it reads on its own, in a fresh worker if needed. No "Try a sample" anywhere; the sample audit is gone.
  - The result shows right there. Past customers stand on their own:
    - how many haven't been back. Someone whose only reason to be on the list is work come due counts only once they've stopped coming too: past the trade's quiet time, set by how often they come when they're on a regular schedule. A cleaning regular still on the schedule whose first deep clean came due isn't counted. Lapsed regulars and one-time customers count as before;
    - what they paid in their last year with the shop: their bills, else what their visits billed, each job counted once, so a Jobs report beside the Visits report adds nothing. Nothing is estimated. It shows only when the file gives it for every one of them; otherwise there's no money line and no money column. A Visits report for fixed-price jobs, whose recurring visits carry no amounts, shows who and when but no money, never the one-off clean-up alone;
    - when they were last here: last 3 months, 3–12 months, then for lawn and landscape shops last season and before it, or over a year ago for other trades;
    - the engine's first note to one of the people counted, a lapsed regular first, with his company and first name from the form.
  - A lawn Invoices report on its own (the brief's case) gives the same people, months and money as its visits, and the note.
  - One-pass pages keep the quote result (quotes or estimates nobody answered, by age, and the note to the likeliest one) and add the past customers. A file with neither says which export to send: monthly pages name Jobber's Visits report, one-pass pages its Quotes report or Visits report. No page names Jobber's Re-engagement report.
  - With VITE_SERVER_URL set, "Send this file" ("Send these files" when there are several) makes a second /start POST with the same sign-up, the files and the audit's numbers, including the past customers and, when known, what they paid. Without a server, he's asked to forward the email as usual (one-pass pages: "the emails"). Nothing leaves the browser before that press. After a send, "It's all in, so there's no email to forward" shows only when nothing is still to come. On a one-pass page, a send with only the quotes, or only the past jobs, names the export still to come instead. A file picked while a send is out keeps its own result and send; the first send clears only the files it carried. A failed send says to forward the email(s) or text Jack, with an sms: link that has his name and company filled in.
  - The server already took a returning owner's file for an untouched sign-up. A test now sends it the site's way after sign-ups from /lawn, /tree, /painting and /fence. The operator's alert describes what the file holds, with the same people the site counted. A lawn Visits report reads "Their file is in (1640 visits): 23 past customers haven't been back (paid $26k in their last year)."; on fixed-price jobs the "(paid ...)" is left out. A one-pass file gives its quotes never answered and its past customers. A monthly trade's alert leaves quotes out, and a file with neither says there's nobody in it to write to.
  - Trade: the page passes its trade. The file's titles (quotes, jobs and visits, requests, and invoice subjects) pick among the trades that page's offer sells; the page's trade wins when they can't tell or tie. The trade the titles read most stays one of the shop's others, so mowing visits on /tree get a note about the mowing. The rule is the engine's `readTrade`. The site's audit and the server both use it: when /start reads a sign-up's file, the account gets the trade and other trades the site showed, so Jack's count and the planned note are the ones the owner saw. A cleaning file on /lawn makes a cleaning account, and the alert says "and reads as cleaning". A trade the operator set since stands. "Recurring Cleaning" reads as cleaning, and "Standard/Recurring Cleaning (3 Bed / 2 Bath)" no longer reads as landscaping. A landscaper's "Recurring Clean Up" or "Standard Clean-up" stays yard work.
  - Engine: `stoppedCustomers(ds, scan)` lists who stopped, when they were last here and, when the records say it, what they paid in their last year. `paidTogether(people)` adds that up, or gives nothing when anyone's is unknown. `readTrade(ds, page?)` reads the trade; `adoptTrade` takes the page's trade.
  - Screenshots: apps/site/screenshots/got-it-{lawn,tree}-{390,1280}.png (tree retaken). Nothing deployed.
  - Left:
    - A cleaning client list with no service names, dropped on /lawn, reads as lawn until /cleaning (C3) passes its own trade.
    - The one-pass "still to come" line names the export generically ("your visits or jobs export", "your quotes export") rather than by each software's report name.
    - A hyphenated "Recurring clean-up" next to mowing still reads as cleaning, as it did before C1: the cleaning playbook's recurring service matches "recurring", and lawn's clean-up service doesn't match "clean-up". Fixing it means changing lawn's service match, which B2's seasons use.
    - The scan still plans a "due again" note to a regular still on the schedule whose deep clean came due. Only the past-customer count and the note shown on the site leave them out; what the planner writes to is outside C1.
  - Brief notes: "last 3 months, 3–12 months, last season" overlap for a lawn shop, so lawn and landscape count this calendar year in months and earlier years by season. Passing the page's trade and reading invoice subjects only both matter if the page's trade is the fallback, so it is, on the site and the server alike. Plain "Recurring Cleaning" already read as cleaning; with a frequency or bedroom count beside it, it didn't.
  - Merge notes: built off A7 and merged after B6 and the holiday rule; one import line in runtime/agents.ts needed both sides.
  - Engine 1,636, site 148, server 448 (on its own base).

- **C2. Cleaning software exports (ZenMaid, BookingKoala, Launch27).**
  - Cleaning shops can send their booking tool's export instead of Jobber's Visits report:
    - ZenMaid's Appointments export.
    - BookingKoala's Booking Time Logs export plus its Customers export (the emails are only in the Customers export).
    - Launch27's booking CSV.
    - The client lists too: ZenMaid Contacts and Launch27 Customers.
  - Each tool is recognised by column names only its exports use.
    - Columns an owner's own sheet has too count only beside one of BookingKoala's own. These are "Provider", "Industry" and the clock: "Clocked in", "Clocked out" and "Time reported".
    - So a homemade bookings sheet or a crew's timesheet stays a spreadsheet.
    - Each export is read with a column map taken from the tool's help pages, with the URLs and the date they were read in the code.
  - A tool's own row columns decide what a file is.
    - ZenMaid's export dialog ticks every column by default. So its appointments come with the customer's Balance and what was Paid, and its contacts with each one's Balance and Revenue.
    - An appointment's ID or status still makes the file one row per visit. A ZenMaid contact's ID, Type or most recent clean makes it one row per client.
    - Both read correctly under any file name, not only ZenMaid's own.
  - A bookings file's Status is always read, BookingKoala's own booking CSV included.
    - Completed counts as work done.
    - Cancelled never counts and never makes a regular look active.
    - ZenMaid's Locked Out counts as a missed visit.
  - BookingKoala time logs:
    - A log is made when the cleaner taps On the Way, before any work. It counts as a clean only once someone clocked in.
    - A log nobody clocked in on (a booking cancelled at the door), or one whose hours the office rejected, is not a clean.
    - The clock is read only in a file that BookingKoala's own columns name. It decides only where the Status doesn't say what happened; BookingKoala's Status is only the hours' approval.
    - An owner's sheet with a clock column is a spreadsheet. A clean the crew didn't clock in on still counts, with a Status or without one.
  - ZenMaid Appointments: a booking with a blank Recurrence and no Subscription ID is a one-time clean, the same as "one time". So it still gets the note to go regular.
  - ZenMaid Contacts:
    - A Recurring Customer (written "Recurring" too), or anyone with a Next Appointment, has a visit booked. They aren't written to, however old their last clean.
    - A One-Time Customer stays one after their clean. With no Next Appointment, how long since their last clean decides, as on any list.
    - A list sent again that says Former Customer makes them a past customer again.
    - Only ZenMaid's own Type and Next Appointment are read this way. An owner's list whose Customer Status says "Recurring customer" or "One-time customer" finds the same people as before.
  - The frequency column gives each client's rhythm (weekly, every 2 weeks, Bi-Weekly, Tri-Weekly, every 4 weeks or Monthly, One Time).
  - A plain Date beside a Frequency doesn't make a file a bookings file. It needs the time of day or Launch27's Final Price too, so an owner's quote tracker or client list reads as before.
  - A booking titled only "Standard Cleaning" counts as the regular cleaning when it recurs, and as a one-time clean when it was booked once.
    - So lapsed regulars get the "regular cleaning" note.
    - One-time clients still get "Want it on a regular schedule?".
  - BookingKoala and Launch27 now have labels in the console.
  - New fixtures, one per tool, with tests:
    - Each fixture finds the lapsed regulars and flags no active client.
    - The one-time-to-regular note is kept, and the plan picks exactly those people.
    - Detection by headers is tested, and a generic spreadsheet still imports as before.
    - ZenMaid Appointments:
      - The fixture has every column ZenMaid ticks by default.
      - It finds the same people under ZenMaid's file name, export.csv and zenmaid.csv.
      - With the Recurrence of its one-time bookings left blank, it finds the same people, Linda's one-time-to-regular note included.
    - A Contacts export with every column, Balance and Revenue included, stays a client list.
    - A bookings sheet with Provider, Industry or BookingKoala's own columns still reads Cancelled.
      - A cancelled series doesn't hold off a lapsed regular.
      - A cancelled one-time booking isn't flagged.
    - An On the Way log with no clock-in, and a log with rejected hours, are not cleans.
    - Clock sheets:
      - An owner's sheet whose crew only started clocking in during August is a spreadsheet, with Completed and Scheduled or with no Status at all. Every clean counts, and it finds the same people.
      - The same sheet beside BookingKoala's travel time is read as BookingKoala's: the clock is read and Completed still decides.
    - ZenMaid's booked clients are not flagged, and a past One-Time Customer is found as one-and-done.
    - An owner's list with a Customer Status column finds who it found without it.
    - A quote tracker and a client list with Frequency and Date stay quotes and clients.
  - Left:
    - BookingKoala time logs exist only for shops that turned on clocking in and out.
      - A shop without it has to send BookingKoala's "Download booking CSV".
      - That file has no documented columns, so it goes through the generic matching. Its Status is read, but nothing about it has been checked.
    - A BookingKoala time log needs one of BookingKoala's own columns to be known: provider status or payment, travel distance or time, estimated job length, total payable amount, pricing parameters or package addons.
      - "Select All" in its export dialog ticks them all.
      - Without one, the log is labelled Housecall Pro (because of its "Customer" column) or a spreadsheet. Its clock isn't read, and the dates decide which logs were cleans.
    - An owner's crew timesheet that also has one of those columns (a "Travel time", say) is read as BookingKoala's. There, a clean with no clock-in counts only if its Status says Completed.
    - ZenMaid's Appointments dialog scrolls past what its help page screenshot shows.
      - Apart from Customer Full Name and Recurrence, the columns past that point are unknown.
      - No help page shows what its money columns hold.
      - A blank Recurrence on a booking with a Subscription ID says nothing of how often it comes, so the dates decide.
    - ZenMaid Contacts without a Next Appointment column can't tell a One-Time Customer with a clean booked from one cleaned long ago. Without Type or Next Appointment, it can't tell a booked client from a past one. So the C3 export step should ask for Type and Next Appointment, or for the Appointments export.
    - The console's onboarding software guides have no cleaning-tool entries. The /cleaning page export step is C3.
    - Nothing has been checked against a real export file from any of the three tools.

- **C3. Site: the cleaning page.**
  - /cleaning is the monthly page with cleaning words (one HTML file and a trades.ts entry). Headline "Clients who stopped booking, back on your schedule." It has the same one button and price line, consent box, labels, Dow's disclosure and postal address as /lawn. At 390px the button shows without scrolling (Playwright check).
  - Money section: "You lose about 80 regulars a year." The two figures are new claims in claims.ts with their source beside them: 6.89% of regulars lost a month, and about $5,580 a year for a biweekly client. Both come from MaidCentral's Professional Cleaning Index for Aug 2026; the brief's research lines 369 and 395 are right. The calculator starts at 80 regulars and $5,580 (both read from claims.ts) and uses Capital City's 11%, labelled "a landscaper's past customers". Every result is labelled.
  - A link's ?j= (the average job) doesn't touch /cleaning's slider, because that slider is what a regular pays a year. The page keeps $5,580 labelled Example: a `perYear` flag in trades.ts, which page.ts honours the way /lawn ignores ?q= (Chromium test). Cleaning links need only ?co= and ?src=.
  - The example note is the engine's own note to a regular who stopped ("We haven't been by for the regular cleaning since September 1… Want us back on your usual schedule?").
  - After the form: Jobber's Visits report; for BookingKoala, Launch27, ZenMaid or a spreadsheet, the brief's one line, with no menu paths. Then "One question we'll text you: how many new regulars can you take this month? We pace the notes to that." New FAQ: "We're booked solid." The form sends trade cleaning and offer monthly, and a dropped file is read as a cleaning shop's.
  - The front page's lawn-and-cleaning card links /cleaning. /fence stays unlinked.
  - Screenshots: apps/site/screenshots/cleaning-390.png and cleaning-1280.png. Not deployed.
  - Left: Lighthouse not run (not on this machine).
  - With C1, C2 and C3 on top of B6 and the holiday rule: engine 1,781, site 178, server 565.

- **Billing review (B4, B5, B6 and the holiday rule together).** Four reviewers (the one pass, the monthly plan,
  Stripe and safety, texts and console) ran real scenarios through the merged code; two skeptics checked each finding;
  25 reported, 17 confirmed and fixed, each with a test. The ones that mattered most:
  - Reopening /pay after a Checkout payment the server hadn't recorded yet opened a second Checkout (a second $250 or
    $497). It now asks Stripe about the last session first.
  - An owner's "Ok thanks" to a money text while the one pass's monthly offer was open read as a yes to monthly. It now
    goes to Jack.
  - A booking that dropped out before its charge left that customer unbillable forever, so a real rebooking was never
    billed; a BOOKED with no amount was never billed at all.
  - A month that became free after its pre-charge text (Jack relabelled its only "asked" reply) was still charged; months
    not yet charged are judged again before Jack's OK and at charging.
  - The cap text wasn't withdrawn when a refund freed a place; the end text's "You paid" was frozen at the pass's end;
    the weekly "You've paid us" counted months never charged.
  - With texts by hand, saved cards were charged at 00:01 on their day, before Jack could paste the text; now from noon.
  - Adding a Stripe key after billing by hand stranded approved charges; a customer deleted in Stripe made /pay fail; a
    refund after a declined card marked paid outside went to the declined payment; texts for a nameless customer read
    " booked (#HQ4)".
  - Rounds 2 and 3 checked those fixes and the code around them: 14 and 9 more confirmed and fixed, each with a test.
    Among them: a Checkout paid for a booking whose charge had gone back on the saved card no longer leaves the card
    charged as well; a month paid early by its link and then cancelled or found free goes to Jack; a plain "Ok" to an
    unrelated text is never a yes to $497; a bare "No" to a pre-charge text reaches Jack; by hand (no key), a charge
    Jack was told to collect isn't dropped silently when its booking drops out, and NOT OURS and CANCEL don't claim a
    charge happened before he made it. Round 2 made a yes to the close go to Jack too often; round 3 fixed that.
  - Left: the review didn't reach a round with nothing new (25, then 14, then 9), and round 3's fixes weren't reviewed
    again. What it was still finding was edge cases (by-hand mode, re-cancels, totals in texts), not the main paths, and
    every money text still waits for Jack's OK. Run the Stripe test-mode steps below before the first real charge.
  - Engine 1,795, server 629, site 178.

**Live steps for Jack**
Before launch, in order (details for each in the list below): DNS; deploy the server (A8) with every setting from
.env.example; Stripe test mode end to end (B4, B5), then live with STRIPE_ALLOW_LIVE=true; each client's own inboxes and
sender names in Instantly (A3); the site to Netlify with form detection or VITE_SERVER_URL (A7); one test sign-up and
one test client from import to the first OK.
- (Phone) After the deploy, open the live console's address in Safari on your iPhone, sign in once, then tap Share and
  "Add to Home Screen". It opens full screen with the violet icon, straight to the live console, and stays signed in.
- (DNS) What the code needs, nothing more:
  - quietaccounts.com and www point at Netlify (its records or its name servers), so the pages and /start's form load.
  - One host name for the server (for example app.quietaccounts.com) points at the always-on host; PUBLIC_URL is that
    https address, and every webhook (Stripe, Instantly, inbound email, Twilio later) and /pay link uses it.
  - INBOUND_DOMAIN (for example in.quietaccounts.com) has MX records to your inbound email service, which posts to
    PUBLIC_URL/webhooks/inbound-email/WEBHOOK_SECRET. quotes@quietaccounts.com, the address the pages give owners, must
    forward there (or be that service's address) so a forwarded export lands in the import.
  - Each client's sending inboxes need SPF, DKIM and DMARC on their own domain before they're connected in Instantly;
    the server never touches DNS.
- (C3) Text each cleaning owner the clicks for his software. ZenMaid: Reports → Data exports → Export data → Appointments (only on its Pro Max plan). BookingKoala: Bookings → Booking Time Logs → Export, plus Customers → Customers → Export (the customer file has emails but no dates, and time logs exist only if clocking in is on; otherwise "Download booking CSV"). Launch27: Bookings → Download CSV (active bookings only).
- (Holidays) On Thanksgiving, open one Instantly client's page. Its campaigns that were Active should say Paused in Instantly, and its activity should say "Sending platform paused for this client: Because of Thanksgiving, a holiday".
- By Saturday those should be Active again, and the follow-ups due over the holiday should go out Monday.
- If one of that client's campaigns was already paused before the holiday (by you, or by Instantly's bounce protection), it should still be in that state on Saturday.
- Reading a campaign's state, and pausing and resuming through Instantly's API over a holiday, have never run against live Instantly.
- (B5) In Stripe test mode, with the B4 key and webhook set up:
  1. Text "Yes" from a test owner's phone to a client whose free 150 is closed, and approve the first month's text. Pay its /pay link with 4242 4242 4242 4242. The client should say Paying from today, with the card ending 4242 on file.
  2. Make a test reply to a monthly note in that month. On the day two days before the charge date, approve the pre-charge text and send it. Nothing should be charged the day before; on the charge date the month should say Paid.
  3. A quiet month: nobody asked. The free-month text goes and nothing is charged.
  4. Decline: paste a test customer with 4000 0000 0000 0341, then approve and send a pre-charge text. On its date the month should say "Didn't go through", with the link text waiting for you.
  5. Text CANCEL the day before a charge date. Nothing should be charged on it.
  6. Approve a pre-charge text on its charge date. Its last line should name the next business day, and nothing should be charged until that day.
- (B5) Without a key: "Send the $497 link" and "Charge his saved card" wait in Needs a person. Charge in Stripe on the day, then press Done, and paste the owner's cus_ id under Monthly charges.
- (B4) Stripe, in test mode first:
  1. In Stripe (test mode), add the webhook endpoint PUBLIC_URL/webhooks/stripe with four events: checkout.session.completed, checkout.session.expired, payment_intent.succeeded and payment_intent.payment_failed. Copy its signing secret.
  2. Set STRIPE_SECRET_KEY to the sk_test_ key and STRIPE_WEBHOOK_SECRET to that whsec_ secret, then restart. The Setup box should say "Stripe: test" and "Stripe events: none yet".
  3. Run one test client end to end:
     - **Link:** book a test lead (BOOKED 2400 #code) and approve its money text (in manual SMS mode, text it and press Sent). Open the /pay link and try 4000 0000 0000 0002: it's declined and the charge stays "Link sent". Then pay with 4242 4242 4242 4242: the charge says Paid, the card ending 4242 is on file, and the Setup box shows the event.
     - **Saved card:** book a second lead, approve its text and send it. Nothing should be charged before the next business day, and on that day it should be Paid.
     - **Decline on the saved card:** in the Stripe dashboard, make a test customer with the card 4000 0000 0000 0341 (it saves, then declines). Paste its cus_ id, book a lead, then approve and send the text. On its day the charge should say "Didn't go through", with the link text waiting for you.
     - **Refund:** mark a paid one's job cancelled in a new export, or reply NOT OURS after the charge. Refund it from Needs a person, then check the refund in Stripe and the owner's text.
     - **NOT OURS before the charge:** reply NOT OURS #code before its day (from the owner's phone, or the paste box). There should be no charge.
     - **Replace all links:** the old /pay link should say it's no longer valid, and a new text should wait for your OK.
     - **Gone monthly:** switch the test client to monthly in Settings with a card charge approved. It should still be charged on its day, and a lead booked after the switch should get its money text.
  4. Going live, on purpose, at deploy: set the sk_live_ key, STRIPE_ALLOW_LIVE=true, and the signing secret of a live-mode endpoint (live and test endpoints have different secrets).
  5. Without a key (manual mode):
     - Each charge waits in Needs a person.
     - For "Send the $250 link", text your own Stripe payment link set to save the card for future use, and press Done once it's paid.
     - Paste that owner's Stripe customer id (cus_...) under the one-pass box.
     - For "Charge his saved card", charge it in Stripe on its day, then press Done.
     - Do the same paste for each owner who already paid through your own link.
- (B2 re-check) In a lawn shop's season, send a fresh Visits report (or invoices) at least every two weeks. When one
  is older, Needs a person asks for it and nothing new is planned until it comes.
- (B3) On a one pass, check in Instantly that each of its inboxes shows a daily limit of 30 after its first activation.
- (B1) Keep /fence off every link until January. Look at /tree and /painting on a phone after deploying.
- (A8) Deploy: pick one always-on host with a volume at /data (Fly: auto-stop off, internal_port 8787), sized about
  16 times the database or with BACKUP_DIR on a second volume. Run the first real `docker build` on the host (the
  base image pull and corepack's pnpm download are untested). Fill every required setting from .env.example (an https
  PUBLIC_URL; OPERATOR_TOKEN, APP_SECRET and WEBHOOK_SECRET from `openssl rand -hex 32`; SIGNUP_ORIGINS;
  EMAIL_PROVIDER and INSTANTLY_API_KEY). Set TRUSTED_PROXY_HOPS to the proxies every request passes through (usually
  1, one more for Cloudflare; check your host's docs). On a VPS run with `-p 127.0.0.1:8787:8787` behind Caddy or
  nginx. After the first boot open the console's Setup box, point the host's health check at /api/health, and turn on
  volume snapshots or copy a backup off the host now and then.
- (A7) Either build the site with VITE_SERVER_URL set to the server's https URL (and that site origin in
  SIGNUP_ORIGINS), or leave it unset and turn on Netlify form detection (form "start"). Don't drag apps/site/dist
  or dist.zip to Netlify on its own any more: since Oct 8, quietaccounts.com (project brilliant-sorbet-d89cb5) is
  deployed from somewhere else and also carries the Jobber functions, 72 redirects, /privacy, /terms, the renewal
  letter page and the /for/<company> pages, and a deploy replaces the whole site. Merge the build into that folder
  instead (the steps are in the README on branch site-zip). The lawn page tells owners to forward their export to quotes@quietaccounts.com: that address
  must exist and reach the server's import before launch. Check /lawn and /lawn?co=Your+Company on a phone, then
  send one test sign-up.
- (A6) Set SIGNUP_ORIGINS to the site's address (for example https://quietaccounts.com) in production, or the
  server won't start with sign-ups on. Check each new sign-up's guessed time zone in Settings before planning.
- (A5) Leave SMS_PROVIDER unset (or manual) in production until Twilio clears carrier registration. Work "Texts to
  send" in the console and paste each owner reply on their client's Overview. When Twilio clears, set
  SMS_PROVIDER=twilio with TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.
- (A1) Leave FEATURE_NEW_REQUESTS and FEATURE_YEARLY unset (off) in production.
- (A3) Give each client its own inbox, connected in Instantly, in Settings before planning; keep client inboxes out
  of your cold campaigns. Check the Instantly API key can update accounts and campaigns and read account-campaign
  mappings (a client page saying "Instantly wouldn't name <inbox>" means it can't), and that Instantly takes an empty
  last name for a one-word From name. PATCH /campaigns has never run against live Instantly: if a client's activity
  says "Couldn't update this client's campaigns in Instantly", that campaign is still on its old settings.
- (A3) To move an inbox between clients, take it off the first client in Settings first; the second starts sending
  from it within about 15 minutes.

## 2026-09-30 — iteration 3

**Published (private links)**
- Call card for Jack (the 15-minute sales call, his numbers in, the script filled in):
  https://claude.ai/artifact/ScU3nCP4u2RV6oVzJzNb3b

**Done and green** (engine 829 tests, server 219, web + site typecheck clean)
- One-tap start: the free round's first plan waits for the owner. The welcome text shows their quiet
  rate and the first note word for word; OK (or "looks good", "send it") starts it, anything else is a
  change request for the operator and nothing goes out.
- Sign-up from the site (`POST /start`): company, first name, cell, consent and the file they already
  read in their browser; the account is made, the file read, and a "New sign-up" alert plus a "ready"
  item land in the operator's queue. Nothing is sent until the operator adds the mailing address and
  plans. Planning now refuses without a postal address (every note carries it).
- New requests by email for every shop: a `requests+<token>@` address per client. Forwarded website
  forms, Angi / Thumbtack / Google / Yelp alerts and homeowners' own emails are read (rules, then Claude
  only when the rules can't, keeping only contact details that are in the email word for word), added
  to the records and answered from the office on the always-on track. Unreadable ones go to a person.
- Honest money: the quiet month counts only people we followed up with; answers to someone's own new
  request never open a ledger record or count as a comeback; one quiet-rate definition (two years,
  14+ days old) shared by the site, the welcome text and the Friday report.
- Owner texts: SKIP + a name (off every list, asks when a name fits several); CANCEL in one text with
  UNDO for a day (ROSCA's simple way to stop); leaving a yearly plan early costs no more than monthly
  would have, nor more than the jobs on the ledger in those months, and the rest is refunded (the
  refund text goes to the operator to issue).
- Claims library corrected from the loss research (ServiceTitan's 71% is referrals, not repeat jobs)
  and extended with sourced lead-cost, Angi, Housecall Pro, Jobber homebuyer, Yelp and Google lines;
  four more myths banned.

**Decisions (why)**
- Loss framing uses the owner's own file, never an industry "X% of quotes go quiet": no such figure
  exists. Outside numbers appear only with their source beside them.
- The site says "answered from your office, 7am to 8pm", not "in minutes", until the ledger measures it.
- The sign-up keeps a person in the loop before the first text: it stops a spammer's number getting
  texted, and Jack reads the first note before the owner does.

**Later in iteration 3**
- Site v3 merged and republished (same link): the judged loss-first copy, the full audit (guess chips,
  lead cost from his own number only, "how many would you take back" priced at the lower of his guess
  and our shops' rate), the five named parts, one-tap Start that sends his file. Lint clean on all
  four trades; the Friday example shows only the "before" rate.
- Blueprint v3 republished; Call card published.
- Two new trades: holiday / permanent lighting (a yearly rebook clock) and decks (a 24–36 month stain
  clock after a wood build). 20 trades.
- Second adversarial review: 38 findings, 36 confirmed, all fixed and tested. Money windows (quiet
  months belong to the period they end), exact cancel/undo, whole-text OKs, top-ups wait for the OK,
  forwarded requests read from the innermost message only, one answer per person, sign-up can never
  touch a live account, rate limit on the socket peer.
- Research saved in docs/research: owner complaints by trade, loss evidence, the call guide, the site
  v3 copy deck, adjacent industries.

**Deploy notes**
- Behind a load balancer set `TRUSTED_PROXY_HOPS` (e.g. 1), or every sign-up shares one rate limit.
- `SIGNUP_ORIGINS`, `INBOUND_DOMAIN`, `SIGNUPS_PER_HOUR` (default 30).
- Twilio: remove CANCEL from the Messaging Service opt-out keywords.

- Trade depth from owner research merged: non-Jobber quote statuses read right (Unsigned, Not sent,
  Unscheduled, Not sold...), a full painting playbook (repaint clocks, exterior in late winter,
  interiors sold in the fall), cleaning lapses at ~21 days for weekly/biweekly clients, new-request
  answers ask each trade's intake questions (and skip what the form already says).
- Third adversarial review: 30 reported, 21 confirmed, all fixed: platform-safe UNDO (the cancel's
  withdrawals run first; sequences under way stay stopped and the owner is told), a Restore plan action
  for the operator, pulled notes stop the rest of a sequence, the paid year keeps its guarantee after
  MONTHLY, stricter texts while the first note waits for OK, holiday-lights clocks only in season,
  one-time cleaning asks only to people not on a schedule, recreated ids never get old links.
- Plain-language breakdown for Jack: https://claude.ai/artifact/G2cLRQe3SJt53PWhrMNFZt (a doc he can edit
  and comment on). Engine 1,057 tests, server 242.

- Fourth adversarial review: 13 confirmed (2 duplicates), all fixed and tested. A "yes" to a follow-up
  with no thread is recorded against that note, not a request answer (so it counts for the guarantee
  and the ledger); fees stay right across a mid-year switch to monthly; a renewed year still judges the
  old year's last month after a missed check; Restore plan withdraws only the cancel's own refund text;
  a trial owner texting MONTHLY/YEARLY goes to Jack for the payment link (never "paying" on a text);
  while a first note waits, only a text that reads like an answer to a lead or the close acts on one;
  CANCEL on a sending platform says who UNDO can't bring back; a two-person forward never gets a
  Claude guess; quote statuses where the leading yes/no decides ("Accepted - not booked" is a yes,
  "Not sold yet" is open). Engine 1,085 tests, server 246.

- Fifth adversarial review: 14 reported, 6 confirmed, all fixed and tested. The big one predated it: the
  wait for the owner's OK, the "before we started" quiet rate and what a CANCEL stopped lived only in
  memory, so a deploy lost them (UNDO said "nothing to undo", Restore plan refused, an OK was ignored).
  They're saved with the account now, with a restart test. Also: a reply in the request answer's own
  thread stays with the request (only a no-thread reply with a follow-up sent lately moves to that note),
  and the thread decides between two records sharing an address; while a first note waits, only a bare
  outcome ("no", "done", "booked 2400") or a whole-text yes acts on another lead or plan ("won't" is never
  a win, and a year is never an amount in a note edit); "Sent - not sold - lost to competitor" is a no.
  Engine 1,101 tests, server 247.

- Sixth adversarial review (with a hunt for anything that only lived in memory): 17 reported, 13 confirmed,
  all fixed and tested. A skipped person no longer comes back after a deploy (records are replaced, not
  edited in place); re-planned notes get new ids (two notes with one id stuck, then went out in a burst);
  the reply poll leaves an email it had no lookups left for to the next poll instead of writing it off;
  renewal/kickoff/refund texts always load; replies from two records sharing one address go to the one
  the thread, Instantly's lead variable or the latest note names, a spouse's reply is credited to the
  person we wrote to, and a reply stops every record at that address. Owner texts: "won't book it",
  "hasn't booked yet", "booked someone else" and the iPhone apostrophe never book; note edits that mention
  booked/quoted stay note edits; two businesses both waiting for an OK get "which one?"; a NO after a
  BOOKED takes its dollars back off the ledger. Statuses: one no-vocabulary for every rule, open words on
  either side of "not sold", a leading no or "went with someone else" decides. Engine 1,154, server 252.

- Seventh adversarial review: 15 reported, 13 confirmed, all fixed and tested. Mostly the edges of the last
  round's wider word lists, so the rule now is: a text or status that reads two ways goes to a person or
  keeps its leading answer, never a guess. A booking with a "won't/hasn't" in the same text goes to Jack;
  another company only counts when someone was hired; a booking on the ledger is taken back only by a
  plain NO. Re-booking after a NO never double-counts a job already synced; a skipped person leaves the
  scan's plan list. Instantly replies name the exact note (qa_touch_N), a spouse's reply in someone else's
  thread goes with that note, a reply stops every record at the address on Instantly too, and an
  out-of-office stops nothing. Statuses: a leading yes keeps its yes ("Sold - went w/ black vinyl"),
  revision requests stay open, price reasons after "not sold" are a no, postponements stay open.
  Engine 1,190, server 255.

- Eighth adversarial review: 18 reported, 11 confirmed, all fixed and tested. Two ledger double counts that
  predate this round (a quote approved online and the job it became, landing in different syncs; a quiet
  comeback promoted next to the owner's BOOKED) now fold into one win. The reply poll takes the answered
  note from the email's own campaign, or passes only the person. Owner texts: "she's getting another
  quote" is still our lead; "They found someone else", "went with another roofer", "Someone else already
  did it" are losses. Statuses: an answer after a revision wins ("Requoted - sold"), "Went with ABC Fence"
  is a no unless it starts with a yes, our own lower price is not a no, waiting words after "not sold"
  stay open. New safety net: a status that says two things at once ("Approved - said no to the gate") is
  held for a person instead of being written to on a guess. Engine 1,219, server 256.

- Ninth adversarial review: 15 reported, 7 confirmed (13 → 11 → 7 over the last three passes), all fixed and
  tested. A BOOKED that follows an earlier QUOTED is dated when it booked, so the job in their records
  folds into it instead of counting twice; a quote marked "not ours" stays out when it becomes a job; a
  folded win keeps the day it came back, so no weekly report announces it twice. Owner texts: "went with"
  is a loss only when it names someone else (a capitalized name counts), "went with my quote" is a
  booking, an option or plan we can't place goes to a person, and shopping around ("has another guy
  coming out") stays open. The reply poll takes the campaign from our own note in the thread when the
  reply carries none. Statuses: someone else's lower price is a no however it's written. Engine 1,231,
  server 257.

- Tenth adversarial review: 13 reported, 4 confirmed (13 → 11 → 7 → 4), all fixed and tested. An owner's
  BOOKED is matched to their records over the whole lead (from the month before they wrote back to the
  month after BOOKED), so a quote approved in October and a BOOKED texted in November count once, in
  either order. "Someone else got the job, 1800 cheaper", "Another company won the bid", "The other guy
  got the job" read as losses (the price that follows is why we lost it, not a booking); shopping words
  only protect a "has another guy coming out". A spouse with her own record replying in our thread with
  no lead on the email is tied to the person we wrote to through our note in that thread.
  Engine 1,232, server 258.

- Eleventh adversarial review: 7 reported, 2 confirmed (13 → 11 → 7 → 4 → 2), both fixed and tested. A
  competitor's price is shopping, not a loss ("she has another company giving her a price", "someone else
  already quoted her 1800"), while "someone else got the job, 1800 cheaper" stays a loss. In the reply
  poll, only our own notes say whose thread it is, so the person we wrote to following up after her spouse
  wrote there is still herself. Engine 1,232, server 259.

- Twelfth adversarial review: 2 confirmed, both about owner texts that mention another company ("the other
  guy had a lower bid and got the job" was booked for us; "she had another company do it, lower price" read
  as quoted). The patterns had been chasing these phrasings for several rounds, so the approach changed:
  an owner's lead text that mentions another company is read by Claude (apps/server/src/agents/ownerText.ts)
  for what happened to the owner's own company. An amount only counts if it's written in the text, and
  "unclear", an error or no Claude key sends it to a person. Plain commands still go through the rules.
  Engine 1,232, server 260.

- Thirteenth adversarial review: 2 confirmed, fixed. The gate that sends a text to Claude was too narrow:
  "Other guy got the job, 1800" (no "the"), "Someone cheaper got the job", "Competition got the job", "She
  booked Bartlett" still hit the booking patterns. It is now broad on purpose (any other/another/different
  + word, someone cheaper, competition, "her regular guy", a name after a hiring word): a text sent to Claude
  costs nothing, someone else's win read as ours costs the owner's ledger. A text that goes to Jack as
  unclear also stops the "still waiting" nudges for that lead. Engine 1,232, server 260.

- Fourteenth adversarial review: 3 reported, 1 confirmed: "Davey got the job, 1800" and other ways of
  naming a competitor still slipped past the list of competitor words and booked their price for us. The
  gate is now the other way round: a booking (money on the ledger) is recorded by the patterns only when
  it's plainly the owner's ("booked 2400", "Booked the dead oak, 1800", "She booked us for 2400", "SOLD
  2.4k"); any other text that reads as a booking goes to Claude, or to Jack with no key. An unclear text
  stops a lead's reminders only when its #code names that lead. Engine 1,232, server 261.

- Fifteenth adversarial review: 2 confirmed in the new plain-booking rule, fixed. It let someone else in as
  the thing booked ("She booked the cheaper guy, 1500"), took she/he/they as the winner ("They got the job,
  1800", "He won it") and read an appointment time as the price ("Booked her for 10 tomorrow, 2400" was
  $10). Now it's plain only with the owner (or no one) as the subject and a job, not a person or bid, as
  the object; she/he/they only when they booked "us/me/it"; one amount, last, and at least $50. Anything
  else goes to Claude or Jack. Engine 1,232, server 261.

- Sixteenth adversarial review: 1 reported, 1 confirmed, fixed: a time without a colon or a year was
  still taken as the price ("Booked her for Thursday at 1030" recorded $1,030). An amount is plain only with
  no day, date or time word anywhere in the text, and "at" no longer leads into an amount. Engine 1,232,
  server 261.

- Seventeenth adversarial review: the plain-booking rule's free "thing booked" slot was still a way in
  ("Booked her tmrw 1030" as $1,030, "Booked the cheaper roofer, 1500" as ours). The rule is now the command
  we teach the owner and nothing else: BOOKED 2400, booked it 2400, sold 2.4k, won it, the amount alone, or
  "she booked us for 2400". Any other booking text goes to Claude, or to Jack with no key. Engine 1,232,
  server 261.

- Eighteenth adversarial review: 2 confirmed, fixed. "@" is read as "at" ("Booked @ 1030" is a time, never
  $1,030), and a business's short name is never a word with a digit in it ("360 Tree Care" is CARE, so
  "BOOKED #K7Q 360" means $360, not the business). Engine 1,232, server 262.

- Nineteenth adversarial review: 1 confirmed (plus a low one), fixed. After "for", a bare number that could
  be a clock time or a year ("Booked for 930", "booked it for 2027") is Claude's or Jack's to read; "for
  1800", "$930" and "BOOKED 930" stay plain. A business with no word of its own gets its initials as its
  short name, never a piece of its id. Engine 1,232, server 262.

- Whole-codebase sweep (five lenses, each finding checked by a skeptic): 30 confirmed, all fixed and tested,
  in five batches.
  - Money and plans: Settings can record a yearly plan (billing, year price, paid years); a second RENEW
    changes nothing; RENEW and MONTHLY work from the paid year running today, so years never overlap; every
    plan change by text goes to Jack's queue to collect or refund; CANCEL takes a renewed year that hadn't
    started off the plan (the owner is told Jack refunds it only if it was paid); RESUME after a year ran out
    says it's still paused (and the direct sender honours a paused plan).
  - Owner texts: a text without a #code can be about a lead reported in the last 14 days, and asks when
    two fit; "Go ahead" answers the close or the renewal instead of running RESUME; a text with a #code is
    never a plan change, pause or booked-out command; BUSY and STATUS act only on the command shapes.
  - Sending: queued follow-ups stop once the quote is approved, becomes a job, gets onto the schedule, or the
    customer books or gets a new quote (in Instantly the lead is withdrawn); people whose request got our
    instant answer now get their follow-ups; a "today" answer is never sent late at night.
  - Surface: one Instantly campaign per client (the business id is in the name); forwarded requests and
    exports are read from every recipient field (Delivered-To, Cc, Bcc, provider envelopes); Don't send,
    Hold and edits reach Instantly or are refused with a reason; two records whose ids collide are kept apart.
  - Import: blank titles no longer crash it; archived quotes are dated by the quote, not the archive day;
    status words owners type (Done, Yes, Didn't sell) are read, and any we don't know is held for a person;
    "Leads…csv" with prices is read as quotes; unknown work never becomes the trade's first service; paid
    invoices and same-day sibling quotes count as coming back; re-sent sheets update rows in place; a
    shared phone no longer merges two people; the QuickBooks "Estimates by Customer" report imports.
  - Console: Resume on a plan that's paused or cancelled says nothing will send.
  - Engine 1,304, server 285.
- Known gaps left on purpose: an owner who edits a row's title or date before re-sending still gets a new
  record (the database save never deletes); an edit made in the seconds before Instantly's "sent" webhook
  arrives re-pushes from note 1 (BUSY's take-back has the same race).

- Verification pass over the sweep's fixes (four lenses, each finding checked by a skeptic): 17 reported, 14
  confirmed, all fixed and tested.
  - Record ids stay the 32-bit ones every stored account already has (a 64-bit switch would have duplicated
    records on the next Jobber pull or re-upload); a new record whose id is taken by a different one gets a
    salted id instead, for quotes, jobs, invoices, requests and forwarded leads.
  - Anyone who replied to our instant answer is never planned again, and nothing for them reaches Instantly;
    a newer quote that stops an older sequence gets its own follow-up.
  - Re-sent sheets with no title column match rows by customer and date (Notes edits no longer make a new
    quote); QuickBooks carry-down only on the real grouped report; "Sales by Customer Detail" reads as paid
    sales; "Yes - waiting on HOA" is a yes held for a person.
  - Settings: a renewed year can be taken off, going Monthly drops years not started, moving the first paid
    day forward keeps fees paid so far; switching billing asks for the day it starts.
  - Owner texts: "Monthly cleaning booked 180" is a lead, not a plan change; a bare "No" to the close or the
    renewal never marks a lead lost; "Go ahead and resume" resumes; "Ok cool" is a plain yes.
  - Engine 1,316, server 295.

- Second verification pass over those fixes: 6 reported, 5 confirmed (30 → 14 → 5), all fixed and tested.
  A renewal reply that starts with a plan word and gives a reason ("Monthly - the year is too expensive") goes
  to Jack and never touches a lead; "Yes - backed out", "Yes - changed mind", "Approved - cancelled" are held
  for a person, never told "you gave us the go-ahead"; a quote dated before the request's follow-up was planned
  is still the one chased; QuickBooks Desktop's Sales by Customer Detail (a Name column on every line) reads as
  paid sales; a quiet last month dated the day Jack moves the first paid day still comes off that year's fees.
  Engine 1,319, server 297.

**Next**
- Wrap up: the summary for Jack.

## 2026-09-30 — iteration 2

**Published (private links)**
- Site with the in-browser Quote Audit: https://claude.ai/artifact/SwTYKddjdyLiStT5EuJk7P (source `apps/site`).
- Breakage & Offer Blueprint v2: https://claude.ai/artifact/FfgLR9w8XWTJU3MYr3tfcj (copy in `docs/blueprint.html`).
- Research: `docs/research/market-brief.md`, `docs/research/conversion-brief.md`.

**Done and green** (engine 724 tests, server 99, web + site typecheck clean)
- Jobber listing kept: 3 notes max per quote (fresh-quote follow-up cut to 3), quotes >= $10k and
  phone-only people go to the owner's call list (kickoff text + console), Jobber read-only on clients
  and quotes by default (`JOBBER_READ`), write-back off unless `JOBBER_WRITE_NOTES=on`; a resource
  Jobber refuses is skipped with a warning, never a failed sync.
- Site (`apps/site`): drop a quotes export, the real engine runs in a worker in the browser and shows
  quotes never answered, the monthly leak, the call list and the first note already written. Tree,
  fence, painting, cleaning versions; one plan; guarantee said three times; results labelled
  owner-reported.
- Offer v2: yearly plan ($4,970 = 12 for 10), quiet months refund a twelfth automatically, never
  renews by itself (asked 30 days out; paused at year end without a yes), RENEW / MONTHLY by text,
  offered at the close only when the owner's own numbers make it an easy yes.
- Forecasts on evidence: research-brief priors (old quotes 2.5%, matching our 4 of 150) with per-type
  ranges; backlog vs ongoing split; fit tiers A / B / audit-only replace the old 15% rule; complaint
  brake at 0.1%; one shop's comparison group never "solid".
- Review fixes (engine): service-due notes use the date the work was done; the guarantee is never
  judged on the first payment day and cancelled accounts get no billing texts; one credit per job;
  top-ups count what's already scheduled.

**Decisions (why)**
- The instant result sells: an owner sees their own quiet-quote dollars in ten seconds before any
  signup (Explee pattern, without its fake counters or card-first trial).
- "15–20%" is never a blanket promise: only Tier A shops see a year-one range with the backlog share.
- AI drafts and sorts; the only automatic send is a fixed acknowledgment. A person approves anything
  about price, dates or scope, so "a person reads every reply" stays true.

**In flight**
- Backend hardening agent: Instantly reply recipient check, a real instant campaign for new requests,
  per-company cap off, reply backstop poller, libphonenumber, CSV encoding, reply cleaning, weekdays.
- Copy-fix agent: 11 confirmed copy findings (oak-wilt season asks, greetings, free-look, lapsed
  regulars, never-priced requests, owner-text originals, grammar, Re: threading, AI writer guardrail).

**Next**
- Server review fixes: route replies by thread (two clients sharing a homeowner), Instantly pause /
  cancel / BUSY / delete, send-state and bounce handling, owner-text parsing, security defaults.
- Re-review, then the plain-language breakdown and the ultimate offer for Jack.

## 2026-09-29 — iteration 1

**Done and green**
- Engine (`packages/engine`): ingest (Jobber/HCP/ServiceTitan/QuickBooks/any CSV), 12 breakage detectors,
  11 suppressions, scoring, forecast + fit check, 20 trade playbooks, note library + quality gate,
  cadence planner, reply reader (inbox), ledger/attribution with holdout lift, owner reports, runtime agents,
  simulator, sample generator. 405 tests pass; `tsc` clean.
- Server (`apps/server`): SQLite store, API, worker, webhooks (Instantly, inbound email, owner SMS, Jobber),
  Jobber OAuth + GraphQL sync + note write-back, Instantly sequencer, Claude agents (reply second opinion,
  first-note writer, column mapping). 68 tests pass incl. the full end-to-end loop; `tsc` clean.
- Dashboard (`apps/web`): owner view (Home, Unibox, Opportunities, Sequence, Recovered, Settings),
  operator console, onboarding. Builds; checked in a browser at 1280px and 390px.

**Decisions this iteration (why)**
- Tree service is the flagship trade; every trade runs on the same engine via its playbook. Tree has the most
  dead quotes per shop (~39% of estimates never convert), a low close rate on blind leads, hazard work that
  truly gets worse, and a winter slow season. Ticket size is *not* the reason — big quotes are down-weighted.
- The free round of 150 is ranked by likelihood to reply (the trial's job is proof), capped at 40% per leak so
  the owner sees wins from several leaks, dead quotes included. Paying accounts rank by expected dollars.
- "Big ticket" is relative to each shop's own typical job (4x median), never a national number.
- Quotes older than 180 days never repeat the old price; the note offers a fresh look and the owner's hand-off
  says to re-price.
- Oak pruning is never offered April–October (oak wilt); ash-borer treatment timed to May/early June.
- House-wash re-service moved from 12 to 36 months (owners report 3–10 years); aerobic septic on a 12-month clock.
- Every human reply gets a Claude second opinion (rules are ~83% right on unseen mail); a stop always stands and
  a possible "yes" is never dropped.
- Instantly: one workspace serves many businesses, so `skip_if_in_workspace` is off.
- Claims library: 10 sourced claims; 12 banned stats, now enforced by the note linter.

**Also this iteration**
- Shop profile (`breakage/profile.ts`): each shop's own ticket size, volume and repeat work set its strategy —
  small-ticket repeat shops lead with likeliest yeses; big-ticket one-off shops lead with expected dollars and
  get AI-drafted first notes on every quote. No per-trade configuration.
- Readiness (`breakage/readiness.ts`): the operator's "ask the owner for this next" list — which export is
  missing, what it unlocks, and the exact menu path in their software. In every client overview.
- Forecast honesty: unpaid invoices are cash to collect, not revenue lift, so they're out of the lift.
  Careful year-one lift on a ~50%-close shop: 15–19% across tree/septic/lawn/fence/pressure washing.
- Tree sample prices rebased on HomeAdvisor/Fixr (typical job ~$875).
- Worker 20x faster: saves skip unchanged records (idle tick 107ms → 6ms; 23 sends 1.24s → 60ms).
- Jobber write-back: replies and bookings leave a note on the quote in Jobber; rotated tokens always saved.

**Also (owner-voice + compliance research)**
- Easy "reply pass" in first notes; loss reasons ("5 went with someone else, 3 price") in the Friday text.
- Don't-chase holds: "go away" prices and realtor/HOA/insurance bids wait for an OK; bad-customer tags never contacted.
- Silent Quote Audit: won vs said no vs never answered, by age — the problem owners don't know they have.
- Booked-out mode: owner texts BUSY until <date> / OPEN; new work lands when there's room.
- Honest why-line on every commercial note (CAN-SPAM); no fake "Re:" on first notes.
- Address risk (typos, placeholders, throwaways, role inboxes last) + DNS check before sending.
- Brakes: pause at 3% bounces, 0.2% complaints, or 1% "who is this?".
- Instant answer to hot replies in the homeowner's thread ("Dave will call you Monday"), 7am–8pm local,
  never promising a price or a date; the owner's hand-off says what was promised.

**Also (offer research → product)**
- Recovered Ledger with published counting rules (traced 180 days / "came back after our note" 90 days,
  never counted), CSV + owner link, "not ours" disputes; guarantee evidence automatic; fees-vs-traced
  multiple in the weekly text; cancel by text; "15–20%" only when the shop's careful forecast reaches 15%;
  marketing copy checker.
- Unpaid invoices: detected for the owner's "cash to collect" only — never messaged (debt-collection law
  review pending from the research gap-fill).
- Live operator console on the real server; demo mode kept for sales calls.
- Test suite: engine 698, server 92.

**Next**
- Adversarial review (5 lenses + verifiers) running → fix confirmed findings.
- Research gap-fills + synthesis → Breakage & Offer Blueprint (publish) → final plain-language breakdown.
- Staggered holdout (held people start ~60 days late instead of never) so no owner permanently loses quotes.
- Sample catalogs for the other 14 trades + recurring visits for route trades (demo realism).
- Research synthesis → Breakage & Offer Blueprint (judge-panel the offer framing).
- Engine test suites for breakage/cadence/copy/ledger/reports/runtime + a 10k-row performance test.
- Worker tick speed (≈0.75s per business per tick in the e2e test).
- Adversarial review + fix passes; publish blueprint and demo.
