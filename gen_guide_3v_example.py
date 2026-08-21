#!/usr/bin/env python3
"""Example guide board for 3-Vertikal at the user's specific spacing:
topPad=200, bottomPad=200, gap=25. Drawn with dashed lines marking the
FREE SPACE (decoration zones): top band, bottom band, and between photos.
Transparent PNG, ready to import into Canva as a layer.
Also a no-logo variant."""
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
FOOTER = 308

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

def setpx(x, y, rgba):
    if 0 <= x < W and 0 <= y < len(buf)//(W*4):
        i = (y * W + x) * 4
        buf[i:i+4] = bytes(rgba)

def get(x, y):
    if 0 <= x < W and 0 <= y < len(buf)//(W*4):
        i = (y * W + x) * 4
        return buf[i:i+4]
    return (0,0,0,0)

def blend(x, y, rgba):
    s = get(x, y)
    sa = rgba[3]/255.0
    out = tuple(int(sa*c + (1-sa)*b) for c,b in zip(rgba[:3], s[:3]))
    setpx(x, y, (out[0],out[1],out[2], max(rgba[3], s[3])))

def text(x, y, s, rgba, scale=2):
    cx = x
    for ch in s.upper():
        g = FONT.get(ch, FONT[' '])
        for r in range(7):
            for c in range(5):
                if (g[r] >> (4-c)) & 1:
                    for dy in range(scale):
                        for dx in range(scale):
                            blend(cx + c*scale + dx, y + r*scale + dy, rgba)
        cx += 6*scale + 4

def rect(x0, y0, x1, y1, rgba, t=3):
    for y in range(y0, y1):
        for x in range(x0, x1):
            if x-x0 < t or x1-x <= t or y-y0 < t or y1-y <= t:
                setpx(x, y, rgba)

def vline(x, y0, y1, rgba, t=4):
    for y in range(y0, y1):
        for dx in range(t):
            setpx(x+dx, y, rgba)

def hline(x0, x1, y, rgba, t=3, dash=10):
    n = 0
    for x in range(x0, x1):
        if dash and (n // dash) % 2 == 1:
            n += 1; continue
        for dy in range(t):
            setpx(x, y+dy, rgba)
        n += 1

def png(path):
    Hh = len(buf)//(W*4)
    raw = bytearray()
    for y in range(Hh):
        raw.append(0)
        raw += buf[y*W*4:(y+1)*W*4]
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return c
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, Hh, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    open(path, "wb").write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

def build(header, name):
    global buf, H
    innerW = W - 40
    gap = 25
    topPad = 200
    bottomPad = 200
    shotW = innerW
    shotH = round(shotW * 0.75)
    rows = 3
    contentH = rows*shotH + (rows-1)*gap
    H = header + topPad + contentH + bottomPad + FOOTER
    buf = new()
    ph_top = header + topPad

    # Dashed free-space bands: TOP (header->first photo), BOTTOM (last photo->footer),
    # and BETWEEN photos. Drawn first (under solid frames).
    hline(20, W-20, header + topPad//2, GRY, t=3, dash=10)          # top band center
    hline(20, W-20, H - FOOTER - bottomPad//2, GRY, t=3, dash=10)   # bottom band center
    for i in range(2):
        dyp = ph_top + (i+1)*shotH + i*gap + gap//2
        hline(20, W-20, dyp, GRY, t=3, dash=10)                      # between photos

    # Photo slots (solid red + label)
    for i in range(3):
        st = ph_top + i*(shotH+gap)
        rect(20, st, W-20, st+shotH, RED, 3)
        text(26, st + shotH//2 - 14, f"FOTO {i+1}", RED, scale=3)

    # Top label
    text(26, 10, "LOGO / NAMA EVENT", BLK, scale=2)
    # Bottom zone
    bz = H - FOOTER
    rect(20, bz+4, W-20, H-20, YEL, 3)
    text(26, bz + 14, "QR + TANGGAL + WATERMARK", YEL, scale=2)
    # corner ticks + side rails
    for (cx, cy, sx, sy) in [(8,8,1,1),(W-8,8,-1,1),(8,H-8,1,-1),(W-8,H-8,-1,-1)]:
        for i in range(8, 48):
            setpx(cx + sx*i, cy, BLK)
            setpx(cx, cy + sy*i, BLK)
    vline(6, 0, H, BLK, 4)
    vline(W-10, 0, H, BLK, 4)
    png(f"{OUT}/{name}.png")
    print("wrote", name, f"{W}x{H}")

H = 0
build(HEADER_LOGO, "guide-3vertikal-example")
build(HEADER_NL, "guide-nologo-3vertikal-example")
