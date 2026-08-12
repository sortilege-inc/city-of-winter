# city-of-winter

Two things, in one repo:

| | |
|---|---|
| [`titterpig-dsl-city-of-winter/`](titterpig-dsl-city-of-winter/) | The Titterpig DSL corpus for **City of Winter** (Heart of the Deernicorn, 2022) — spec v0.5, content `0.5/`. Generated from the print-and-play source set, gated for validity, verbatim fidelity and source coverage. |
| [`web/`](web/) | A buildless web app that plays the game from that corpus — the table, the atlas, the decks, and the rules. |

The corpus is the source of truth. The app's data feed (`web/data/cow.json`) is emitted by the same
generator that writes the DSL, and a gate checks the two agree.

## Gates

```bash
titterpig-dsl-city-of-winter/build/gates.sh
```

regenerate → DSL validator → `check_references` → `check_constructs` → verbatim → feed↔corpus →
rebuild source inventory → coverage.

```bash
python3 web/check_js.py
```

parses every app module and every inline page script.

## Serving the app

```bash
python3 -m http.server 8731 --directory web
```

## Rights

City of Winter is © 2022 Heart of the Deernicorn; design, writing and layout by Ross Cowman,
illustrations by Doug Keith. This repository is a structured transcription and an unofficial play
aid for personal use. It is not a licence to redistribute the game, and it is not a substitute for
owning it.
