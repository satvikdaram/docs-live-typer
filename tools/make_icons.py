#!/usr/bin/env python3
"""Draws icons/icon16.png, icon48.png and icon128.png using only the Python standard library.

Design: an indigo-to-blue squircle with a soft top highlight. On it, lines of "typed" text and a
bright text cursor at the end of the last line. The 16 px icon uses a simpler, chunkier version.

Run from the extension folder:  python3 tools/make_icons.py
"""
import math
import os
import struct
import zlib

SAMPLES = 4  # supersampling per axis, for smooth edges

GRAD_TOP_LEFT = (0x7C, 0x6C, 0xFF)      # indigo
GRAD_BOTTOM_RIGHT = (0x2F, 0x6B, 0xF2)  # blue
LINE = (255, 255, 255, 0.55)            # already-typed text
LINE_ACTIVE = (255, 255, 255, 0.95)     # the line being typed
CARET = (0xB8, 0xF0, 0xFF, 1.0)         # text cursor

# Foreground shapes in unit coordinates: (x0, y0, x1, y1, radius, color)
DETAILED = [
    (0.23, 0.29, 0.77, 0.37, 0.04, LINE),
    (0.23, 0.45, 0.66, 0.53, 0.04, LINE),
    (0.23, 0.61, 0.50, 0.69, 0.04, LINE_ACTIVE),
    (0.565, 0.565, 0.625, 0.735, 0.03, CARET),
]
SIMPLE = [  # for 16 px: fewer, thicker shapes
    (0.22, 0.30, 0.78, 0.44, 0.06, LINE),
    (0.22, 0.56, 0.52, 0.70, 0.06, LINE_ACTIVE),
    (0.60, 0.50, 0.72, 0.78, 0.05, CARET),
]


def in_squircle(px, py, n=5.0, inset=0.0):
    """Superellipse |x|^n + |y|^n <= 1, a softer shape than a rounded square."""
    x = abs((px - 0.5) / (0.5 - inset))
    y = abs((py - 0.5) / (0.5 - inset))
    return x ** n + y ** n <= 1.0


def in_rrect(px, py, shape):
    x0, y0, x1, y1, r = shape[:5]
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def background(px, py):
    t = min(1.0, max(0.0, (px + py) / 2.0))
    r, g, b = mix(GRAD_TOP_LEFT, GRAD_BOTTOM_RIGHT, t)
    # soft highlight across the top third, fading out
    hl = max(0.0, 0.42 - py) / 0.42 * 0.16
    return mix((r, g, b), (255, 255, 255), hl)


def render(size):
    shapes = SIMPLE if size <= 16 else DETAILED
    n = SAMPLES * SAMPLES
    rows = []
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0
        for x in range(size):
            acc = [0.0, 0.0, 0.0]
            alpha = 0.0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    px = (x + (sx + 0.5) / SAMPLES) / size
                    py = (y + (sy + 0.5) / SAMPLES) / size
                    if not in_squircle(px, py):
                        continue
                    c = background(px, py)
                    for s in shapes:
                        if in_rrect(px, py, s):
                            fr, fg, fb, fa = s[5]
                            c = mix(c, (fr, fg, fb), fa)
                    acc = [acc[i] + c[i] for i in range(3)]
                    alpha += 1
            if alpha:
                r, g, b = (round(v / alpha) for v in acc)
            else:
                r = g = b = 0
            row += bytes((r, g, b, round(alpha / n * 255)))
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "icons")
    os.makedirs(out_dir, exist_ok=True)
    for size in (16, 48, 128):
        path = os.path.join(out_dir, f"icon{size}.png")
        write_png(path, size, render(size))
        print("wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
