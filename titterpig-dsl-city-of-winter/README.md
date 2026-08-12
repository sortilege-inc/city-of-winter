# titterpig-dsl-city-of-winter

Titterpig DSL corpus for **City of Winter** (Heart of the Deernicorn, 2022 — Rules V2, design by
Ross Cowman). Targets **DSL spec v0.5**; content version `0.5/`.

City of Winter is a GM-less story game in which a family migrates from the Riverlands to the City of
Winter, holding, sharing, witnessing, saving and losing Traditions as generations pass.

## Layout

```
0.5/
  cityofwinter-0.5-core-base.ttrpg          BASE — actor types, components, decks, banners,
                                            marks, bonds, map vocabulary
  cityofwinter-0.5-cards-<deck>.ttrpg       10 files — the 249 Tradition Cards
  cityofwinter-0.5-procedures.ttrpg         procedures, rules, guidance, hooks, optional rules,
                                            the rulebook's own section outline
  cityofwinter-0.5-riverlands.frame         the River Scroll: 11 locations, scenes, connections
  cityofwinter-0.5-city.frame               the City: 21 locations, scenes, transit lines,
                                            the printed transit-distance table
  cityofwinter-0.5-*.lore                   prose the game means to be read, not queried
sources.json                                source documents + file manifest + source anomalies
build/                                      the generator and its gates (see below)
```

## The corpus is generated, not hand-edited

`build/gen_corpus.py` emits every file in `0.5/` from three data files that hold the extracted
source content:

| file | what it holds | how it was produced |
|---|---|---|
| `build/cards.json` | 249 card prompts + deck | gutterfold PDF **text layer** (exact, no OCR); deck identity from each card's PDF image XObject id, confirmed visually one page per deck |
| `build/source-data.json` | decks, banners, bonds, age tiers, locations, scenes, transit, distance table | Atlas + banner PDFs; the local-tradition icons are vector art and were read visually from rendered pages |
| `build/procedures.json` | every procedure, rule, sidebar and variant, verbatim | transcribed from the rules PDF |

**Edit the data files and re-run the generator — do not hand-edit `0.5/`.** Hash IDs are derived
from a stable salt, so regeneration is byte-for-byte reproducible.

## Gates

```bash
build/gates.sh
```

Runs, in order: regenerate → DSL validator (lint + coherence) → `check_references.py` →
`check_constructs.py` → **verbatim check** → rebuild the source inventory → **coverage gate**.

- `build/check_verbatim.py` proves every `DESCRIPTION` / `TEACHING_TEXT` / `TEXT` string in the
  corpus occurs in the source PDFs' text layer. Paraphrase cannot pass.
- `build/make_inventory.py` re-derives the source's enumerable sets from the PDFs on every run
  (never from the corpus) and feeds `coverageAudit.ts` via `build/cityofwinter.manifest.json`.

Last full run: **all gates pass** — 14 files 0 errors / 0 warnings, 151 quotations all found in
source, coverage 523/523 units covered, 0 deferred, 0 excluded.

## Modelling notes

- **Locations live in `.frame` files.** A FRAME is the spec's container for "setting plus enough
  mechanical scaffolding to play", which is what the River Scroll and City Map are: geography that
  determines which Tradition Deck you draw from.
- **Blank tradition icons** are modelled as `^"Blank <shape> icon"` shape-family DEFs listing the
  decks a blank icon of that shape may be drawn from, exactly as the rules define them (p.38).
- **Cards are named `<Deck>: <prompt>`** because prompts repeat across decks (and twice within the
  Umbra deck). The verbatim prompt is the `^"Prompt"` property; the name is only identity.
- **Sidebars are `GUIDANCE`**, variants are `OPTIONAL` with the shipped default posture, and
  situations with an untracked mechanical consequence are `HOOKS` with a declared `FORMALITY`.

## Source anomalies

Recorded in `sources.json` under `sourceAnomalies` and reproduced as printed rather than corrected.
The ones worth knowing before building on this corpus:

1. The rules say **11** Tradition Decks (p.8); the card set contains **10** (9 traditions + Umbra),
   and the Design Notes sidebar (p.52) says "Ten Tradition Decks".
2. The **Mask Maker deck has 24 cards**; every other deck has 25 (249 total). Confirmed against both
   the gutterfold set and the 250-page VTT card photos (= 249 cards + the X-Card).
3. The **Umbra deck prints two copies** each of "who joins the Umbra" and "a lie of the Umbra".
4. The **Transit Distance table** (Atlas p.40) is symmetric but not consistent with the Transit Map:
   Glowtown–Undertown is 1 and Undertown–Husk is 1, yet Glowtown–Husk is printed 7+.
5. **Wintermount** is on the Transit Map and has a location page but is **absent from the distance
   table**.
6. Two page cross-references in the Atlas are wrong (p.9 → "We Join a Caravan (p.12)", actually
   p.11; p.16 → "Glowtown (p.19)", actually p.22).
7. The Wandering Borough card is titled "The Wandering **Burrough**" and its eighth scene is printed
   "**WANDERERING**".

*Not* an anomaly, though it reads like one: "Glowdog of the Dust" (p.52) names a starting Home whose
Atlas page carries no Glowdog icon. The Dust's icons are a blank circle and a **blank diamond**, and
Glowdog is a diamond deck — so the Blank Tradition Icons rule (p.38) already permits Glowdog there.
Five of the six City starting options name a printed icon; this one goes through the blank-shape rule
instead.

## Licence / rights

City of Winter is © 2022 Heart of the Deernicorn, all rights reserved. This corpus is a structured
transcription for personal tooling; it is not a licence to redistribute the game.
