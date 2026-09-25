#!/usr/bin/env python3
"""
Converts the raw art in "infernal pact/" into web-ready assets.

    pip install pillow numpy scipy imageio-ffmpeg
    python scripts/prepare_assets.py

Outputs (all committed, so you only need to re-run this when the raw art changes):
    public/media/stable.mp4, public/media/pribliji.mp4   H.264 + AAC, faststart
    public/media/stable.webm, public/media/pribliji.webm VP9 + Opus fallback
    public/media/poster.jpg                              first frame of stable.mp4
    src/assets/paper.webp                                bumajka.png, RGBA
    src/assets/certificate.webp                          Sertificate.png with the backdrop cut away (RGBA)
    src/assets/seal-mask.png                             Pechat.png as a white-on-transparent mask
    src/assets/glyphs.svg                                symbols.svg (the 32 infernal letters)
    public/media/tail.webm, public/media/tail.m4a        the last noise of pribliji.mp4, stretched
                                                         into a seamless loop (old sound set)
    public/media/sfx/*.webm, *.m4a                       the new sound set, cut from "Sounds/":
                                                         loop beds (cave, fire, roar, drone) and
                                                         one-shots (thunder, moan, burst, spell ...)
    public/media/music.webm, music.m4a                   "Grinding Inferno", silent ends trimmed
"""
import os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "infernal pact")
PUB = os.path.join(ROOT, "public", "media")
ASSETS = os.path.join(ROOT, "src", "assets")
SOUNDS = os.path.join(ROOT, "Sounds")


def ffmpeg_bin():
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def encode_videos():
    ff = ffmpeg_bin()
    for name in ("stable", "pribliji"):
        src = os.path.join(RAW, "BG altar", f"{name}.mp4")
        dst = os.path.join(PUB, f"{name}.mp4")
        # Every frame stays (24 fps, same count): the ritual timeline is keyed to frame numbers.
        # Short GOP keeps seeking/looping snappy.
        subprocess.run([ff, "-y", "-v", "error", "-i", src,
                        "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-profile:v", "high", "-g", "24", "-keyint_min", "24", "-sc_threshold", "0",
                        "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", dst], check=True)
        print("video", dst, os.path.getsize(dst) // 1024, "KB")
        # VP9/Opus twin for browsers without H.264 (e.g. open-source Chromium builds).
        webm = os.path.join(PUB, f"{name}.webm")
        subprocess.run([ff, "-y", "-v", "error", "-i", src,
                        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34", "-row-mt", "1", "-deadline", "good",
                        "-cpu-used", "2", "-g", "24", "-pix_fmt", "yuv420p",
                        "-c:a", "libopus", "-b:a", "96k", webm], check=True)
        print("video", webm, os.path.getsize(webm) // 1024, "KB")
    subprocess.run([ff, "-y", "-v", "error", "-i", os.path.join(RAW, "BG altar", "stable.mp4"),
                    "-vf", "select=eq(n\\,0)", "-frames:v", "1", "-q:v", "3",
                    os.path.join(PUB, "poster.jpg")], check=True)


def paper():
    im = Image.open(os.path.join(RAW, "bumajka.png")).convert("RGBA")
    im.save(os.path.join(ASSETS, "paper.webp"), quality=90, method=6)


def certificate():
    from scipy import ndimage
    im = Image.open(os.path.join(RAW, "Sertificate.png")).convert("RGB")
    a = np.asarray(im).astype(np.float32)
    H, W, _ = a.shape
    lum = a.mean(axis=2)
    light = lum > 128

    # Per-row left/right and per-column top/bottom paper edges, median-filtered so that
    # dark frame ornaments touching the border don't punch holes into the sheet.
    def edges(mask, axis):
        n = mask.shape[1 - axis]
        lo = np.zeros(n); hi = np.zeros(n)
        for i in range(n):
            line = mask[i, :] if axis == 1 else mask[:, i]
            idx = np.nonzero(line)[0]
            if len(idx) < 8:  # no paper on this line
                lo[i], hi[i] = len(line), -1
            else:
                lo[i], hi[i] = idx[0], idx[-1]
        return ndimage.median_filter(lo, 41), ndimage.median_filter(hi, 41)

    L, R = edges(light, 1)
    T, B = edges(light, 0)
    yy, xx = np.mgrid[0:H, 0:W]
    mask = (xx >= L[:, None]) & (xx <= R[:, None]) & (yy >= T[None, :]) & (yy <= B[None, :])
    # Keep genuinely dark backdrop pixels along the rim transparent (torn / worn edges).
    rim = ~ndimage.binary_erosion(mask, iterations=10)
    backdrop = rim & (lum < 95) & (a[..., 0] - a[..., 2] < 60)
    mask &= ~backdrop
    mask = ndimage.binary_opening(mask, iterations=2)
    mask = ndimage.binary_fill_holes(mask)
    alpha = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    ys, xs = np.nonzero(mask)
    box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
    out = im.convert("RGBA")
    out.putalpha(alpha)
    out = out.crop(box)
    out = worn_top_edge(out)
    out.save(os.path.join(ASSETS, "certificate.webp"), quality=92, method=6)
    print("certificate crop box", box, "-> size", out.size)


def worn_top_edge(img):
    """
    The source picture's top edge is a perfectly straight cut, unlike the torn, worn left,
    right and bottom edges. Give it the same character: an irregular profile (fractal noise +
    a few nicks), a soft 2 px falloff and the slightly darker worn rim of the other sides.
    """
    a = np.asarray(img).astype(np.float32)
    H, W, _ = a.shape
    rng = np.random.default_rng(1666)

    def noise(scale):
        n = W // scale + 3
        pts = rng.normal(size=n)
        xs = np.linspace(0, n - 1, W)
        i = np.floor(xs).astype(int)
        f = xs - i
        f = f * f * (3 - 2 * f)
        return pts[i] * (1 - f) + pts[np.minimum(i + 1, n - 1)] * f

    prof = 5.0 + 2.6 * noise(110) + 1.5 * noise(28) + 0.6 * noise(7)
    for _ in range(9):  # small nicks and tears
        cx = rng.uniform(0, W)
        w = rng.uniform(5, 16)
        d = rng.uniform(2.5, 6.5)
        prof += d * np.exp(-(((np.arange(W) - cx) / w) ** 2))
    # blend smoothly into the side edges
    ramp = np.clip(np.minimum(np.arange(W), W - 1 - np.arange(W)) / 40.0, 0, 1)
    prof = np.clip(prof * ramp + 1.0 * (1 - ramp), 1.0, 20.0)

    y = np.arange(40, dtype=np.float32)[:, None]
    d = y - prof[None, :]
    alpha_top = np.clip(d / 2.2 + 0.5, 0, 1)
    band = a[:40]
    band[..., 3] = np.minimum(band[..., 3], alpha_top * 255)
    # worn rim: a little darker and warmer right at the new edge
    rim = 1 - 0.22 * np.exp(-np.clip(d, 0, None) / 4.5)
    band[..., 0] *= rim
    band[..., 1] *= rim * 0.98 + 0.02 * rim ** 2
    band[..., 2] *= rim * 0.95
    a[:40] = band
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGBA")


def seal():
    im = Image.open(os.path.join(RAW, "Pechat.png")).convert("L")
    a = np.asarray(im).astype(np.float32)
    ink = np.clip((200 - a) / 150, 0, 1)  # black lines -> 1
    ys, xs = np.nonzero(ink > 0.3)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    rad = max(xs.max() - xs.min(), ys.max() - ys.min()) / 2 + 6
    box = (int(cx - rad), int(cy - rad), int(cx + rad), int(cy + rad))
    m = Image.fromarray((ink * 255).astype(np.uint8)).crop(box).resize((512, 512), Image.LANCZOS)
    out = Image.new("RGBA", m.size, (255, 255, 255, 0))
    out.putalpha(m)
    out.save(os.path.join(ASSETS, "seal-mask.png"), optimize=True)
    print("seal mask box", box)


def tail_audio():
    """Last 1.7 s of pribliji's sound, 4x time-stretched + reverb, crossfaded into a seamless loop."""
    ff = ffmpeg_bin()
    src = os.path.join(RAW, "BG altar", "pribliji.mp4")
    raw = subprocess.run([ff, "-v", "error", "-ss", "9.55", "-t", "1.7", "-i", src, "-vn",
                          "-af", "atempo=0.5,atempo=0.5,lowpass=f=5200,aecho=0.8:0.85:60|140|260:0.45|0.3|0.2,volume=0.9",
                          "-ac", "2", "-ar", "48000", "-f", "f32le", "-"], check=True, capture_output=True).stdout
    sr = 48000
    y = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    mix = y * 0.8 + y[::-1] * 0.45
    x = int(1.2 * sr)
    n = len(mix) - x
    out = mix[:n].copy()
    t = np.linspace(0, 1, x)[:, None]
    out[:x] = mix[:x] * np.sqrt(t) + mix[n:n + x] * np.sqrt(1 - t)
    out *= (1 + 0.12 * np.sin(np.linspace(0, 4 * np.pi, n)))[:, None]
    out /= max(1e-6, np.abs(out).max()) * 1.15
    pcm = out.astype(np.float32).tobytes()
    for ext, codec in (("webm", ["-c:a", "libopus", "-b:a", "96k"]), ("m4a", ["-c:a", "aac", "-b:a", "128k"])):
        dst = os.path.join(PUB, f"tail.{ext}")
        subprocess.run([ff, "-y", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "2", "-i", "-", *codec, dst],
                       input=pcm, check=True)
        print("audio", dst, os.path.getsize(dst) // 1024, "KB")


SR = 48000


def load_sound(name, start=0.0, end=None):
    """A file from Sounds/ (matched by its freesound id) as float32 stereo at 48 kHz."""
    ff = ffmpeg_bin()
    src = next(os.path.join(SOUNDS, f) for f in sorted(os.listdir(SOUNDS)) if f.startswith(name))
    args = [ff, "-v", "error", "-ss", str(start)]
    if end is not None:
        args += ["-t", str(end - start)]
    args += ["-i", src, "-ac", "2", "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(args, check=True, capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def fades(x, fin=0.01, fout=0.05):
    a, b = int(fin * SR), int(fout * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)[:, None] ** 2
    if b:
        x[-b:] *= np.linspace(1, 0, b)[:, None] ** 2
    return x


def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)


def to_rms(x, db, peak=-1.0):
    """Loop beds: the same average loudness, peaks kept under `peak` dBFS."""
    x = x * 10 ** ((db - rms_db(x)) / 20)
    lim = 10 ** (peak / 20)
    over = np.abs(x).max()
    return x * (lim / over) if over > lim else x


def to_peak(x, db=-1.0):
    return x * (10 ** (db / 20) / max(1e-9, np.abs(x).max()))


def shelf(x, gain_db, freq):
    """Gentle high shelf (one-pole split) - makes the thunder cracks crisper."""
    from scipy.signal import lfilter
    a = np.exp(-2 * np.pi * freq / SR)
    low = lfilter([1 - a], [1, -a], x, axis=0)
    return low + (x - low) * 10 ** (gain_db / 20)


def resample(x, rate):
    """Plays x `rate` times faster (pitch up); linear interpolation is fine for noise beds."""
    n = int(len(x) / rate)
    t = np.arange(n) * rate
    i = np.minimum(t.astype(int), len(x) - 2)
    f = (t - i)[:, None]
    return x[i] * (1 - f) + x[i + 1] * f


def save_sound(name, x):
    ff = ffmpeg_bin()
    out = os.path.join(PUB, "sfx")
    os.makedirs(out, exist_ok=True)
    pcm = np.clip(x, -1, 1).astype(np.float32).tobytes()
    for ext, codec in (("webm", ["-c:a", "libopus", "-b:a", "112k"]), ("m4a", ["-c:a", "aac", "-b:a", "144k"])):
        dst = os.path.join(out, f"{name}.{ext}")
        subprocess.run([ff, "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", *codec, dst],
                       input=pcm, check=True)
    print("sfx", name, f"{len(x) / SR:.1f}s", os.path.getsize(os.path.join(out, name + ".webm")) // 1024, "KB")


def sounds():
    """The new sound set. Loop beds are plain segments: the page crossfades their ends itself
    (after decoding), so the loops have no seam whatever the codec padding is."""
    rng = np.random.default_rng(7)

    # cave: the short hollow wind, layered from shifted and slightly re-pitched copies into a
    # 24 s bed, so its repetition is not heard
    wind = load_sound("453850", 0.05, 4.75)
    bed = np.zeros((26 * SR, 2), np.float32)
    for k in range(16):
        piece = resample(wind, rng.uniform(0.88, 1.08))
        if k % 2:
            piece = piece[:, ::-1]
        piece = fades(piece.copy(), 1.2, 1.4)
        at = int((-2 + k * 1.75 + rng.uniform(-0.4, 0.4)) * SR)
        a0, a1 = max(0, at), min(len(bed), at + len(piece))
        if a1 > a0:
            bed[a0:a1] += piece[a0 - at:a1 - at] * rng.uniform(0.6, 1.0)
    save_sound("cave", to_rms(bed[2 * SR:24 * SR], -21))

    # fire crackling (without the loud flare at the end, which becomes its own accent)
    save_sound("fire", to_rms(load_sound("543657", 0.2, 22.2), -22))
    save_sound("flare", to_peak(fades(load_sound("543657", 22.3, 25.2), 0.02, 0.6), -2))
    # roaring fire: the steady part after the eruption
    save_sound("roar", to_rms(load_sound("828433", 2.6, 13.7), -21))
    # eruption: the burst and a bit of roar
    save_sound("burst", to_peak(fades(load_sound("828433", 0.7, 5.0), 0.005, 1.6), -1))

    # thunder, cut to start just before the crack and made crisper
    save_sound("thunder1", to_peak(shelf(fades(load_sound("744716", 0.95, 13.0), 0.02, 3.0), 5, 2500), -0.5))
    save_sound("thunder2", to_peak(shelf(fades(load_sound("744722", 4.9, 8.8), 0.3, 0.5), 5, 2500), -0.5))
    save_sound("thunder3", to_peak(shelf(fades(load_sound("744723", 3.05, 14.0), 0.02, 3.0), 6, 2500), -0.5))

    # cave moan, wind swell (the page also plays it reversed, as a rush into the impact)
    save_sound("moan", to_peak(fades(load_sound("581090", 0.3, 7.8), 0.6, 1.2), -3))
    save_sound("whoosh", to_peak(fades(load_sound("475876", 0.0, 5.2), 0.02, 0.8), -1))

    # magic: the even drone of the circle, a sparkle for pieces locking in, a flutter for motion
    save_sound("drone", to_rms(load_sound("758005", 1.0, 14.8), -22))
    save_sound("spell", to_peak(fades(load_sound("442774", 0.0, 1.6), 0.002, 0.3), -1))
    save_sound("flutter", to_peak(fades(load_sound("636087", 0.05, 4.3), 0.01, 0.8), -1))


def music():
    """'Grinding Inferno' without its silent head and tail (the page crossfades its end into
    its start while it loops, so the music never stops)."""
    ff = ffmpeg_bin()
    raw = subprocess.run([ff, "-v", "error", "-i", os.path.join(SOUNDS, "Grinding Inferno.mp3"), "-ac", "2", "-ar", str(SR),
                          "-f", "f32le", "-"], check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    loud = np.where(np.abs(x).max(1) > 10 ** (-50 / 20))[0]
    x = fades(x[max(0, loud[0] - 480):loud[-1] + 480].copy(), 0.01, 0.05)
    pcm = x.astype(np.float32).tobytes()
    for ext, codec in (("webm", ["-c:a", "libopus", "-b:a", "96k"]), ("m4a", ["-c:a", "aac", "-b:a", "128k"])):
        dst = os.path.join(PUB, f"music.{ext}")
        subprocess.run([ff, "-y", "-v", "error", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", *codec, dst],
                       input=pcm, check=True)
        print("music", dst, f"{len(x) / SR:.1f}s", os.path.getsize(dst) // 1024, "KB")


def glyphs():
    shutil.copy(os.path.join(RAW, "symbols.svg"), os.path.join(ASSETS, "glyphs.svg"))


if __name__ == "__main__":
    os.makedirs(PUB, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    only = sys.argv[1:]
    for step in (encode_videos, paper, certificate, seal, glyphs, tail_audio, sounds, music):
        if not only or step.__name__ in only:
            step()
