"""Draws the Tideover mark (two white waves on teal) at every size the app needs."""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent / "app"
TEAL = (14, 124, 102, 255)


def wave_points(size, y, amp):
    pts = []
    x0, x1 = 0.22 * size, 0.78 * size
    steps = 160
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        # one smooth S-curve with a little tail, matching the in-app painter
        import math
        dy = -amp * math.sin(t * 2 * math.pi * 0.85)
        pts.append((x, y + dy))
    return pts


def mark(size, rounded=True, padding=0.0):
    scale = 4  # supersample for smooth edges
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = int(s * padding)
    box = [pad, pad, s - pad, s - pad]
    inner = s - 2 * pad
    if rounded:
        d.rounded_rectangle(box, radius=int(inner * 0.28), fill=TEAL)
    else:
        d.rectangle([0, 0, s, s], fill=TEAL)
    w = max(2, int(inner * 0.085))
    for frac in (0.40, 0.60):
        pts = wave_points(inner, frac * inner, inner * 0.07)
        pts = [(pad + x, pad + y) for x, y in pts]
        r = w / 2
        # Stamp circles densely along the curve: a smooth, round-capped stroke.
        for (ax, ay), (bx, by) in zip(pts, pts[1:]):
            n = max(1, int(((bx - ax) ** 2 + (by - ay) ** 2) ** 0.5 / (r * 0.25)))
            for k in range(n + 1):
                x = ax + (bx - ax) * k / n
                y = ay + (by - ay) * k / n
                d.ellipse([x - r, y - r, x + r, y + r], fill="white")
    return img.resize((size, size), Image.LANCZOS)


def save(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print("wrote", path.relative_to(ROOT.parent))


web = ROOT / "web"
save(mark(64), web / "favicon.png")
save(mark(192), web / "icons" / "Icon-192.png")
save(mark(512), web / "icons" / "Icon-512.png")
save(mark(192, rounded=False, padding=0.0), web / "icons" / "Icon-maskable-192.png")
save(mark(512, rounded=False, padding=0.0), web / "icons" / "Icon-maskable-512.png")

android = ROOT / "android" / "app" / "src" / "main" / "res"
for folder, px in {"mipmap-mdpi": 48, "mipmap-hdpi": 72, "mipmap-xhdpi": 96, "mipmap-xxhdpi": 144, "mipmap-xxxhdpi": 192}.items():
    if (android / folder).exists():
        save(mark(px), android / folder / "ic_launcher.png")

ios = ROOT / "ios" / "Runner" / "Assets.xcassets" / "AppIcon.appiconset"
if ios.exists():
    for f in ios.glob("*.png"):
        with Image.open(f) as existing:
            size = existing.size[0]
        # iOS icons must be opaque squares; the OS applies its own mask.
        bg = Image.new("RGB", (size, size), TEAL[:3])
        m = mark(size, rounded=False)
        bg.paste(m, (0, 0), m)
        bg.save(f)
    print("updated iOS app icons")
