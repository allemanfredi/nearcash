"""Draws docs/images/sale-flow.svg, the README's picture of the system: how a
NearCash banknote is made, then redeemed.

Lanes with a header each, numbered rows, solid arrows for requests, dashed
arrows with grey labels for answers, green boxes for what one party does by
itself. Change the rows below and run it again:

    python3 docs/images/sale-flow.py
"""
import sys
from html import escape
from pathlib import Path

WIDTH = 1080
INK, GREY, LANE, GREEN, DARK_GREEN = '#161616', '#5b616b', '#c9cdd3', '#00EC97', '#06281c'
LINE_HEIGHT = 16

out = []


def text(x, y, value, size=13, weight='normal', fill=INK, anchor='middle'):
    out.append(f'<text x="{x}" y="{y}" font-size="{size}" font-weight="{weight}" fill="{fill}" '
               f'text-anchor="{anchor}">{escape(value)}</text>')


def rect(x, y, w, h, fill, rx=8, stroke=None):
    border = f' stroke="{stroke}" stroke-width="1.5"' if stroke else ''
    out.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"{border}/>')


def arrow(x_from, x_to, y, answer=False):
    """A horizontal arrow from one lane centre to another; answers are dashed."""
    dash = ' stroke-dasharray="6 5"' if answer else ''
    if x_to > x_from:
        out.append(f'<line x1="{x_from + 6}" y1="{y}" x2="{x_to - 14}" y2="{y}" stroke="{INK}" stroke-width="2"{dash}/>')
        out.append(f'<path d="M{x_to - 4},{y} l-13,-6 v12 z" fill="{INK}"/>')
    else:
        out.append(f'<line x1="{x_from - 6}" y1="{y}" x2="{x_to + 14}" y2="{y}" stroke="{INK}" stroke-width="2"{dash}/>')
        out.append(f'<path d="M{x_to + 4},{y} l13,-6 v12 z" fill="{INK}"/>')


def section(title, top, lanes, rows):
    """Draws a titled section: lane headers, then numbered rows. Returns the bottom y.

    lanes: [(name, fill, text colour)]; rows: [(number, [element, ...])], where an element is
      ('arrow', from_lane, to_lane, [lines], answer)   or
      ('box', lane, [lines], width)                     or
      ('box_span', first_lane, last_lane, [lines])
    """
    spacing = 1048 / len(lanes)
    centres = [round(16 + spacing * (i + 0.5)) for i in range(len(lanes))]
    header_width = round(spacing - 20)
    text(WIDTH / 2, top + 30, title, size=21, weight='bold')
    for (name, fill, colour), x in zip(lanes, centres):
        rect(x - header_width // 2, top + 50, header_width, 44, fill, rx=10)
        text(x, top + 78, name, size=16, weight='bold', fill=colour)

    y = top + 106
    drawn = []  # (row top, row height, number, elements) drawn after the backgrounds
    for index, (number, elements) in enumerate(rows):
        row_top = y
        cursor = row_top + 5
        bottom = cursor
        placed = []
        for element in elements:
            if element[0] == 'arrow':
                _, a, b, lines, answer = element
                label_ys = [cursor + LINE_HEIGHT * (i + 1) for i in range(len(lines))]
                arrow_y = label_ys[-1] + 11
                placed.append(('arrow', a, b, lines, answer, label_ys, arrow_y))
                cursor = arrow_y + 9
                bottom = arrow_y + 16
            else:
                if element[0] == 'box':
                    _, lane, lines, width = element
                    x, w = centres[lane] - width / 2, width
                else:
                    _, first, last, lines = element
                    x, w = centres[first] - header_width / 2, centres[last] - centres[first] + header_width
                box_top = cursor + 3
                height = LINE_HEIGHT * len(lines) + 16
                placed.append(('box', x, w, lines, box_top, height))
                cursor = box_top + height + 12
                bottom = box_top + height + 14
        height = bottom - row_top
        drawn.append((row_top, height, number, placed, index))
        y = row_top + height + 4

    for row_top, height, number, placed, index in drawn:
        rect(16, row_top, 1048, height, '#f6f7f9' if index % 2 == 0 else '#ffffff')
        out.append(f'<circle cx="46" cy="{row_top + height // 2}" r="14" fill="{INK}"/>')
        text(46, row_top + height // 2 + 5, number, size=15, weight='bold', fill=GREEN)
    for x in centres:
        out.append(f'<line x1="{x}" y1="{top + 94}" x2="{x}" y2="{y}" stroke="{LANE}" stroke-width="1.5" stroke-dasharray="4 5"/>')
    for row_top, height, number, placed, index in drawn:
        for item in placed:
            if item[0] == 'arrow':
                _, a, b, lines, answer, label_ys, arrow_y = item
                for line, line_y in zip(lines, label_ys):
                    text((centres[a] + centres[b]) / 2, line_y, line, fill=GREY if answer else INK)
                arrow(centres[a], centres[b], arrow_y, answer)
            else:
                _, x, w, lines, box_top, box_height = item
                rect(round(x), box_top, round(w), box_height, '#e8fff6', stroke='#00b377')
                for i, line in enumerate(lines):
                    text(round(x + w / 2), box_top + 21 + LINE_HEIGHT * i, line)
    return y


CUSTOMER, ATM, BANK, ONECLICK, CONTRACT = range(5)
made = section('How a banknote is made', 10, [
    ('Customer', '#eef0f3', INK),
    ('ATM', GREEN, DARK_GREEN),
    ('Bank', INK, '#ffffff'),
    ('1Click · FAR', '#eef0f3', INK),
    ('Issuer contract', '#eef0f3', INK),
], [
    ('0', [('box_span', ATM, BANK, [
        "Before any sale, at the bank's factory (offline):",
        "each blank card's chip makes a key C, and the bank's",
        "production key signs it: the card's birth certificate",
    ])]),
    ('1', [('arrow', CUSTOMER, ATM, ['picks a banknote, the token', 'to pay with, and a PIN'], False)]),
    ('2', [
        ('arrow', ATM, BANK, ['asks for a quote'], False),
        ('arrow', BANK, ONECLICK, ['a quote that pays', "the bank's reserve on FAR"], False),
        ('arrow', BANK, ATM, ['the deposit address as a QR code:', '5 minutes to pay'], True),
    ]),
    ('3', [
        ('arrow', CUSTOMER, ONECLICK, ['pays the deposit address from their own wallet', "(in USDC, exactly the banknote's value)"], False),
        ('box', ONECLICK, ['converts it into the', "bank's reserve, on FAR"], 196),
    ]),
    ('4', [('arrow', ONECLICK, BANK, ['SUCCESS: the bank reads it', 'from 1Click, not from the ATM'], True)]),
    ('5', [('box', ATM, ['pushes a blank card into the reader:', 'its chip makes its own keys, A and F,', 'and signs them with C'], 270)]),
    ('6', [
        ('arrow', ATM, BANK, ["the card's keys and its", 'birth certificate'], False),
        ('box', BANK, ['checks the birth certificate:', "a card the bank didn't make", 'is refused here'], 230),
        ('arrow', BANK, ONECLICK, ['moves the value from the reserve', "to the card's own account"], False),
        ('arrow', BANK, CONTRACT, ['asks for the certificate'], False),
        ('box', CONTRACT, ['checks the birth again;', 'the NEAR MPC network', 'signs the certificate'], 190),
        ('arrow', CONTRACT, BANK, ['the signed certificate'], True),
        ('arrow', BANK, ATM, ['the signed certificate'], True),
    ]),
    ('7', [('arrow', ATM, CUSTOMER, ['writes the certificate and the PIN,', 'checks the card, hands it out'], False)]),
])

banner_top = made + 10
rect(16, banner_top, 1048, 62, INK, rx=10)
text(WIDTH / 2, banner_top + 26, 'From here on the bank is no longer needed.', size=15, weight='bold', fill=GREEN)
text(WIDTH / 2, banner_top + 48, 'The banknote goes hand to hand, offline: any phone can check it, and its holder redeems it on FAR with the PIN.',
     fill='#ffffff')

HOLDER, WALLET, NOTE, FAR = range(4)
bottom = section('Redeem, whenever the holder wants', banner_top + 86, [
    ('Holder', '#eef0f3', INK),
    ('Wallet app', GREEN, DARK_GREEN),
    ('Banknote', INK, '#ffffff'),
    ('1Click · FAR', '#eef0f3', INK),
], [
    ('8', [('arrow', HOLDER, WALLET, ['chooses where the money goes', '(token, chain, address) and types the PIN'], False)]),
    ('9', [
        ('arrow', WALLET, NOTE, ['asks the card to sign', 'the withdrawal, with the PIN'], False),
        ('arrow', NOTE, WALLET, ['its one signature: from now', 'on the card is spent, for good'], True),
    ]),
    ('10', [
        ('arrow', WALLET, FAR, ['submits the signed withdrawal'], False),
        ('arrow', FAR, HOLDER, ["the card's money reaches the holder's own wallet"], False),
        ('arrow', FAR, WALLET, ["if the delivery fails: a refund to the holder's", 'passkey account inside FAR, never to the card'], True),
    ]),
])

height = bottom + 16
svg = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{height}" viewBox="0 0 {WIDTH} {height}" '
       f'font-family="-apple-system, \'Segoe UI\', Helvetica, Arial, sans-serif">',
       '<title>How a NearCash banknote is made, then redeemed</title>',
       f'<rect x="0.5" y="0.5" width="{WIDTH - 1}" height="{height - 1}" rx="14" fill="#ffffff" stroke="#dfe2e6"/>']
output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).with_name('sale-flow.svg')
output.write_text('\n'.join(svg + out + ['</svg>']) + '\n')
print(f'{output}: {WIDTH} × {height}')
