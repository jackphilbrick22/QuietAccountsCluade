"""Writes paper-site/ and paper-cold-email-page/: the explee-style look Jack picked from the mockups, with the real form,
results, calculator, note and text in it. The main page takes explee's order (the cost table right under the hero, the
work as stacked cards); the cold email page keeps its own short order and only changes how it looks."""
import os, re
SITE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
FONTS_OLD = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400;500;600;700&display=swap">'
FONTS_NEW = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap">'
INK_MARK = "/src/assets/logo-mark-ink.svg"


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c + t ** 3 * d for a, b, c, d in zip(p0, p1, p2, p3))


def lines(vh, half, cy, starts, green):
    """Thin lines from both edges, each bending in to meet the form (or the button) at its side: last season's
    customers, coming back to his company's name. A few dots on them are green: the ones who booked."""
    paths, dots = [], []
    for side in (0, 1):
        for i, y0 in enumerate(starts):
            x3 = 960 - half if side == 0 else 960 + half
            x0, x1, x2 = (-20, x3 - 156, x3 - 86) if side == 0 else (1940, x3 + 156, x3 + 86)
            y3 = cy + (y0 - cy) * 0.06
            paths.append(f'<path d="M{x0} {y0}C{x1} {y0} {x2} {y3:.1f} {x3} {y3:.1f}"/>')
            for j, t in enumerate((0.3, 0.62)):
                x, y = bez((x0, y0), (x1, y0), (x2, y3), (x3, y3), t)
                g = (side, i) in green and j == 1
                dots.append(f'<circle cx="{x:.0f}" cy="{y:.1f}" r="{2.8 if g else 2.2}"{" class=" + chr(34) + "g" + chr(34) if g else ""}/>')
    return (f'<svg class="lines" aria-hidden="true" focusable="false" viewBox="0 0 1920 {vh}" width="1920" height="{vh}">'
            f'<g fill="none">{"".join(paths)}</g>{"".join(dots)}</svg>')


HERO_LINES = lines(820, 304, 588, [40, 150, 270, 400, 540, 680, 790], {(0, 2), (1, 4), (0, 5), (1, 1)})
FINAL_LINES = lines(240, 140, 120, [52, 76, 100, 140, 164, 188], {(0, 1), (1, 4)})

FWD_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#0D0D0C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>'


def head(h):
    for a, b in [("logo-mark-violet.svg", "logo-mark-ink.svg"), ("og-soro.png", "og-paper.png"), (FONTS_OLD, FONTS_NEW),
                 ('<link rel="stylesheet" href="/src/soro.css">', '<link rel="stylesheet" href="/src/soro.css">\n<link rel="stylesheet" href="/src/paper.css">'),
                 ('<meta name="theme-color" content="#FFFFFF">', '<meta name="theme-color" content="#F6F5F2">')]:
        assert a in h, a[:60]
        h = h.replace(a, b)
    return h


def section(h, start):
    s = h.index(start)
    return h[s:h.index("</div></section>", s) + len("</div></section>")]


def final(sub):
    return f'''<section class="final" id="final"><div class="wrap">
  <h2>Your first 150 are free, then $497 a month if <span class="g">you say yes.</span></h2>
  <p class="sub">{sub}</p>
  <div class="converge">
    {FINAL_LINES}
    <!--qa:cta-->
  </div>
  <ul class="ticks"><li>No card</li><li>No contract</li><li>Cancel by text</li></ul>
</div></section>'''


def cost_row(k, buy, ours):
    return (f'    <div class="crow" role="row"><span class="ck" role="rowheader">{k}</span>'
            f'<span class="cc" role="cell"><span><i aria-hidden="true">Buy new customers</i>{buy}</span></span>'
            f'<span class="cc us" role="cell"><span><i aria-hidden="true">Quiet Accounts</i>{ours}</span></span></div>')


COST = f'''<section class="sec cost" aria-labelledby="costH"><div class="wrap">
  <h2 class="vh" id="costH">Buying new customers, or asking last season's back</h2>
  <div class="cgrid" role="table" aria-labelledby="costH">
    <div class="crow chead" role="row">
      <span class="ck" role="columnheader">What filling your schedule takes</span>
      <div class="cc" role="columnheader"><p class="cn"><b>Buy new customers</b><span class="cbig red">$118<small> a lead</small></span></p><p class="cs">Google search ads, landscaping</p></div>
      <div class="cc us" role="columnheader"><p class="cn"><b><img src="{INK_MARK}" width="24" height="24" alt="">Quiet Accounts</b><span class="cbig">$0<small> first 150</small></span></p><p class="cs">then $497/mo if you say yes</p></div>
    </div>
{cost_row("Who you're reaching", "Strangers comparing three quotes", "Customers who already paid you")}
{cost_row("What each one costs", "About $118 a lead from search ads, $37 from Local Services ads", "Nothing for your first 150")}
{cost_row("Who does the work", "You: call back, quote, drive out, chase", "We write, follow up and read every reply")}
{cost_row("A month nothing comes of it", "The clicks are paid for anyway", "You don't pay")}
  </div>
  <p class="src">Lead cost: <!--qa:source:lead-cost-landscaping-->.</p>
</div></section>'''

VISITS = [("Paul Bergeron", "weekly mowing", "Nov 2025"), ("Karen Whitfield", "spring cleanup", "Apr 2025"),
          ("Raj Okafor", "aeration + overseed", "Sep 2025"), ("Dana Pruitt", "mulch + edging", "May 2025")]
LIST_UI = ('<div class="vlist"><p class="vlist-h"><span>From your Visits report</span><span class="eg-pill">Example</span></p>'
           + "".join(f'<p class="vrow"><span>{n} <i>&middot; {s}</i></span><em>{d}</em></p>' for n, s, d in VISITS)
           + '<p class="vmore">+ everyone else who hasn&#39;t booked</p></div>')
REPLIES = [("Yes, same as last year.", "Wants it done", True), ("Can you do the same price?", "Sent to you", True),
           ("We had someone else do it.", "No more notes", False), ("Stop.", "Removed that minute", False)]
REPLY_UI = ('<div class="vlist"><p class="vlist-h"><span>Replies, each one read</span><span class="eg-pill">Example</span></p>'
            + "".join(f'<p class="rrow"><q>{q}</q><b{" class=" + chr(34) + "yes" + chr(34) if y else ""}>{t}</b></p>' for q, t, y in REPLIES)
            + '</div>')


def stage(title, text, ui):
    return f'''    <div class="stage">
      <div class="stage-t"><h3>{title}</h3><p>{text}</p></div>
      <div class="stage-ui">{ui}</div>
    </div>'''


def main_page():
    src = open(f"{SITE}/main-site/index.html").read()
    top = head(src[:src.index("<body>")])
    pricing = section(src, '<section class="sec" id="pricing">')
    faq = section(src, '<section class="sec" id="faq">')
    body = f'''<body>
<header class="top"><div class="wrap">
  <a class="logo" href="#top" aria-label="Quiet Accounts, top of page"><img src="{INK_MARK}" width="30" height="30" alt="">Quiet Accounts</a>
  <p class="top-price">First 150 free, then $497/mo if you say yes</p>
</div></header>

<main id="top">
<section class="hero" id="hero"><div class="wrap">
  <p class="chip">For lawn and landscaping companies</p>
  <h1>Last season's customers, <span class="g">booked again.</span></h1>
  <p class="promise">Done for you. Any month nobody asks to come back, you don't pay.</p>
  <p class="lede">We write to every customer who hasn't booked, in your name. You get a text when one wants the work.</p>
  <div class="converge">
    {HERO_LINES}
    <!--qa:form-->
  </div>
  <ul class="ticks"><li>No call, no card</li><li>Your part: forward one email</li></ul>
  <!--qa:tally-->
</div></section>

{COST}

<section class="sec" id="results"><div class="wrap">
  <h2>What the first 150 did for three shops.</h2>
  <div class="cards">
<!--qa:results-->
  </div>
  <p class="swipe">Swipe for the other two &rarr;</p>
  <p class="ask">Want to ask them yourself? Text <a href="sms:+16033407673">603-340-7673</a> and we'll pass on their number.</p>
</div></section>

<section class="sec" id="how"><div class="wrap">
  <h2>You forward one email. We run the rest.</h2>
  <div class="yourpart"><b>Your part:</b><span class="fwdchip">{FWD_ICON}<span>Fwd: Visits report <em>to quotes@quietaccounts.com</em></span></span><span>About four minutes. Then you read the first note and text OK.</span></div>
  <div class="stages">
{stage("Finds everyone who hasn't booked", "From the report your software already makes. Nobody gets left out because they went quiet before you set anything up.", LIST_UI)}
{stage("Writes each one a note from your office", "Your company's name on it, their last job in it. You read the first one, and nothing sends until you say so.", "<!--qa:note-->")}
{stage("Follows up and reads every reply", "Up to three short notes. A person reads each reply. Anyone who says stop is off the list that minute.", REPLY_UI)}
{stage("Texts you every yes", "Their name, address, the last job and what they said. You call and book. Every Friday, a text with your week.", "<!--qa:handoff-->")}
  </div>
</div></section>

<section class="sec" id="jobber"><div class="wrap">
  <h2>Three things Jobber's campaigns don't do.</h2>
  <div class="three">
    <div><h3>Ask the customers who went quiet before you set it up</h3><p><!--qa:claim:jobber-campaigns-not-retroactive--> We ask every one.</p></div>
    <div><h3>Read every reply</h3><p>A person reads each one and texts you the yeses, the same day. Not your inbox.</p></div>
    <div><h3><span class="g">$0</span> any month nobody asks to come back</h3><p><!--qa:claim:jobber-campaigns-add-on--></p></div>
  </div>
  <p class="src">Source: <!--qa:source:jobber-campaigns-not-retroactive-->; <!--qa:source:jobber-campaigns-add-on-->.</p>
  <p class="keep">Keep Jobber. <span>We work from its export.</span></p>
  <!--qa:works-->
</div></section>

<section class="sec" id="money"><div class="wrap">
  <h2>You already paid for these customers.</h2>
  <p class="sub"><!--qa:claim:lead-cost-landscaping--> These ones already know you, and nobody's asked them back.</p>
  <!--qa:calc-->
  <p class="src">Lead cost: <!--qa:source:lead-cost-landscaping-->.</p>
</div></section>

{pricing}

{faq}

{final("Your company name shows you the first note. Three more fields and one forwarded email, and we text you that note to read within one business day.")}
</main>

<!--qa:footer-->
<!--qa:sticky-->
<script type="module" src="/src/page.ts"></script>
</body>
</html>
'''
    return top + body


def cold_page():
    h = head(open(f"{SITE}/cold-email-page/index.html").read())
    a = "<h1>Last season's customers, booked again.</h1>"
    assert a in h
    h = h.replace(a, "<h1>Last season's customers, <span class=\"g\">booked again.</span></h1>")
    logo = '<img src="/src/assets/logo-mark-ink.svg" width="32" height="32" alt="">Quiet Accounts</a>'
    assert h.count(logo) == 1
    h = h.replace(logo, logo + '\n  <p class="top-price">First 150 free, then $497/mo if you say yes</p>')
    s = h.index('<section class="final" id="final">')
    e = h.index("</section>", s) + len("</section>")
    sub = re.search(r'<p class="sub">(.*?)</p>', h[s:e]).group(1)
    return h[:s] + final(sub) + h[e:]


def write(folder, h):
    os.makedirs(f"{SITE}/{folder}", exist_ok=True)
    open(f"{SITE}/{folder}/index.html", "w").write(h)
    print(folder, len(h))


write("paper-site", main_page())
write("paper-cold-email-page", cold_page())
