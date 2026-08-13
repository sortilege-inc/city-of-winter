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
| `build/cards.json` | 249 card prompts + deck | prompts from the **printed cards** (`cards-printed.txt`, transcribed from the card photographs — these are authoritative); deck identity from each card's PDF image XObject id in the gutterfold PDF, where it is exact |
| `build/card-errata.json` | the 13 faces where the gutterfold print-and-play sheets differ from the printed cards | diffed mechanically; the build fails on any *unrecorded* difference |
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

Recorded in `sources.json` under `sourceAnomalies`. Owner rulings of 2026-08-12 are applied.

1. **The gutterfold print-and-play sheets differ from the printed cards on 13 of the 249 faces.**
   The **printed cards are authoritative**; the corpus follows them, and the print-and-play wording
   is kept on each affected card as `^"PnP Prompt"` (`build/card-errata.json`). Four are genuinely
   different prompts: the PnP duplicates *who joins the Umbra* and *a lie of the Umbra*, and so omits
   **how we fight the Umbra** and **why we fear the Umbra** entirely. The rest are spelling, and the
   typos fall on both sides (`a deed if legend` in the PnP; `in fashon`, `vison`, `servents` on the
   cards).
2. The **Mask Maker deck has 24 cards**; every other deck has 25 (249 total). Owner-confirmed.
3. **The Transit Distance table (p.40) is authoritative** where it disagrees with the Transit Map
   (Glowtown–Undertown 1, Undertown–Husk 1, yet Glowtown–Husk 7+). Travel and migration reach are
   computed from the table, never from the line topology.
4. **Wintermount** is on the Transit Map and has a location page but is absent from the distance
   table. Open — owner following up.
5. The location is **"The Wandering Burrough"** (its card), spelled "Wandering Borough" in the rules
   text. The corpus names it Burrough and records the rules spelling as `RULES_SPELLING`; rules
   quotations stay verbatim.
6. Atlas page cross-references on p.9 and p.16 are wrong. Tracked here only — page numbers are
   carried per location as `ATLAS_PAGE` and never surfaced to players.

Two things that read like anomalies but are not: the **deck count** (11 on p.8, "ten" on p.52) simply
depends what is counted — the box holds the X-Card, an initial deck naming each tradition, and the 10
tradition decks; and **"Glowdog of the Dust"** is permitted by the Blank Tradition Icons rule (p.38),
since the Dust carries a blank diamond and Glowdog is a diamond deck.

## Licence / rights

City of Winter is © 2022 Heart of the Deernicorn, all rights reserved. This corpus is a structured
transcription for personal tooling; it is not a licence to redistribute the game.
