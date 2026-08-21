#!/usr/bin/env python3
"""Generate a DISTINCT 2x2 decoration frame (PNG transparent, edges only) so the
2x2 template looks different from strip3. Side rails + corner brackets + a
center cross motif (only at grid intersection, transparent elsewhere)."""
import zlib, struct, os
W, H = 576, 1030
OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)
RED = (220, 38, 38, 255)
YEL = (202, 138, 4, 255)
buf = bytearray(W * H * 4)

def setpx(x, y, rgba):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 4
        buf[i:i+4] = bytes(rgba)

def rect(x0, y0, x1, y1, rgba, t=3):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if x - x0 < t or x1 - x <= t or y - y0 < t or y1 - y <= t:
                setpx(x, y, rgba)

def hline(x0, x1, y, rgba, t=3):
    for x in range(x0, x1):
        for dy in range(t):
            setpx(x, y + dy, rgba)

def vline(x, y0, y1, rgba, t=3):
    for y in range(y0, y1):
        for dx in range(t):
            setpx(x + dx, y, rgba)

def bracket(x, y, dx, dy, rgba, L=26, t=5):
    # corner bracket pointing inward, dx/dy = direction of inner
    for i in range(L):
        for w in range(t):
            setpx(x + dx * i + (w if dx < 0 else 0), y + (w if dy < 0 else 0) + (i if dy > 0 else 0) * 0, rgba)
    # simpler: draw L using short h+v
    hx = (x - L) if dx < 0 else x
    vy = (y - L) if dy < 0 else y
    for i in range(L):
        for w in range(t):
            setpx(hx + i, y + (w if dy < 0 else 0), rgba)        # horizontal arm
            setpx(x + (w if dx < 0 else 0), vy + i, rgba)        # vertical arm

# Outer side rails (red)
rect(0, 0, W, H, RED, 6)
# Corner brackets (red, inward)
bracket(8, 8, 1, 1, RED)
bracket(W - 8, 8, -1, 1, RED)
bracket(8, H - 8, 1, -1, RED)
bracket(W - 8, H - 8, -1, -1, RED)
# Accent inner yellow frame
rect(16, 16, W - 16, H - 16, YEL, 3)

# Center cross at grid intersection (2x2): x = W/2, y = header+topPad+shotH+gap/2
# Approx center for all-on logo: but draw at canvas mid for decoration hint.
midx = W // 2
midy = H // 2
vline(midx - 2, 16, H - 16, YEL, 4)
hline(16, W - 16, midy - 2, YEL, 4)
# small diamond at center
for r in range(18):
    for w in range(3):
        if abs(abs(r) - 0) < 1:
            pass
for a in range(-16, 17):
    for b in range(-16, 17):
        if abs(abs(a) + abs(b) - 16) < 3:
            for w in range(3):
                setpx(midx + a + w, midy + b, YEL)

def png(path):
    raw = bytearray()
    for y in range(H):
        raw.append(0)
        raw += buf[y * W * 4:(y + 1) * W * 4]
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return c
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    open(path, "wb").write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

png(f"{OUT}/frame-2x2-grid.png")
print("wrote frame-2x2-grid.png", f"{W}x{H}")
