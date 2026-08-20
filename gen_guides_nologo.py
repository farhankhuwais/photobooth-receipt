#!/usr/bin/env python3
"""Generate blank guide boards (transparent) for Canva import - NO LOGO variant.
Header = 64px (logo off). Bottom QR/date/watermark zone = last 308px (all on).
See FRAME_GUIDE.md for dims:
  3 Vertikal: 576 x 1598
  1 Foto:     576 x 774
  2x2:       576 x 776
Markers drawn at edges only, never covering the photo."""
import zlib, struct, os

OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)

SPECS = {
    "guide-nologo-3vertikal": (576, 1598),
    "guide-nologo-1foto": (576, 774),
    "guide-nologo-2x2": (576, 776),
}

RED = (220, 38, 38, 255)
YEL = (202, 138, 4, 255)
BLK = (0, 0, 0, 255)
HEADER = 64          # no logo
FOOTER = 308         # all toggles on (QR 180 + scan 28 + date 34 + watermark 44 + paddings)

def new(W, H):
    return bytearray(W * H * 4)

def setpx(buf, W, x, y, rgba):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 4
        buf[i:i+4] = bytes(rgba)

def rect(buf, W, x0, y0, x1, y1, rgba, t=3):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if x-x0 < t or x1-x <= t or y-y0 < t or y1-y <= t:
                setpx(buf, W, x, y, rgba)

def vline(buf, W, x, y0, y1, rgba, t=4):
    for y in range(y0, y1):
        for dx in range(t):
            setpx(buf, W, x+dx, y, rgba)

def png(path, W, H, buf):
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw += buf[y*W*4:(y+1)*W*4]
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return c
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

for name, (W, H) in SPECS.items():
    buf = new(W, H)
    ph_top = HEADER
    ph_bot = H - FOOTER
    rect(buf, W, 20, ph_top, W-20, ph_bot, RED, 3)         # photo zone outline
    rect(buf, W, 20, ph_bot+4, W-20, H-20, YEL, 3)         # bottom keep-clear zone
    for (cx, cy, sx, sy) in [(8,8,1,1),(W-8,8,-1,1),(8,H-8,1,-1),(W-8,H-8,-1,-1)]:
        for i in range(8, 48):
            setpx(buf, W, cx + sx*i, cy, BLK)
            setpx(buf, W, cx, cy + sy*i, BLK)
    vline(buf, W, 6, 0, H, BLK, 4)
    vline(buf, W, W-10, 0, H, BLK, 4)
    png(f"{OUT}/{name}.png", W, H, buf)
    print("wrote", name, f"{W}x{H}")
