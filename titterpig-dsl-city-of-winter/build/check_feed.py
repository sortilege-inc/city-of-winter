#!/usr/bin/env python3
"""Gate: the web app's JSON feed must agree with the DSL corpus.

The feed and the corpus are emitted in one pass from the same content, so they
start out identical — this reads the enumerable facts back out of the *emitted
DSL text* and compares them with the feed, so that any future divergence (an
edited corpus file, a changed emitter) fails loudly instead of silently shipping
a stale app.

  usage: python3 build/check_feed.py
"""
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(ROOT)
CORPUS = os.path.join(REPO, "0.5")
FEED = os.path.abspath(os.path.join(REPO, "..", "web", "data", "cow.json"))

if not os.path.exists(FEED):
    sys.exit(f"feed missing: {FEED} — run build/gen_corpus.py")
feed = json.load(open(FEED, encoding="utf-8"))

corpus = {}
for fn in sorted(os.listdir(CORPUS)):
    if fn.endswith((".ttrpg", ".frame")):
        corpus[fn] = open(os.path.join(CORPUS, fn), encoding="utf-8").read()
ALL = "\n".join(corpus.values())

problems = []


def check(label, got, want):
    if got != want:
        problems.append(f"{label}: corpus has {want!r}, feed has {got!r}")


# --- cards: one DEF per card, per deck file -----------------------------------
for deck in feed["decks"]:
    fn = "cityofwinter-0.5-cards-" + re.sub(r"[^a-z0-9]+", "-", deck["name"].lower()).strip("-") + ".ttrpg"
    if fn not in corpus:
        problems.append(f"missing deck file {fn}")
        continue
    dsl_cards = re.findall(r'^\s*#\S+ \^"([^"]+)" DEF', corpus[fn], re.M)
    feed_cards = [c["name"] for c in feed["cards"] if c["deck"] == deck["name"]]
    check(f"{deck['name']} card count", len(feed_cards), len(dsl_cards))
    check(f"{deck['name']} card names", sorted(feed_cards), sorted(dsl_cards))
    check(f"{deck['name']} declared Card Count", deck["cardCount"], len(dsl_cards))

check("total cards", len(feed["cards"]),
      len(re.findall(r'EXTENDS #\S+ \^"Tradition Card"', ALL)))

# --- locations and scenes -----------------------------------------------------
for key, fn in (("riverlands", "cityofwinter-0.5-riverlands.frame"),
                ("city", "cityofwinter-0.5-city.frame")):
    text = corpus[fn]
    dsl_locs = re.findall(r'^\s*LOCATION \^"([^"]+)"', text, re.M)
    feed_locs = [l["name"] for l in feed[key]]
    if key == "city":
        feed_locs = feed_locs + [feed["wanderingBorough"]["name"]]
    check(f"{key} locations", feed_locs, dsl_locs)

dsl_scenes = re.findall(r'EXTENDS #\S+ \^"Scene"', ALL)
feed_scenes = sum(len(l["scenes"]) for l in feed["riverlands"] + feed["city"])
feed_scenes += len(feed["wanderingBorough"]["scenes"])
check("scene count", feed_scenes, len(dsl_scenes))

# --- transit ------------------------------------------------------------------
dsl_lines = re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Transit Line"',
                       corpus["cityofwinter-0.5-city.frame"], re.M)
check("transit lines", [t["name"] for t in feed["transitLines"]], dsl_lines)

# the city frame carries the printed table and, after it, the derived supplement
city = corpus["cityofwinter-0.5-city.frame"]
split = city.index('TRANSIT DISTANCE — WINTERMOUNT') if 'TRANSIT DISTANCE — WINTERMOUNT' in city else len(city)
printed_rows = re.findall(r'^\s*ROW "([^"]+)"', city[:split], re.M)
derived_rows = re.findall(r'^\s*ROW "([^"]+)"', city[split:], re.M)
check("transit distance rows", list(feed["transitDistance"]["rows"].keys()), printed_rows)
check("derived distance rows",
      list((feed["transitDistance"].get("derived") or {}).get("rows", {}).keys()), derived_rows)

# --- decks, banners, bonds, tiers, sections -----------------------------------
base = corpus["cityofwinter-0.5-core-base.ttrpg"]
check("decks", [d["name"] for d in feed["decks"]],
      re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Tradition Deck"', base, re.M))
check("bond lists", [b["name"] for b in
                     [{"name": f'{x["tier"]} {x["kind"]}'} for x in feed["bondLists"]]],
      re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Bonds List"', base, re.M))
check("age tiers", [t["name"] for t in feed["ageTiers"]],
      re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Age Tier"', base, re.M))

procs = corpus["cityofwinter-0.5-procedures.ttrpg"]
check("sections", ["Section: " + s["title"] for s in feed["sections"]],
      re.findall(r'^\s*#\S+ \^"(Section: [^"]+)" DEF', procs, re.M))
check("procedures", [p["name"] for p in feed["procedures"]],
      re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Procedure"', procs, re.M))
check("rules", [r["name"] for r in feed["rules"]],
      [n for n in re.findall(r'^\s*#\S+ \^"([^"]+)" DEF \{\n\s*EXTENDS #\S+ \^"Rule"', procs, re.M)
       if n not in {"Fate Answers"} and not n.startswith("Section: ")
       and n not in {m["name"] for m in feed["soloModules"]}
       and n not in {o["name"] for o in feed["optionalRules"]}])
check("guidance entries", len(feed["guidance"]),
      len(re.findall(r'^\s*ENTRY \^"', procs, re.M)))
check("hooks", len(feed["hooks"]), len(re.findall(r'^\s*HOOK #', procs, re.M)))

# --- every card prompt in the feed must be the prompt printed in the DSL ------
dsl_prompts = Counter(re.findall(r'^\s*\^"Prompt" STRING "((?:[^"\\]|\\.)*)"', ALL, re.M))
feed_prompts = Counter(c["prompt"] for c in feed["cards"])
feed_prompts.update(s for l in feed["riverlands"] + feed["city"] for s in l["scenes"])
feed_prompts.update(feed["wanderingBorough"]["scenes"])
if dsl_prompts != feed_prompts:
    only_dsl = dsl_prompts - feed_prompts
    only_feed = feed_prompts - dsl_prompts
    problems.append(f"prompt mismatch — only in DSL: {list(only_dsl)[:5]}; "
                    f"only in feed: {list(only_feed)[:5]}")

for p in problems:
    print("  MISMATCH " + p)
print(f"\nFEED: {len(feed['cards'])} cards, {feed_scenes} scenes, "
      f"{len(feed['riverlands']) + len(feed['city']) + 1} locations — "
      f"{len(problems)} mismatch(es) against the corpus.")
sys.exit(1 if problems else 0)
