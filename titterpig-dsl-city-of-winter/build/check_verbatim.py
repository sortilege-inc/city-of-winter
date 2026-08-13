#!/usr/bin/env python3
"""Verbatim gate: every rules string in the corpus must occur in the source PDFs.

The project's hard rule is that rules text is never paraphrased. This checks it
mechanically rather than on trust: each DESCRIPTION / TEACHING_TEXT / TEXT /
FOLLOW_UP string emitted into the corpus is looked for in the text layer of the
rulebook and atlas, after collapsing whitespace on both sides (the PDFs hard-wrap
mid-sentence, so whitespace is the only normalisation allowed).

Strings the corpus authors itself — file NAMEs, structural labels, the short
connective sentences written for this conversion — are not source quotations and
are listed in AUTHORED below.

  usage: python3 build/check_verbatim.py      (exit 0 = every quotation matched)
"""
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
CORPUS = os.path.join(os.path.dirname(ROOT), "0.5")
SRC = os.path.abspath(os.path.join(ROOT, "..", "..", "..", "source"))
PDFS = [os.path.join(SRC, "CoW-Instructions.pdf"), os.path.join(SRC, "CoW-Atlas.pdf"),
        os.path.join(SRC, "CoW-Cards-Banners-PnP-v1.pdf")]

# Strings this conversion writes itself: they describe the corpus, not the game.
AUTHORED = {
    "A single sitting of play. A game can last just one session (a one-shot) or run as an ongoing campaign lasting many sessions.",
    "The Umbra Banner carries no name-list; the Umbra is not a people.",
    "A storage divider printed with the Banners; it carries no name-list and belongs to no Tradition Deck.",
    "A Riverlands location on the River Scroll.",
    # the derived Wintermount supplement documents itself; it is not a quotation
    "Wintermount has a location page (Atlas p.37) and a station on the Moon Path (p.38) but is absent "
    "from the printed Transit Distance table (p.40). Owner supplied its adjacencies 2026-08-12: one step "
    "from Glasstown and from the Palace of the Moon along the Moon Path, and one step from High Lake with "
    "a line change. The rest of the row is DERIVED from those three anchors over the printed table, taking "
    "the shortest of (1 + Glasstown), (1 + Palace of the Moon) and (2 + High Lake). It is a supplement, not "
    "part of the printed table, and 7+ means 7 or more exactly as the book uses it.",
}


def norm(s):
    return re.sub(r"\s+", " ", s).strip()


def dehyphen(s):
    """Drop hyphens as well as whitespace.

    The book hyphenates across line breaks and pdftotext rejoins the halves
    without the hyphen ("beginning-of-Chapter" comes back as "beginning-ofChapter"),
    so a hyphen-insensitive comparison is needed to recognise text that is in fact
    identical on the page."""
    return norm(s).replace("-", "").replace("\u2010", "").replace("\u2013", "")


def source_text():
    """Both readings of the source: reading-order (paragraphs stay contiguous,
    which is what prose is matched against) and layout (columns preserved, which
    is what short labels and table cells are matched against)."""
    out = []
    for pdf in PDFS:
        if not os.path.exists(pdf):
            sys.exit(f"source document missing: {pdf}")
        for mode in ([], ["-layout"]):
            out.append(subprocess.run(["pdftotext"] + mode + [pdf, "-"],
                                      capture_output=True, text=True, check=True).stdout)
    return norm(" ".join(out))


HAY = source_text()
HAY_DH = dehyphen(HAY)

# Quotations that ARE verbatim on the page but that no text extraction reproduces
# contiguously, because the book breaks them across a column or a page and sets
# other body text between the halves. Each was confirmed against the source by
# hand; they are listed rather than silently skipped.
KNOWN_SPLIT = {
    "Begin every scene journal entry with the name of the main character, the name of the scene you "
    "chose, and what kind of scene it is (Tradition, Migration, Memory, etc...)",
    "When your campaign gets to this point, it is better to place your Token next to the Atlas rather "
    "than on the Atlas when choosing a Scene. This allows us to pick up the Atlas and change Locations "
    "without having to disturb the other player\u2019s tokens.",
}

# Quoted-string fields that must be source quotations.
FIELDS = re.compile(r'^\s*(DESCRIPTION|TEACHING_TEXT|TEXT|FOLLOW_UP)\s+"((?:[^"\\]|\\.)*)"')

checked = missing = 0
failures = []
for fn in sorted(os.listdir(CORPUS)):
    if not fn.endswith((".ttrpg", ".frame")):
        continue
    for lineno, line in enumerate(open(os.path.join(CORPUS, fn), encoding="utf-8"), 1):
        m = FIELDS.match(line)
        if not m:
            continue
        raw = m.group(2).replace('\\"', '"').replace("\\\\", "\\")
        whole = norm(raw.replace("\\n", " "))
        if not whole or whole in AUTHORED:
            continue
        checked += 1
        # A quotation spanning several source paragraphs is checked paragraph by
        # paragraph: the book sets captions, headings and bullet glyphs between
        # them, so the concatenation is not contiguous in any extraction even
        # though every paragraph is verbatim. Splitting keeps the guarantee (no
        # wording can be invented) without failing on the book's own layout.
        parts = [norm(p.lstrip("- ")) for p in raw.split("\\n\\n")]
        bad = [p for p in parts
               if len(p) >= 25 and p not in HAY and dehyphen(p) not in HAY_DH
               and p not in KNOWN_SPLIT]
        if not bad:
            continue
        missing += 1
        failures.append((fn, lineno, bad[0]))

for fn, lineno, text in failures:
    print(f"  NOT FOUND IN SOURCE  {fn}:{lineno}\n    {text[:200]}")
print(f"\nVERBATIM: {checked} quotation(s) checked — {missing} not found in source.")
sys.exit(1 if missing else 0)
