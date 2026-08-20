#!/usr/bin/env python3
"""Generate blank guide boards (transparent) for Canva import.
Each board: canvas size per template, with zone markers drawn OUTSIDE the
photo area so they don't cover the picture. Red dashed = photo zone (transparent
inside), yellow = bottom QR/date/watermark zone (keep clear), corner ticks.
Markers are thin lines at the very edges only."""
import zlib, struct, os

OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)

# canvas dims per template (logo ON, all footer toggles on) -- see FRAME_GUIDE.md
SPECS = {
    "guide-3vertikal": (576, 1800),
    "guide-1foto": (576, 976),
    "guide-2x2": (576, 978),
}

RED = (220, 38, 38, 255)
YEL = (202, 138, 4, 255)
BLK = (0, 0, 0, 255)

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

def hline(buf, W, y, x0, x1, rgba, t=4):
    for x in range(x0, x1):
        for dy in range(t):
            setpx(buf, W, x, y+dy, rgba)

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
    # photo zone: from below header (logo 266) to above footer (~308 from bottom)
    ph_top = 266
    ph_bot = H - 308
    rect(buf, W, 20, ph_top, W-20, ph_bot, RED, 3)        # photo zone outline
    # bottom QR/date/watermark zone: last 308px -> keep clear marker
    rect(buf, W, 20, ph_bot+4, W-20, H-20, YEL, 3)
    # corner ticks (where to put decorations)
    tick = 40
    for (cx, cy, sx, sy) in [(0,0,1,1),(W,0,-1,1),(0,H,1,-1),(W,H,-1,-1)]:
        # 2 thin Ls
        hline(buf, W, cy if sy>0 else cy, cx if sx>0 else cx, cx + sx*tick if sx>0 else cx - tick + (W if sx<0 else 0), BLK, 4) if False else None
    # simpler corner ticks
    for (cx, cy, sx, sy) in [(8,8,1,1),(W-8,8,-1,1),(8,H-8,1,-1),(W-8,H-8,-1,-1)]:
        for i in range(8, 8+tick):
            setpx(buf, W, cx + sx*i, cy, BLK)
            setpx(buf, W, cx, cy + sy*i, BLK)
    # side decoration rails (suggested frame edges)
    vline(buf, W, 6, 0, H, BLK, 4)
    vline(buf, W, W-10, 0, H, BLK, 4)
    png(f"{OUT}/{name}.png", W, H, buf)
    print("wrote", name, f"{W}x{H}")
