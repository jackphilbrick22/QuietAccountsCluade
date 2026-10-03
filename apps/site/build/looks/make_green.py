"""Writes green-site/ and green-cold-email-page/ from the violet templates: same words and markers, the green look."""
import os
SITE = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
FONTS_OLD = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cal+Sans&family=Inter:wght@400;500;600;700&display=swap">'
FONTS_NEW = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap">'
HILL = '''  <div class="hill" aria-hidden="true">
    <img class="rise" src="/src/assets/logo-mark-green.svg" width="142" height="142" alt="">
    <i class="mound"></i>
  </div>'''
SKY = '''  <div class="sky" aria-hidden="true">
    <img class="rise" src="/src/assets/logo-mark-violet.svg" width="144" height="144" alt="">
    <div class="clouds"><i></i><i></i><i></i><i></i><i></i></div>
  </div>'''
LIST_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#1B5A31" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>'
CHAT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="#1B5A31" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
ROWS = [("Mike Sanderson", "Fall cleanup + leaves", "Nov 2025", "booked", "Booked &middot; $640"),
        ("Paul Bergeron", "Weekly mowing", "Nov 2025", "yes", "Wants it done"),
        ("Karen Whitfield", "Spring cleanup", "Apr 2025", "back", "Wrote back"),
        ("Raj Okafor", "Aeration + overseed", "Sep 2025", "", "Note 2 sent"),
        ("Dana Pruitt", "Mulch + edging", "May 2025", "", "Asked")]
QLIST = f'''<section class="qlist" aria-label="Example: last season's customers, asked"><div class="wrap">
  <div class="qcard" aria-hidden="true">
    <div class="qtable">
      <div class="qhead"><b>{LIST_ICON}<span>Customers who haven't booked: <span data-company>Ridgeline Landscaping</span></span></b><span class="eg-pill">Example</span></div>
{chr(10).join(f'      <div class="qrow"><span><b>{n}</b><small>{s} &middot; last here {d}</small></span><i{(" class=" + chr(34) + c + chr(34)) if c else ""}>{t}</i></div>' for n, s, d, c, t in ROWS)}
      <div class="qmore">+ everyone else who hasn't booked</div>
    </div>
    <div class="qside">
      <span class="pill-k">{CHAT_ICON}A text to you</span>
      <div class="msg">
        <div class="msg-top"><span>Quiet Accounts</span><span>9:12 AM</span></div>
        <p class="msg-title">Mike Sanderson wants it done</p>
        <p class="msg-sub">Fall cleanup + leaves &middot; last job Nov 2025</p>
        <q class="msg-said">Yes, same as last year. Any day next week works.</q>
        <p class="msg-meta">14 Oak Ln &middot; best contact: cell, after 5</p>
      </div>
      <div class="msg-me"><small>You &middot; 9:14 AM</small><span>On it. Calling him at 5.</span></div>
    </div>
  </div>
  <!--qa:works-->
</div></section>
'''

def common(h):
    for a, b in [("logo-mark-violet.svg", "logo-mark-green.svg"), ("og-soro.png", "og-green.png"), (FONTS_OLD, FONTS_NEW),
                 ('<link rel="stylesheet" href="/src/soro.css">', '<link rel="stylesheet" href="/src/soro.css">\n<link rel="stylesheet" href="/src/green.css">'),
                 ('<meta name="theme-color" content="#FFFFFF">', '<meta name="theme-color" content="#1B5A31">'),
                 ('#6A47F5', '#1B5A31'), (SKY.replace("logo-mark-violet.svg", "logo-mark-green.svg"), HILL)]:
        assert a in h or a == '#6A47F5', a[:60]
        h = h.replace(a, b)
    return h

def write(folder, h):
    os.makedirs(f"{SITE}/{folder}", exist_ok=True)
    open(f"{SITE}/{folder}/index.html", "w").write(h)
    print(folder, len(h))

main = common(open(f"{SITE}/main-site/index.html").read())
s = main.index('  <div class="peekcard" aria-hidden="true">')
e = main.index('\n</div></section>', s)
main = main[:s].rstrip() + main[e:]
hero_end = main.index('</div></section>', main.index('<section class="hero"')) + len('</div></section>')
main = main[:hero_end] + '\n\n' + QLIST + main[hero_end:]
ws = main.index('<section class="sec" id="works">'); we = main.index('</div></section>', ws) + len('</div></section>')
main = main[:ws].rstrip() + '\n' + main[we:].lstrip('\n')
write("green-site", main)
write("green-cold-email-page", common(open(f"{SITE}/cold-email-page/index.html").read()))
