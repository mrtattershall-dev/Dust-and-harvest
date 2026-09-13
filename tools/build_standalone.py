#!/usr/bin/env python3
"""Bake index.html + assets/ into one self-contained .html file.

Run:  ./tools/build_standalone.py [output.html]

The game as it lives in the repo is one big HTML file plus 329 asset files it
fetches at runtime, which is right for development and for itch.io (upload the
folder as a zip and the browser fetches normally). It is wrong for handing
someone a single file to double-click, because `file://` blocks `fetch`, so
every sprite, icon and ground texture silently falls back to the hand-drawn
art.

This produces one file that runs from `file://`, from a phone's Files app, or
anywhere else, with all art intact.

How, without touching the game's own code:

* The five `<script src="assets/js/...">` tags are replaced with their
  contents inline, in the same order.
* Every file under `assets/` is embedded in one `ASSETS` map — JSON as text,
  images as `data:` URIs.
* A shim, injected before everything else, intercepts the three ways the game
  reaches for an asset: `fetch()`, assigning to an `<img>`'s `src`, and CSS
  `url(...)`. The first two are patched at runtime; the third is rewritten
  here at bake time.

The shim resolves any path containing `assets/` against the map and falls
through to the real `fetch` / `src` for anything else, so nothing about the
game's loading code has to change and the repo version keeps working normally.

Expect roughly 9 MB: base64 costs about a third on top of the 5 MB of assets.
"""
import base64
import json
import mimetypes
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
TEXT_EXT = {".json"}


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else REPO / "dist" / "dust-and-harvest.html"
    html = (REPO / "index.html").read_text(encoding="utf-8")

    # ── 1. collect every asset ───────────────────────────────────────────
    table, n_text, n_bin, raw = {}, 0, 0, 0
    for f in sorted(ASSETS.rglob("*")):
        if not f.is_file():
            continue
        key = f.relative_to(REPO).as_posix()          # "assets/icons/items.png"
        data = f.read_bytes()
        raw += len(data)
        if f.suffix in TEXT_EXT:
            table[key] = data.decode("utf-8")
            n_text += 1
        elif f.suffix == ".js":
            continue                                   # inlined as <script>, below
        else:
            mime = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
            table[key] = "data:%s;base64,%s" % (mime, base64.b64encode(data).decode())
            n_bin += 1

    # ── 2. inline the <script src> tags, in order ────────────────────────
    def inline_script(m):
        src = m.group(1)
        p = REPO / src
        if not p.is_file():
            print(f"  ! missing script {src}, left as-is")
            return m.group(0)
        # </script> inside the source would close the wrapper early
        body = p.read_text(encoding="utf-8").replace("</script>", "<\\/script>")
        return f"<script>\n/* inlined from {src} */\n{body}\n</script>"

    html, n_js = re.subn(r'<script src="(assets/js/[^"]+)"></script>', inline_script, html)

    # ── 3. rewrite CSS url(...) to the embedded data URIs ────────────────
    def css_url(m):
        path = m.group(2).strip("'\"")
        return f"url({table[path]})" if path in table else m.group(0)

    html, n_css = re.subn(r"url\((\s*)(['\"]?assets/[^)]+?['\"]?)\)", css_url, html)

    # ── 4. the shim, first thing in the document ─────────────────────────
    shim = """<script>
/* Standalone shim — baked by tools/build_standalone.py.
   Serves assets/... from the embedded table so the game runs from file://,
   where fetch() is blocked. Anything not in the table falls through to the
   real fetch / src, so nothing else changes. */
(function () {
  var A = window.__DH_ASSETS__;
  function key(u) {
    u = String(u).split('?')[0].split('#')[0];
    var i = u.indexOf('assets/');
    return i < 0 ? null : u.slice(i);
  }
  var realFetch = window.fetch;
  window.fetch = function (u, o) {
    var k = key(u && u.url ? u.url : u);
    if (k && A[k] != null) {
      return Promise.resolve(new Response(A[k], {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }));
    }
    return realFetch.apply(this, arguments);
  };
  var d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get: function () { return d.get.call(this); },
    set: function (v) {
      var k = key(v);
      d.set.call(this, (k && A[k] != null) ? A[k] : v);
    }
  });
})();
</script>"""
    payload = ("<script>window.__DH_ASSETS__=" +
               json.dumps(table, separators=(",", ":")) + ";</script>")

    # The payload and shim must precede every consumer, so they go immediately
    # after <head> — before the first inline script in the document.
    i = html.index(">", html.index("<head")) + 1
    html = html[:i] + "\n" + payload + "\n" + shim + html[i:]

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    mb = out.stat().st_size / 1024 / 1024
    print(f"{n_js} scripts inlined, {n_css} css urls rewritten")
    print(f"{n_text} json + {n_bin} binary assets embedded ({raw/1024/1024:.1f} MB raw)")
    print(f"-> {out}  [{mb:.1f} MB]")


if __name__ == "__main__":
    main()
