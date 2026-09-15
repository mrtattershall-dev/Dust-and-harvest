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
              volume they would be inaudible. Lifted by ONE COMMON GAIN across
              the family rather than normalised one by one: a storm is meant to
              be louder than a calm sea, and per-file normalisation would throw
              that away.

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
LOOP_PEAK = 0.707    # -3dBFS, the family's loudest peak after the common gain
SHOT_PEAK = 0.794    # -2dBFS, per one-shot
SHOT_FLOOR = 0.01    # below this is silence, for trimming
SHOT_FADE = 0.020    # seconds faded out at the end of a one-shot

# name -> (filename fragment, kind, bitrate)
PIECES = {
    "sea":       ("Sea.wav",       "loop", "112k"),
    "sea_rain":  ("Sea_Rain.wav",  "loop", "112k"),
    "sea_storm": ("Sea_Storm.wav", "loop", "112k"),
    "chop1":     ("chop_1.wav",    "shot", "128k"),
    "chop2":     ("chop_2.wav",    "shot", "128k"),
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
    for name, (frag, kind, br) in PIECES.items():
        hits = [p for r in roots for p in r.rglob("*" + frag)]
        if not hits:
            log(f"  -- {name}: no *{frag} under " + ", ".join(map(str, roots)))
            continue
        found[name] = (sorted(hits)[0], kind, br)

    if not found:
        sys.exit("None of the source files were found.")

    # One common gain over the looping family, so a storm stays louder than a
    # calm sea. Measured before anything is written.
    loaded, loudest = {}, 0.0
    for name, (path, kind, br) in found.items():
        a, sr, ch = read_wav(path)
        loaded[name] = (a, sr, ch, kind, br)
        if kind == "loop":
            loudest = max(loudest, float(np.abs(a).max()))
    gain = (LOOP_PEAK / loudest) if loudest > 1e-6 else 1.0
    log(f"loops: common gain x{gain:.2f} (loudest peak {loudest:.3f})")

    meta = {}
    for name, (a, sr, ch, kind, br) in loaded.items():
        if kind == "loop":
            a, seam = seam_loop(a, sr)
            a = a * gain
            log(f"  {name:10s} loop  {len(a)/sr:6.2f}s  "
                f"seam {seam[0]:.4f} -> {seam[1]:.4f}  peak {np.abs(a).max():.3f}")
        else:
            a, lead, tail = trim_shot(a, sr)
            pk = float(np.abs(a).max())
            a = a * (SHOT_PEAK / pk if pk > 1e-6 else 1.0)
            log(f"  {name:10s} shot  {len(a)/sr:6.2f}s  "
                f"trimmed {lead*1000:.0f}ms lead, {tail*1000:.0f}ms tail")
        path = OUT / f"{name}.mp3"
        encode(exe, a, sr, ch, br, path)
        meta[name] = {"kind": kind, "sec": round(len(a) / sr, 3),
                      "kb": round(path.stat().st_size / 1024)}

    (OUT / "audio.json").write_text(
        json.dumps({"files": meta}, indent=1, sort_keys=True) + "\n")
    total = sum(m["kb"] for m in meta.values())
    log(f"\n{len(meta)} files -> assets/audio/  [{total} KB]")


if __name__ == "__main__":
    main()
