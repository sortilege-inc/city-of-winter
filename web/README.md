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
```

## Where the content comes from

`data/cow.json` is written by `../titterpig-dsl-city-of-winter/build/gen_corpus.py` in the same pass
that emits the DSL corpus, and `build/check_feed.py` gates that the two agree (card counts and names
per deck, locations, scene counts, transit lines, distance rows, procedures, rules, guidance, hooks,
and every prompt string). **The app never invents game content.** To change what it shows, change
the corpus and regenerate.

## Running it

```bash
python3 -m http.server 8731 --directory web
```

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

`table/table.js` drives the rulebook procedures through `app/game.js`. Implemented and exercised:

- **First Session Setup** — choose Home & Tradition from the three Riverlands homes, name characters
  from the Family Tradition Banner, Mark Age by tier, Make Bonds, Hold Traditions (hand = Marks of
  Age), Choose Tokens, Introduce the Umbra.
- **Tradition Scene** — choose a Scene, Share (play face down, name a recipient) or Witness (draw one
  card per Local Tradition icon, blank icons offering every deck of that shape, the Umbra Deck
  offered while it is in play), pass on the Tradition, end the scene, pass the turn.
- **Migration Scene / Migrate the Family** — lay down what you cannot carry, save from the face-up
  pool, leave the rest behind (discards go to the *bottom* of their decks), choose a destination from
  the Atlas connections, and bring the new Local Tradition Deck into play.
- **Ending a Chapter** — Mark Age (Elders cross off instead; in the City an Elder may cross off
  either kind), New Bonds, Hold Traditions, New Chapter or Closing Reflection.
- **Campaign** — New Session Setup; Elders roll the Die at the start of each Chapter; Death & Memory,
  Memory Scenes, Becoming forgotten, and Birth.
- **The City** — City Marks, City Bonds, Travel by the printed distance table, Migration in the City,
  and the Wandering Borough (arrives, leaves, and the die table for where it wanders).
- **Ask Fate** and the **X-Card**, on every page.

Bond prompts carry their own joining word — the lists are not all "of": *Ward **of** Rye*,
*Befriended **by** Dim*, *Lost **to** Cornflower* — taken from each list's own open prompt.

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
