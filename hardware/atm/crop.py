"""Crops renders to what's drawn in them, with a margin. Called by export.sh
(needs Pillow): OpenSCAD's --viewall leaves a wide empty border.

    python3 crop.py <image.png> [<image.png> ...]
"""
import sys

from PIL import Image, ImageChops

MARGIN = 30   # pixels of background left around the drawing


def crop(path):
    image = Image.open(path).convert('RGB')
    background = Image.new('RGB', image.size, image.getpixel((2, 2)))
    drawn = ImageChops.difference(image, background).convert('L').point(lambda v: 255 if v > 12 else 0)
    left, top, right, bottom = drawn.getbbox()
    box = (max(left - MARGIN, 0), max(top - MARGIN, 0), min(right + MARGIN, image.width), min(bottom + MARGIN, image.height))
    image.crop(box).save(path)


if __name__ == '__main__':
    for path in sys.argv[1:]:
        crop(path)
