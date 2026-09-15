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
    return out, (before, after)


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
            log(f"  {name:10s} loop  {len(a)/sr:6.2f}s  "
                f"seam {extra[0]:.4f} -> {extra[1]:.4f}  peak {np.abs(a).max():.3f}")
        else:
            log(f"  {name:10s} shot  {len(a)/sr:6.2f}s  peak {np.abs(a).max():.3f}  "
                f"trimmed {extra[0]*1000:.0f}ms lead, {extra[1]*1000:.0f}ms tail")
        path = OUT / f"{name}.mp3"
        encode(exe, a, sr, ch, br, path)
        meta[name] = {"kind": kind, "family": fam, "sec": round(len(a) / sr, 3),
                      "kb": round(path.stat().st_size / 1024)}

    (OUT / "audio.json").write_text(
        json.dumps({"files": meta}, indent=1, sort_keys=True) + "\n")
    total = sum(m["kb"] for m in meta.values())
    log(f"\n{len(meta)} files -> assets/audio/  [{total} KB]")


if __name__ == "__main__":
    main()
