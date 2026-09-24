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
"""
import os, shutil, subprocess, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "infernal pact")
PUB = os.path.join(ROOT, "public", "media")
ASSETS = os.path.join(ROOT, "src", "assets")


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
    out.save(os.path.join(ASSETS, "certificate.webp"), quality=92, method=6)
    print("certificate crop box", box, "-> size", out.size)


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


def glyphs():
    shutil.copy(os.path.join(RAW, "symbols.svg"), os.path.join(ASSETS, "glyphs.svg"))


if __name__ == "__main__":
    os.makedirs(PUB, exist_ok=True)
    os.makedirs(ASSETS, exist_ok=True)
    only = sys.argv[1:]
    for step in (encode_videos, paper, certificate, seal, glyphs):
        if not only or step.__name__ in only:
            step()
