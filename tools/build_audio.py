#!/usr/bin/env python3
"""
build_audio.py — bake the delivered WAVs into web audio the game can ship.

The source files are 44.1kHz stereo WAV: 32MB for three sixty-second sea
ambiences alone. They also arrive with three problems that have to be fixed
here rather than worked around at runtime:

  loop seams  The ambiences are not loops. The jump from the last sample to
              the first is 0.06-0.07 against a peak of 0.12-0.19 — half the
              amplitude of the material — which clicks audibly every time
              round. The tail is crossfaded over the head instead, on an
              equal-power curve because the material is broadband noise and a
              linear fade would dip its RMS through the join.

  level       They peak at about -19dBFS and average -34. At any sane master
              volume they would be inaudible. Lifted by ONE COMMON GAIN per
              FAMILY rather than normalised one by one: a storm is meant to be
              louder than a calm sea, and the five dirt footsteps span 6.6dB
              between the lightest and the heaviest take, which is a real foot
              falling differently each time. Normalising each file would flatten
              both of those into nothing.

  dead air    chop_1 has 200ms of SILENCE before the axe lands, which would put
              the sound a fifth of a second behind the swing. Both one-shots are
              trimmed to their onset and faded out after their tail.

MP3 rather than Ogg Vorbis or Opus, which both sound better per byte: Safari
does not play either, the game runs in a browser on itch.io, and the one device
this is tested on is a phone. One format that works everywhere beats two.

Loops are baked MONO at 64k, one-shots stereo. That is measured, not assumed.
Encoding a forest bed and comparing third-octave bands against the source:

  stereo 112k   782 KB/57s   mean 0.51dB   worst 2.70dB
  stereo  96k   670 KB/57s   mean 0.79dB   worst 8.06dB  (-8dB at 12.9kHz)
  stereo  80k   558 KB/57s   mean 1.95dB   worst 29.2dB  (collapses)
  mono    64k   447 KB/57s   mean 0.44dB   worst 0.66dB  (only >16kHz)
  mono    48k   335 KB/57s   mean 1.95dB   worst 34.9dB  (collapses)

Mono 64k is BOTH smaller and more accurate than the stereo 112k this shipped
with: below 16kHz it is within 1dB, where stereo 96k is already losing 8dB at
12.9kHz — which for a forest bed is exactly where the insects and the leaf
detail are. The cost is the stereo image, and with seventeen ambience loops
that image is not worth six megabytes.

Usage:
  ./tools/build_audio.py SRC_DIR [...]        # any dir holding the WAVs
"""

import json
import subprocess
import sys
import wave
from pathlib import Path

try:
    import numpy as np
except ImportError:
    sys.exit("This tool needs numpy:  pip install numpy")

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "assets" / "audio"

SR = 44100
XFADE = 3.0          # seconds of tail crossfaded over the head
SHOT_FLOOR = 0.01    # below this is silence, for trimming
SHOT_FADE = 0.020    # seconds faded out at the end of a one-shot

# The peak the LOUDEST member of each family lands on. Everything else in the
# family keeps its distance from it.
FAMILY_PEAK = {
    "sea":  0.707,   # -3dBFS. Ambience, so this is the ceiling, not the level.
    "chop": 0.794,   # -2dBFS.
    "mine": 0.794,   # Struck stone, same ceiling as the axe.
    "cave":  0.707,  # Ambience, like the sea.
    "river": 0.707,
    "forest": 0.707,
    "inside": 0.707,
    "chest": 0.794,  # Lids and a lock: one family, so they match each other.
    "door":  0.794,
    # Walks and runs share this family, and a run is ~7dB heavier in the
    # material, so the ceiling belongs to the loudest RUN. 0.600 was set when
    # the family was walks only; leaving it there once runs joined pushed the
    # lightest walk down to 0.123, which disappears under the ambience.
    "step": 0.850,
}

# name -> (filename fragment, kind, family, bitrate)
PIECES = {
    "sea":       ("Sea.wav",       "loop", "sea",  "112k"),
    "sea_rain":  ("Sea_Rain.wav",  "loop", "sea",  "112k"),
    "sea_storm": ("Sea_Storm.wav", "loop", "sea",  "112k"),
    "chop1":     ("chop_1.wav",    "shot", "chop", "128k"),
    "chop2":     ("chop_2.wav",    "shot", "chop", "128k"),
    "chop3":     ("chop_3.wav",    "shot", "chop", "128k"),
    "chop4":     ("chop_4.wav",    "shot", "chop", "128k"),

    # The pick. Five takes that all peak within 0.006 of each other, so unlike
    # the footsteps there is almost no level variation in the material and the
    # variety has to come from which one is chosen.
    "mine1":     ("mine_1.wav",    "shot", "mine", "128k"),
    "mine2":     ("mine_2.wav",    "shot", "mine", "128k"),
    "mine3":     ("mine_3.wav",    "shot", "mine", "128k"),
    "mine4":     ("mine_4.wav",    "shot", "mine", "128k"),
    "mine5":     ("mine_5.wav",    "shot", "mine", "128k"),
    "step1":     ("Dirt_Walk_1.wav", "shot", "step", "96k"),
    "step2":     ("Dirt_Walk_2.wav", "shot", "step", "96k"),
    "step3":     ("Dirt_Walk_3.wav", "shot", "step", "96k"),
    "step4":     ("Dirt_Walk_4.wav", "shot", "step", "96k"),
    "step5":     ("Dirt_Walk_5.wav", "shot", "step", "96k"),

    # The same five takes with a chain layer over them — their raw peaks match
    # the plain set to within 0.001, so they are the same recordings re-dressed.
    # Same FAMILY on purpose: one gain over all ten keeps the loaded walk and
    # the empty one directly comparable instead of independently normalised to
    # the same loudness, which would have flattened the difference between
    # them. 96k rather than 128 because the chain lives above 2kHz, where the
    # encoder spends its bits anyway.
    "stepc1":    ("Dirt_Chain_Walk_1.wav", "shot", "step", "96k"),
    "stepc2":    ("Dirt_Chain_Walk_2.wav", "shot", "step", "96k"),
    "stepc3":    ("Dirt_Chain_Walk_3.wav", "shot", "step", "96k"),
    "stepc4":    ("Dirt_Chain_Walk_4.wav", "shot", "step", "96k"),
    "stepc5":    ("Dirt_Chain_Walk_5.wav", "shot", "step", "96k"),

    # Running. Same family as the walks ON PURPOSE: these peak at 0.144-0.290
    # against the walks' 0.059-0.128, so a run is about 7dB heavier than a walk
    # in the material itself. One family gain keeps that; giving runs their own
    # would have normalised a run and a walk to the same loudness, which is
    # exactly wrong.
    "run1":      ("Dirt_Run_1.wav", "shot", "step", "96k"),
    "run2":      ("Dirt_Run_2.wav", "shot", "step", "96k"),
    "run3":      ("Dirt_Run_3.wav", "shot", "step", "96k"),
    "run4":      ("Dirt_Run_4.wav", "shot", "step", "96k"),
    "run5":      ("Dirt_Run_5.wav", "shot", "step", "96k"),

    # The mine, heard from inside it, with the weather coming through.
    "cave":       ("Cave.wav",       "loop", "cave", "112k"),
    "cave_rain":  ("Cave_Rain.wav",  "loop", "cave", "112k"),
    "cave_storm": ("Cave_Storm.wav", "loop", "cave", "112k"),

    # Running water, played by proximity rather than by zone.
    "river":        ("River_Loop.wav",        "loop", "river", "112k"),
    "river_stream": ("River_Stream_Loop.wav", "loop", "river", "112k"),
    # Waterfall_Loop.wav was delivered too and is NOT baked: there is no
    # waterfall anywhere in the game, and an 800KB file nothing ever fetches
    # still costs 1.1MB in the standalone build, which embeds every asset.

    # Lids and a lock. One family: they are the same kind of mechanism and
    # were recorded within 0.07 of each other, so they should stay that way.
    "chest_open1":  ("Chest_Open_1.wav",  "shot", "chest", "128k"),
    "chest_open2":  ("Chest_Open_2.wav",  "shot", "chest", "128k"),
    "chest_close1": ("Chest_Close_1.wav", "shot", "chest", "128k"),
    "chest_close2": ("Chest_Close_2.wav", "shot", "chest", "128k"),
    "unlock":       ("Lock_Unlock.wav",   "shot", "chest", "128k"),

    "door_open1":   ("Door_Open_1.wav",   "shot", "door", "128k"),
    "door_open2":   ("Door_Open_2.wav",   "shot", "door", "128k"),
    "door_close1":  ("Door_Close_1.wav",  "shot", "door", "128k"),
    "door_close2":  ("Door_Close_2.wav",  "shot", "door", "128k"),

    # Outdoors, by time of day and weather. Six of them, and every one is a
    # bed the player can be standing in for a long time, so the day/night pair
    # matters more here than anywhere else.
    "forest_day":         ("Forest_Day.wav",         "loop", "forest", "64k"),
    "forest_day_rain":    ("Forest_Day_Rain.wav",    "loop", "forest", "64k"),
    "forest_day_storm":   ("Forest_Day_Storm.wav",   "loop", "forest", "64k"),
    "forest_night":       ("Forest_Night.wav",       "loop", "forest", "64k"),
    "forest_night_rain":  ("Forest_Night_Rain.wav",  "loop", "forest", "64k"),
    "forest_night_storm": ("Forest_Night_Storm.wav", "loop", "forest", "64k"),

    # Indoors — the farmhouse. No night variant was delivered, so night indoors
    # uses the day bed; it is a room, and the difference is what is audible
    # THROUGH the walls, which the weather variants already carry.
    "inside_day":       ("Inside_Day.wav",       "loop", "inside", "64k"),
    "inside_day_rain":  ("Inside_Day_Rain.wav",  "loop", "inside", "64k"),
    "inside_day_storm": ("Inside_Day_Storm.wav", "loop", "inside", "64k"),
}


def log(m):
    print(m, file=sys.stderr)


def ffmpeg():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    from shutil import which
    exe = which("ffmpeg")
    if not exe:
        sys.exit("No ffmpeg. pip install imageio-ffmpeg, or install ffmpeg.")
    return exe


def read_wav(path):
    with wave.open(str(path)) as w:
        if w.getsampwidth() != 2:
            sys.exit(f"{path.name}: expected 16-bit, got {w.getsampwidth()*8}")
        ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
        a = np.frombuffer(w.readframes(n), dtype="<i2")
    return a.reshape(-1, ch).astype(np.float32) / 32768.0, sr, ch


def seam_loop(a, sr):
    """Crossfade the tail over the head so the clip joins to itself."""
    c = int(XFADE * sr)
    if len(a) <= c * 2:
        return a, 0.0
    before = float(np.abs(a[0] - a[-1]).max())
    head, tail = a[:c], a[len(a) - c:]
    t = np.linspace(0.0, 1.0, c, dtype=np.float32)[:, None]
    # Equal power: sin/cos keep noise energy flat through the join, where a
    # linear pair would dip it.
    out = a[: len(a) - c].copy()
    out[:c] = head * np.sin(t * np.pi / 2) + tail * np.cos(t * np.pi / 2)
    after = float(np.abs(out[0] - out[-1]).max())

    # The seam is a SINGLE-SAMPLE difference, and on its own that number means
    # nothing: bright hiss jumps that far between ordinary neighbouring samples
    # all day. What matters is whether the join is bigger than the steps the
    # material already takes. River_Loop lands at 0.025 where the sea reaches
    # 0.005, and it is still seamless — its own 99th-percentile step is 0.043.
    step99 = float(np.percentile(np.abs(np.diff(out[:, 0])), 99))
    return out, (before, after, step99)


def trim_shot(a, sr):
    m = np.abs(a).max(axis=1)
    loud = np.flatnonzero(m > SHOT_FLOOR)
    if len(loud) == 0:
        return a
    lead = max(0, loud[0] - int(0.005 * sr))       # keep 5ms of the attack
    end = min(len(a), loud[-1] + int(0.060 * sr))  # keep 60ms of the tail
    out = a[lead:end].copy()
    f = int(SHOT_FADE * sr)
    if len(out) > f:
        out[-f:] *= np.linspace(1.0, 0.0, f, dtype=np.float32)[:, None]
    return out, lead / sr, (len(a) - end) / sr


def encode(exe, a, sr, ch, bitrate, path):
    if ch == 1 and a.shape[1] > 1:
        a = a.mean(axis=1, keepdims=True)
    pcm = np.clip(a, -1.0, 1.0)
    pcm = (pcm * 32767.0).astype("<i2").tobytes()
    cmd = [exe, "-y", "-hide_banner", "-loglevel", "error",
           "-f", "s16le", "-ar", str(sr), "-ac", str(ch), "-i", "pipe:0",
           "-codec:a", "libmp3lame", "-b:a", bitrate, str(path)]
    subprocess.run(cmd, input=pcm, check=True)


def main():
    roots = [Path(a) for a in sys.argv[1:]]
    if not roots:
        sys.exit(__doc__)
    exe = ffmpeg()
    OUT.mkdir(parents=True, exist_ok=True)

    found = {}
    for name, (frag, kind, fam, br) in PIECES.items():
        hits = [p for r in roots for p in r.rglob("*" + frag)]
        if not hits:
            log(f"  -- {name}: no *{frag} under " + ", ".join(map(str, roots)))
            continue
        found[name] = (sorted(hits)[0], kind, fam, br)

    if not found:
        sys.exit("None of the source files were found.")

    # Read everything first, then work out one gain per family from the
    # loudest member. Measured on the TRIMMED one-shot, not the raw file: a
    # trim can remove the loudest part of a clip.
    loaded, loudest = {}, {}
    for name, (path, kind, fam, br) in found.items():
        a, sr, ch = read_wav(path)
        extra = None
        if kind == "loop":
            a, extra = seam_loop(a, sr)
        else:
            a, lead, tail = trim_shot(a, sr)
            extra = (lead, tail)
        loaded[name] = (a, sr, ch, kind, fam, br, extra)
        loudest[fam] = max(loudest.get(fam, 0.0), float(np.abs(a).max()))

    gains = {f: (FAMILY_PEAK.get(f, 0.707) / pk if pk > 1e-6 else 1.0)
             for f, pk in loudest.items()}
    for f in sorted(gains):
        log(f"family {f:5s} x{gains[f]:.2f}  (loudest peak {loudest[f]:.3f})")

    meta = {}
    for name, (a, sr, ch, kind, fam, br, extra) in loaded.items():
        a = a * gains[fam]
        if kind == "loop":
            ok = "ok" if extra[1] <= extra[2] else "STILL AUDIBLE"
            log(f"  {name:12s} loop  {len(a)/sr:6.2f}s  "
                f"seam {extra[0]:.4f} -> {extra[1]:.4f} "
                f"(own p99 step {extra[2]:.4f}: {ok})  peak {np.abs(a).max():.3f}")
        else:
            log(f"  {name:10s} shot  {len(a)/sr:6.2f}s  peak {np.abs(a).max():.3f}  "
                f"trimmed {extra[0]*1000:.0f}ms lead, {extra[1]*1000:.0f}ms tail")
        out_ch, out_br = (1, "64k") if kind == "loop" else (ch, br)
        path = OUT / f"{name}.mp3"
        encode(exe, a, sr, out_ch, out_br, path)
        meta[name] = {"kind": kind, "family": fam, "sec": round(len(a) / sr, 3),
                      "kb": round(path.stat().st_size / 1024)}

    (OUT / "audio.json").write_text(
        json.dumps({"files": meta}, indent=1, sort_keys=True) + "\n")
    total = sum(m["kb"] for m in meta.values())
    log(f"\n{len(meta)} files -> assets/audio/  [{total} KB]")


if __name__ == "__main__":
    main()
