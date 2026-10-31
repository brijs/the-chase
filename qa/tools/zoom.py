#!/usr/bin/env python3
"""zoom.py OUT.png ZOOM x,y,w,h IMG [IMG ...] -- crop each image at the same box,
zoom with nearest neighbour, tile left to right with a 4 px gap."""
import sys
from PIL import Image
out, zoom, box = sys.argv[1], int(sys.argv[2]), [int(v) for v in sys.argv[3].split(',')]
x, y, w, h = box
tiles = [Image.open(p).convert('RGB').crop((x, y, x + w, y + h)).resize((w * zoom, h * zoom), Image.NEAREST) for p in sys.argv[4:]]
W = sum(t.width for t in tiles) + 4 * (len(tiles) - 1)
sheet = Image.new('RGB', (W, h * zoom), (255, 255, 255))
cx = 0
for t in tiles:
    sheet.paste(t, (cx, 0)); cx += t.width + 4
sheet.save(out)
print(out, sheet.size)
