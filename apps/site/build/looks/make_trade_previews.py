"""Single-file previews of the all-trades site, to open from a folder in Chrome: the CSS and the script inside each
page, the pictures beside them in assets/, the form pretends to send, the trade switcher leads to the other previews,
and each cold email page opens the way its "show me" link would, for one company.

    python make_trade_previews.py <dist> <out>
"""
import json, os, re, shutil, sys, urllib.parse

DIST, OUT = sys.argv[1], sys.argv[2]
TRADES = [("lawn", "LAWN", "/", "Ridgeline Landscaping"), ("cleaning", "CLEANING", "/cleaning", "Ridgeline Cleaning"),
          ("fence", "FENCE", "/fence", "Ridgeline Fence"), ("tree", "TREE", "/tree-service", "Ridgeline Tree Co."),
          ("painting", "PAINTING", "/painting", "Ridgeline Painting")]
FILES = {}
for i, (t, name, _, _) in enumerate(TRADES, 1):
    FILES[f"{t}-site"] = f"{i} {name} - main page.html"
    FILES[f"{t}-cold-email-page"] = f"{i} {name} - cold email page.html"

STUB = """<script>/* preview only: the form pretends to send, so every step can be tried */
(function(){var f=window.fetch;window.fetch=function(u,o){try{var m=((o&&o.method)||'GET').toUpperCase();var s=typeof u==='string'?u:((u&&u.url)||'');
if(m==='POST'&&(s==='/'||/\\/start$/.test(s))){return new Promise(function(r){setTimeout(function(){r(new Response('ok',{status:200}))},350)})}}catch(e){}return f.apply(this,arguments)}})();</script>
"""


def as_link(company):
    q = urllib.parse.quote(company)
    return ('<script>/* preview only: open the way the "show me" link does, for one company */\n'
            f'try{{if(!/[?&]co=/.test(location.search))history.replaceState(null,"",location.pathname+"?co={q}")}}catch(e){{}}</script>\n')


def bar(cur):
    def link(pid, label):
        style = ' aria-current="page" style="color:#FFFFFF;text-decoration:none;font-weight:700"' if pid == cur else ' style="color:#BFD7FF"'
        return f'<a href="{urllib.parse.quote(FILES[pid])}"{style}>{label}</a>'
    groups = " &nbsp;|&nbsp; ".join(f'{name.title()}: {link(t + "-site", "page")} &middot; {link(t + "-cold-email-page", "cold email")}' for t, name, _, _ in TRADES)
    return ('<div style="background:#0B0F17;color:#D9DEE8;font:600 13px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 16px;display:flex;'
            'flex-wrap:wrap;gap:6px 14px;align-items:center"><b style="color:#BFD7FF">Preview</b><span>Nothing you type here is sent.</span>'
            f'<span>{groups}</span></div>\n')


shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT + "/assets")
for pid, fname in FILES.items():
    trade = pid.split("-")[0]
    h = open(f"{DIST}/{pid}/index.html", encoding="utf-8").read()
    for css in re.findall(r'<link rel="stylesheet" crossorigin href="/(assets/[^"]+\.css)">', h):
        h = h.replace(f'<link rel="stylesheet" crossorigin href="/{css}">', "<style>" + open(f"{DIST}/{css}", encoding="utf-8").read() + "</style>")
    js = re.search(r'<script type="module" crossorigin src="/(assets/[^"]+\.js)"></script>', h)
    code = open(f"{DIST}/{js.group(1)}", encoding="utf-8").read()
    company = [c for t, _, _, c in TRADES if t == trade][0]
    lead = STUB + (as_link(company) if pid.endswith("cold-email-page") else "")
    h = h.replace(js.group(0), lead + '<script type="module">' + code.replace("</script", "<\\/script") + "</script>")
    for a in sorted(set(re.findall(r'"/(assets/[^"]+\.(?:svg|jpg|png))"', h))):
        shutil.copy(f"{DIST}/{a}", f"{OUT}/{a}")
        h = h.replace(f'"/{a}"', f'"{a}"')
    # the switcher leads to the other previews; the footer's privacy and terms go to the live pages
    for t, _, href, _ in TRADES:
        h = h.replace(f'<a href="{href}"', f'<a href="{urllib.parse.quote(FILES[t + "-site"])}"')
    h = h.replace('href="/privacy"', 'href="https://quietaccounts.com/privacy"').replace('href="/terms"', 'href="https://quietaccounts.com/terms"')
    # Chrome won't start a worker from a file, so the audit's worker rides along inside the page
    wk = re.search(r'"/(assets/worker-[\w-]+\.js)"', h)
    if wk:
        body = json.dumps(open(f"{DIST}/{wk.group(1)}", encoding="utf-8").read()).replace("</", "<\\/")
        boot = ('<script>/* preview only: the audit worker, carried inside the page */\n'
                'window.__qaWorker=URL.createObjectURL(new Blob([' + body + '],{type:"text/javascript"}));</script>\n')
        h = h.replace(STUB, STUB + boot, 1)
        h = h.replace(wk.group(0), "window.__qaWorker")
    h = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + bar(pid), h, count=1)
    assert '"/assets/' not in h and 'href="/' not in h, pid
    open(f"{OUT}/{fname}", "w", encoding="utf-8").write(h)
print(len(FILES), "pages;", sorted(os.listdir(OUT + "/assets")))
