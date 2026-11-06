#!/usr/bin/env python3
"""Draws icons/icon16.png, icon48.png and icon128.png using only the Python standard library.

Design: a blue rounded square with three white "text lines" and a text cursor.
Run from the extension folder:  python3 tools/make_icons.py
"""
import os
import struct
import zlib

ACCENT = (0x3B, 0x6F, 0xF5)
WHITE = (255, 255, 255)
SAMPLES = 4  # supersampling per axis, for smooth edges

# Shapes in unit coordinates (0..1): (x0, y0, x1, y1, corner radius)
BACKGROUND = (0.0, 0.0, 1.0, 1.0, 0.22)
WHITE_SHAPES = [
    (0.22, 0.27, 0.78, 0.36, 0.045),  # line 1
    (0.22, 0.455, 0.68, 0.545, 0.045),  # line 2
    (0.22, 0.64, 0.46, 0.73, 0.045),  # line 3 (short)
    (0.545, 0.585, 0.615, 0.785, 0.03),  # cursor
]


def in_rrect(px, py, shape):
    x0, y0, x1, y1, r = shape
    if px < x0 or px > x1 or py < y0 or py > y1:
        return False
    cx = min(max(px, x0 + r), x1 - r)
    cy = min(max(py, y0 + r), y1 - r)
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def render(size):
    rows = []
    n = SAMPLES * SAMPLES
    for y in range(size):
        row = bytearray([0])  # PNG filter type 0
        for x in range(size):
            bg = fg = 0
            for sy in range(SAMPLES):
                for sx in range(SAMPLES):
                    px = (x + (sx + 0.5) / SAMPLES) / size
                    py = (y + (sy + 0.5) / SAMPLES) / size
                    if in_rrect(px, py, BACKGROUND):
                        bg += 1
                        if any(in_rrect(px, py, s) for s in WHITE_SHAPES):
                            fg += 1
            alpha = bg / n
            mix = fg / bg if bg else 0
            r, g, b = (round(ACCENT[i] * (1 - mix) + WHITE[i] * mix) for i in range(3))
            row += bytes((r, g, b, round(alpha * 255)))
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
