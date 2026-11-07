"""Raster favicons + logo from the pixel-A mark (packages/ui/mark.ts), drawn exactly on its 7 x 7 grid.

Run: python3 scripts/brand-icons.py  (Pillow). Writes the dark-tile icons Google, Android and iOS use:
  app/favicon.ico (16/32/48), app/apple-icon.png (180), app/icon1.png (96), app/icon2.png (192),
  public/icon-512.png + public/icon-maskable-512.png (web manifest), public/logo.png (512, schema.org logo),
  public/apple-touch-icon.png (180, for clients that ask for the root path).
Same colours as app/icon.svg in dark mode: tile #0b0a0c, ink #f2eef0, accent pixel #ff5ad2.
"""
import re
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
mark = (ROOT / 'packages/ui/mark.ts').read_text()
path = re.search(r"AD_MARK_PATH = '([^']+)'", mark).group(1)
# Each sub-path is "Mx yhWvHh-Wz": a W x H rectangle at (x, y).
RECTS = [tuple(map(int, m)) for m in re.findall(r'M(\d+) (\d+)h(\d+)v(\d+)', path)]
px = re.search(r'AD_MARK_PIXEL = \{ x: (\d+), y: (\d+), size: (\d+) \}', mark)
PIXEL = tuple(int(v) for v in px.groups())

TILE, INK, ACC = (11, 10, 12, 255), (242, 238, 240, 255), (255, 90, 210, 255)


def tile(size: int, pad: float) -> Image.Image:
    """The mark on a full-bleed dark square, snapped to whole pixels so small sizes stay crisp.

    pad = least share of the side left empty around the mark. 0.15 keeps the A's feet inside the
    circle Google and most launchers crop to; maskable icons need 0.22 (Android's 80 % safe zone).
    """
    unit = max(1, int(size * (1 - 2 * pad) / 7))   # one grid cell of the 7 x 7 mark, in pixels
    o = (size - 7 * unit) // 2
    im = Image.new('RGBA', (size, size), TILE)
    d = ImageDraw.Draw(im)
    cell = lambda v: o + v * unit // 8              # mark units are 8 per grid cell
    for x, y, w, h in RECTS:
        d.rectangle([cell(x), cell(y), cell(x + w) - 1, cell(y + h) - 1], fill=INK)
    x, y, s = PIXEL
    d.rectangle([cell(x), cell(y), cell(x + s) - 1, cell(y + s) - 1], fill=ACC)
    return im


def main() -> None:
    assert len(RECTS) == 13, RECTS
    app, pub = ROOT / 'app', ROOT / 'public'
    ico = [tile(16, 0.05), tile(32, 0.1), tile(48, 0.15)]   # tabs don't crop: bigger A at 16/32
    ico[-1].save(app / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:-1])
    tile(180, 0.15).save(app / 'apple-icon.png')
    tile(180, 0.15).save(pub / 'apple-touch-icon.png')
    tile(96, 0.15).save(app / 'icon1.png')
    tile(192, 0.15).save(app / 'icon2.png')
    tile(512, 0.15).save(pub / 'icon-512.png')
    tile(512, 0.22).save(pub / 'icon-maskable-512.png')   # Android masks to a circle: keep the A in the safe zone
    tile(512, 0.15).save(pub / 'logo.png')


if __name__ == '__main__':
    main()
