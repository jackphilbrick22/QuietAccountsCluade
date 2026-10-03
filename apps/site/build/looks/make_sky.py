"""Writes the every-trade look ("sky"): sky-site/ (quietaccounts.com, lawn), sky-cold-email-page/ (/lawn?co=), and
sky-cleaning/, sky-tree/, sky-painting/, sky-fence/ (the trade picker's pages). Every page is the same layout, filled
from that trade's own tested page (its navy template): its headline, promise, ticks, money, examples, Jobber rows,
pricing, questions and close, word for word. Only the dressing and the order are new."""
import html as H, os, re

SITE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MARK = "/src/assets/logo-mark-sky.svg"
FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Funnel+Display:wght@300..800&family=Funnel+Sans:wght@300..800&display=swap">'
TRADES = [("lawn", "Lawn", "/", "sky-site"), ("cleaning", "Cleaning", "/sky/cleaning", "sky-cleaning"), ("tree", "Tree", "/sky/tree", "sky-tree"),
          ("painting", "Painting", "/sky/painting", "sky-painting"), ("fence", "Fence", "/sky/fence", "sky-fence")]
ONE_PASS_FINAL_TICKS = "<li>No card to start</li><li>No contract</li><li>Never more than $1,000</li>"
FWD_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#5B3FE8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>'
CHAT_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="#5B3FE8" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
CLOUDS = '<div class="hclouds" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="hfade" aria-hidden="true"></div>'
FINAL_SKY = f'''  <div class="sky" aria-hidden="true">
    <img class="rise" src="{MARK}" width="144" height="144" alt="">
    <div class="clouds"><i></i><i></i><i></i><i></i><i></i></div>
  </div>'''


def one(pat, s, flags=re.S):
    m = re.search(pat, s, flags)
    assert m, pat
    return m.group(1)


def section(h, sid):
    m = re.search(rf'<section class="[^"]*" id="{sid}"><div class="wrap[^"]*">\n(.*?)\n</div></section>', h, re.S)
    assert m, sid
    return re.sub(r'\s*<p class="eyebrow[^"]*">.*?</p>\n', "\n", "\n" + m.group(1), count=1).strip("\n")


def navy(trade):
    h = open(f"{SITE}/{trade}/index.html", encoding="utf-8").read()
    hero = h[h.index('<section class="hero"'):h.index("</div></section>", h.index('<section class="hero"'))]
    flow = one(r'<ol class="flow">(.*?)</ol>', h)
    steps = re.findall(r'<li class="(you|we)"><span class="who">\w+</span>\s*<h3>(.*?)</h3>\s*<p>(.*?)</p>(.*?)</li>', flow, re.S)
    you = [s for s in steps if s[0] == "you"]
    we = [s for s in steps if s[0] == "we"]
    jobber = h[h.index('id="jobber"'):h.index("</section>", h.index('id="jobber"'))]
    rows = re.findall(r'<div class="k" role="rowheader">(.*?)</div><div class="a" role="cell">(.*?)</div><div class="b( money)?" role="cell">(.*?)</div>', jobber)
    final = section(h, "final")
    return dict(
        title=one(r"<title>(.*?)</title>", h), desc=one(r'<meta name="description" content="(.*?)">', h),
        chip=one(r'<p class="eyebrow[^"]*">(.*?)</p>', hero), h1=one(r"<h1[^>]*>(.*?)</h1>", hero),
        promise=one(r'<p class="promise[^"]*">(.*?)</p>', hero),
        lede=(re.search(r'<p class="lede">(.*?)</p>', hero) or [None, None])[1],
        ticks=one(r'<ul class="ticks[^"]*">(.*?)</ul>', hero),
        money=section(h, "money"),
        results_h2=one(r'id="results">.*?<h2>(.*?)</h2>', h), swipe=one(r'<p class="swipe">(.*?)</p>', h),
        step1=you[0], find=we[0], last=you[-1],
        mails=re.findall(r"<b>(Fwd: [^<]*)</b><small>([^<]*)</small>", you[0][3]),
        list=re.findall(r"<div><span>(.*?)</span><em>(.*?)</em></div>", we[0][3]),
        more=one(r'<div class="more"><span>(.*?)</span>', we[0][3]),
        replies=re.findall(r'<span( class="x")?>(.*?)</span>', one(r'<div class="ex-replies">(.*?)</div>', flow)),
        friday=one(r'<p class="friday">(.*?)</p>', h),
        j_h2=one(r"<h2>(.*?)</h2>", jobber), j_sub=one(r'<p class="sub">(.*?)</p>', jobber),
        j_label=one(r'<div class="vs" role="table" aria-label="(.*?)">', jobber), j_them=one(r'<div class="h a" role="columnheader">(.*?)</div>', jobber),
        rows=rows, reach=(re.search(r'<p class="reach">(.*?)</p>', jobber) or [None, None])[1],
        j_src=one(r'<p class="src">(.*?)</p>', jobber), keep=one(r'<p class="keep">(.*?)</p>', jobber),
        pricing=section(h, "pricing"), faq=section(h, "faq"),
        f_h2=one(r"<h2>(.*?)</h2>", final), f_sub=one(r'<p class="sub">(.*?)</p>', final),
        f_ticks=(re.search(r'<ul class="ticks">(.*?)</ul>', final) or [None, ONE_PASS_FINAL_TICKS])[1],
        monthly="$497" in h,
    )


def head(n, cold=False):
    t = H.unescape(n["h1"])
    og_desc = n["desc"].split(". ", 1)[1] if ". " in n["desc"] else n["desc"]
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{n["title"]}</title>
<meta name="description" content="{n["desc"]}">
<link rel="icon" href="{MARK}" type="image/svg+xml">
<meta name="theme-color" content="#8DC0FF">{chr(10) + '<meta name="robots" content="noindex">' if cold else ""}
<meta property="og:type" content="website">
<meta property="og:site_name" content="Quiet Accounts">
<meta property="og:title" content="{H.escape(t, quote=True)}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="https://quietaccounts.com/og-sky.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
{FONTS}
<link rel="stylesheet" href="/src/soro.css">
<link rel="stylesheet" href="/src/sky.css">
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="#top" aria-label="Quiet Accounts, top of page"><img src="{MARK}" width="32" height="32" alt="">Quiet Accounts</a>
</div></header>
'''


def picker(trade):
    links = "".join(f'<a href="{href}"{" aria-current=" + chr(34) + "page" + chr(34) if t == trade else ""}>{label}</a>' for t, label, href, _ in TRADES)
    return f'<div class="pick-wrap"><p class="pick-k" id="pickK">Pick your trade</p><div class="pick" role="group" aria-labelledby="pickK">{links}</div></div>'


def replies(n):
    return "".join(f'<span{" class=" + chr(34) + "x" + chr(34) if x else ""}>{t}</span>' for x, t in n["replies"])


def showcase(n):
    return f'''  <div class="hwork"><div class="wrap">
    <div class="glass">
      <div class="g-left">
        <!--qa:note-->
        <div class="rchips"><p>Up to three short notes. A person reads every reply.</p><div>{replies(n)}</div></div>
      </div>
      <div class="g-right">
        <span class="pill-k">{CHAT_SVG}The text you get when someone wants the work</span>
        <!--qa:handoff-->
        <div class="msg-me"><small>You &middot; 9:14 AM</small><span>On it. Calling at 5.</span></div>
      </div>
    </div>
    <!--qa:tally-->
  </div></div>'''


def how(n):
    fwd = "".join(f'<div class="fwd"><span class="ic">{FWD_SVG}</span><div><b>{b}</b><small>{s}</small></div><span class="go">Send</span></div>' for b, s in n["mails"])
    rows = "".join(f'<div><span>{a}</span><em>{b}</em></div>' for a, b in n["list"])
    find = n["find"][1].rstrip(".").replace(", and every past customer", " and every past customer")
    return f'''<section class="sec how" id="how"><div class="wrap">
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
  <p class="friday">{n["friday"]}</p>
</div></section>'''


def jobber(n):
    def cell(v):
        return v
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
      <thead><tr><td></td><th scope="col" class="us"><img src="{MARK}" width="34" height="34" alt="">Quiet Accounts</th><th scope="col">{n["j_them"]}</th></tr></thead>
      <tbody>
{chr(10).join(rows)}
      </tbody>
    </table>
  </div>{reach}
  <p class="src">{n["j_src"]}</p>
  <p class="keep">{n["keep"]}</p>
  <!--qa:works-->
</div></section>'''


def pricing(n):
    p = n["pricing"]
    if n["monthly"]:
        a = '<div class="plan free">\n'
        assert p.count(a) == 1
        p = p.replace(a, a + '      <span class="flag">Start here</span>\n')
    return f'<section class="sec" id="pricing"><div class="wrap">\n{p}\n</div></section>'


def final(n, sub=None):
    return f'''<section class="final" id="final">
  <h2>{n["f_h2"]}</h2>
  <ul class="ticks">{n["f_ticks"]}</ul>
  <p class="sub">{sub or n["f_sub"]}</p>
  <!--qa:cta-->
{FINAL_SKY}
</section>'''


TAIL = '''</main>

<!--qa:footer-->
<!--qa:sticky-->
<script type="module" src="/src/page.ts"></script>
</body>
</html>
'''


def page(trade):
    n = navy(trade)
    lede = f'\n  <p class="lede">{n["lede"]}</p>' if n["lede"] else ""
    return head(n) + f'''
<main id="top">
<section class="hero hero-top" id="hero">
  <div class="wrap">
  {picker(trade)}
  <p class="chip">{n["chip"]}</p>
  <h1>{n["h1"]}</h1>
  <p class="promise">{n["promise"]}</p>{lede}
  <!--qa:form-->
  <ul class="ticks">{n["ticks"]}</ul>
  </div>
</section>
<section class="hero2" aria-label="Your note, and the text you get">
{showcase(n)}
  {CLOUDS}
</section>

<section class="sec" id="results"><div class="wrap">
  <h2>{n["results_h2"]}</h2>
  <div class="cards">
<!--qa:results-->
  </div>
  <p class="swipe">{n["swipe"]}</p>
  <p class="ask">Want to ask them yourself? Text <a href="sms:+16033407673">603-340-7673</a> and we'll pass on their number.</p>
</div></section>

{how(n)}

<section class="sec" id="money"><div class="wrap">
{n["money"]}
</div></section>

{jobber(n)}

{pricing(n)}

<section class="sec" id="faq"><div class="wrap">
{n["faq"]}
</div></section>

{final(n)}
''' + TAIL


def cold():
    """The violet cold email page in the sky dress: its own order and words, clouds under the form, the sky at the close."""
    h = open(f"{SITE}/cold-email-page/index.html", encoding="utf-8").read()
    for a, b in [("logo-mark-violet.svg", "logo-mark-sky.svg"), ("og-soro.png", "og-sky.png"),
                 ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400;500;600;700&display=swap">', FONTS),
                 ('<link rel="stylesheet" href="/src/soro.css">', '<link rel="stylesheet" href="/src/soro.css">\n<link rel="stylesheet" href="/src/sky.css">'),
                 ('<meta name="theme-color" content="#FFFFFF">', '<meta name="theme-color" content="#8DC0FF">'),
                 ("  <!--qa:form:open-->\n</div></section>", f"  <!--qa:form:open-->\n</div>\n{CLOUDS}\n</section>")]:
        assert h.count(a) >= 1, a[:60]
        h = h.replace(a, b)
    return h


def write(folder, h):
    os.makedirs(f"{SITE}/{folder}", exist_ok=True)
    open(f"{SITE}/{folder}/index.html", "w", encoding="utf-8").write(h)
    print(folder, len(h))


for trade, _, _, folder in TRADES:
    write(folder, page(trade))
write("sky-cold-email-page", cold())
