# City of Winter — web

A play surface for *City of Winter* (Heart of the Deernicorn, 2022; design by Ross Cowman).
Buildless: static HTML, ES modules, no bundler, no dependencies.

```
index.html            landing
winter.css            the theme — night ground, scratchboard white, uncial display
data/cow.json         generated feed (do not hand-edit)
app/data.js           loads + indexes the feed; distance, travel reach, shape families, bond joiners
app/store.js          table state + the storage ADAPTER (local now, remote later)
app/game.js           the rules of play, as operations on state
app/ui.js             DOM helpers, the X-Card, tradition-card rendering
table/                the play surface
atlas/                locations, scenes, transit lines, printed distance table
traditions/           all 249 cards, shape families, banners
rules/                every procedure, rule, sidebar and variant
check_js.py           syntax gate for every module and inline page script
serve.py              local dev server that never lets the browser cache a module
```

## Where the content comes from

`data/cow.json` is written by `../titterpig-dsl-city-of-winter/build/gen_corpus.py` in the same pass
that emits the DSL corpus, and `build/check_feed.py` gates that the two agree (card counts and names
per deck, locations, scene counts, transit lines, distance rows, procedures, rules, guidance, hooks,
and every prompt string). **The app never invents game content.** To change what it shows, change
the corpus and regenerate.

## Running it

```bash
python3 web/serve.py
```

`serve.py` is `http.server` with `Cache-Control: no-store`. Plain `python3 -m http.server` works, but
the browser then keeps old ES modules and an edited page can silently fail to load.

It must be served over HTTP, not opened as a `file://` page — ES modules and `fetch` both require an
origin.

## Checks

```bash
python3 web/check_js.py
```

Inline `<script type="module">` blocks fail *silently* in a browser — a stray paren gives a blank
page and an empty console. This parses every module and every inline block with node, and is the
reason two such errors were caught rather than shipped.

## The table

`table/table.js` drives the rulebook procedures through `app/game.js`. The page is laid out like the
table itself:

- the **chronicle bar** — Chapter, Session, Home, what is in play; Ask Fate, End the Chapter, End the
  session, and **Undo** (every change can be stepped back);
- the **Stage** — whose turn it is, which procedure and which numbered step we are on, the book's words
  for that step, and the choices it offers, laid out inline rather than in stacked dialogs;
- the **Location** — the Home (or where a character is visiting) with its Local Traditions, Transit
  Lines and Scenes, and every token where it stands; Scenes are chosen by clicking them here;
- the family's **Notecards** — token, Marks (circles, and diamonds for City Marks), Bonds, and the
  hand, which stays face down until someone chooses to look, as the book advises;
- the **rail** — turn order, the decks in play, face-up cards, and the record, grouped by Chapter.

**Every rule shown on the table is the book's own text,** looked up by name in the feed
(`data.proc`, `data.step`, `data.rule`, `data.concept`, `data.guidanceText`, `data.optional`). The page
only decides which words appear at which moment; nothing is reworded. Interface text (button labels,
status lines) is the app's own and never restates a rule.

Procedures, in play order:

- **First Session Setup** — all eight of the book's steps, navigable back and forth: Introduction
  (read aloud, with the X-Card), Choose Home & Tradition (or *Starting in the City*, and the variants),
  Choose Names from the Banner, Mark Age, Make Bonds (two each, one with a main character), Hold
  Traditions (the spread, dealt character by character), Choose Tokens, Introduce the Umbra.
- **The start of a Chapter** — tokens Home, every Elder rolls the Die (a death leads straight into
  *When You Die* and the Memory Bond), *Living on the Borough* when the Borough is Home, Birth, and who
  takes the first turn.
- **Tradition Scene** — the five steps; Share (a card from your hand, face down, then a recipient) or
  Witness (one draw per Local Tradition icon, blank icons offering every deck of that shape, the Umbra
  Deck while it is in play; the holder reads privately by pressing and holding; in the City they play
  one or more and pass one). *The Borough Wanders* arrives, leaves, or wanders when revealed, and is
  discarded rather than passed.
- **Travel** (City) — destinations and costs from the printed distance table, Wintermount's derived row
  marked; the Wandering Borough reachable through its Station.
- **Migration Scene** — only once your token is on a Scene; choose what you carry.
  **Migrate the Family** — the four steps in the book's order: destination (the River Scroll's
  arrival pages lead to a choice of Entrance), what is saved, what is left, migrate.
  **Migrating to the City** follows an Entrance.
- **Memory Scene** — choose whose token to move and where, play a card face down, give it; sharing the
  last card means *Becoming forgotten*.
- **Ending a Chapter** — one Mark Age per character (City Marks in the City; an Elder crosses off, and
  may choose which kind), New Bonds for those who gained a Mark (names from the Banners the rule
  allows), Hold Traditions, then a new Chapter or the Closing Reflection. It cannot begin while a
  Migration is under way.
- **Sessions** — the Closing Reflection ends a session; New Session Setup begins the next, opening a
  new Chapter or continuing one left open.
- At any time: **Ask Fate** (question, three outcomes, the Die), dying by choice (*Other ways to die*),
  a player leaving mid-game (their character becomes a side-character and their cards join the pool at
  the next Migration or Chapter's end), side-characters, and the variants — *The Umbra Follows*,
  *Fleeing the City*, *Solo Play*.
- **Migrate Apart** (City) — when the turn reaches someone who has had their Migration Scene, they may
  wait (the turn passes) or Migrate Apart, with anyone at the same Home who has also had theirs. The
  group follows Migrate the Family on its own; those staying may save the cards the leavers laid down.
  From then on each character has a Home: households migrate separately (a household migrates when all
  its members have had their Migration Scene), Travel and City Marks follow your own Home, and a family
  that migrates back to the same Location is one household again. Face-up cards remember who laid them,
  so a migration only touches its own group's cards.

Bond prompts carry their own joining word — the lists are not all "of": *Ward **of** Rye*,
*Befriended **by** Dim*, *Lost **to** Cornflower* — taken from each list's own open prompt.

A saved table from the previous version (state v3) is carried forward — family, decks, the scene in
progress and the record — rather than reset.

## Playing together — the part that is not done

State goes through a storage adapter (`app/store.js`). Today the only adapter is `LocalAdapter`:
**this browser only.** It syncs across tabs, and `?room=<name>` keeps more than one family apart.

`RemoteAdapter` is a documented stub. A shared backend has to provide:

1. one family document per room, read/write from several devices;
2. change notification (SSE, WebSocket, or polling with an ETag), so a player sees another player's
   turn without reloading;
3. **conflict handling for the decks specifically** — drawing a card mutates shared order, so whole
   document last-write-wins will lose draws. Either optimistic concurrency (revision check, retry) or
   server-side intent endpoints (`POST /room/:id/draw {deck}`) rather than blind `PUT`s.

GitHub Pages can host the static site but cannot provide any of that. Cloudflare Workers + Durable
Objects, Supabase, Firebase, or a small service behind the existing sortilege.online reverse proxy
would all satisfy it; only the adapter needs to change.

---

City of Winter is © 2022 Heart of the Deernicorn. This is an unofficial play aid, not a copy of the
game — you need the game to play.
