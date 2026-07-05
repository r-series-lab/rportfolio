from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from math import cos, sin, radians

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
SIZE = 1024
TILE = (30, 30, 994, 994)
RADIUS = 155

FONT_BLACK = "/Library/Fonts/Swis721 Blk BT Black.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

WHITE = (248, 250, 252, 255)
SOFT_WHITE = (233, 238, 247, 255)
SILVER = (193, 203, 220, 255)
SILVER_DARK = (139, 153, 177, 255)
BLUE = (109, 160, 255, 255)
BLUE_SOFT = (156, 194, 255, 255)
INK = (7, 10, 16, 255)


@dataclass(frozen=True)
class Concept:
    key: str
    title: str
    subtitle: str
    renderer: str


CONCEPTS = [
    Concept("A", "Risk Lens", "No letter: radar lens plus rising structure.", "a"),
    Concept("B", "Allocation Stack", "Portfolio weights as clean stacked cards.", "b"),
    Concept("C", "Signal Gate", "Risk gate and trend line, very tool-like.", "c"),
    Concept("D", "Lowercase p", "A quiet p mark with portfolio bars inside.", "d"),
    Concept("E", "Market Compass", "Direction, risk ring, and signal point.", "e"),
    Concept("F", "Holdings Grid", "Most compact: allocation grid with trend cut.", "f"),
]


def font(size: int, path: str = FONT_BLACK) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def rounded_tile() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(TILE, radius=RADIUS, fill=255)

    grad = Image.new("RGBA", (SIZE, SIZE), (5, 7, 12, 255))
    px = grad.load()
    for y in range(SIZE):
        for x in range(SIZE):
            dx = (x - 380) / SIZE
            dy = (y - 260) / SIZE
            light = max(0, 1 - (dx * dx + dy * dy) * 5.0)
            edge = (x + y) / (SIZE * 2)
            px[x, y] = (
                int(5 + light * 15 + edge * 4),
                int(7 + light * 16 + edge * 4),
                int(12 + light * 22 + edge * 5),
                255,
            )

    img.alpha_composite(grad)
    img.putalpha(mask)

    shine = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shine)
    sd.ellipse((-170, 0, 740, 510), fill=(255, 255, 255, 13))
    shine.putalpha(Image.composite(shine.getchannel("A"), Image.new("L", (SIZE, SIZE), 0), mask))
    img.alpha_composite(shine)
    return img


def shadowed_layer(base: Image.Image, layer: Image.Image, opacity: int = 105, offset: int = 9) -> None:
    alpha = layer.getchannel("A").point(lambda a: int(a * opacity / 255))
    shadow = Image.new("RGBA", layer.size, (0, 0, 0, 255))
    shadow.putalpha(alpha.filter(ImageFilter.GaussianBlur(14)))
    base.alpha_composite(shadow, (0, offset))
    base.alpha_composite(layer)


def rounded_bar(width: int, height: int, radius: int, fill, angle: float = 0) -> Image.Image:
    pad = 44
    layer = Image.new("RGBA", (width + pad * 2, height + pad * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((pad, pad, pad + width, pad + height), radius=radius, fill=fill)
    if angle:
        layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    return layer


def paste_center(base: Image.Image, layer: Image.Image, center: tuple[int, int]) -> None:
    base.alpha_composite(layer, (int(center[0] - layer.width / 2), int(center[1] - layer.height / 2)))


def draw_line(points: list[tuple[int, int]], width: int, color) -> Image.Image:
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.line(points, fill=color, width=width, joint="curve")
    r = width // 2
    for x, y in points:
        d.ellipse((x - r, y - r, x + r, y + r), fill=color)
    return layer


def draw_arc(draw: ImageDraw.ImageDraw, box, start: int, end: int, fill, width: int) -> None:
    draw.arc(box, start=start, end=end, fill=fill, width=width)


def draw_letter(
    img: Image.Image,
    text: str,
    size: int,
    center: tuple[int, int],
    fill=WHITE,
    x_adjust: int = 0,
    y_adjust: int = 0,
) -> None:
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    f = font(size)
    bbox = d.textbbox((0, 0), text, font=f)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = center[0] - w // 2 - bbox[0] + x_adjust
    y = center[1] - h // 2 - bbox[1] + y_adjust
    d.text((x, y), text, font=f, fill=fill)
    shadowed_layer(img, layer, 95)


def draw_small_spark(draw: ImageDraw.ImageDraw, x: int, y: int, scale: int = 1, color=BLUE_SOFT) -> None:
    width = max(4, 5 * scale)
    draw.line((x - 26 * scale, y, x + 26 * scale, y), fill=color, width=width)
    draw.line((x, y - 26 * scale, x, y + 26 * scale), fill=color, width=width)


def concept_a() -> Image.Image:
    img = rounded_tile()
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_arc(d, (236, 224, 788, 776), 205, 330, SOFT_WHITE, 64)
    draw_arc(d, (306, 294, 718, 706), 205, 330, (188, 200, 219, 255), 32)
    draw_arc(d, (376, 364, 648, 636), 210, 322, (125, 145, 178, 230), 18)
    d.line((512, 236, 512, 774), fill=(64, 78, 105, 170), width=10)
    d.line((244, 506, 780, 506), fill=(64, 78, 105, 170), width=10)
    for x, y, w, h in [(352, 520, 82, 214), (476, 434, 82, 300), (600, 355, 82, 379)]:
        d.rounded_rectangle((x, y, x + w, y + h), radius=28, fill=SOFT_WHITE)
        d.line((x + w // 2, y - 68, x + w // 2, y + h + 68), fill=(100, 116, 145, 180), width=8)
    shadowed_layer(img, layer)

    signal = draw_line([(306, 686), (432, 586), (552, 626), (704, 414)], 44, WHITE)
    accent = draw_line([(568, 617), (704, 414)], 19, BLUE)
    shadowed_layer(img, signal, 125)
    img.alpha_composite(accent)
    d = ImageDraw.Draw(img)
    d.ellipse((705, 394, 751, 440), fill=BLUE_SOFT)
    d.ellipse((721, 410, 735, 424), fill=WHITE)
    return img


def concept_b() -> Image.Image:
    img = rounded_tile()
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cards = [
        ((275, 290, 575, 650), SOFT_WHITE),
        ((388, 360, 688, 720), (224, 231, 243, 255)),
        ((501, 430, 801, 790), SILVER),
    ]
    for box, fill in cards:
        d.rounded_rectangle(box, radius=42, fill=fill)
        d.rounded_rectangle((box[0] + 42, box[1] + 56, box[2] - 42, box[1] + 82), radius=13, fill=INK)
        d.rounded_rectangle((box[0] + 42, box[1] + 116, box[2] - 118, box[1] + 142), radius=13, fill=INK)
    shadowed_layer(img, layer, 115)
    trend = draw_line([(286, 718), (408, 650), (520, 670), (650, 558), (762, 470)], 34, WHITE)
    shadowed_layer(img, trend, 110)
    accent = draw_line([(650, 558), (762, 470)], 15, BLUE)
    img.alpha_composite(accent)
    return img


def concept_c() -> Image.Image:
    img = rounded_tile()
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle((255, 248, 405, 780), radius=34, fill=WHITE)
    d.rounded_rectangle((475, 248, 785, 780), radius=34, fill=WHITE)
    d.rounded_rectangle((405, 362, 475, 666), radius=34, fill=WHITE)
    d.rounded_rectangle((514, 346, 744, 410), radius=23, fill=INK)
    d.rounded_rectangle((514, 480, 708, 544), radius=23, fill=INK)
    d.rounded_rectangle((514, 614, 668, 678), radius=23, fill=INK)
    shadowed_layer(img, layer, 105)

    signal = draw_line([(302, 698), (442, 602), (575, 620), (720, 452)], 34, WHITE)
    shadowed_layer(img, signal, 90)
    img.alpha_composite(draw_line([(592, 602), (720, 452)], 14, BLUE))
    d = ImageDraw.Draw(img)
    d.ellipse((718, 430, 762, 474), fill=BLUE_SOFT)
    d.ellipse((733, 445, 747, 459), fill=WHITE)
    return img


def concept_d() -> Image.Image:
    img = rounded_tile()
    draw_letter(img, "p", 650, (436, 512), x_adjust=-18, y_adjust=-8)
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for x, y, h, fill in [
        (598, 548, 146, SOFT_WHITE),
        (692, 478, 216, SILVER),
        (786, 394, 300, SILVER_DARK),
    ]:
        d.rounded_rectangle((x, y, x + 68, y + h), radius=22, fill=fill)
    d.rounded_rectangle((576, 735, 866, 782), radius=24, fill=SOFT_WHITE)
    shadowed_layer(img, layer, 105)
    d = ImageDraw.Draw(img)
    draw_small_spark(d, 806, 304, 2)
    d.ellipse((822, 298, 852, 328), fill=BLUE)
    return img


def concept_e() -> Image.Image:
    img = rounded_tile()
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    draw_arc(d, (214, 214, 810, 810), 210, 326, SOFT_WHITE, 54)
    draw_arc(d, (302, 302, 722, 722), 30, 160, (206, 216, 232, 255), 34)
    draw_arc(d, (386, 386, 638, 638), 205, 330, (127, 145, 176, 220), 20)
    arrow = [(388, 655), (614, 456), (622, 542), (792, 314), (756, 620), (690, 552), (452, 742)]
    d.polygon(arrow, fill=WHITE)
    d.line((512, 355, 512, 670), fill=(91, 107, 136, 170), width=12)
    d.line((355, 512, 670, 512), fill=(91, 107, 136, 170), width=12)
    shadowed_layer(img, layer, 115)
    d = ImageDraw.Draw(img)
    d.ellipse((756, 286, 816, 346), fill=BLUE_SOFT)
    d.ellipse((777, 307, 795, 325), fill=WHITE)
    return img


def concept_f() -> Image.Image:
    img = rounded_tile()
    layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    boxes = [
        (286, 284, 446, 444, SOFT_WHITE),
        (486, 284, 646, 444, (224, 231, 243, 255)),
        (686, 284, 806, 444, SILVER),
        (286, 484, 446, 644, (224, 231, 243, 255)),
        (486, 484, 646, 644, SILVER),
        (686, 484, 806, 644, SILVER_DARK),
        (286, 684, 446, 804, SILVER),
        (486, 684, 646, 804, SILVER_DARK),
    ]
    for x1, y1, x2, y2, fill in boxes:
        d.rounded_rectangle((x1, y1, x2, y2), radius=32, fill=fill)
    shadowed_layer(img, layer, 115)
    cut = draw_line([(300, 740), (428, 628), (552, 654), (744, 414)], 48, INK)
    img.alpha_composite(cut)
    signal = draw_line([(316, 726), (436, 624), (552, 650), (728, 428)], 28, WHITE)
    shadowed_layer(img, signal, 70)
    img.alpha_composite(draw_line([(568, 632), (728, 428)], 12, BLUE))
    return img


RENDERERS = {
    "a": concept_a,
    "b": concept_b,
    "c": concept_c,
    "d": concept_d,
    "e": concept_e,
    "f": concept_f,
}


def wrap(draw: ImageDraw.ImageDraw, text: str, width: int, font_obj) -> list[str]:
    words = text.split()
    lines: list[str] = []
    line = ""
    for word in words:
        probe = f"{line} {word}".strip()
        if draw.textlength(probe, font=font_obj) > width and line:
            lines.append(line)
            line = word
        else:
            line = probe
    if line:
        lines.append(line)
    return lines


def make_sheet(paths: list[tuple[Concept, Path]]) -> Image.Image:
    sheet = Image.new("RGBA", (2180, 1700), (29, 31, 36, 255))
    d = ImageDraw.Draw(sheet)
    title_font = font(58, FONT_BOLD)
    small_font = font(29, FONT_BOLD)
    label_font = font(35, FONT_BOLD)
    body_font = ImageFont.truetype(FONT_BOLD, 24)

    d.text((78, 56), "rPortfolio r-series icon concepts", fill=(246, 248, 252, 255), font=title_font)
    d.text(
        (80, 128),
        "near-black tile | mostly white/silver mark | restrained blue accent | preview only",
        fill=(169, 176, 190, 255),
        font=small_font,
    )

    positions = [(78, 220), (754, 220), (1430, 220), (78, 930), (754, 930), (1430, 930)]
    for (concept, path), (x, y) in zip(paths, positions):
        d.rounded_rectangle((x, y, x + 620, y + 615), radius=32, fill=(43, 46, 54, 255))
        icon = Image.open(path).convert("RGBA").resize((344, 344), Image.Resampling.LANCZOS)
        sheet.alpha_composite(icon, (x + 138, y + 34))

        mini128 = icon.resize((88, 88), Image.Resampling.LANCZOS)
        mini32 = icon.resize((32, 32), Image.Resampling.LANCZOS)
        sheet.alpha_composite(mini128, (x + 58, y + 408))
        sheet.alpha_composite(mini32, (x + 166, y + 436))

        d.text((x + 230, y + 414), f"{concept.key}. {concept.title}", fill=(247, 249, 252, 255), font=label_font)
        for idx, line in enumerate(wrap(d, concept.subtitle, 340, body_font)[:3]):
            d.text((x + 230, y + 464 + idx * 34), line, fill=(178, 185, 198, 255), font=body_font)

    return sheet


def make_family_strip(paths: list[tuple[Concept, Path]]) -> Image.Image:
    strip = Image.new("RGBA", (2340, 500), (88, 88, 88, 255))
    d = ImageDraw.Draw(strip)
    label_font = ImageFont.truetype(FONT_BOLD, 30)
    caption_font = ImageFont.truetype(FONT_BOLD, 22)
    icons: list[tuple[str, str, Path]] = [
        (
            "Reference",
            "rDevTool",
            Path("/Users/ikiru/Documents/r-series-public/rdevtool/src-tauri/icons/rdevtool-app-icon-source.png"),
        ),
        (
            "Reference",
            "rCodexManager",
            Path("/Users/ikiru/Documents/r-series-public/rcodexmanager/src-tauri/icons/rcodexmanager-app-icon-source.png"),
        ),
    ]
    icons += [(f"Option {concept.key}", f"rPortfolio {concept.key}", path) for concept, path in paths]

    gap = 280
    start_x = 56
    y = 58
    for idx, (caption, label, path) in enumerate(icons):
        x = start_x + idx * gap
        icon = Image.open(path).convert("RGBA").resize((150, 150), Image.Resampling.LANCZOS)
        strip.alpha_composite(icon, (x + 42, y))
        cw = d.textlength(caption, font=caption_font)
        lw = d.textlength(label, font=label_font)
        d.text((x + 117 - cw / 2, y + 188), caption, fill=(213, 216, 222, 255), font=caption_font)
        d.text((x + 117 - lw / 2, y + 225), label, fill=(255, 255, 255, 255), font=label_font)

    return strip


def main() -> None:
    paths: list[tuple[Concept, Path]] = []
    for concept in CONCEPTS:
        img = RENDERERS[concept.renderer]()
        slug = concept.title.lower().replace(" ", "-")
        path = ROOT / f"rportfolio-rseries-icon-{concept.key.lower()}-{slug}.png"
        img.save(path)
        paths.append((concept, path))

    make_sheet(paths).save(ROOT / "rportfolio-rseries-icon-concepts-sheet.png")
    make_family_strip(paths).save(ROOT / "rportfolio-rseries-icon-family-strip.png")


if __name__ == "__main__":
    main()
