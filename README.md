# city-of-winter

Two things, in one repo:

| | |
|---|---|
| [`titterpig-dsl-city-of-winter/`](titterpig-dsl-city-of-winter/) | The Titterpig DSL corpus for **City of Winter** (Heart of the Deernicorn, 2022) — spec v0.5, content `0.5/`. Generated from the print-and-play source set, gated for validity, verbatim fidelity and source coverage. |
| *(the play surface)* | Moved 2026-10-09 to [`sortilege-inc/sortilege-vtt-cityofwinter`](https://github.com/sortilege-inc/sortilege-vtt-cityofwinter), the Sortilege VTT for this game, live at [cityofwinter.sortilege.online](https://cityofwinter.sortilege.online/). Its `build/` reads this corpus by path (`titterpig-dsl-city-of-winter/0.5`). The first app, `web/`, is retired; it is in this repo's history up to `e551b6e`. |

The corpus is the source of truth. The generator also emits a JSON feed (`titterpig-dsl-city-of-winter/build/cow-feed.json`, the first app's data), and a gate checks the two agree.

## Gates

```bash
titterpig-dsl-city-of-winter/build/gates.sh
```

regenerate → DSL validator → `check_references` → `check_constructs` → verbatim → feed↔corpus →
rebuild source inventory → coverage.


## Rights

City of Winter is © 2022 Heart of the Deernicorn; design, writing and layout by Ross Cowman,
illustrations by Doug Keith. This repository is a structured transcription and an unofficial play
aid for personal use. It is not a licence to redistribute the game, and it is not a substitute for
owning it.
