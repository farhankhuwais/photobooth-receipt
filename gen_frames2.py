#!/usr/bin/env python3
"""Generate 4 more custom frame samples (side bars + corner accents only,
top & bottom central kept clear so logo/QR/date/watermark stay visible).
All rendered at 576x1410 (matches 3-vertikal canvas; scales to other templates)."""
import zlib, struct, os

OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)

W, H = 576, 1410

def new_buf():
    # RGBA, all transparent
    return bytearray(W * H * 4)

def set_px(buf, x, y, rgba):
    if 0 <= x < W and 0 <= y < H:
        i = (y * W + x) * 4
        buf[i:i+4] = bytes(rgba)

def fill_rect(buf, x0, y0, x1, y1, rgba):
    for y in range(int(y0), int(y1)):
        for x in range(int(x0), int(x1)):
            set_px(buf, x, y, rgba)

def vline(buf, x, y0, y1, w, rgba):
    fill_rect(buf, x, y0, x + w, y1, rgba)

def hline(buf, y, x0, x1, h, rgba):
    fill_rect(buf, x0, y, x1, y + h, rgba)

def png(path, buf):
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

BLACK = (0,0,0,255)

# ── 1. Corner bracket (L-shaped arms + accent) ──
def frame_corner():
    buf = new_buf()
    a = (255,62,108,255)  # pink
    bw, aw, arm = 14, 6, 64
    for (cx, cy, sx, sy) in [(0,0,1,1),(W,0,-1,1),(0,H,1,-1),(W,H,-1,-1)]:
        ox = cx + (0 if sx>0 else -(bw+aw))
        oy = cy + (0 if sy>0 else -(bw+aw))
        # black L
        hline(buf, oy, cx if sx>0 else ox, cx if sx<0 else ox+bw, bw, BLACK)
        vline(buf, ox if sx>0 else ox+bw-bw, oy if sy>0 else oy+bw-bw, oy+arm if sy>0 else oy+bw-arm+bw, bw, BLACK)
        # simpler: draw via explicit corners
    # redo cleanly
    buf = new_buf()
    def corner(cx, cy, sx, sy):
        # outer black L
        fill_rect(buf, cx, cy, cx + sx*arm, cy + sy*bw, BLACK)        # top arm
        fill_rect(buf, cx, cy, cx + sx*bw, cy + sy*arm, BLACK)        # side arm
        # inner accent L offset by bw
        ix, iy = cx + sx*bw, cy + sy*bw
        fill_rect(buf, ix, iy, ix + sx*(arm-bw), iy + sy*aw, a)
        fill_rect(buf, ix, iy, ix + sx*aw, iy + sy*(arm-bw), a)
    corner(0,0,1,1)
    corner(W,0,-1,1)
    corner(0,H,1,-1)
    corner(W,H,-1,-1)
    return buf

# ── 2. Dot column (dots down left & right) ──
def frame_dot():
    buf = new_buf()
    a = (59,130,246,255)  # blue
    r = 7
    step = 46
    for y in range(40, H-40, step):
        for cx in (28, W-28):
            for dy in range(-r, r+1):
                for dx in range(-r, r+1):
                    if dx*dx + dy*dy <= r*r:
                        set_px(buf, cx+dx, y+dy, BLACK)
                        set_px(buf, cx+dx, y+dy-3, a)
    # thicker side rails
    vline(buf, 10, 0, H, 6, BLACK)
    vline(buf, W-16, 0, H, 6, BLACK)
    return buf

# ── 3. Double side border (black + accent) ──
def frame_double():
    buf = new_buf()
    a = (22,163,74,255)  # green
    bw, gap, aw = 12, 5, 8
    vline(buf, 0, 0, H, bw, BLACK)
    vline(buf, bw+gap, 0, H, aw, a)
    vline(buf, W-bw, 0, H, bw, BLACK)
    vline(buf, W-bw-gap-aw, 0, H, aw, a)
    return buf

# ── 4. Triangle corner ──
def frame_triangle():
    buf = new_buf()
    a = (124,58,237,255)  # purple
    S = 80
    def tri(cx, cy, sx, sy):
        for y in range(S):
            for x in range(S):
                if (sx>0 and x<=y) or (sx<0 and (S-x)<=y):
                    if x+y < S:
                        set_px(buf, cx + sx*x, cy + sy*y, BLACK)
                        set_px(buf, cx + sx*x, cy + sy*y + (-sy)*4, a)
    tri(0,0,1,1); tri(W,0,-1,1); tri(0,H,1,-1); tri(W,H,-1,-1)
    return buf

jobs = [
    ("frame-corner", frame_corner),
    ("frame-dot", frame_dot),
    ("frame-double", frame_double),
    ("frame-triangle", frame_triangle),
]
for name, fn in jobs:
    png(f"{OUT}/{name}.png", fn())
    print("wrote", name)
