"""Puts the six renders of a card's journey side by side, with captions, into
images/how-it-works.png. Called by export.sh (needs Pillow: pip install pillow).

    python3 sequence.py <folder with frame-1.png … frame-6.png> <output.png>
"""
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

CAPTIONS = [
    "1  Ready: blank cards wait in the hopper;\n    the reader's slot faces them.",
    "2  The pusher, under the floor, catches only\n    the bottom card and pushes it under the gate.",
    "3  The card goes all the way into the reader:\n    the Raspberry Pi issues the banknote.",
    "4  The pusher goes back home. The card stays\n    in the reader, its end sticking out.",
    "5  The turret turns, carrying the reader\n    with the card inside.",
    "6  At 180° the banknote sticks out of the smile:\n    the customer pulls it out.",
]


def caption_font(max_width):
    """The largest font, up to 22 pt, in which every caption line fits max_width pixels."""
    lines = [line for text in CAPTIONS for line in text.split('\n')]
    for size in range(22, 11, -1):
        try:
            font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', size)
        except OSError:
            return ImageFont.load_default()
        if all(font.getlength(line) <= max_width for line in lines):
            return font
    return font


def main(folder, output):
    frames = [Image.open(f'{folder}/frame-{i}.png').convert('RGB') for i in range(1, 7)]
    background = frames[0].getpixel((5, 5))
    # One crop for all frames: the union of what's drawn in each.
    box = None
    for frame in frames:
        drawn = ImageChops.difference(frame, Image.new('RGB', frame.size, background)).convert('L').point(lambda v: 255 if v > 12 else 0)
        b = drawn.getbbox()
        box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    box = (max(box[0] - 20, 0), max(box[1] - 20, 0), box[2] + 20, box[3] + 20)
    crops = [frame.crop(box) for frame in frames]
    width, height = crops[0].size
    caption_height = 70
    font = caption_font(width - 36)
    sheet = Image.new('RGB', (3 * width, 2 * (height + caption_height)), (250, 250, 250))
    draw = ImageDraw.Draw(sheet)
    for i, (image, text) in enumerate(zip(crops, CAPTIONS)):
        x, y = (i % 3) * width, (i // 3) * (height + caption_height)
        sheet.paste(image, (x, y))
        draw.multiline_text((x + 18, y + height + 6), text, fill=(20, 20, 20), font=font, spacing=4)
        draw.rectangle([x, y, x + width - 1, y + height + caption_height - 1], outline=(210, 210, 210))
    sheet.save(output)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
