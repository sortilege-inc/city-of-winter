#!/usr/bin/env python3
"""Deterministically emit the titterpig-dsl-city-of-winter 0.5 corpus.

Input  : build/source-data.json, build/cards.json, build/procedures.json
Output : 0.5/*.ttrpg, 0.5/*.frame, 0.5/*.lore, sources.json

Every string that came off the page is reproduced verbatim; this script only
arranges it. Re-running regenerates the corpus byte-for-byte.
"""
import hashlib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smartquote import smarten

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
OUT = os.path.join(REPO, "0.5")
SPEC_VERSION = "0.5"
VERSION = "0.5"
RELEASE_DATE = "2026-08-12"
BASE_ID = "CityOfWinter_Core_Base"

# ---------------------------------------------------------------- identity ---
# Hash IDs are opaque (spec §5): derived from a stable salt+name so the corpus
# regenerates identically, and carrying no semantics a tool parses back out.
_seen_hashes = {}


def h(kind, name):
    digest = hashlib.sha256(f"cityofwinter|{kind}|{name}".encode("utf-8")).hexdigest()
    hid = "COW" + digest[:21]
    if _seen_hashes.setdefault(hid, (kind, name)) != (kind, name):
        raise SystemExit(f"hash collision: {hid} {(kind, name)} vs {_seen_hashes[hid]}")
    return hid


def q(s):
    """Quote a DSL string literal, in the source's own typography.

    The City of Winter PDFs contain no straight quotes at all, so every emitted
    string is normalised to U+2018/19/1C/1D. Identifiers and enum values contain
    no quotes, so this is safe to apply uniformly."""
    s = smarten(s)
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


def caret(name):
    return '^"' + name.replace('"', '\\"') + '"'


def ref(kind, name):
    return f'#{h(kind, name)} {caret(name)}'


# Entities this run actually emits a DEF for, as (kind, name). GUIDANCE CONCERNS
# and HOOK THEN resolve against this — never against h(), which registers on
# call and would make any candidate kind look defined.
DEFINED = set()


def decl(kind, name):
    """Register an entity being defined; returns its bare hash id (as h() does)."""
    DEFINED.add((kind, name))
    return h(kind, name)


def resolve_ref(name, kinds):
    for kind in kinds:
        if (kind, name) in DEFINED:
            return ref(kind, name)
    raise SystemExit(f"unresolvable reference {name!r} (tried kinds {kinds})")


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


class W:
    def __init__(self):
        self.buf = []
        self.depth = 0

    def line(self, s=""):
        self.buf.append(("    " * self.depth + s).rstrip() if s else "")

    def open(self, s):
        self.line(s)
        self.depth += 1

    def close(self, s="}"):
        self.depth -= 1
        self.line(s)

    def text(self):
        return "\n".join(self.buf).rstrip() + "\n"


def header(w, kind, fid, name, parent=None):
    if parent:
        w.open(f'{kind} {q(fid)} EXTENDS {q(parent)} {{')
    else:
        w.open(f'{kind} {q(fid)} {{')
    w.line(f'NAME {q(name)}')
    w.line(f'VERSION {q(VERSION)}')
    w.line(f'SPEC_VERSION {q(SPEC_VERSION)}')
    w.line(f'RELEASE_DATE {q(RELEASE_DATE)}')
    w.line()


def sep(w, title):
    w.line()
    w.line("# " + "=" * 68)
    w.line("# " + title)
    w.line("# " + "=" * 68)
    w.line()


# ------------------------------------------------------------------- inputs ---
data = json.load(open(os.path.join(ROOT, "source-data.json")))
cards = json.load(open(os.path.join(ROOT, "cards.json")))
proc = json.load(open(os.path.join(ROOT, "procedures.json")))

os.makedirs(OUT, exist_ok=True)
written = []


def emit(fname, text):
    path = os.path.join(OUT, fname)
    with open(path, "w") as f:
        f.write(text)
    written.append(fname)


# card entity names: deck-qualified, copy-numbered where the deck prints
# the same prompt twice. The verbatim prompt lives in ^"Prompt".
card_names = []
_counts = {}
for c in cards:
    key = (c["deck"], c["prompt"])
    _counts[key] = _counts.get(key, 0) + 1
    n = _counts[key]
    base = f'{c["deck"]}: {c["prompt"]}'
    card_names.append(base if n == 1 else f"{base} (copy {n})")

deck_cards = {}
for c, nm in zip(cards, card_names):
    deck_cards.setdefault(c["deck"], []).append((nm, c))

# =============================================================== core base ===
w = W()
header(w, "BASE", BASE_ID,
       "City of Winter — core components, characters, and vocabulary")
w.line("# City of Winter (Heart of the Deernicorn, 2022), Rules V2, by Ross Cowman.")
w.line("# A GM-less story game about a family migrating from the Riverlands to the")
w.line("# City of Winter. This file defines the component and actor types that the")
w.line("# card, procedure and map files build on. Rules prose is verbatim.")

sep(w, "ACTOR HIERARCHY")
w.open(f'#{decl("actor", "Entity")} ACTOR "Entity" DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Name")} STRING REQUIRED')
w.line(f'{caret("Pronouns")} STRING')
w.close()
w.close()
w.line()

w.open(f'#{decl("actor", "Main Character")} ACTOR "Main Character" DEF {{')
w.line(f'EXTENDS {ref("actor", "Entity")}')
w.line("# A player's character, tracked on a Notecard (also called a Character Card).")
w.open("PROPERTIES {")
w.line(f'{caret("Marks of Age")} INTEGER MIN 0 MAX 6 DEFAULT 0')
w.line(f'{caret("Crossed-off Marks")} INTEGER MIN 0 MAX 6 DEFAULT 0')
w.line(f'{caret("City Marks")} INTEGER MIN 0 DEFAULT 0')
w.line(f'{caret("Crossed-off City Marks")} INTEGER MIN 0 DEFAULT 0')
w.line(f'{caret("Bonds")} LIST OF {caret("Bond")}')
w.line(f'{caret("Hand")} LIST OF {caret("Tradition Card")}')
w.line(f'{caret("Token")} {caret("Token")}')
w.line(f'{caret("Home")} {caret("Location")}')
w.line(f'{caret("Is Memory")} BOOLEAN DEFAULT false')
w.close()
w.close()
w.line()

w.open(f'#{decl("actor", "Side Character")} ACTOR "Side Character" DEF {{')
w.line(f'EXTENDS {ref("actor", "Entity")}')
w.line("# Created by taking any unused name from a Banner in play.")
w.open("PROPERTIES {")
w.line(f'{caret("Marks of Age")} INTEGER MIN 0 MAX 6 DEFAULT 0')
w.line(f'{caret("From Banner")} {caret("Tradition Banner")}')
w.close()
w.close()
w.line()

w.open(f'#{decl("actor", "Memory")} ACTOR "Memory" DEF {{')
w.line(f'EXTENDS {ref("actor", "Main Character")}')
w.line(f'DESCRIPTION {q("For the rest of the Chapter you will play as our family\'s memory of your character.\\n\\nA character who is a Memory does not participate in the Migration Scene procedure or in another character\'s Share a Tradition Scene.\\n\\nOtherwise, continue to participate fully in other players\' turns, offering suggestions and playing side characters, or roleplaying a tradition in a Witness a Tradition Scene, as normal.\\n\\nOn your turn, follow the Memory Scene procedure.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Is Memory")} BOOLEAN true')
w.close()
w.close()
w.line()

w.open(f'#{decl("actor", "Facilitator")} ACTOR "Facilitator" DEF {{')
w.line(f'EXTENDS {ref("actor", "Entity")}')
w.line("# City of Winter has no GM; a facilitator is whoever teaches the rules.")
w.close()
w.line()

sep(w, "PLAY STRUCTURE")
for nm, desc in [
    ("Session", "A single sitting of play. A game can last just one session (a one-shot) or run as an ongoing campaign lasting many sessions."),
    ("Chapter", "City of Winter is played in Chapters. During a Chapter, we take turns leading the group in a Tradition Scene. To start a new Chapter, decide who will go first then continue taking turns, clockwise."),
    ("Campaign", "A Campaign is the fullest way to experience City of Winter. You can start a Campaign by planning in advance, or evolve a one-shot into a Campaign by simply playing more Sessions."),
]:
    w.open(f'#{decl("structure", nm)} {caret(nm)} DEF {{')
    w.line(f'DESCRIPTION {q(desc)}')
    w.close()
    w.line()

sep(w, "COMPONENTS")
components = [
    ("River Scroll", "A map of connected Locations we unroll as we migrate from the Riverlands on the left, to the City of Winter at the far end of the scroll."),
    ("City Map", "When we arrive at the City of Winter, the River Scroll is replaced by the City Map that shows its numerous Locations and Transit System in detail."),
    ("Token", "Double-sided Tokens represent our characters in the story."),
    ("Die", "City of Winter uses a single, six-sided Die."),
    ("X-Card", "A safety tool used to address anything causing discomfort or spoiling our fun in our game."),
    ("Wandering Borough Card", "An additional location that is used with the City Map."),
    ("Notecard", "Each player needs a Notecard (or small piece of paper) to track information about their character. This is also called a Character Card."),
    ("Writing Utensils", "Everyone will need something to write with. Pencils, pens, colored markers are all fine."),
]
for nm, desc in components:
    w.open(f'#{decl("component", nm)} {caret(nm)} DEF {{')
    w.line(f'DESCRIPTION {q(desc)}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Page")} INTEGER 8')
    w.close()
    w.close()
    w.line()

sep(w, "TRADITIONS — decks, icons, cards, banners")
w.open(f'#{decl("type", "Tradition Icon Shape")} {caret("Tradition Icon Shape")} DEF {{')
w.line('# Every Tradition Deck icon is drawn inside one of these border shapes. A')
w.line('# blank icon of a given shape lets the drawing player choose any deck of')
w.line('# that shape. The Umbra icon has no border shape.')
w.line('ENUM ["circle", "sun", "diamond", "umbra"]')
w.close()
w.line()

w.open(f'#{decl("type", "Tradition Deck")} {caret("Tradition Deck")} DEF {{')
w.line(f'DESCRIPTION {q("The Tradition Cards are separated into 11 Tradition Decks. Every card has an icon on the back showing which deck it belongs to.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Shape")} {caret("Tradition Icon Shape")} REQUIRED')
w.line(f'{caret("Region")} ENUM ["Riverlands", "City"]')
w.line(f'{caret("Card Count")} INTEGER MIN 0')
w.line(f'{caret("Banner")} {caret("Tradition Banner")}')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Tradition Card")} {caret("Tradition Card")} DEF {{')
w.line('# The prompt printed on the card face, verbatim, plus the deck it belongs to.')
w.open("PROPERTIES {")
w.line(f'{caret("Prompt")} STRING REQUIRED')
w.line(f'{caret("Deck")} {caret("Tradition Deck")} REQUIRED')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Tradition Banner")} {caret("Tradition Banner")} DEF {{')
w.line(f'DESCRIPTION {q("Each Tradition Deck has a Banner that goes with it. These Banners contain name-lists and are also used as dividers to keep the Tradition Decks organized.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Names")} LIST OF STRING')
w.line(f'{caret("Open Prompt")} STRING')
w.line(f'{caret("Deck")} {caret("Tradition Deck")}')
w.close()
w.close()
w.line()

# shape families
w.open(f'#{decl("type", "Shape Family")} {caret("Shape Family")} DEF {{')
w.line('# Which decks a blank icon of each shape may be drawn from (rules p.38).')
w.close()
w.line()
for shape, decks in data["shapeFamilies"].items():
    nm = f"Blank {shape} icon"
    w.open(f'#{decl("shapefamily", nm)} {caret(nm)} DEF {{')
    w.line(f'EXTENDS {ref("type", "Shape Family")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Shape")} {caret("Tradition Icon Shape")} {q(shape)}')
    w.line(f'{caret("Decks")} LIST OF {caret("Tradition Deck")} [ ' +
           ", ".join(ref("deck", d) for d in decks) + " ]")
    w.close()
    w.close()
    w.line()

# banners first (decks reference them)
sep(w, "TRADITION BANNERS")
for d in data["decks"]:
    bn = d["banner"] + " Banner"
    w.open(f'#{decl("banner", bn)} {caret(bn)} DEF {{')
    w.line(f'EXTENDS {ref("type", "Tradition Banner")}')
    w.open("PROPERTIES {")
    if d["names"]:
        w.line(f'{caret("Names")} LIST OF STRING [ ' + ", ".join(q(n) for n in d["names"]) + " ]")
    else:
        w.line(f'{caret("Names")} LIST OF STRING [] FIAT "The Umbra Banner carries no name-list; the Umbra is not a people."')
    if d["namePrompt"]:
        w.line(f'{caret("Open Prompt")} STRING {q(d["namePrompt"])}')
    w.line(f'{caret("Deck")} {caret("Tradition Deck")} {ref("deck", d["name"])}')
    w.close()
    w.close()
    w.line()

fam = "Our Family Banner"
w.open(f'#{decl("banner", fam)} {caret(fam)} DEF {{')
w.line(f'EXTENDS {ref("type", "Tradition Banner")}')
w.line(f'DESCRIPTION {q("Store character cards and held traditions here between sessions.")}')
w.line('FIAT "A storage divider printed with the Banners; it carries no name-list and belongs to no Tradition Deck."')
w.close()
w.line()

sep(w, "TRADITION DECKS")
for d in data["decks"]:
    w.open(f'#{decl("deck", d["name"])} {caret(d["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Tradition Deck")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Shape")} {caret("Tradition Icon Shape")} {q(d["shape"])}')
    w.line(f'{caret("Region")} ENUM {q(d["region"])}')
    w.line(f'{caret("Card Count")} INTEGER {len(deck_cards[d["name"]])}')
    w.line(f'{caret("Banner")} {caret("Tradition Banner")} {ref("banner", d["banner"] + " Banner")}')
    w.close()
    w.close()
    w.line()

sep(w, "MARKS OF AGE & AGE TIERS")
w.open(f'#{decl("type", "Marks of Age")} {caret("Marks of Age")} DEF {{')
w.line(f'DESCRIPTION {q("We track our character\'s age by drawing circles called Marks of Age. There is no direct correlation between the number of Marks and the exact age of a character in years. We can decide for ourselves what they mean as we play.")}')
w.line("INTEGER MIN 0 MAX 6")
w.close()
w.line()

w.open(f'#{decl("type", "City Marks")} {caret("City Marks")} DEF {{')
w.line(f'DESCRIPTION {q("If our family\'s Home is in the City of Winter, we mark age with diamond-shaped City Marks instead of a circles. City Marks represent both your age, and how much you\'ve adapted to life in the city.\\n\\nIf an Elder has both regular and City Marks, they may cross off either when we Mark Age.")}')
w.line("INTEGER MIN 0")
w.close()
w.line()

w.open(f'#{decl("type", "Age Tier")} {caret("Age Tier")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Marks")} LIST OF STRING')
w.line(f'{caret("Marks Text")} STRING')
w.close()
w.close()
w.line()

for t in data["ageTiers"]:
    w.open(f'#{decl("agetier", t["name"])} {caret(t["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Age Tier")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Marks")} LIST OF STRING [ ' + ", ".join(q(str(m)) for m in t["marks"]) + " ]")
    w.line(f'{caret("Marks Text")} STRING {q(t["marksText"])}')
    w.close()
    w.close()
    w.line()

sep(w, "BONDS")
w.open(f'#{decl("type", "Bond")} {caret("Bond")} DEF {{')
w.line(f'DESCRIPTION {q("Our characters begin with two Bonds. A Bond represents an important relationship that helps to define your character\'s role in our family.\\n\\nTo create a Bond, combine a prompt from the Bonds List with the name of another character and write it on your Notecard.\\n\\nThe prompts are organized by age, and you may only choose prompts at your age or younger.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Prompt")} STRING REQUIRED')
w.line(f'{caret("Subject")} STRING REQUIRED')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Bonds List")} {caret("Bonds List")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Tier")} STRING REQUIRED')
w.line(f'{caret("Kind")} ENUM ["Bonds", "Memory Bonds", "City Bonds"]')
w.line(f'{caret("Prompts")} LIST OF STRING')
w.line(f'{caret("Open Prompt")} STRING')
w.close()
w.close()
w.line()

for b in data["bondLists"]:
    nm = f'{b["tier"]} {b["kind"]}'
    w.open(f'#{decl("bondlist", nm)} {caret(nm)} DEF {{')
    w.line(f'EXTENDS {ref("type", "Bonds List")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Tier")} STRING {q(b["tier"])}')
    w.line(f'{caret("Kind")} ENUM {q(b["kind"])}')
    w.line(f'{caret("Prompts")} LIST OF STRING [ ' + ", ".join(q(p) for p in b["prompts"]) + " ]")
    w.line(f'{caret("Open Prompt")} STRING {q(b["openPrompt"])}')
    w.close()
    w.close()
    w.line()

sep(w, "MAP VOCABULARY")
w.open(f'#{decl("type", "Location")} {caret("Location")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Region")} ENUM ["Riverlands", "City"]')
w.line(f'{caret("Page")} INTEGER')
w.line(f'{caret("Local Traditions")} LIST OF STRING')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Scene")} {caret("Scene")} DEF {{')
w.line(f'DESCRIPTION {q("Each location has several prompts called Scenes. On your turn, move your token to a scene at our family\'s current location. You may choose any scene, even if another player\'s token is already there.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Prompt")} STRING REQUIRED')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Transit Line")} {caret("Transit Line")} DEF {{')
w.line(f'DESCRIPTION {q("Every Location has a Transit Station that is connected to one or more Transit Lines. On your turn, whenever you Choose a Scene, you have the option to Travel to another Location.")}')
w.open("PROPERTIES {")
w.line(f'{caret("Stations")} LIST OF STRING')
w.line(f'{caret("Borough Die Result")} INTEGER MIN 1 MAX 6')
w.close()
w.close()
w.line()

sep(w, "SCENE OPTIONS")
# The three scene *procedures* (Tradition / Migration / Memory) are defined once,
# in the procedures file, where their full step lists live. Only the two
# per-scene choices are typed here.
scene_types = [
    ("Share a Tradition", "Play a card from your hand, face down onto the table. (You must have at least one card in hand to choose this option.)"),
    ("Witness a Tradition", "Draw a card from either the Umbra Deck or the Local Tradition Deck (indicated by the icon next to our current location) and without looking at it, give it to another player who privately reads the prompt on the card."),
]
for nm, desc in scene_types:
    w.open(f'#{decl("scenetype", nm)} {caret(nm)} DEF {{')
    w.line(f'DESCRIPTION {q(desc)}')
    w.close()
    w.line()

sep(w, "PROCEDURE & RULE TYPES")
w.open(f'#{decl("type", "Procedure")} {caret("Procedure")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Phase")} STRING')
w.line(f'{caret("Page")} INTEGER')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Rule")} {caret("Rule")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Phase")} STRING')
w.line(f'{caret("Page")} INTEGER')
w.close()
w.close()
w.line()

w.open(f'#{decl("type", "Step")} {caret("Step")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Order")} INTEGER MIN 1')
w.close()
w.close()
w.line()

w.close()
emit("cityofwinter-0.5-core-base.ttrpg", w.text())

# ================================================================== cards ====
for d in data["decks"]:
    dn = d["name"]
    w = W()
    fid = "CityOfWinter_Cards_" + re.sub(r"[^A-Za-z0-9]", "", dn)
    header(w, "EXTENSION", fid,
           f"City of Winter — the {dn} Tradition Deck", BASE_ID)
    w.line(f'# {len(deck_cards[dn])} cards. Prompts are verbatim from the card faces;')
    w.line('# deck membership is taken from the icon printed on each card back.')
    w.line()
    for nm, c in deck_cards[dn]:
        w.open(f'#{decl("card", nm)} {caret(nm)} DEF {{')
        w.line(f'EXTENDS {ref("type", "Tradition Card")}')
        w.open("PROPERTIES {")
        w.line(f'{caret("Prompt")} STRING {q(c["prompt"])}')
        w.line(f'{caret("Deck")} {caret("Tradition Deck")} {ref("deck", dn)}')
        w.close()
        w.close()
        w.line()
    w.close()
    emit(f"cityofwinter-0.5-cards-{slug(dn)}.ttrpg", w.text())

# ============================================================== procedures ===
w = W()
header(w, "EXTENSION", "CityOfWinter_Procedures",
       "City of Winter — procedures, rules, guidance and variants", BASE_ID)
w.line("# Every DESCRIPTION and TEXT below is the rulebook's own wording, verbatim.")

sep(w, "PROCEDURES")


def emit_steps(w, steps, kind_prefix):
    w.open("STEPS {")
    for s in steps:
        nm = f'{kind_prefix}: {s["name"]}'
        w.open(f'#{decl("step", nm)} {caret(nm)} DEF {{')
        w.line(f'EXTENDS {ref("type", "Step")}')
        w.open("PROPERTIES {")
        w.line(f'{caret("Order")} INTEGER {s["n"]}')
        w.close()
        if s.get("instruction"):
            w.line(f'DESCRIPTION {q(s["instruction"])}')
        if s.get("teaching"):
            w.line(f'TEACHING_TEXT {q(s["teaching"])}')
        if s.get("followUp"):
            w.line(f'FOLLOW_UP {q(s["followUp"])}')
        if s.get("teachingTwo"):
            w.line(f'TEACHING_TEXT {q(s["teachingTwo"])}')
        for o in s.get("options", []):
            w.open(f'OPTION {caret(o["name"])} {{')
            w.line(f'DESCRIPTION {q(o["instruction"])}')
            w.close()
        if s.get("substeps"):
            emit_steps(w, s["substeps"], nm)
        w.close()
    w.close()


for p in proc["procedures"]:
    w.open(f'#{decl("procedure", p["name"])} {caret(p["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Procedure")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Phase")} STRING {q(p["phase"])}')
    w.line(f'{caret("Page")} INTEGER {p["page"]}')
    w.close()
    if p.get("instruction"):
        w.line(f'DESCRIPTION {q(p["instruction"])}')
    emit_steps(w, p["steps"], p["name"])
    w.close()
    w.line()

sep(w, "RULES")
for r in proc["rules"]:
    w.open(f'#{decl("rule", r["name"])} {caret(r["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Rule")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Phase")} STRING {q(r["phase"])}')
    w.line(f'{caret("Page")} INTEGER {r["page"]}')
    w.close()
    w.line(f'DESCRIPTION {q(r["text"])}')
    w.close()
    w.line()

sep(w, "ASK FATE — outcome table")
w.open(f'#{decl("table", "Fate Answers")} {caret("Fate Answers")} DEF {{')
w.line(f'EXTENDS {ref("type", "Rule")}')
w.open("PROPERTIES {")
w.line(f'{caret("Phase")} STRING "Design Notes"')
w.line(f'{caret("Page")} INTEGER 47')
w.close()
w.open("OUTCOMES {")
for o in data["askFate"]:
    w.open(f'{caret(o["outcome"])} DEF {{')
    w.line(f'{caret("Roll")} STRING {q(o["roll"])}')
    w.line(f'{caret("Definition")} STRING {q(o["definition"])}')
    w.close()
w.close()
w.close()
w.line()

sep(w, "SOLO PLAY — journal modules")
for m in proc["soloModules"]:
    w.open(f'#{decl("solomodule", m["name"])} {caret(m["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Rule")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Phase")} STRING "Design Notes"')
    w.line(f'{caret("Page")} INTEGER {m["page"]}')
    w.close()
    w.line(f'DESCRIPTION {q(m["text"])}')
    w.close()
    w.line()

sep(w, "OPTIONAL & VARIANT RULES")
for o in proc["optionalRules"]:
    w.open(f'#{decl("optional", o["name"])} {caret(o["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Rule")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Phase")} STRING {q(o["phase"])}')
    w.line(f'{caret("Page")} INTEGER {o["page"]}')
    w.close()
    w.open("OPTIONAL {")
    w.line(f'DEFAULT {o["default"]}')
    w.line(f'SCOPE {o["scope"]}')
    w.line(f'TEXT {q(o["optionalText"])}')
    w.close()
    w.line(f'DESCRIPTION {q(o["text"])}')
    w.close()
    w.line()

sep(w, "STARTING IN THE CITY — home & tradition options")
for opt in data["cityStartingOptions"]:
    nm = "Starting Option: " + opt["text"]
    w.open(f'#{decl("startopt", nm)} {caret(nm)} DEF {{')
    w.open("PROPERTIES {")
    w.line(f'{caret("Tradition")} {caret("Tradition Deck")} {ref("deck", opt["tradition"])}')
    w.line(f'{caret("Home")} STRING {q(opt["home"])}')
    w.line(f'{caret("As Printed")} STRING {q(opt["text"])}')
    w.close()
    w.close()
    w.line()

sep(w, "THE RULEBOOK’S OWN OUTLINE")
w.line("# The book's Table of Contents, as printed: every section it names, so a")
w.line("# consumer (and the coverage gate) can see the source's own structure.")
w.line()
w.open(f'#{decl("type", "Rulebook Section")} {caret("Rulebook Section")} DEF {{')
w.open("PROPERTIES {")
w.line(f'{caret("Page")} INTEGER')
w.close()
w.close()
w.line()
for sec in proc["sections"]:
    nm = "Section: " + sec["title"]
    w.open(f'#{decl("section", nm)} {caret(nm)} DEF {{')
    w.line(f'EXTENDS {ref("type", "Rulebook Section")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Page")} INTEGER {sec["page"]}')
    w.close()
    w.close()
    w.line()

sep(w, "GUIDANCE — the rulebook's sidebars and advice")
w.open("GUIDANCE {")
for g in proc["guidance"]:
    w.open(f'ENTRY {caret(g["label"])} #{h("guidance", g["label"])} {{')
    concerns = [resolve_ref(c, ("type", "structure", "actor", "component", "procedure",
                                "rule", "scenetype", "optional", "solomodule"))
                for c in g["concerns"]]
    w.line("CONCERNS [ " + ", ".join(concerns) + " ]")
    w.line("TOPICS [ " + ", ".join(q(t) for t in g["topics"]) + " ]")
    w.line(f'TEXT {q(g["text"])}')
    w.close()
w.close()
w.line()

sep(w, "HOOKS — narrative situations with a mechanical consequence")
w.open("HOOKS {")
for i, hk in enumerate(proc["hooks"]):
    w.open(f'HOOK #{h("hook", hk["when"])} {{')
    w.line(f'FORMALITY {hk["formality"]}')
    w.line(f'WHEN {q(hk["when"])}')
    if hk.get("trigger"):
        w.line("TRIGGER { ANY [ " + ", ".join(q(t) for t in hk["trigger"]) + " ] }")
    thens = [resolve_ref(t, ("procedure", "rule", "type", "scenetype", "optional"))
             for t in hk["then"]]
    w.line("THEN [ " + ", ".join(thens) + " ]")
    w.close()
w.close()

w.close()
emit("cityofwinter-0.5-procedures.ttrpg", w.text())


# =================================================================== maps ====
def tradition_refs(trads):
    out = []
    for t in trads:
        if t.startswith("ANY:"):
            out.append(ref("shapefamily", f"Blank {t[4:]} icon"))
        else:
            out.append(ref("deck", t))
    return out


def emit_location(w, loc, region):
    name = loc["name"]
    w.open(f'LOCATION {caret(name)} #{decl("location", name)} {{')
    tags = [region.lower()]
    if loc.get("startingHome"):
        tags.append("starting-home")
    if loc.get("isArrival"):
        tags.append("city-entrance")
    if loc.get("route"):
        tags.append("route-" + slug(loc["route"]))
    w.line("TAGS [ " + ", ".join(q(t) for t in tags) + " ]")
    w.line(f'ATLAS_PAGE {loc["page"]}')
    if loc["traditions"]:
        w.line("LOCAL_TRADITIONS [ " + ", ".join(tradition_refs(loc["traditions"])) + " ]")
    if loc.get("connects"):
        w.line("CONNECTS_TO [ " + ", ".join(q(c) for c in loc["connects"]) + " ]")
    if loc.get("entrances"):
        w.open("ENTRANCES {")
        for e in loc["entrances"]:
            w.open(f'ENTRANCE {caret(e["text"])} {{')
            w.line(f'DESTINATION STRING {q(e["target"])}')
            w.close()
        w.close()
    if loc["scenes"]:
        w.open("SCENES {")
        for s in loc["scenes"]:
            w.open(f'#{decl("scene", s)} {caret(s)} DEF {{')
            w.line(f'EXTENDS {ref("type", "Scene")}')
            w.open("PROPERTIES {")
            w.line(f'{caret("Prompt")} STRING {q(s)}')
            w.close()
            w.close()
        w.close()
    w.close()
    w.line()


# --- Riverlands frame
w = W()
header(w, "FRAME", "CityOfWinter_Riverlands",
       "City of Winter — the Riverlands (River Scroll / Atlas)")
w.line(f'DEPENDS_ON {q(BASE_ID)}')
w.line()
w.open("THEMES {")
w.line(q("The Umbra is coming, and the Riverlands are no longer safe. Our family must flee to the City of Winter, to find another home."))
w.line(q("Of Tradition & migration — what a family carries, saves, and leaves behind"))
w.close()
w.line()
w.line("# Locations, scene prompts, local traditions and connections are as printed")
w.line("# in the Atlas Edition (CoW-Atlas.pdf, pp.2, 7-17).")
w.line()
for loc in data["riverlands"]:
    emit_location(w, loc, "Riverlands")
w.close()
emit("cityofwinter-0.5-riverlands.frame", w.text())

# --- City frame
w = W()
header(w, "FRAME", "CityOfWinter_City",
       "City of Winter — the City (City Map / Atlas), transit and the Wandering Borough")
w.line(f'DEPENDS_ON {q(BASE_ID)}')
w.line()
w.open("THEMES {")
w.line(q("Arrival, asylum, and adapting to a city that is not yet home"))
w.line(q("Traditions that combine into something new"))
w.close()
w.line()
for loc in data["city"]:
    emit_location(w, loc, "City")

wb = data["wanderingBorough"]
w.open(f'LOCATION {caret(wb["name"])} #{decl("location", wb["name"])} {{')
w.line('TAGS [ "city", "wandering-borough" ]')
w.line(f'PRINTED_TITLE {q(wb["cardTitle"])}')
w.line(f'RULES_SPELLING {q(wb["rulesSpelling"])}')
w.line("LOCAL_TRADITIONS [ " + ", ".join(tradition_refs(wb["traditions"])) + " ]")
w.open("SCENES {")
for s in wb["scenes"]:
    w.open(f'#{decl("scene", s)} {caret(s)} DEF {{')
    w.line(f'EXTENDS {ref("type", "Scene")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Prompt")} STRING {q(s)}')
    w.close()
    w.close()
w.close()
w.close()
w.line()

sep(w, "TRANSIT LINES")
for tl in data["transitLines"]:
    w.open(f'#{decl("line", tl["name"])} {caret(tl["name"])} DEF {{')
    w.line(f'EXTENDS {ref("type", "Transit Line")}')
    w.open("PROPERTIES {")
    w.line(f'{caret("Stations")} LIST OF STRING [ ' + ", ".join(q(s) for s in tl["stations"]) + " ]")
    if tl["die"]:
        w.line(f'{caret("Borough Die Result")} INTEGER {tl["die"]}')
    w.close()
    w.close()
    w.line()

sep(w, "TRANSIT DISTANCE TABLE (Atlas p.40, reproduced as printed)")
w.open(f'#{decl("table", "Transit Distance")} {caret("Transit Distance")} DEF {{')
w.line(f'DESCRIPTION {q("(# of Stations + Line Transfers between Locations.)")}')
w.line("COLUMNS [ " + ", ".join(q(c) for c in data["transitDistanceOrder"]) + " ]")
w.open("ROWS {")
for rname in data["transitDistanceOrder"]:
    row = data["transitDistance"][rname]
    w.line(f'ROW {q(rname)} [ ' + ", ".join(q(v) for v in row) + " ]")
w.close()
w.close()
w.line()

w.close()
emit("cityofwinter-0.5-city.frame", w.text())

# =================================================================== lore ====
LORE = {
    "cityofwinter-0.5-what-this-is.lore": """# What This Is

City of Winter is a story game where we follow the journey of a family as they migrate from
their home in the Riverlands to live in the City of Winter.

## This is a Story Game

City of Winter gives us elegant rules, evocative prompts, and inspiring images to help us create
a story as we play to explore a world of our shared imagination. It is infinitely replayable, and
no two games will ever be the same.

## A family saga

In City of Winter, we tell a story that spans generations. Over chapters of play, our characters
will grow old and pass into memory as new generations are born.

## Of Tradition & migration

Play centers around the exploration of tradition. As we journey through the world of City of
Winter, we will encounter varied traditions of the City, represented by Tradition Cards. As our
characters change and grow, the traditions they hold for our family change as well.

## In a world of fantasy

City of Winter takes place in a world of fantasy. Use this space to imagine, explore, and discover
new possibilities without the restrictions we find in our day-to-day lives.
""",

    "cityofwinter-0.5-scene-advice.lore": """# Scene Advice

Here are some best practices and different things to try out:

## Starting a scene

- Start with a physical description of the place, and build from there. "Gran's House is one of
  the oldest in River Town. It is built of stone that she quarried with her father long ago from
  the nearby mountains."
- Use taste, touch, or smell in your description. "The smell of fresh-ploughed earth hangs in
  the air."
- Ask other players to take on the role of a character or element of the environment. "We hear
  the crack of thunder as rain starts to fall. Could someone be in charge of describing the storm
  in this scene?"

## Leading a scene

- Ask another player what their character is doing "What is Apple up to this morning?"
- Start a conversation. "Clover finds Apple out tending the oxen and says, 'Hey Gran, can I skip
  my chores today and go to the river festival?'"
- Skip ahead to the interesting part. "Ok, after hours of brushing, we finally finish grooming
  the herd."
- Revisit something interesting that we skipped. "Wait, how exactly did you convince Gran to let
  you come to the festival? I want to see that conversation!"
- Start a go-around. "Lets go around the table and have everyone share one thing they see at the
  river festival."
- Scenes can be as long or as short as we like.
- Steal ideas from books, movies, or your life.
- When you feel stuck, ask for ideas. "My card says, 'what pride demands.' Does anyone have an
  idea what that could be?"

## Roleplaying a Character

- Describe your appearance. "Stone is a young woman with tangled black hair and black eyes."
- Describe your thoughts. "Zephyr is really excited for the harvest festival."
- Tell us what you want. "Zeal is wanting to cut a deal to get the Umbra to leave our family
  alone."
- Say what you do. "I climb up the side of the tower, and let myself in through a balcony."
- Keep secrets from characters, not from players. "That night, when everyone is sleeping, Zeal
  sneaks off to go meet with the Shadow Men."
- Voice different characters by varying the pitch, pace, and/or weight of your speech. Or just
  describe what a character's voice sounds like and use your normal speaking voice.
- Be respectful and don't mimic marginalized cultures.

## Roleplaying a local Tradition

- Reveal the Tradition directly through a Side-Character. "You see Old Grandma Juniper butchering
  an animal with what looks like a knife made from the jaw of an Ox." (Reveals: with a jawbone
  blade)
- Reveal the Tradition directly through a group of people. "When the soldiers return from battle,
  they organize laborers and begin the construction of a huge pyre in the town square. (Reveals:
  the victory pyre)
- Reveal the Tradition indirectly through the environment. "You see ashy remains of many
  cook-fires and trampled grass in the meadow surrounding a shrine of bones and flowers."
  (Reveals: the ritual of the field)

## Handling Story Conflict

- Play to lose. "Stone says, 'What do you mean Grandma? I'm not hiding anything!' Buuut it's
  super obvious that I'm lying!"
- Play to win. "Zeal brings his quarterstaff to bear, and soon the bullies are all either running
  away or on the ground crying!"
- Ask the group to decide. "So who do we think catches more fish, me or Zephyr?"
""",

    "cityofwinter-0.5-credits.lore": """# Credits

**Ross Cowman** — Game Design, Graphic Design, Layout, Writing, Textile Design

**Doug Keith** — Illustrations, Token Designs

## Deernicorn Staff

- Mads Bradley-Kurttila — Shipping Clerk, Press Operator
- Terri Cohlene — Game Designer, Editor
- Thistle Grey — Press Operator
- Miranda Holmes — Press Operator
- Amelia Miller — Press Operator, Crafter
- KC Monster — Manufacturing Manager, Textile Designer
- Jasper Pease — Press Manager, Graphic Designer, Product Designer
- Jude Wasserman — Game Developer, Editor, Marketing Director

## Design Consultants

Whitney Strix Beltrán, Campaign Coins, Ajit George, Mo Golden, Drew Henderson, Kira Magrann,
Hakan Seyalioglu, Robert Bruce

## Main Playtesters & Reviewers

Robert Bruce, Orion Canning, Tyrone Cawston, Alex Cooley, Stephanie Cheung, Annamyriah de Jong,
Rob Dean, Matthew Gagan, Clayton Grey, Liz Gorinsky, Christian Griffin, Yeonsoo Julian Kim,
The Lab - Toronto (Mutiny, Shaz, Marcie, and Richard), Harry Lee, Kira Magrann,
Stephanie Nudleman, Jessica Price, Jessie Rainbow, Kurt Refling, Hakan Seyalioglu,
John Stavropoulos, Nick Wedig, Katie Wright.

## Acknowledgments

**Land Acknowledgment.** The Heart of the Deernicorn workshop is located on the shores of
Steh-Chass named after the Steh-Chass Band of Indigenous people of the Squaxin Island Tribe who
have stewarded this land since time immemorial and who still inhabit the area today.
(https://squaxinisland.org)

**X-Card.** The X-Card was created by John Stavropoulos. For more information about the X-Card,
visit tinyurl.com/x-card-rpg.

**Bullet Journaling.** The method of journaling presented in the Solo Play section is adapted from
Ryder Carroll's "Bullet Journal" method.

---

City of Winter - Rules V2
Copyright 2022 Heart of the Deernicorn
All Rights Reserved
""",

    "cityofwinter-0.5-formatting-conventions.lore": """# Formatting Conventions

There are a couple of formatting conventions to be aware of:

**Normal Text.** Basic formatting, like this paragraph, contains general rules and instructions
needed to facilitate the game.

**Game terms.** Game terms and component names are capitalized. For example: Tradition Card,
River Scroll etc....

**Teaching Text.** "Teaching text in quotes is specifically for reading out loud at the table when
teaching the game. You'll mostly find this in the parts of the rules that are used for your
first-time playing City of Winter, and not so much later in the text."

**Procedures.** When the game asks you follow a procedure with multiple steps, those steps will be
numbered.

**Examples of play.** Examples of play are in italics. In scene examples, token icons and character
names are used to show who is acting. For simplicity's sake, character names are used for both the
character and for the player who is controlling that character. (Parenthesis signify player actions
like picking up a token, or rolling a die.)

**Side Notes.** Additional rules, clarifications, and tips are presented as boxed text.
""",

    "cityofwinter-0.5-design-notes.lore": """# Design Notes

> Over the last four years, I've explored many ways to play City of Winter.
>
> In this section, I've included some ideas that I think are interesting enough to share but don't
> recommend as part of the first-time experience. Try them as-is, or use them to inspire your own
> explorations.

The Design Notes section holds *Ask Fate*, *Solo Play*, *Starting in the City* and the *Umbra
Variations*. Their mechanical content is carried in the corpus as rules and `OPTIONAL` variants
(see `cityofwinter-0.5-procedures.ttrpg`); this file keeps the section's framing voice.

## Using the Atlas

This Atlas replaces the River Scroll and City Map components for City of Winter.

**Location Pages.** Each Location has a dedicated page in the Atlas. The Location page shows the
illustration, name, local tradition and scene prompts. Riverlands Locations also include the page
number of connected Locations.

**Riverlands Map.** This map shows how the Locations in the Riverlands are connected. Use it to
pick a destination during Family Migration.

**City Transit Map.** The City Transit Map shows how the City Locations are connected by Transit
Lines. When your Family Migrates, or when your wishes to Visit another Location, turn to this map
to see which Locations are availible.

**Travel Distance Table.** The Travel Distance Table is a quick reference guide to the shortest
Distance between any two City Locations. As a reminder, each Station and and Line transfer adds 1
to the total distance.
""",
}
for fn, body in LORE.items():
    emit(fn, smarten(body))

# ============================================================= sources.json ==
sources = {
    "system": "cityofwinter",
    "edition": "cityofwinter",
    "contentVersion": VERSION,
    "specVersion": SPEC_VERSION,
    "title": "City of Winter",
    "publisher": "Heart of the Deernicorn",
    "designer": "Ross Cowman",
    "year": 2022,
    "sourceDocuments": [
        {"file": "CoW-Instructions.pdf", "title": "City of Winter — Rules V2", "pages": 31},
        {"file": "CoW-Atlas.pdf", "title": "City of Winter — Atlas Edition", "pages": 40},
        {"file": "CoW-Cards-Gutterfold.pdf", "title": "Tradition Cards (gutterfold print-and-play)", "pages": 83},
        {"file": "CoW-Cards-Banners-PnP-v1.pdf", "title": "Tradition Banners (print-and-play)", "pages": 3},
        {"file": "CoW-VTT-Photos/CoW-TraditionCards.pdf", "title": "Tradition Cards (VTT photos)", "pages": 250},
        {"file": "CoW-VTT-Photos/CoW-Banners-Burrough-Color.pdf", "title": "Banners and Wandering Borough (colour)", "pages": 10},
    ],
    "files": sorted(written),
    "generatedBy": "build/gen_corpus.py",
    "sourceAnomalies": data["sourceAnomalies"],
}
with open(os.path.join(REPO, "sources.json"), "w") as f:
    json.dump(sources, f, indent=2)
    f.write("\n")

# ================================================== the web app's data feed ==
# Emitted in the same pass, from the same in-memory content as the DSL, so the
# two cannot disagree. `build/check_feed.py` gates that agreement by reading the
# facts back out of the emitted .ttrpg/.frame text.
def tradition_names(trads):
    return ["ANY:" + t[4:] if t.startswith("ANY:") else t for t in trads]


def loc_json(loc, region):
    return {
        "name": loc["name"], "region": region, "page": loc["page"],
        "traditions": tradition_names(loc["traditions"]),
        "scenes": list(loc["scenes"]),
        "connects": list(loc.get("connects", [])),
        "entrances": loc.get("entrances", []),
        "startingHome": bool(loc.get("startingHome")),
        "isArrival": bool(loc.get("isArrival")),
        "route": loc.get("route"),
    }


feed = {
    "meta": {
        "title": "City of Winter", "publisher": "Heart of the Deernicorn",
        "designer": "Ross Cowman", "year": 2022,
        "contentVersion": VERSION, "specVersion": SPEC_VERSION,
        "generatedFrom": "titterpig-dsl-city-of-winter/0.5",
    },
    "decks": [
        {"name": d["name"], "shape": d["shape"], "region": d["region"],
         "banner": d["banner"], "cardCount": len(deck_cards[d["name"]]),
         "namePrompt": d["namePrompt"], "names": d["names"]}
        for d in data["decks"]
    ],
    "shapeFamilies": data["shapeFamilies"],
    "cards": [
        {"id": h("card", nm), "name": nm, "prompt": c["prompt"], "deck": c["deck"],
         "isBoroughWanders": c["borough"]}
        for d in data["decks"] for nm, c in deck_cards[d["name"]]
    ],
    "ageTiers": data["ageTiers"],
    "bondLists": data["bondLists"],
    "riverlands": [loc_json(l, "Riverlands") for l in data["riverlands"]],
    "city": [loc_json(l, "City") for l in data["city"]],
    "wanderingBorough": {
        "name": data["wanderingBorough"]["name"],
        "printedTitle": data["wanderingBorough"]["cardTitle"],
        "region": "City",
        "traditions": tradition_names(data["wanderingBorough"]["traditions"]),
        "scenes": list(data["wanderingBorough"]["scenes"]),
    },
    "transitLines": data["transitLines"],
    "transitDistance": {"order": data["transitDistanceOrder"],
                        "rows": data["transitDistance"]},
    "cityStartingOptions": data["cityStartingOptions"],
    "askFate": data["askFate"],
    "procedures": proc["procedures"],
    "rules": proc["rules"],
    "optionalRules": proc["optionalRules"],
    "soloModules": proc["soloModules"],
    "guidance": proc["guidance"],
    "hooks": proc["hooks"],
    "sections": proc["sections"],
    "lore": [{"file": fn, "title": smarten(body).lstrip().split("\n", 1)[0].lstrip("# ").strip(),
              "markdown": smarten(body)} for fn, body in LORE.items()],
    "sourceAnomalies": data["sourceAnomalies"],
}
FEED = os.path.abspath(os.path.join(REPO, "..", "web", "data", "cow.json"))
os.makedirs(os.path.dirname(FEED), exist_ok=True)
with open(FEED, "w") as f:
    json.dump(feed, f, indent=1, ensure_ascii=False)
    f.write("\n")

print(f"wrote {len(written)} corpus files to 0.5/ and sources.json")
for fn in sorted(written):
    print("  ", fn)
print(f"wrote app data feed: {FEED}")
