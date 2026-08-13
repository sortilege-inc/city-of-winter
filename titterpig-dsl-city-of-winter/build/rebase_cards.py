#!/usr/bin/env python3
"""Re-base build/cards.json on the PRINTED cards.

The gutterfold print-and-play sheets and the printed cards disagree on 14 of
the 249 faces (see build/card-errata.json). The printed cards are authoritative
— they are the physical component — so this applies the errata to the card list
and records the print-and-play reading alongside it, losing nothing.

The deck assignment still comes from the gutterfold, where it is exact: each
card's deck was read from the PDF image XObject id of the icon on its back.
The printed photos have no text layer, so they cannot supply that.

Afterwards the result is checked, hard, against the transcription of the printed
cards: the multiset of 249 prompts must match exactly. That is what makes this a
re-base rather than a guess.

  usage: python3 build/rebase_cards.py
"""
import json
import os
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))


def norm(s):
    return s.replace("'", "’").strip()


cards = json.load(open(os.path.join(ROOT, "cards.json")))
errata = json.load(open(os.path.join(ROOT, "card-errata.json")))["corrections"]

# printed transcription: 5 per line, pipe-separated, __XCARD__ marks the X-Card
printed = []
for line in open(os.path.join(ROOT, "cards-printed.txt")):
    for c in line.strip().split("|"):
        c = c.strip()
        if c and c != "__XCARD__":
            printed.append(norm(c))

# apply the errata, occurrence by occurrence within each deck
seen = Counter()
applied = 0
for card in cards:
    if "pnpPrompt" in card:          # already re-based; start from the PnP text
        card["prompt"] = card.pop("pnpPrompt")
    key = (card["deck"], card["prompt"])
    seen[key] += 1
    n = seen[key]
    for e in errata:
        if e["deck"] == card["deck"] and norm(e["pnp"]) == norm(card["prompt"]) and e["occurrence"] == n:
            card["pnpPrompt"] = card["prompt"]
            card["prompt"] = norm(e["printed"])
            applied += 1
            break

if applied != len(errata):
    sys.exit(f"expected to apply {len(errata)} corrections, applied {applied} — "
             "an errata entry did not match a card")

got, want = Counter(c["prompt"] for c in cards), Counter(printed)
if got != want:
    print("re-based card list does NOT match the printed cards:")
    for k, v in sorted((want - got).items()):
        print(f"   printed only: {v}x {k}")
    for k, v in sorted((got - want).items()):
        print(f"   corpus  only: {v}x {k}")
    sys.exit(1)

json.dump(cards, open(os.path.join(ROOT, "cards.json"), "w"), indent=1, ensure_ascii=False)
open(os.path.join(ROOT, "cards.json"), "a").write("\n")
print(f"re-based {len(cards)} cards on the printed set; {applied} corrections applied.")
print(f"prompt multiset matches the printed transcription exactly ({len(printed)} cards).")
