#!/usr/bin/env python3
"""Labeled guide boards (transparent PNG) for Canva import.
Shows exactly where photos go + gap between them, plus LOGO (top) and
QR/DATE/WATERMARK (bottom) zones. Supports 3-vertikal / 1-foto / 2x2,
with logo-ON and no-logo variants. Tiny bitmap font (no PIL)."""
import zlib, struct, os

OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)

W = 576
RED = (220, 38, 38, 255)
YEL = (202, 138, 4, 255)
BLK = (0, 0, 0, 255)
GRY = (120, 120, 120, 255)
HEADER_LOGO = 266
HEADER_NL = 64
FOOTER = 308   # all toggles on

FONT = {
 'F':[0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
 'O':[0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
 'T':[0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
 '1':[0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
 '2':[0b11110,0b00001,0b00001,0b01110,0b10000,0b10000,0b11111],
 '3':[0b11110,0b00001,0b00001,0b01110,0b00001,0b00001,0b11110],
 'L':[0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
 'G':[0b01110,0b10000,0b10000,0b10110,0b10001,0b10001,0b01111],
 'Q':[0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
 'R':[0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
 'D':[0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
 'A':[0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
 'E':[0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
 'W':[0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
 'M':[0b10001,0b11011,0b11111,0b10101,0b10001,0b10001,0b10001],
 'K':[0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
 '+':[0b00000,0b00100,0b00100,0b11111,0b00100,0b00100,0b00000],
 ' ': [0]*7,
}

def new():
    return bytearray(W * H * 4)

def setpx(buf, x, y, rgba):
    if 0 <= x < W and 0 <= y < len(buf)//(W*4):
        i = (y * W + x) * 4
        buf[i:i+4] = bytes(rgba)

def get(buf, x, y):
    if 0 <= x < W and 0 <= y < len(buf)//(W*4):
        i = (y * W + x) * 4
        return buf[i:i+4]
    return (0,0,0,0)

def blend(buf, x, y, rgba):
    s = get(buf, x, y)
    sa = rgba[3]/255.0
    out = tuple(int(sa*c + (1-sa)*b) for c,b in zip(rgba[:3], s[:3]))
    setpx(buf, x, y, (out[0],out[1],out[2], max(rgba[3], s[3])))

def text(buf, x, y, s, rgba, scale=2):
    cx = x
    for ch in s.upper():
        g = FONT.get(ch, FONT[' '])
        for r in range(7):
            for c in range(5):
                if (g[r] >> (4-c)) & 1:
                    for dy in range(scale):
                        for dx in range(scale):
                            blend(buf, cx + c*scale + dx, y + r*scale + dy, rgba)
        cx += 6*scale + 4

def rect(buf, x0, y0, x1, y1, rgba, t=3):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if x-x0 < t or x1-x <= t or y-y0 < t or y1-y <= t:
                setpx(buf, x, y, rgba)

def vline(buf, x, y0, y1, rgba, t=4):
    for y in range(y0, y1):
        for dx in range(t):
            setpx(buf, x+dx, y, rgba)

def hline(buf, x0, x1, y, rgba, t=3, dash=0):
    n = 0
    for x in range(x0, x1):
        if dash and (n // dash) % 2 == 1:
            n += 1; continue
        for dy in range(t):
            setpx(buf, x, y+dy, rgba)
        n += 1

def png(path, buf):
    H = len(buf)//(W*4)
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

def build(header, kind, name):
    global H
    innerW = W - 40
    gap = 200
    topPad = 200
    bottomPad = 200
    if kind == 'strip3':
        cols = 1
    elif kind == 'single':
        cols = 1
    else:  # grid2x2
        cols = 2
    shotW = (innerW - (cols-1)*gap) / cols
    shotH = round(shotW * 0.75)
    rows = 1 if kind == 'single' else (3 if kind == 'strip3' else 2)
    contentH = rows*shotH + (rows-1)*gap
    H = header + topPad + contentH + bottomPad + FOOTER

    buf = new()
    ph_top = header + topPad
    # draw slots
    if kind == 'single':
        rect(buf, 20, ph_top, W-20, ph_top+shotH, RED, 3)
        text(buf, 26, ph_top + shotH//2 - 14, "FOTO 1", RED, scale=3)
    elif kind == 'strip3':
        for i in range(3):
            st = ph_top + i*(shotH+gap)
            rect(buf, 20, st, W-20, st+shotH, RED, 3)
            text(buf, 26, st + shotH//2 - 14, f"FOTO {i+1}", RED, scale=3)
        for i in range(2):
            dyp = ph_top + (i+1)*shotH + i*gap + gap//2
            hline(buf, 20, W-20, dyp, GRY, t=3, dash=10)
    else:  # grid2x2
        for r in range(2):
            for c in range(2):
                x0 = 20 + c*(shotW+gap)
                y0 = ph_top + r*(shotH+gap)
                rect(buf, int(round(x0)), int(round(y0)),
                     int(round(x0+shotW)), int(round(y0+shotH)), RED, 3)
                text(buf, int(round(x0))+6, int(round(y0))+shotH//2-14,
                     f"FOTO {r*2+c+1}", RED, scale=3)
        # vertical + horizontal dividers
        hline(buf, 20, W-20, ph_top + shotH + gap//2, GRY, t=3, dash=10)
        xmid = 20 + shotW + gap//2
        vline(buf, int(round(xmid)), ph_top, ph_top + 2*shotH + gap, GRY, t=3)

    # top label
    text(buf, 26, 10, "LOGO / NAMA EVENT", BLK, scale=2)
    # bottom zone
    bz = H - FOOTER
    rect(buf, 20, bz+4, W-20, H-20, YEL, 3)
    text(buf, 26, bz + 14, "QR + TANGGAL + WATERMARK", YEL, scale=2)
    # corner ticks + side rails
    for (cx, cy, sx, sy) in [(8,8,1,1),(W-8,8,-1,1),(8,H-8,1,-1),(W-8,H-8,-1,-1)]:
        for i in range(8, 48):
            setpx(buf, cx + sx*i, cy, BLK)
            setpx(buf, cx, cy + sy*i, BLK)
    vline(buf, 6, 0, H, BLK, 4)
    vline(buf, W-10, 0, H, BLK, 4)
    png(f"{OUT}/{name}.png", buf)
    print("wrote", name, f"{W}x{H}")

H = 0
# logo ON
build(HEADER_LOGO, 'strip3', 'guide-3vertikal')
build(HEADER_LOGO, 'single', 'guide-1foto')
build(HEADER_LOGO, 'grid2x2', 'guide-2x2')
# no logo
build(HEADER_NL, 'strip3', 'guide-nologo-3vertikal')
build(HEADER_NL, 'single', 'guide-nologo-1foto')
build(HEADER_NL, 'grid2x2', 'guide-nologo-2x2')
