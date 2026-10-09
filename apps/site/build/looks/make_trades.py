"""Writes the all-trades site (Oct 3, 2026): a page per trade, each in a look of its own, and a cold email page per
trade in the same look. Lawn is the green look Jack liked, word for word, with the trade switcher added. Cleaning,
fence, tree and painting take the green page's layout and fill it from that trade's own tested page (its navy
template): headline, promise, ticks, money, examples, Jobber rows, pricing, questions and close, word for word.

    <trade>-site/             the trade's page (quietaccounts.com/<trade>; lawn is quietaccounts.com itself)
    <trade>-cold-email-page/  the link in that trade's "show me" reply (quietaccounts.com/start/<trade>?co=...)
"""
import html as H, os, re

SITE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
ARCHIVO = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap">'
INSTRUMENT = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400..700&family=Instrument+Serif:ital@0;1&display=swap">'

# The switcher's order is Jack's: lawn, cleaning, fence, tree, painting. Tree's page waits at /tree-service while
# /tree stays the Jobber reviewers' page.
ORDER = ["lawn", "cleaning", "fence", "tree", "painting"]
T = {
    "lawn": dict(label="Lawn", href="/", css="green.css", mark="logo-mark-green.svg", og="og-green.png", color="#1B5A31", fonts=ARCHIVO),
    "cleaning": dict(label="Cleaning", href="/cleaning", css="trade-cleaning.css", mark="logo-mark-aqua.svg", og="og-cleaning.png", color="#C9F1F0", fonts=INSTRUMENT),
    "fence": dict(label="Fence", href="/fence", css="trade-fence.css", mark="logo-mark-cedar.svg", og="og-fence.png", color="#5C3520", fonts=ARCHIVO),
    "tree": dict(label="Tree", href="/tree-service", css="trade-tree.css", mark="logo-mark-tree.svg", og="og-tree.png", color="#14301F", fonts=ARCHIVO),
    "painting": dict(label="Painting", href="/painting", css="trade-painting.css", mark="logo-mark-paint.svg", og="og-painting.png", color="#1C2C4E", fonts=ARCHIVO),
}

# The hero's example list for each trade: made-up customers, labeled an example, kept apart from the engine's own
# example customer (who leads the list in "how it works", so the note and the text that follow are to someone on it).
Q = {
    "cleaning": dict(
        label="clients who stopped booking, asked", head="Clients who stopped booking",
        rows=[("Karen Doucette", "Every other Friday", "last clean Aug 2026", "booked", "Back on &middot; $190 a visit"),
              ("Mark Lefebvre", "Monthly clean", "last clean Jun 2026", "yes", "Wants it back"),
              ("Amy Cote", "Weekly cleaning", "last clean Jul 2026", "back", "Wrote back"),
              ("Rita Morin", "Biweekly cleaning", "last clean May 2026", "", "Note 2 sent"),
              ("Joe Vachon", "Deep clean", "last clean Mar 2026", "", "Asked")],
        text=("Karen Doucette wants it done", "Every other Friday &middot; last clean Aug 2026", "Yes, put us back on. Fridays still work.",
              "22 Summer St &middot; best contact: text", "On it. Texting her now.")),
    "fence": dict(
        label="old quotes, asked", head="Quotes that never booked",
        rows=[("Carl Mendes", "Cedar privacy, 140 ft", "quoted Apr 2026", "booked", "Booked &middot; $7,400"),
              ("Lisa Grenier", "Vinyl picket + gate", "quoted Jun 2026", "yes", "Wants it done"),
              ("Ben Tardif", "Black aluminum, pool code", "quoted Mar 2026", "back", "Wrote back"),
              ("Meg Castonguay", "Split rail, 220 ft", "quoted Sep 2025", "", "Note 2 sent"),
              ("Ray Bilodeau", "Chain link + double gate", "quoted Nov 2025", "", "Asked")],
        text=("Carl Mendes wants it done", "Cedar privacy, 140 ft &middot; quoted Apr 2026", "Yes, we still want the fence. Can you come measure again next week?",
              "6 Brook St &middot; best contact: text", "On it. Texting him now.")),
    "tree": dict(
        label="old quotes, asked", head="Quotes that never booked",
        rows=[("Dale Brennan", "Two oaks over the driveway", "quoted Mar 2026", "booked", "Booked &middot; $3,200"),
              ("Sue Marchand", "Storm cleanup, back lot", "quoted Jan 2026", "yes", "Wants it done"),
              ("Tom Leclair", "Pine removal + stump grind", "quoted Aug 2025", "back", "Wrote back"),
              ("Ann Dufresne", "Crown thinning, maple", "quoted May 2025", "", "Note 2 sent"),
              ("Jim Ouellette", "Hazard tree by the shed", "quoted Oct 2025", "", "Asked")],
        text=("Dale Brennan wants it done", "Two oaks over the driveway &middot; quoted Mar 2026", "Yes, still want them down before winter. Can you come take another look?",
              "27 Ridge Rd &middot; best contact: cell, mornings", "On it. Calling him at 8.")),
    "painting": dict(
        label="old estimates, asked", head="Estimates that never booked",
        rows=[("Diane Roy", "Exterior, body + trim", "estimate Apr 2026", "booked", "Booked &middot; $6,900"),
              ("Gary Fortin", "Kitchen cabinets", "estimate Feb 2026", "yes", "Wants it done"),
              ("Nina Patel", "Living room + hall", "estimate Jan 2026", "back", "Wrote back"),
              ("Luc Gagne", "Deck stain", "estimate Jul 2025", "", "Note 2 sent"),
              ("Ellen Moore", "Two bedrooms", "estimate Oct 2025", "", "Asked")],
        text=("Diane Roy wants it done", "Exterior, body + trim &middot; estimate Apr 2026", "Yes, let's do it before it gets cold. Same colors we picked.",
              "40 Summer St &middot; best contact: cell, evenings", "On it. Calling her at 6.")),
}
# what the first of the three lines finds, per trade
FINDS = {"cleaning": "find every client who stopped booking.", "fence": "find every quote that never booked.",
         "tree": "find every quote that never booked.", "painting": "find every estimate that never booked."}
ONE_PASS_FINAL_TICKS = "<li>No card to start</li><li>No contract</li><li>Never more than $1,000</li>"
# The film (Oct 9, 2026): the service running for a made-up company in the trade, playing on the page under the three
# lines that say what we do, where he's just understood it and wants to see it's real. Build/render.ts fills the marker
# from the trade's film in public/film/<trade>/. Its cold email page (where an owner from an email lands) has it too, at
# the end of "What happens after you press start". Painting waits for its own film.
FILM = ["lawn", "cleaning", "fence", "tree"]
FILM_MARK = "  <!--qa:film-->\n"

ICON = {
    "list": '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    "chat": '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    "search": '<circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.2" y2="16.2"/>',
    "mail": '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
    "phone": '<rect x="6" y="2" width="12" height="20" rx="2.5"/><line x1="11" y1="18" x2="13" y2="18"/>',
    "fwd": '<polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/>',
}


def icon(name):
    return f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICON[name]}</svg>'


def one(pat, s, flags=re.S):
    m = re.search(pat, s, flags)
    assert m, pat
    return m.group(1)


def section(h, sid):
    m = re.search(rf'<section class="[^"]*" id="{sid}"><div class="wrap[^"]*">\n(.*?)\n</div></section>', h, re.S)
    assert m, sid
    return re.sub(r'\s*<p class="eyebrow[^"]*">.*?</p>\n', "\n", "\n" + m.group(1), count=1).strip("\n")


def navy(trade):
    """That trade's tested page, in pieces."""
    h = open(f"{SITE}/{trade}/index.html", encoding="utf-8").read()
    hero = h[h.index('<section class="hero"'):h.index("</div></section>", h.index('<section class="hero"'))]
    flow = one(r'<ol class="flow">(.*?)</ol>', h)
    steps = re.findall(r'<li class="(you|we)"><span class="who">\w+</span>\s*<h3>(.*?)</h3>\s*<p>(.*?)</p>(.*?)</li>', flow, re.S)
    you = [s for s in steps if s[0] == "you"]
    we = [s for s in steps if s[0] == "we"]
    jobber = h[h.index('id="jobber"'):h.index("</section>", h.index('id="jobber"'))]
    final = section(h, "final")
    return dict(
        title=one(r"<title>(.*?)</title>", h), desc=one(r'<meta name="description" content="(.*?)">', h),
        chip=one(r'<p class="eyebrow[^"]*">(.*?)</p>', hero), h1=one(r"<h1[^>]*>(.*?)</h1>", hero),
        promise=one(r'<p class="promise[^"]*">(.*?)</p>', hero),
        lede=(re.search(r'<p class="lede">(.*?)</p>', hero) or [None, None])[1],
        ticks=one(r'<ul class="ticks[^"]*">(.*?)</ul>', hero),
        money=section(h, "money"),
        results_h2=one(r'id="results">.*?<h2>(.*?)</h2>', h), swipe=one(r'<p class="swipe">(.*?)</p>', h),
        how_h2=one(r'id="how">.*?<h2>(.*?)</h2>', h),
        step1=you[0], find=we[0], last=you[-1],
        note_p=[s for s in we if "<!--qa:note-->" in s[3]][0][2],
        mails=re.findall(r"<b>(Fwd: [^<]*)</b><small>([^<]*)</small>", you[0][3]),
        list=re.findall(r"<div><span>(.*?)</span><em>(.*?)</em></div>", we[0][3]),
        more=one(r'<div class="more"><span>(.*?)</span>', we[0][3]),
        replies=re.findall(r'<span( class="x")?>(.*?)</span>', one(r'<div class="ex-replies">(.*?)</div>', flow)),
        friday=one(r'<p class="friday">(.*?)</p>', h),
        j_h2=one(r"<h2>(.*?)</h2>", jobber), j_sub=one(r'<p class="sub">(.*?)</p>', jobber),
        j_label=one(r'<div class="vs" role="table" aria-label="(.*?)">', jobber), j_them=one(r'<div class="h a" role="columnheader">(.*?)</div>', jobber),
        rows=re.findall(r'<div class="k" role="rowheader">(.*?)</div><div class="a" role="cell">(.*?)</div><div class="b( money)?" role="cell">(.*?)</div>', jobber),
        reach=(re.search(r'<p class="reach">(.*?)</p>', jobber) or [None, None])[1],
        j_src=one(r'<p class="src">(.*?)</p>', jobber), keep=one(r'<p class="keep">(.*?)</p>', jobber),
        pricing=section(h, "pricing"), faq=section(h, "faq"),
        f_h2=one(r"<h2>(.*?)</h2>", final), f_sub=one(r'<p class="sub">(.*?)</p>', final),
        f_ticks=(re.search(r'<ul class="ticks">(.*?)</ul>', final) or [None, ONE_PASS_FINAL_TICKS])[1],
        monthly="$497" in h,
    )


COMPANY = {"lawn": "Ridgeline Landscaping", "cleaning": "Ridgeline Cleaning", "tree": "Ridgeline Tree Co.", "fence": "Ridgeline Fence", "painting": "Ridgeline Painting"}


def switcher(trade):
    links = "".join(f'<a href="{T[t]["href"]}"{" aria-current=" + chr(34) + "page" + chr(34) if t == trade else ""}>{T[t]["label"]}</a>' for t in ORDER)
    return f'<div class="tswitch"><p class="tswitch-k" id="tradeK">Pick your trade</p><div class="tswitch-pills" role="group" aria-labelledby="tradeK">{links}</div></div>'


def head(trade, n, cold=False):
    t = T[trade]
    og_desc = n["desc"].split(". ", 1)[1] if ". " in n["desc"] else n["desc"]
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{n["title"]}</title>
<meta name="description" content="{n["desc"]}">
<link rel="icon" href="/src/assets/{t["mark"]}" type="image/svg+xml">
<meta name="theme-color" content="{t["color"]}">{chr(10) + '<meta name="robots" content="noindex">' if cold else ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quiet Accounts">
<meta property="og:title" content="{H.escape(H.unescape(n["h1"]), quote=True)}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="https://quietaccounts.com/{t["og"]}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{t["fonts"]}
<link rel="stylesheet" href="/src/soro.css">
<link rel="stylesheet" href="/src/green.css">
<link rel="stylesheet" href="/src/trade.css">
<link rel="stylesheet" href="/src/{t["css"]}">
</head>
<body class="t-{trade}">
<header class="top"><div class="wrap">
  <a class="logo" href="#top" aria-label="Quiet Accounts, top of page"><img src="/src/assets/{t["mark"]}" width="32" height="32" alt="">Quiet Accounts</a>
</div></header>
'''


TAIL = '''</main>

<!--qa:footer-->
<!--qa:sticky-->
<script type="module" src="/src/page.ts"></script>
</body>
</html>
'''


def motif(trade, where):
    """The close's picture, and any picture the hero carries: each trade's own."""
    mark = f'<img class="rise" src="/src/assets/{T[trade]["mark"]}" width="142" height="142" alt="">'
    if trade == "tree":
        return f'<div class="ridge" aria-hidden="true">{mark}{pines()}</div>' if where == "final" else ""
    if trade == "fence":
        return f'<div class="fenceline" aria-hidden="true">{mark}{fence_row()}</div>' if where == "final" else ""
    if trade == "painting":
        return f'<div class="chips" aria-hidden="true">{mark}{swatches()}</div>' if where == "final" else ""
    if trade == "cleaning":
        if where == "hero":
            return '<div class="bubbles" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>'
        return f'<div class="suds" aria-hidden="true">{mark}<i></i><i></i><i></i><i></i><i></i><i></i></div>'
    return ""


def pines():
    """Three rows of conifers along the bottom of the close, the back row palest. Fixed, not random, so builds repeat."""
    import math
    rows = []
    for k, (base, hmin, hmax, step, col) in enumerate([(232, 70, 128, 44, "#3B7A55"), (250, 92, 158, 52, "#285E40"), (270, 116, 196, 60, "#17402B")]):
        d = []
        x, i = -30 + k * 19, 0
        while x < 1480:
            h = hmin + (hmax - hmin) * (0.5 + 0.5 * math.sin(i * 1.7 + k * 2.3)) * (0.78 + 0.22 * math.sin(i * 0.61 + k))
            w = h * 0.46
            top, y1, y2 = base - h, base - h * 0.62, base - h * 0.30
            pts = [(x, top), (x + .30 * w, y1), (x + .14 * w, y1), (x + .42 * w, y2), (x + .22 * w, y2), (x + .5 * w, base),
                   (x - .5 * w, base), (x - .22 * w, y2), (x - .42 * w, y2), (x - .14 * w, y1), (x - .30 * w, y1)]
            d.append("M" + " L".join(f"{px:.0f} {py:.0f}" for px, py in pts) + "Z")
            x += step + 12 * math.sin(i * 2.1 + k)
            i += 1
        rows.append(f'<path fill="{col}" d="{"".join(d)}M-40 {base - 2}H1480V300H-40Z"/>')
    return f'<svg class="pines" viewBox="0 0 1440 300" preserveAspectRatio="xMidYMax slice">{"".join(rows)}</svg>'


def fence_row():
    """Cedar boards with dog-ear tops along the bottom of the close, each board a slightly different tone."""
    tones = ["#B9764A", "#A9683F", "#C4835A", "#AE6D43", "#BE7B4F", "#A46340", "#B5714A"]
    boards = []
    x, i = -12, 0
    while x < 1460:
        w, top = 46, 64 + (5 if i % 3 == 1 else 0)
        boards.append(f'<path fill="{tones[i % len(tones)]}" d="M{x} {top + 10}L{x + 10} {top}H{x + w - 10}L{x + w} {top + 10}V220H{x}Z"/>')
        boards.append(f'<path fill="rgba(255,236,214,.16)" d="M{x + 6} {top + 12}H{x + 9}V220H{x + 6}Z"/>')
        x += w + 3
        i += 1
    return f'<svg class="boards" viewBox="0 0 1440 220" preserveAspectRatio="xMidYMax slice">{"".join(boards)}</svg>'


def swatches():
    """A fan of paint chips, the mark resting on it."""
    chips = [("#E9C46A", -28), ("#E76F51", -16), ("#8AB17D", -4), ("#2A9D8F", 8), ("#6D597A", 20), ("#F4A6A0", 32)]
    out = []
    for i, (c, rot) in enumerate(chips):
        out.append(f'<i style="--c:{c};--r:{rot}deg;--i:{i}"></i>')
    return f'<div class="fan">{"".join(out)}</div>'


def qlist(trade, n):
    q = Q[trade]
    rows = "\n".join(f'      <div class="qrow"><span><b>{nm}</b><small>{job} &middot; {when}</small></span><i{(" class=" + chr(34) + c + chr(34)) if c else ""}>{st}</i></div>'
                     for nm, job, when, c, st in q["rows"])
    tt = q["text"]
    return f'''<section class="qlist" aria-label="Example: {q["label"]}"><div class="wrap">
  <div class="qcard" aria-hidden="true">
    <div class="qtable">
      <div class="qhead"><b>{icon("list")}<span>{q["head"]}: <span data-company>{COMPANY[trade]}</span></span></b><span class="eg-pill">Example</span></div>
{rows}
      <div class="qmore">{n["more"]}</div>
    </div>
    <div class="qside">
      <span class="pill-k">{icon("chat")}A text to you</span>
      <div class="msg">
        <div class="msg-top"><span>Quiet Accounts</span><span>9:12 AM</span></div>
        <p class="msg-title">{tt[0]}</p>
        <p class="msg-sub">{tt[1]}</p>
        <q class="msg-said">{tt[2]}</q>
        <p class="msg-meta">{tt[3]}</p>
      </div>
      <div class="msg-me"><small>You &middot; 9:14 AM</small><span>{tt[4]}</span></div>
    </div>
  </div>
  <!--qa:works-->
</div></section>'''


def lines(trade):
    return f'''<section class="sec lines" aria-label="What we do"><div class="wrap">
  <p>We <span class="ico">{icon("search")}</span> {FINDS[trade]}</p>
  <p>Then we <span class="ico">{icon("mail")}</span> write each one a note from your office.</p>
  <p>Every yes <span class="ico">{icon("phone")}</span> is texted to you.</p>
{FILM_MARK if trade in FILM else ""}</div></section>'''


def how(n):
    fwd = "".join(f'<div class="fwd"><span class="ic">{icon("fwd")}</span><div><b>{b}</b><small>{s}</small></div><span class="go">Send</span></div>' for b, s in n["mails"])
    rows = "".join(f'<div><span>{a}</span><em>{b}</em></div>' for a, b in n["list"])
    find = n["find"][1].rstrip(".").replace(", and every past customer", " and every past customer")
    return f'''<section class="sec" id="how"><div class="wrap">
  <h2>You do two things. We do everything in between.</h2>
  <div class="steps">
    <div>
      <div class="panel">{fwd}</div>
      <h3>1. {n["step1"][1]}</h3>
      <p>{n["step1"][2]}</p>
    </div>
    <div>
      <div class="panel">
        <span class="eg-pill">Example</span>
        <div class="list">{rows}<div class="more"><span>{n["more"]}</span><em></em></div></div>
      </div>
      <h3>2. We do everything in between.</h3>
      <p>{find}, write each one a note from your office, follow up, and read every reply.</p>
    </div>
    <div>
      <div class="panel">
        <span class="eg-pill">Example text to you</span>
        <!--qa:handoff-->
      </div>
      <h3>3. {n["last"][1]}</h3>
      <p>{n["last"][2]}</p>
    </div>
  </div>
</div></section>'''


def note(trade, n):
    chips = "".join(f'<span{" class=" + chr(34) + "x" + chr(34) if x else ""}>{t}</span>' for x, t in n["replies"])
    return f'''<section class="sec" id="note"><div class="wrap">
  <div class="split">
    <div>
      <h2>{n["how_h2"]}</h2>
      <p class="sub">{n["note_p"]}</p>
      <div class="yours"><img src="/src/assets/{T[trade]["mark"]}" width="46" height="46" alt=""><span><small>Your part</small><b>Change anything you want and text OK. The first notes go out the next weekday morning.</b></span></div>
      <p class="friday">{n["friday"]}</p>
    </div>
    <div class="notebox">
      <!--qa:note-->
      <div class="replies"><p>Up to three short notes. Every reply read.</p><div>{chips}</div></div>
    </div>
  </div>
</div></section>'''


def jobber(trade, n):
    rows = []
    for k, them, money, us in n["rows"]:
        ours = f'<td class="us money">{us}</td>' if money else f'<td class="us"><span class="yes">{us}</span></td>'
        rows.append(f'        <tr><th scope="row">{k}</th>{ours}<td><span class="no">{them}</span></td></tr>')
    reach = f'\n  <p class="reach">{n["reach"]}</p>' if n["reach"] else ""
    return f'''<section class="sec" id="jobber"><div class="wrap">
  <h2>{n["j_h2"]}</h2>
  <p class="sub">{n["j_sub"]}</p>
  <div class="tbl">
    <table class="vs2" aria-label="{n["j_label"]}">
      <thead><tr><td></td><th scope="col" class="us"><img src="/src/assets/{T[trade]["mark"]}" width="34" height="34" alt="">Quiet Accounts</th><th scope="col">{n["j_them"]}</th></tr></thead>
      <tbody>
{chr(10).join(rows)}
      </tbody>
    </table>
  </div>{reach}
  <p class="src">{n["j_src"]}</p>
  <p class="keep">{n["keep"]}</p>
</div></section>'''


def pricing(n):
    p = n["pricing"]
    if n["monthly"]:
        a = '<div class="plan free">\n'
        assert p.count(a) == 1
        p = p.replace(a, a + '      <span class="flag">Start here</span>\n')
    return f'<section class="sec" id="pricing"><div class="wrap">\n{p}\n</div></section>'


def final(trade, n, sub=None):
    return f'''<section class="final" id="final">
  <h2>{n["f_h2"]}</h2>
  <ul class="ticks">{n["f_ticks"]}</ul>
  <p class="sub">{sub or n["f_sub"]}</p>
  <!--qa:cta-->
  {motif(trade, "final")}
</section>'''


def main_page(trade):
    n = navy(trade)
    lede = f'\n  <p class="lede">{n["lede"]}</p>' if n["lede"] else ""
    return head(trade, n) + f'''
<main id="top">
<section class="hero" id="hero">{motif(trade, "hero")}<div class="wrap">
  {switcher(trade)}
  <p class="chip">{n["chip"]}</p>
  <h1>{n["h1"]}</h1>
  <p class="promise">{n["promise"]}</p>{lede}
  <!--qa:form-->
  <ul class="ticks">{n["ticks"]}</ul>
  <!--qa:tally-->
</div></section>

{qlist(trade, n)}

{lines(trade)}

<section class="sec" id="money"><div class="wrap">
{n["money"]}
</div></section>

<section class="sec" id="results"><div class="wrap">
  <h2>{n["results_h2"]}</h2>
  <div class="cards">
<!--qa:results-->
  </div>
  <p class="swipe">{n["swipe"]}</p>
  <p class="ask">Want to ask them yourself? Text <a href="sms:+16033407673">603-340-7673</a> and we'll pass on their number.</p>
</div></section>

{how(n)}

{note(trade, n)}

{jobber(trade, n)}

{pricing(n)}

<section class="sec" id="faq"><div class="wrap">
{n["faq"]}
</div></section>

{final(trade, n)}
''' + TAIL


# ------------------------------------------------------------------ the cold email pages
JOBBER_Q = {
    "monthly": ('<details><summary>Doesn\'t Jobber do this?</summary><div class="a">Jobber gives you a tool. We do the work. '
                '<!--qa:claim:jobber-campaigns-not-retroactive--> <!--qa:claim:jobber-campaigns-add-on--> Your software sends reminders going forward. '
                'We go back through everyone it never reached, and read every reply. Keep your software: we work from its export.'
                '<p class="src">Source: <!--qa:source:jobber-campaigns-not-retroactive-->; <!--qa:source:jobber-campaigns-add-on-->.</p></div></details>'),
    "one_pass": ('<details><summary>Doesn\'t Jobber already follow up?</summary><div class="a">Jobber gives you a tool. We do the work. '
                 '<!--qa:claim:jobber-two-reminders--> If Jobber\'s follow-up were going to book the job, it would be booked already. '
                 'Keep Jobber: we work from its exports.<p class="src">Source: <!--qa:source:jobber-two-reminders-->.</p></div></details>'),
}
SEND = {"cleaning": ("Send one export.", "Your past visits, or your clients with their last cleaning date and email, to quotes@quietaccounts.com. About five minutes, and we text you where to click."),
        "fence": ("Forward your exports.", "Your quotes and your past jobs, to quotes@quietaccounts.com: two emails from Jobber or Housecall Pro, or an export from whatever you use. About five minutes, and we show you where to click."),
        "tree": ("Forward your exports.", "Your quotes and your past jobs, to quotes@quietaccounts.com: two emails from Jobber or Housecall Pro, or an export from whatever you use. About five minutes, and we show you where to click."),
        "painting": ("Forward your exports.", "Your estimates and your past jobs, to quotes@quietaccounts.com: two emails from Jobber or Housecall Pro, or an export from whatever you use. About five minutes, and we show you where to click.")}
LAST = {"monthly": ("After your first 150", "You decide.", "Keep it going for $497 a month only if you say yes. Any month nobody asks to come back is free. Cancel with a text."),
        "one_pass": ("When a job books", "You pay $250.", "Only for someone who wrote back to one of our notes and booked with you within 60 days. Never more than $1,000. Nothing books, you owe nothing.")}
COLD_SUB = {"cleaning": "Three fields and one export, and we text you your first note to read within one business day."}


def cold_page(trade):
    n = navy(trade)
    offer = "monthly" if n["monthly"] else "one_pass"
    s1 = SEND[trade]
    when, h3, p = LAST[offer]
    faq = n["faq"]
    parts = faq.split("</details>")
    assert len(parts) > 4
    faq = "</details>".join(parts[:3]) + "</details>\n    " + JOBBER_Q[offer] + "</details>".join([""] + parts[3:])
    return head(trade, n, cold=True) + f'''
<main id="top">
<section class="hero hero-start" id="hero">{motif(trade, "hero")}<div class="wrap">
  <div class="hs-copy">
    <p class="chip"><span data-if-no-link>{n["chip"]}</span><span data-if-link hidden>For <b data-company>{COMPANY[trade]}</b></span></p>
    <h1>{n["h1"]}</h1>
    <p class="promise">{n["promise"]}</p>
    <ul class="ticks">{n["ticks"]}</ul>
    <!--qa:tally-->
  </div>
  <!--qa:form:open-->
</div></section>

<section class="sec" id="next"><div class="wrap">
  <h2>What happens after you press start.</h2>
  <ol class="nexts">
    <li><span class="when">Today</span><h3>{s1[0]}</h3><p>{s1[1]}</p></li>
    <li><span class="when">Within one business day</span><h3>Read your first note.</h3><p>Jack texts it to you with your company's name on it. Change anything you want and text OK. Nothing sends until you do.</p></li>
    <li><span class="when">The next weekday morning</span><h3>The first notes go out.</h3><p>Up to three short notes over a week or two. A person reads every reply, and every yes is texted to you the same day, like this:</p><!--qa:handoff--></li>
    <li><span class="when">{when}</span><h3>{h3}</h3><p>{p}</p></li>
  </ol>
{FILM_MARK if trade in FILM else ""}</div></section>

<section class="sec" id="results"><div class="wrap">
  <h2>{n["results_h2"]}</h2>
  <div class="cards">
<!--qa:results-->
  </div>
  <p class="swipe">{n["swipe"]}</p>
  <p class="ask">Want to ask them yourself? Text <a href="sms:+16033407673">603-340-7673</a> and we'll pass on their number.</p>
</div></section>

<section class="sec" id="money"><div class="wrap">
{n["money"]}
</div></section>

<section class="sec" id="faq"><div class="wrap">
{faq}
</div></section>

{final(trade, n, COLD_SUB.get(trade))}
''' + TAIL


# ------------------------------------------------------------------ lawn: the green look Jack liked, plus the switcher
def lawn_pages():
    main = open(f"{SITE}/green-site/index.html", encoding="utf-8").read()
    a = '<link rel="stylesheet" href="/src/green.css">'
    assert main.count(a) == 1
    main = main.replace(a, a + '\n<link rel="stylesheet" href="/src/trade.css">')
    a = '<section class="hero" id="hero"><div class="wrap">\n'
    assert main.count(a) == 1
    main = main.replace(a, a + f"  {switcher('lawn')}\n")
    main = main.replace("<body>", '<body class="t-lawn">', 1)
    # the film, under the three lines, as on every filmed trade's page
    a = re.search(r'<section class="sec lines"[^>]*><div class="wrap">\n.*?\n(?=</div></section>)', main, re.S)
    assert a and "lawn" in FILM
    main = main[:a.end()] + FILM_MARK + main[a.end():]
    # its cold email page, the link in the "show me" reply, where an owner from an email lands: the film too, at the end
    # of "What happens after you press start" (what it shows), in the lawn page's look
    cold = open(f"{SITE}/green-cold-email-page/index.html", encoding="utf-8").read()
    a = '<link rel="stylesheet" href="/src/green.css">'
    assert cold.count(a) == 1
    cold = cold.replace(a, a + '\n<link rel="stylesheet" href="/src/trade.css">').replace("<body>", '<body class="t-lawn">', 1)
    a = re.search(r'<section class="sec" id="next"><div class="wrap">\n.*?</ol>\n', cold, re.S)
    assert a
    cold = cold[:a.end()] + FILM_MARK + cold[a.end():]
    return main, cold


def write(folder, h):
    os.makedirs(f"{SITE}/{folder}", exist_ok=True)
    open(f"{SITE}/{folder}/index.html", "w", encoding="utf-8").write(h)
    print(folder, len(h))


if __name__ == "__main__":
    lm, lc = lawn_pages()
    write("lawn-site", lm)
    write("lawn-cold-email-page", lc)
    for tr in ["cleaning", "fence", "tree", "painting"]:
        write(f"{tr}-site", main_page(tr))
        write(f"{tr}-cold-email-page", cold_page(tr))
