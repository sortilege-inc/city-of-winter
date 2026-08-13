#!/usr/bin/env python3
"""Build the source-coverage inventory MECHANICALLY from the City of Winter PDFs.

The inventory is the ground truth the coverage gate audits the corpus against, so
it is re-derived from the source documents on every run and is never read back
out of the DSL corpus.

  Tradition Card : the 249 PRINTED card faces (authoritative), transcribed in
                   build/cards-printed.txt, cross-checked against the gutterfold
                   PDF's text layer — every difference must be a recorded
                   correction in build/card-errata.json.
  Scene          : every ALL-CAPS scene label on the Atlas location pages (7-37)
                   plus the Wandering Borough card. Labels wrap over two or three
                   lines on the page, so words are clustered by bounding box
                   rather than read line-by-line.
  Location       : the Atlas contents listing (p.3), plus the Wandering Borough.
  Banner         : the banner titles in CoW-Cards-Banners-PnP-v1.pdf.
  Heading        : every entry in the rulebook's own Table of Contents.

  usage: python3 build/make_inventory.py
"""
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.abspath(os.path.join(ROOT, "..", "..", "..", "source"))
CARDS_PDF = os.path.join(SRC, "CoW-Cards-Gutterfold.pdf")
ATLAS_PDF = os.path.join(SRC, "CoW-Atlas.pdf")
BANNERS_PDF = os.path.join(SRC, "CoW-Cards-Banners-PnP-v1.pdf")
RULES_PDF = os.path.join(SRC, "CoW-Instructions.pdf")
BOROUGH_PDF = os.path.join(SRC, "CoW-VTT-Photos", "CoW-VTT-Photos",
                           "CoW-Banners-Burrough-Color.pdf")

for p in (CARDS_PDF, ATLAS_PDF, BANNERS_PDF, RULES_PDF, BOROUGH_PDF):
    if not os.path.exists(p):
        sys.exit(f"source document missing: {p}\n"
                 "The inventory cannot be built — an unreadable source is not a passing gate.")


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def pdftext(pdf, first, last, x=None, w=None):
    cmd = ["pdftotext", "-layout", "-f", str(first), "-l", str(last)]
    if x is not None:
        cmd += ["-x", str(x), "-y", "0", "-W", str(w), "-H", "2000"]
    return run(cmd + [pdf, "-"])


def page_labels(pdf, page):
    """The text blocks a page is composed of, as poppler segments them.

    `pdftotext -bbox-layout` already groups words into the blocks the layout
    engine sees, which is exactly one block per Atlas scene prompt however many
    lines it wraps over. That is far more faithful than re-clustering word boxes
    by hand, and it is deterministic.
    """
    xml = run(["pdftotext", "-bbox-layout", "-f", str(page), "-l", str(page), pdf, "-"])
    # The rulebook's display font carries a literal U+0008 in some words, which
    # is not legal XML; drop control characters before parsing.
    xml = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml)
    root = ET.fromstring(xml)
    NS = "{http://www.w3.org/1999/xhtml}"
    out = []
    for block in root.iter(NS + "block"):
        words = [(w.text or "") for line in block.iter(NS + "line")
                 for w in line.iter(NS + "word")]
        text = re.sub(r"\s+", " ", " ".join(words)).strip()
        if text:
            out.append(text)
    return out


units, seen = [], set()


def add(category, name):
    name = re.sub(r"\s+", " ", name).strip()
    if not name or (category, name.lower()) in seen:
        return
    seen.add((category, name.lower()))
    units.append({"category": category, "name": name})


# --- Tradition Cards ----------------------------------------------------------
# The PRINTED cards are authoritative (owner ruling 2026-08-12), and they are
# photographs with no text layer, so the inventory reads them from the
# transcription in build/cards-printed.txt. That transcription is not taken on
# trust: the gutterfold print-and-play sheets ARE machine-readable, so their 249
# faces are extracted here too and the two are diffed. Every difference must be
# a recorded correction in build/card-errata.json — a NEW divergence fails the
# build, which is what stops either reading drifting unnoticed.
FURNITURE = re.compile(r"\b(cut|lines|fold\s+line)\b", re.I)
n_pages = int(re.search(r"Pages:\s+(\d+)", run(["pdfinfo", CARDS_PDF])).group(1))
pnp_faces = []
for page in range(1, n_pages + 1):
    for col in range(3):
        raw = pdftext(CARDS_PDF, page, page, col * 264, 264)
        txt = " ".join(FURNITURE.sub(" ", l).strip() for l in raw.splitlines())
        txt = re.sub(r"\s+", " ", txt).strip()
        # the sheet hyphenates across line breaks ("oath-\nbreaker's"); joining
        # lines with a space would otherwise read that as "oath- breaker's".
        txt = re.sub(r"-\s+(?=\w)", "-", txt)
        if txt:
            pnp_faces.append(txt)

printed_faces = []
with open(os.path.join(ROOT, "cards-printed.txt")) as fh:
    for line in fh:
        for c in line.strip().split("|"):
            c = c.strip()
            if c and c != "__XCARD__":
                printed_faces.append(c.replace("'", "\u2019"))

if len(pnp_faces) != len(printed_faces):
    sys.exit(f"card count mismatch: gutterfold {len(pnp_faces)}, printed {len(printed_faces)}")

errata = json.load(open(os.path.join(ROOT, "card-errata.json")))["corrections"]
allowed_pnp = Counter(e["pnp"].replace("'", "\u2019") for e in errata)
allowed_printed = Counter(e["printed"].replace("'", "\u2019") for e in errata)
dp = Counter(pnp_faces) - Counter(printed_faces)
dq = Counter(printed_faces) - Counter(pnp_faces)
if dp != allowed_pnp or dq != allowed_printed:
    print("UNRECORDED difference between the gutterfold and the printed cards:")
    for k, v in sorted((dp - allowed_pnp).items()):
        print(f"   gutterfold only: {v}x {k}")
    for k, v in sorted((dq - allowed_printed).items()):
        print(f"   printed    only: {v}x {k}")
    sys.exit("every difference must be listed in build/card-errata.json")

card_faces = len(printed_faces)
for txt in printed_faces:
    add("Tradition Card", txt)

# --- Scenes: ALL-CAPS labels on the Atlas location pages ----------------------
CAPS = re.compile(r"^[A-Z][A-Z’',\.\- ]{2,}$")
NOT_SCENE = re.compile(
    r"^(AT LAST WE REACH|THE CITY OF WINTER|CONTENTS|TRANSIT|CITY TRANSIT|"
    r"RIVERLANDS MAP|USING THE ATLAS|PRELUDE|THE WANDERING|BURROUGH|THE W ANDERING)", re.I)
for page in list(range(7, 38)):
    for lab in page_labels(ATLAS_PDF, page):
        if CAPS.match(lab) and not NOT_SCENE.match(lab) and not lab.startswith("..."):
            add("Scene", lab.title())
for lab in page_labels(BOROUGH_PDF, 10):
    if CAPS.match(lab) and not NOT_SCENE.match(lab):
        add("Scene", lab.title())

# --- Locations: the Atlas contents listing (p.3) ------------------------------
for line in pdftext(ATLAS_PDF, 3, 3).splitlines():
    for chunk in re.split(r"\s{3,}", line):
        m = re.match(r"^(.*?)\.{2,}\s*(\d+)\s*$", chunk.strip())
        if m and m.group(1).strip():
            title = m.group(1).strip()
            if int(m.group(2)) >= 7 and title.upper() not in {
                    "CITY TRANSIT MAP", "TRANSIT DISTANCE TABLE"} and not title.startswith("("):
                add("Location", title)
add("Location", "We reach the City of Winter (by Lantern Ship)")
add("Location", "We reach the City of Winter (by Caravan)")
add("Location", "The Wandering Burrough")

# --- Banners: title-case headings on the banner sheets ------------------------
for line in pdftext(BANNERS_PDF, 1, 2).splitlines():
    for chunk in re.split(r"\s{3,}", line):
        c = chunk.strip()
        if (len(c) > 2 and c[0].isupper() and not c.isupper() and "," not in c
                and "..." not in c and len(c.split()) <= 4
                and not c.startswith(("Choose", "or another", "Store", "between"))):
            add("Banner", c)

# --- Rulebook headings: the book's own Table of Contents ----------------------
toc_pages = [p for p in range(1, 9) if "Table of Contents" in pdftext(RULES_PDF, p, p)]
if not toc_pages:
    sys.exit("could not locate the rulebook Table of Contents — inventory would be incomplete")
for page in toc_pages:
    for line in pdftext(RULES_PDF, page, page).splitlines():
        for chunk in re.split(r"\s{3,}", line):
            c = re.sub(r"[\x00-\x1f]", "", chunk).strip()
            # a ToC entry is "<title><page no>", the number sometimes butted
            # straight against the title ("Learning City of Winter7").
            title = re.sub(r"[\s\.]*\d{1,3}$", "", c).strip()
            title = re.sub(r"^\d+[\.\s]+", lambda m: m.group(0), title)
            if (4 <= len(title) < 60 and re.search(r"[A-Za-z]", title)
                    and not title.startswith("–") and "Table of Contents" not in title):
                add("Heading", title)

out = os.path.join(ROOT, "inventory.json")
with open(out, "w") as f:
    json.dump(units, f, indent=1)
    f.write("\n")

print(f"wrote {out}: {len(units)} units  (card faces read: {card_faces})")
for k, v in sorted(Counter(u["category"] for u in units).items()):
    print(f"  {k:16} {v}")
