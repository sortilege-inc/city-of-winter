# City of Winter — work log

## 2026-09-29 · UX/UI pass on the play surface, against the rules

Owner's ask: look at the rules and clean up the UX/UI so every step of the game is a good, good-looking
experience.

### Done

- **The table (`web/table/`) rewritten around the book's procedures.** Chronicle bar · Stage (procedure,
  numbered step, the book's words, the choices) · Location plate (Scenes with tokens on them) · Notecards
  · rail (turn order, decks, face-up cards, record by Chapter). Inline steps replace stacked dialogs.
- **Every rule on the table is looked up in the feed**, never typed into the page. Several hand-typed
  paraphrases were removed from `table.js`, `atlas/` and `traditions/` (two of them were spliced from
  different rules).
- **Setup is the book's eight steps**, navigable; *Introduction* and *Choose Tokens* were missing.
- **Start of a Chapter is its own stage**: Elder rolls → When You Die → Memory Bond; Living on the
  Borough; Birth; who goes first. New Session Setup runs through it.
- **Migrate the Family and Ending a Chapter are guided stages** in the book's step order.
- **Rules page rebuilt** by the book's chapters with sidebars beside the rules they concern, a filter,
  and no page numbers. **Atlas** cards restyled; page numbers removed.
- **Undo** for every change (this page's history). **State v4** with a real v3→v4 migration.
- Phone layout checked at 375 px: no horizontal scroll, compact two-row nav with the X-Card always
  visible, steppers collapse to numbers.
- `web/serve.py`: a no-cache dev server (plain `http.server` let the browser keep old modules).

### Bugs found and fixed on the way

- Corpus: three DESCRIPTIONs (City Marks, Bond, Memory) held a literal `\n\n` instead of a paragraph
  break. Fixed in the generator; `core-base` content version → **0.5.1**.
- The Borough's die table read a field (`boroughDie`) that does not exist — *Roll to see where it
  wanders* could never find a line, and the Atlas said every line was "not on the Borough table".
- After a Memory gave its card, the stage showed step 2 again instead of step 5.
- A player leaving mid-game: their cards were discarded before *Hold Traditions*/*What is saved* could
  use them. They now join the pool at the start of the procedure, as the sidebar says.
- A face-down *The Borough Wanders* gave itself away (no "pass this one" button) before it was played.
- `gates.sh` could not find the source PDFs after the 2026-09 tree move; the build now looks in
  `city-of-winter-support/archive/sourcebooks/City of Winter/` (override: `COW_SOURCE`).
- Tokens were never chosen; Mark Age could be clicked repeatedly at a Chapter's end.

### Decision log (autonomous calls, for audit)

| # | Decision | Why |
|---|---|---|
| 1 | Teaching text is marked "Read aloud" in setup | The book's *Formatting Conventions*: "Teaching text in quotes is specifically for reading out loud at the table when teaching the game." |
| 2 | Tokens are colours worn with an initial | The boxed tokens are picture discs the app does not have; the step still happens. |
| 3 | Hands are face down on Notecards until someone presses *Look* | Sidebar: hands "are not secret, but should be kept in hand or face-down on the table when not in use." |
| 4 | Witnessed cards are read privately by press-and-hold | "…give it to another player who privately reads the prompt." On one shared screen this is the closest honest match. |
| 5 | The Migration Scene is offered only once your token is on a Scene | "At the start of your turn, if your token is already on a Scene, you may choose to play a Migration Scene." |
| 6 | Ending a Chapter is blocked while a Migration is under way | Sidebar: "If we are in the middle of the Migration Scene procedure, we must complete it before ending the Chapter." |
| 7 | *The Borough Wanders* arrives at the Station of the Location where the scene took place | "Place the Wandering Borough Location Card next to the edge of the map near where the scene took place." |
| 8 | No Elder rolls at the very first Chapter of a campaign | The roll is "at the start of each new Chapter"; Chapter 1 is not new. |
| 9 | Memories and forgotten characters skip Mark Age and Hold Traditions | They are dead; the steps address living characters' Notecards. |
| 10 | Starting in the City (not Fleeing): the Umbra step becomes the *Umbra Follows* choice | "By default the Umbra Deck is no longer in play when we reach the City." |
| 11 | Fleeing the City: leaving via the River Scroll's arrival pages goes straight to the connected Riverlands location | The arrival pages have no Scenes; they are passages. |
| 12 | Living on the Borough: its own Station counts as Travel cost 0 | "The Borough occupies the same Station in the Transit Line as the Location where it appeared." |
| 13 | A name may be typed for any Bond; suggested names follow the rule's Banners | Suggestions guide; the table can always overrule. |

### Open — for the owner

1. **Do City Marks raise the hand limit?** Today the hand limit is Marks of Age only, so a character who
   arrives in the City as a Child (0 Marks) can never hold a card there, and nobody's hand grows in the
   City. The book says City Marks "represent both your age, and how much you've adapted to life in the
   city", but every hand rule says "Marks of Age". *Recommendation:* keep as is (the literal rule) unless
   you rule otherwise — it is a one-line change in `handLimit()`.
2. **Migrate Apart (City) is not implemented.** It needs a Home per group of characters rather than one
   family Home — a state-model change, not a UI one. *Recommendation:* do it as its own piece of work.

### Deferred and pending

- Multi-device play: the `RemoteAdapter` in `web/app/store.js` is a documented stub.
- `cityofwinter.sortilege.online` resolves and serves over HTTPS (checked 2026-09-29); **HTTPS enforcement is
  still off** — `gh api -X PUT repos/sortilege-inc/city-of-winter/pages -F https_enforced=true`.
