#!/usr/bin/env python3
"""
build_standalone.py — fold the whole game into one openable .html file.

index.html is 2MB of game that then asks the network for 5MB of art: seven
module scripts, six JSON manifests and three hundred PNGs. Opened from a file://
URL none of that arrives — fetch() is blocked on file:// in every browser — so
the game loads, finds no sprites, and falls back to its hand-drawn art with
multiplayer switched off. That is not a download anyone can play.

This writes a single file that needs nothing else. Everything the game asks for
at runtime goes through one of two doors:

  fetch(path)   for the six JSON manifests
  img.src=path  for every PNG

so both are shimmed to answer from a map baked into the file, and the module
scripts are inlined in place. PeerJS is inlined too, ahead of its loader, which
already returns early when window.Peer exists — so multiplayer keeps working
from a local file instead of silently needing a CDN.

Nothing about the game's own source changes; the shims sit in front of it.

Emits:
  dist/dust-and-harvest.html

Usage:
  ./tools/build_standalone.py
"""

import base64
import json
import mimetypes
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "index.html"
OUT = REPO / "dist" / "dust-and-harvest.html"

# Inlined as <script> in place, not as fetchable assets.
INLINE_SCRIPTS = re.compile(r'<script src="(assets/js/[^"]+\.js)"[^>]*>\s*</script>')

TEXT_SUFFIXES = {".json"}


def collect_assets():
    """Every asset the runtime can ask for, keyed by the path it will ask with."""
    out = {}
    for p in sorted((REPO / "assets").rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(REPO).as_posix()
        # The module scripts are inlined; the vendored PeerJS is handled on its
        # own. Neither is ever fetched by path once this file is built.
        if rel.startswith("assets/js/"):
            continue
        if p.suffix in TEXT_SUFFIXES:
            out[rel] = p.read_text(encoding="utf-8")
        else:
            mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
            out[rel] = "data:%s;base64,%s" % (
                mime, base64.b64encode(p.read_bytes()).decode("ascii"))
    return out


SHIM = """<script>
/* Standalone build: the game's assets live in this file, not next to it.

   Two doors to cover. fetch() serves the JSON manifests — it is also the call
   that fails outright on file://, which is the whole reason this build exists.
   The img.src setter covers the PNGs, which do load from file:// but only if
   something rewrites the path to the baked-in data URI first.

   Both fall through to the real thing for anything not in the map, so a build
   that is missing an asset degrades exactly as the unbundled game does rather
   than throwing. */
(function () {
  var A = window.__DH_ASSETS || {};
  function norm(u) {
    u = String(u);
    if (/^data:/.test(u)) return null;
    try {
      if (/^[a-z]+:\\/\\//i.test(u)) u = new URL(u).pathname;
    } catch (e) { /* not a URL we can parse; fall through to the tidy-up */ }
    return u.replace(/^\\.\\//, '').replace(/^\\//, '');
  }

  var realFetch = window.fetch && window.fetch.bind(window);
  window.fetch = function (input, init) {
    var raw = (typeof input === 'string') ? input : (input && input.url) || '';
    var key = norm(raw);
    if (key && Object.prototype.hasOwnProperty.call(A, key)) {
      var body = A[key];
      var type = /\\.json$/.test(key) ? 'application/json' : 'text/plain';
      return Promise.resolve(new Response(body, {
        status: 200, headers: { 'Content-Type': type }
      }));
    }
    if (!realFetch) return Promise.reject(new Error('fetch unavailable: ' + raw));
    return realFetch(input, init);
  };

  var proto = HTMLImageElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'src');
  if (desc && desc.set) {
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: desc.enumerable,
      get: function () { return desc.get.call(this); },
      set: function (v) {
        var key = norm(v);
        desc.set.call(this, (key && A[key]) ? A[key] : v);
      }
    });
  }
})();
</script>
"""


def main():
    html = SRC.read_text(encoding="utf-8")

    assets = collect_assets()
    total = sum(len(v) for v in assets.values())
    print(f"  {len(assets)} assets, {total/1e6:.1f}MB inlined")

    # A JSON object literal is valid JavaScript. "</" is the only sequence that
    # could end the script tag early; nothing else in base64 or JSON can.
    blob = json.dumps(assets, separators=(",", ":")).replace("</", "<\\/")
    preamble = f"<script>window.__DH_ASSETS={blob};</script>\n" + SHIM

    # PeerJS ahead of everything, so _dhLoadPeerJS sees window.Peer and returns
    # early instead of reaching for a CDN that file:// pages often cannot use.
    peer = REPO / "assets" / "js" / "vendor" / "peerjs.min.js"
    if peer.exists():
        preamble += "<script>" + peer.read_text(encoding="utf-8") + "</script>\n"
        print("  PeerJS inlined — multiplayer works without a CDN")
    else:
        print("  ! no vendored PeerJS; multiplayer will need the network")

    # The module scripts, inlined where they stood so load order is unchanged.
    inlined = []

    def swap(m):
        path = REPO / m.group(1)
        inlined.append(m.group(1))
        return "<script>\n" + path.read_text(encoding="utf-8") + "\n</script>"

    html, n = INLINE_SCRIPTS.subn(swap, html)
    print(f"  {n} module scripts inlined: {', '.join(Path(p).name for p in inlined)}")
    if n == 0:
        sys.exit("no <script src=\"assets/js/...\"> tags matched — has the markup changed?")

    # The one asset referenced from CSS rather than from code.
    css_icon = "assets/icons/items.png"
    if css_icon in assets:
        html, c = re.subn(r"url\('%s'\)" % re.escape(css_icon),
                          "url('%s')" % assets[css_icon], html)
        print(f"  {c} CSS url() rewritten")

    # Everything above goes in before the first script the game runs.
    marker = "<script"
    idx = html.index(marker)
    html = html[:idx] + preamble + html[idx:]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    mb = OUT.stat().st_size / 1e6
    print(f"\nwrote {OUT.relative_to(REPO)}  ({mb:.1f}MB)")
    if re.search(r'src="assets/', html):
        print("  ! some assets/ references survived — check them before shipping")


if __name__ == "__main__":
    main()
