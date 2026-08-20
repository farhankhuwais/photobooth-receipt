#!/usr/bin/env python3
"""Generate 3 transparent PNG sample frames (left+right side bars only,
bottom & top clear so logo/QR/date/watermark are never covered)."""
import zlib, struct, os

OUT = os.path.expanduser("~/photobooth/samples")
os.makedirs(OUT, exist_ok=True)

def png(path, W, H, accent):
    # accent = (r,g,b) for the inner color band
    black = (0, 0, 0, 255)
    ac = (accent[0], accent[1], accent[2], 255)
    bw, aw = 10, 16  # black width, accent width
    clear = (0, 0, 0, 0)
    raw = bytearray()
    for y in range(H):
        raw.append(0)  # filter type 0
        for x in range(W):
            in_left = x < (bw + aw)
            in_right = x >= W - (bw + aw)
            if in_left:
                c = black if x < bw else ac
            elif in_right:
                c = black if x >= W - bw else ac
            else:
                c = clear
            raw += bytes(c)
    def chunk(typ, data):
        c = struct.pack(">I", len(data)) + typ + data
        c += struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff)
        return c
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

# Template sizes (canvas dims the engine uses, ~576 wide)
png(f"{OUT}/frame-3vertikal.png", 576, 1410, (255, 62, 108))   # pink
png(f"{OUT}/frame-1foto.png",     576, 590,  (59, 130, 246))    # blue
png(f"{OUT}/frame-2x2.png",       576, 590,  (22, 163, 74))     # green

print("done", os.listdir(OUT))
