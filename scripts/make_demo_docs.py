"""Generates realistic-looking (fictional) supporting documents for demos and seed data.

Every business name here is invented. Output: demo-assets/*.jpg
Run: python3 scripts/make_demo_docs.py
"""
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent.parent / "demo-assets"
OUT.mkdir(exist_ok=True)

FONT_DIRS = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/truetype/freefont"]


def font(name, size):
    for d in FONT_DIRS:
        p = Path(d) / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    return ImageFont.load_default()


SANS = "DejaVuSans.ttf"
SANS_B = "DejaVuSans-Bold.ttf"
MONO = "DejaVuSansMono.ttf"
SERIF_B = "DejaVuSerif-Bold.ttf"


def paper(w=1240, h=1600):
    img = Image.new("RGB", (w, h), (252, 251, 247))
    d = ImageDraw.Draw(img)
    rnd = random.Random(7)
    for _ in range(2200):  # subtle paper grain
        x, y = rnd.randrange(w), rnd.randrange(h)
        c = 244 + rnd.randrange(10)
        d.point((x, y), fill=(c, c, c - 3))
    return img, d


def photo(img, name, angle):
    """Makes a flat page look like a phone photo on a table."""
    pad_x, pad_y = 130, 150
    bg = Image.new("RGB", (img.width + 2 * pad_x, img.height + 2 * pad_y), (104, 94, 82))
    shadow = Image.new("L", bg.size, 0)
    ImageDraw.Draw(shadow).rectangle(
        [pad_x + 14, pad_y + 22, pad_x + img.width + 14, pad_y + img.height + 22], fill=150
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(22))
    bg = Image.composite(Image.new("RGB", bg.size, (40, 34, 28)), bg, shadow)
    bg.paste(img, (pad_x, pad_y))
    bg = bg.rotate(angle, resample=Image.BICUBIC, expand=False, fillcolor=(104, 94, 82))
    # soft vignette: bright centre, slightly darker edges
    mask = Image.new("L", bg.size, 255)
    md = ImageDraw.Draw(mask)
    for i in range(0, 90, 3):
        md.rectangle([i, i, bg.width - i, bg.height - i], outline=int(150 + 105 * i / 90))
    mask = mask.filter(ImageFilter.GaussianBlur(30))
    bg = Image.composite(bg, Image.new("RGB", bg.size, (50, 44, 38)), mask)
    bg = bg.resize((bg.width * 3 // 4, bg.height * 3 // 4), Image.LANCZOS)
    bg.save(OUT / name, quality=86)
    print("wrote", OUT / name)


def table(d, x, y, rows, widths, f, line_h=46):
    for r, row in enumerate(rows):
        cx = x
        for c, cell in enumerate(row):
            if c == len(row) - 1:
                tw = d.textlength(cell, font=f)
                d.text((cx + widths[c] - tw, y + r * line_h), cell, font=f, fill=(30, 30, 30))
            else:
                d.text((cx, y + r * line_h), cell, font=f, fill=(30, 30, 30))
            cx += widths[c]
    return y + len(rows) * line_h


def auto_estimate():
    img, d = paper()
    d.rectangle([0, 0, 1240, 170], fill=(26, 54, 93))
    d.text((70, 40), "EASTSIDE AUTO CARE", font=font(SANS_B, 58), fill="white")
    d.text((72, 110), "Family-owned since 2004  ·  1810 E 7th St (fictional)  ·  (512) 555-0147", font=font(SANS, 24), fill=(210, 220, 235))
    d.text((70, 220), "REPAIR ESTIMATE", font=font(SANS_B, 44), fill=(26, 54, 93))
    d.text((860, 230), "Estimate #E-20417", font=font(SANS, 28), fill=(60, 60, 60))
    f = font(SANS, 28)
    d.text((70, 310), "Customer: Maria L.", font=f, fill=(30, 30, 30))
    d.text((70, 355), "Vehicle: 2014 Honda Civic LX  ·  142,880 mi", font=f, fill=(30, 30, 30))
    d.text((70, 400), "Date: 10/08/2026", font=f, fill=(30, 30, 30))
    d.text((70, 460), "Concern: grinding noise when braking, unsafe to drive.", font=f, fill=(30, 30, 30))
    d.line([70, 530, 1170, 530], fill=(26, 54, 93), width=3)
    fb = font(SANS_B, 28)
    d.text((70, 550), "Description", font=fb, fill=(26, 54, 93))
    d.text((1030, 550), "Amount", font=fb, fill=(26, 54, 93))
    rows = [
        ["Front brake pads (ceramic)", "$78.00"],
        ["Front rotors x2", "$112.00"],
        ["Brake fluid flush", "$55.00"],
        ["Labor 1.5 h @ $90", "$135.00"],
    ]
    y = table(d, 70, 610, rows, [900, 200], f, 54)
    d.line([70, y + 10, 1170, y + 10], fill=(160, 160, 160), width=2)
    d.text((70, y + 40), "TOTAL (parts + labor)", font=font(SANS_B, 34), fill=(20, 20, 20))
    d.text((960, y + 36), "$380.00", font=font(SANS_B, 40), fill=(20, 20, 20))
    d.text((70, y + 140), "Estimate valid for 14 days. Vehicle can be ready same day.", font=font(SANS, 24), fill=(80, 80, 80))
    d.text((70, y + 180), "Payment accepted: cash, card, PayPal.", font=font(SANS, 24), fill=(80, 80, 80))
    # handwritten-ish note
    d.text((640, y + 300), "Thanks Maria - call when ready", font=font("FreeSansOblique.ttf", 34), fill=(30, 60, 150))
    d.text((70, 1500), "This estimate is a fictional sample created for software demos.", font=font(SANS, 18), fill=(150, 150, 150))
    photo(img, "eastside-auto-estimate-380.jpg", -2.2)


def shutoff_notice():
    img, d = paper()
    d.text((70, 60), "CAPITAL CITY POWER & LIGHT", font=font(SERIF_B, 46), fill=(170, 30, 30))
    d.text((70, 125), "Customer Service (512) 555-0199  ·  capcitypower.example", font=font(SANS, 22), fill=(90, 90, 90))
    d.rectangle([70, 190, 1170, 300], outline=(170, 30, 30), width=5)
    d.text((100, 212), "FINAL NOTICE: SERVICE DISCONNECTION", font=font(SANS_B, 38), fill=(170, 30, 30))
    d.text((100, 260), "AVISO FINAL: DESCONEXIÓN DEL SERVICIO", font=font(SANS, 24), fill=(170, 30, 30))
    f = font(SANS, 28)
    lines = [
        "Account: 4410-2287-09",
        "Service address: 2xxx Riverside Dr, Austin TX 78741",
        "Notice date: 10/07/2026",
    ]
    for i, t in enumerate(lines):
        d.text((70, 360 + i * 48), t, font=f, fill=(30, 30, 30))
    rows = [
        ["Previous balance", "$214.77"],
        ["Current charges (Sep)", "$61.63"],
        ["Late fee", "$10.00"],
    ]
    y = table(d, 70, 540, rows, [900, 200], f, 54)
    d.line([70, y + 10, 1170, y + 10], fill=(120, 120, 120), width=2)
    d.text((70, y + 40), "AMOUNT DUE TO AVOID DISCONNECTION", font=font(SANS_B, 30), fill=(20, 20, 20))
    d.text((960, y + 36), "$286.40", font=font(SANS_B, 40), fill=(170, 30, 30))
    d.text((70, y + 120), "Pay by 10/13/2026 to avoid disconnection.", font=font(SANS_B, 30), fill=(20, 20, 20))
    d.text((70, y + 170), "Service may be disconnected on or after 10/14/2026.", font=f, fill=(30, 30, 30))
    d.text((70, 1500), "Fictional sample document created for software demos.", font=font(SANS, 18), fill=(150, 150, 150))
    photo(img, "capital-power-shutoff-286.jpg", 1.6)


def rent_notice():
    img, d = paper()
    d.text((70, 70), "Riverbend Commons Apartments", font=font(SERIF_B, 44), fill=(40, 70, 50))
    d.text((70, 130), "Leasing Office  ·  (512) 555-0123  (fictional)", font=font(SANS, 22), fill=(90, 90, 90))
    d.text((70, 230), "NOTICE OF PAST DUE RENT", font=font(SANS_B, 42), fill=(20, 20, 20))
    f = font(SANS, 28)
    body = [
        "Date: October 6, 2026",
        "Resident: Unit 214",
        "",
        "Our records show the following balance on your account:",
    ]
    for i, t in enumerate(body):
        d.text((70, 320 + i * 48), t, font=f, fill=(30, 30, 30))
    rows = [["October rent", "$1,180.00"], ["Payments received", "-$430.00"]]
    y = table(d, 70, 540, rows, [900, 200], f, 54)
    d.line([70, y + 10, 1170, y + 10], fill=(120, 120, 120), width=2)
    d.text((70, y + 40), "BALANCE DUE", font=font(SANS_B, 32), fill=(20, 20, 20))
    d.text((960, y + 36), "$750.00", font=font(SANS_B, 40), fill=(20, 20, 20))
    msg = [
        "Please pay the balance by October 20, 2026. If the balance is not",
        "paid, we may begin the eviction process as permitted by law.",
        "Payment plans may be available - please contact the office.",
    ]
    for i, t in enumerate(msg):
        d.text((70, y + 130 + i * 44), t, font=f, fill=(30, 30, 30))
    d.text((70, 1500), "Fictional sample document created for software demos.", font=font(SANS, 18), fill=(150, 150, 150))
    photo(img, "riverbend-rent-notice-750.jpg", -1.1)


def pharmacy_quote():
    img, d = paper(1000, 1400)
    d.text((60, 60), "NEIGHBORHOOD PHARMACY", font=font(SANS_B, 40), fill=(20, 110, 100))
    d.text((60, 115), "Prescription price quote (fictional sample)", font=font(SANS, 24), fill=(90, 90, 90))
    f = font(MONO, 26)
    lines = [
        "DATE        10/09/2026",
        "RX#         7731-0442",
        "ITEM        Insulin glargine pen x5",
        "INSURANCE   NOT COVERED / NO PLAN",
        "",
        "RETAIL      $186.18",
        "DISCOUNT    -$44.00",
        "------------------------------",
        "PATIENT PAYS  $142.18",
    ]
    for i, t in enumerate(lines):
        d.text((60, 220 + i * 46), t, font=f, fill=(30, 30, 30))
    photo(img, "pharmacy-quote-142.jpg", 2.4)


if __name__ == "__main__":
    auto_estimate()
    shutoff_notice()
    rent_notice()
    pharmacy_quote()
