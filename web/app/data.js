/* ==========================================================================
   data.js — loads the generated feed and indexes it.

   data/cow.json is produced by titterpig-dsl-city-of-winter/build/gen_corpus.py
   in the same pass that writes the DSL corpus, and build/check_feed.py gates
   that the two agree. Nothing in the app invents game content: if it isn't in
   the corpus, it isn't here.
   ========================================================================== */

export const DATA_URL = new URL('../data/cow.json', import.meta.url);

let _cache = null;

export async function loadData() {
  if (_cache) return _cache;
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`could not load game data (${res.status})`);
  _cache = index(await res.json());
  return _cache;
}

function index(raw) {
  const d = { ...raw };

  d.locations = [...raw.riverlands, ...raw.city, raw.wanderingBorough];
  d.byLocation = new Map(d.locations.map((l) => [l.name, l]));
  d.byDeck = new Map(raw.decks.map((k) => [k.name, k]));
  d.byCard = new Map(raw.cards.map((c) => [c.id, c]));
  d.cardsByDeck = new Map(raw.decks.map((k) => [k.name, []]));
  for (const c of raw.cards) d.cardsByDeck.get(c.deck).push(c);
  d.byShape = new Map(Object.entries(raw.shapeFamilies));
  d.bannerByDeck = new Map(raw.decks.map((k) => [k.name, k]));
  d.byLine = new Map(raw.transitLines.map((t) => [t.name, t]));
  d.byProcedure = new Map(raw.procedures.map((p) => [p.name, p]));
  d.byRule = new Map(raw.rules.map((r) => [r.name, r]));

  // scene -> location, for token placement and the atlas
  d.sceneLocation = new Map();
  for (const l of d.locations) for (const s of l.scenes) d.sceneLocation.set(s, l.name);

  // the three Riverlands starting homes, in the order the rules present them
  d.startingHomes = raw.riverlands.filter((l) => l.startingHome);

  // the five entrances to the City
  d.cityEntrances = [];
  for (const l of raw.riverlands) {
    for (const e of l.entrances || []) {
      if (!d.cityEntrances.some((x) => x.target === e.target)) d.cityEntrances.push(e);
    }
  }

  // which decks a location draws from, resolving blank shape icons
  d.localDecks = (locName) => {
    const loc = d.byLocation.get(locName);
    if (!loc) return [];
    return loc.traditions.map((t) =>
      t.startsWith('ANY:')
        ? { blank: true, shape: t.slice(4), decks: raw.shapeFamilies[t.slice(4)] }
        : { blank: false, shape: d.byDeck.get(t)?.shape, decks: [t] });
  };

  // transit distance lookup, exactly as printed (values may be "7+" or "-")
  d.distance = (from, to) => {
    const order = raw.transitDistance.order;
    const row = raw.transitDistance.rows[from];
    if (!row) return null;
    const i = order.indexOf(to);
    return i < 0 ? null : row[i];
  };

  // every City location a character could Travel to from Home with n City Marks
  d.travelReach = (home, cityMarks) => {
    const out = [];
    for (const to of raw.transitDistance.order) {
      if (to === home) continue;
      const v = d.distance(home, to);
      if (v && v !== '-' && v !== '7+' && Number(v) <= cityMarks) out.push({ to, cost: Number(v) });
    }
    return out.sort((a, b) => a.cost - b.cost || a.to.localeCompare(b.to));
  };

  d.adjacent = (locName) => (d.byLocation.get(locName)?.connects || []);

  // bond prompts legal at a given number of marks, per tier order
  const TIERS = ['Child', 'Youth', 'Parent', 'Elder'];
  d.bondsAtOrBelow = (tierName) => {
    const upto = TIERS.indexOf(tierName);
    return raw.bondLists.filter((b) => b.kind === 'Bonds' && TIERS.indexOf(b.tier) <= upto);
  };
  d.cityBondsAtOrBelow = (cityMarks) =>
    raw.bondLists.filter((b) => b.kind === 'City Bonds' &&
      Number((b.tier.match(/\d+/) || [0])[0]) <= cityMarks);
  d.memoryBonds = () => raw.bondLists.find((b) => b.kind === 'Memory Bonds');

  /**
   * The word that joins a Bond prompt to a name. It is not always "of": each
   * list's own open prompt states it — "or Child of…", "or Shadowed by…",
   * "or Lost to…" — so a Bond reads "Ward of Rye", "Befriended by Dim",
   * "Lost to Cornflower".
   */
  d.bondJoiner = (list) => {
    const m = (list.openPrompt || '').match(/\b(of|by|to|with)\s*\.*\s*$/i);
    return m ? m[1].toLowerCase() : 'of';
  };

  /** The open prompt's own word, e.g. "or Child of…" -> "Child". */
  d.openPromptWord = (list) =>
    (list.openPrompt || '').replace(/^or\s+/i, '').replace(/\s*\b(of|by|to|with)\s*\.*\s*$/i, '').trim();

  d.tierForMarks = (marks) =>
    raw.ageTiers.find((t) => t.marks.includes(marks))?.name ||
    (marks > 6 ? 'Elder' : 'Child');

  // palette a deck's cards are printed in
  d.palette = (deckName) => {
    const k = d.byDeck.get(deckName);
    if (!k) return 'river';
    if (k.shape === 'umbra') return 'umbra';
    return k.region === 'City' ? 'city' : 'river';
  };

  return d;
}
