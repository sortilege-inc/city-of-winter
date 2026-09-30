/* ==========================================================================
   game.js — the rules of play, as operations on the table state.

   Every function here corresponds to a named procedure or rule in the corpus,
   and the page numbers in the comments are the rulebook's. The UI calls these;
   it does not reimplement them.
   ========================================================================== */

import { uid, rollDie } from './ui.js';
import { TOKENS } from './store.js';

/* ------------------------------------------------------- decks and drawing -- */

/** Bring a Tradition Deck into play (Migrate the Family, step 4, p.25). */
export function bringDeckIntoPlay(st, data, deckName) {
  if (!deckName || st.inPlay.includes(deckName)) return;
  st.inPlay.push(deckName);
  if (!st.decks[deckName]) {
    // "It is not necessary to shuffle cards in City of Winter. Instead, let the
    // order of cards naturally shift from session to session." (p.16) A fresh
    // deck therefore starts in its printed order.
    st.decks[deckName] = data.cardsByDeck.get(deckName).map((c) => c.id);
  }
}

/** Draw the top card of a deck. Discards go to the bottom, so a deck never empties. */
export function drawFrom(st, data, deckName) {
  bringDeckIntoPlay(st, data, deckName);
  const deck = st.decks[deckName];
  if (!deck || !deck.length) return null;
  return deck.shift();
}

/** "Discarded Tradition Cards go to the bottom of their respective Tradition Decks." (p.25) */
export function discard(st, data, cardId) {
  const card = data.byCard.get(cardId);
  if (!card) return;
  bringDeckIntoPlay(st, data, card.deck);
  st.decks[card.deck] = (st.decks[card.deck] || []).filter((id) => id !== cardId);
  st.decks[card.deck].push(cardId);
}

/** Remove a card from wherever it currently sits (a hand, the pool, the table). */
export function detach(st, cardId) {
  for (const ch of st.characters) ch.hand = ch.hand.filter((id) => id !== cardId);
  st.pool = st.pool.filter((id) => id !== cardId);
  st.table = st.table.filter((t) => t.cardId !== cardId);
}

/* ------------------------------------------------------------- characters -- */

export function newCharacter({ name, pronouns, marks = 0, token = '' }) {
  return {
    id: uid(), name, pronouns, token,
    marks, crossed: 0, cityMarks: 0, cityCrossed: 0,
    bonds: [], hand: [],
    isMemory: false, forgotten: false, leaving: false,
    scene: null, visiting: null, hadMigrationScene: false, deathRolled: false,
  };
}

/** The first token nobody is using yet. */
export function freeToken(st) {
  const used = new Set(st.characters.map((c) => c.token));
  return (TOKENS.find((t) => !used.has(t.id)) || TOKENS[st.characters.length % TOKENS.length]).id;
}

export function tierOf(data, ch) { return data.tierForMarks(ch.marks); }
export function isElder(ch) { return ch.marks >= 6; }

/** Hand size a character may hold: their Marks of Age (p.16). */
export function handLimit(ch) { return ch.marks; }

/** Characters still at the table: not forgotten, not gone to be side-characters. */
export function activeCharacters(st) {
  return st.characters.filter((c) => !c.forgotten && !c.leaving);
}

/** Main characters who are alive (not Memories) and at the table. */
export function livingCharacters(st) {
  return activeCharacters(st).filter((c) => !c.isMemory);
}

/**
 * Banners a character may name a new Bond from: "names from our Family
 * Tradition Banners, or any other Banner matching a Tradition Card that you
 * hold." (p.27)
 */
export function bondBanners(st, data, ch) {
  const decks = [st.family.tradition, ...ch.hand.map((id) => data.byCard.get(id)?.deck)];
  return [...new Set(decks.filter(Boolean))].map((d) => data.byDeck.get(d)).filter((k) => k && k.names?.length);
}

/* ------------------------------------------------------- the turn sequence -- */

export function currentCharacter(st) {
  const order = st.turn.order.filter((id) => activeCharacters(st).some((c) => c.id === id));
  if (!order.length) return null;
  return st.characters.find((c) => c.id === order[st.turn.current % order.length]) || null;
}

function liveOrder(st) {
  return st.turn.order.filter((id) => activeCharacters(st).some((c) => c.id === id));
}

/** Who would take the next turn. Characters who have had a Migration Scene are skipped (p.24). */
export function nextCharacter(st) {
  const order = liveOrder(st);
  for (let i = 1; i <= order.length; i++) {
    const idx = (st.turn.current + i) % order.length;
    const c = st.characters.find((x) => x.id === order[idx]);
    if (c && !c.hadMigrationScene) return { idx, c };
  }
  return null;
}

export function passTurn(st) {
  const n = nextCharacter(st);
  if (n) st.turn.current = n.idx;
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  st.turn.sceneKind = null;
  st.turn.memoryTarget = null;
  if (allHadMigrationScene(st)) {
    st.turn.phase = 'migrate-family';
    st.migration = { destination: null, entrance: null };
    retireLeavers(st);   // their cards join the face-up pool, to be saved or left
  }
}

/** "Any player may take the first turn" — choose who begins. */
export function giveTurnTo(st, chId) {
  const order = liveOrder(st);
  const i = order.indexOf(chId);
  if (i >= 0) st.turn.current = i;
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  st.turn.sceneKind = null;
  st.turn.memoryTarget = null;
}

/** Everyone has had their Migration Scene → the family migrates as a group (p.24). */
export function allHadMigrationScene(st) {
  const eligible = livingCharacters(st);
  return eligible.length > 0 && eligible.every((c) => c.hadMigrationScene);
}

/** The Migration Scene procedure is under way: it must finish before a Chapter can end (p.26). */
export function migrationUnderway(st) {
  return st.turn.phase === 'migrate-family' || livingCharacters(st).some((c) => c.hadMigrationScene);
}

/**
 * "At the start of your turn, if your token is already on a Scene, you may
 * choose to play a Migration Scene." (p.24) A Memory does not participate.
 */
export function canPlayMigrationScene(ch) {
  return !!ch && !ch.isMemory && !ch.hadMigrationScene && !!ch.scene;
}

/* ---------------------------------------------------------- Tradition Scene */

/** Step 1: move your token to a scene at the family's current location (p.21). */
export function chooseScene(st, ch, sceneName) {
  ch.scene = sceneName;
  st.turn.scene = sceneName;
  st.turn.phase = 'share-or-witness';
}

/** Share a Tradition: play a card from your hand face down (p.22). */
export function shareTradition(st, ch, cardId) {
  detach(st, cardId);
  st.table.push({ cardId, from: ch.id, to: null, kind: 'share', revealed: false });
  st.turn.sceneKind = 'share';
  st.turn.phase = 'lead';
}

/**
 * Witness a Tradition (p.22, and in the City p.38).
 * Draws one card per Local Tradition icon at the location; a blank icon lets the
 * drawing player choose any deck of the matching shape. The cards go to another
 * player, who reads them privately.
 */
export function witnessTradition(st, data, ch, recipientId, deckChoices) {
  const drawn = [];
  for (const deckName of deckChoices) {
    const id = drawFrom(st, data, deckName);
    if (id) drawn.push(id);
  }
  for (const cardId of drawn) {
    st.table.push({ cardId, from: ch.id, to: recipientId, kind: 'witness', revealed: false });
  }
  st.turn.sceneKind = 'witness';
  st.turn.phase = 'lead';
  return drawn;
}

/** Which decks a Witness at this location may draw from, icon by icon. */
export function witnessOptions(st, data, locationName) {
  const icons = data.localDecks(locationName);
  const opts = icons.map((icon) => ({
    blank: icon.blank,
    shape: icon.shape,
    decks: icon.decks.filter((d) => d !== 'Umbra'),
  }));
  // In the Riverlands you may draw from the Umbra Deck instead of the Local
  // Tradition (p.22). In the City the Umbra Deck is out of play unless the
  // group is using "The Umbra Follows" (p.53).
  if (st.umbraInPlay) for (const o of opts) o.decks = [...o.decks, 'Umbra'];
  return opts;
}

/** Share a Tradition names its recipient before the card is passed. */
export function setShareRecipient(st, cardId, recipientId) {
  const t = st.table.find((x) => x.cardId === cardId);
  if (t) t.to = recipientId;
}

/**
 * Pass on the Tradition (p.23). One card reaches its hand — the named
 * recipient's for a Share, the turn player's for a Witness; in a City Witness
 * Scene the rest are discarded to the bottom of their decks (p.39).
 * "The Borough Wanders" is never passed: at the end of the scene it is
 * discarded to the bottom of its deck (p.44).
 */
export function passOnTradition(st, data, keptCardId) {
  const turnCh = currentCharacter(st);
  let passed = null;
  for (const t of st.table.slice()) {
    st.table = st.table.filter((x) => x.cardId !== t.cardId);
    const card = data.byCard.get(t.cardId);
    if (t.cardId === keptCardId && !card?.isBoroughWanders) {
      const receiver = t.kind === 'witness' ? turnCh : st.characters.find((c) => c.id === t.to);
      if (receiver) { receiver.hand.push(t.cardId); passed = { cardId: t.cardId, to: receiver.id }; }
      else discard(st, data, t.cardId);
    } else {
      discard(st, data, t.cardId);
    }
  }
  st.turn.phase = 'end-scene';
  return passed;
}

/* --------------------------------------------------------- Migration Scene -- */

/** Migration Scene step 2: cards above your Marks of Age go face-up (p.24). */
export function layDownExcess(st, ch, keepIds) {
  const keep = new Set(keepIds);
  const laid = ch.hand.filter((id) => !keep.has(id));
  ch.hand = ch.hand.filter((id) => keep.has(id));
  st.pool.push(...laid);
  return laid;
}

export function finishMigrationScene(st, ch) {
  ch.hadMigrationScene = true;
  ch.scene = null;
  ch.visiting = null;
}

/** Migrate the Family step 2: fill short hands from the face-up pool (p.25). */
export function saveTradition(st, ch, cardId) {
  if (ch.hand.length >= handLimit(ch)) return false;
  if (!st.pool.includes(cardId)) return false;
  st.pool = st.pool.filter((id) => id !== cardId);
  ch.hand.push(cardId);
  return true;
}

/** Migrate the Family step 3: whatever is unclaimed is left behind (p.25). */
export function leaveBehind(st, data, cardId) {
  st.pool = st.pool.filter((id) => id !== cardId);
  discard(st, data, cardId);
}

/** The River Scroll's arrival pages, which lead through an Entrance into the City. */
export function isArrival(data, locName) { return !!data.byLocation.get(locName)?.isArrival; }

/**
 * Migrate the Family step 4 (p.25). Also handles arriving in the City (p.37)
 * and, under "Fleeing the City" (p.53), leaving it.
 */
export function migrateFamily(st, data, destination) {
  const dest = data.byLocation.get(destination);
  const from = st.family.region;
  const entering = !!dest && dest.region === 'City' && from !== 'City';
  const leaving = !!dest && dest.region === 'Riverlands' && from === 'City';
  st.family.home = destination;
  if (dest) st.family.region = dest.region;

  if (entering) {
    // Migrating to the City: the River Scroll and the Umbra Deck go back in the
    // box; a player already holding an Umbra Tradition keeps it (p.37).
    st.umbraInPlay = !!st.variants['The Umbra Follows'];
    st.inPlay = st.inPlay.filter((d) => d !== 'Umbra' || st.umbraInPlay);
  }
  // Fleeing the City: "Remove the Umbra Deck from play when we reach Temple
  // Island or Cloud Citadel." (p.53)
  if (st.variants['Fleeing the City'] && ['Temple Island', 'Cloud Citadel'].includes(destination)) {
    st.umbraInPlay = false;
    st.inPlay = st.inPlay.filter((d) => d !== 'Umbra');
  }

  for (const t of dest ? dest.traditions : []) {
    if (!t.startsWith('ANY:')) bringDeckIntoPlay(st, data, t);
  }
  if (destination === data.wanderingBorough.name) st.borough.isHome = true;
  else if (st.borough.isHome) st.borough.isHome = false;

  for (const c of st.characters) {
    c.hadMigrationScene = false;
    c.scene = null;
    c.visiting = null;
  }
  retireLeavers(st);
  st.migration = null;
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  return { entering, leaving };
}

/** Destinations available to the family right now. */
export function migrationDestinations(st, data) {
  const home = st.family.home;
  if (!home) return [];
  if (st.family.region !== 'City') {
    return data.adjacent(home).map((to) => ({
      to, why: isArrival(data, to) ? 'the road into the City' : 'connected by a river or other path',
      route: data.byLocation.get(to)?.route || null,
    }));
  }
  // In the City: any adjacent Location, plus anywhere a migrating family member
  // could reach through Travel with their City Marks (p.43).
  const out = new Map();
  const at = home === data.wanderingBorough.name ? st.borough.station : home;
  for (const line of data.transitLines) {
    const i = line.stations.indexOf(at);
    if (i < 0) continue;
    for (const j of [i - 1, i + 1]) {
      const to = line.stations[j];
      if (to && to !== home) out.set(to, { to, why: `adjacent on ${line.name}` });
    }
  }
  for (const c of livingCharacters(st)) {
    for (const r of data.travelReach(at, c.cityMarks)) {
      if (r.to !== home && !out.has(r.to)) out.set(r.to, { to: r.to, why: `${c.name} can Travel ${r.cost}`, derived: r.derived });
    }
  }
  if (st.borough.inPlay && home !== data.wanderingBorough.name) {
    out.set(data.wanderingBorough.name, { to: data.wanderingBorough.name, why: `the Borough is at ${st.borough.station}` });
  }
  // Fleeing the City: "We can Migrate from the City Map to the River Scroll
  // through any of the points of entry listed on the Riverscroll." (p.53)
  if (st.variants['Fleeing the City']) {
    for (const l of data.riverlands.filter((r) => r.isArrival)) {
      if (!l.entrances.some((e) => e.target === home)) continue;
      for (const to of l.connects) {
        out.set(to, { to, why: `out of the City by ${l.route}`, route: l.route });
      }
    }
  }
  return [...out.values()].sort((a, b) => a.to.localeCompare(b.to));
}

/* -------------------------------------------------------------- Travel (City) */

/** Travel to another Location on your turn (p.42). Distance is measured from Home. */
export function travelTargets(st, data, ch) {
  if (st.family.region !== 'City' || !st.family.home) return [];
  const home = st.family.home === data.wanderingBorough.name ? st.borough.station : st.family.home;
  if (!home) return [];
  const reach = data.travelReach(home, ch.cityMarks);
  if (st.borough.inPlay && st.borough.station && st.family.home !== data.wanderingBorough.name) {
    // "The Borough occupies the same Station in the Transit Line as the Location
    // where it appeared. Any character who could interact with that Location may
    // interact in the same way with the Wandering Borough" (p.45).
    const at = st.borough.station;
    if (at === home || reach.some((r) => r.to === at)) {
      reach.push({ to: data.wanderingBorough.name, cost: reach.find((r) => r.to === at)?.cost ?? 0 });
    }
  }
  if (st.family.home === data.wanderingBorough.name && st.borough.station) {
    reach.unshift({ to: st.borough.station, cost: 0 });
  }
  return reach;
}

/* ----------------------------------------------------------- Ending a Chapter */

export function beginEndingChapter(st) {
  st.turn.phase = 'end-chapter';
  st.chapterEnd = { marked: {}, held: {} };
  st.table = [];
  retireLeavers(st);     // their cards join the face-up pool for Hold Traditions
}

/**
 * Step 1: Mark Age. An Elder crosses a Mark off instead of adding one (p.26).
 * In the City we mark age with City Marks (p.40), and an Elder with both kinds
 * may cross off either.
 */
export function markAge(st, ch, opts = {}) {
  const inCity = st.family.region === 'City';
  if (isElder(ch)) {
    if (opts.crossCityMark && ch.cityMarks > ch.cityCrossed) { ch.cityCrossed += 1; return { gained: false, kind: 'cross-city' }; }
    ch.crossed = Math.min(ch.marks, ch.crossed + 1);
    return { gained: false, kind: 'cross' };
  }
  if (inCity) { ch.cityMarks += 1; return { gained: true, kind: 'city' }; }
  ch.marks = Math.min(6, ch.marks + 1);
  return { gained: true, kind: 'age' };
}

/** Undo a Mark Age made by mistake during the same Chapter's end. */
export function unmarkAge(ch, kind) {
  if (kind === 'city') ch.cityMarks = Math.max(0, ch.cityMarks - 1);
  else if (kind === 'age') ch.marks = Math.max(0, ch.marks - 1);
  else if (kind === 'cross') ch.crossed = Math.max(0, ch.crossed - 1);
  else if (kind === 'cross-city') ch.cityCrossed = Math.max(0, ch.cityCrossed - 1);
}

/** Step 3: Hold Traditions — trim to hand size, or fill up from the pool (p.27). */
export function holdTraditions(st, ch, keepIds) {
  const keep = new Set(keepIds);
  const laid = ch.hand.filter((id) => !keep.has(id));
  ch.hand = ch.hand.filter((id) => keep.has(id));
  st.pool.push(...laid);
}

/** Step 3, second half: "Remaining cards are discarded." (p.27) */
export function discardPool(st, data) {
  const left = st.pool.slice();
  st.pool = [];
  for (const id of left) discard(st, data, id);
  return left;
}

/**
 * Close the Chapter: remove the Wandering Borough unless it is Home (p.44),
 * and let anyone leaving the game go (p.35).
 */
export function closeChapter(st, data) {
  retireLeavers(st);
  discardPool(st, data);
  if (st.borough.inPlay && !st.borough.isHome) {
    st.borough.inPlay = false;
    st.borough.station = null;
  }
  for (const c of st.characters) { c.scene = null; c.visiting = null; }
  st.family.chapterClosed = true;
  st.chapterEnd = null;
}

/** Start of a Chapter: "everyone places their Token on our Home" (p.27). */
export function startNewChapter(st, { continuing = false } = {}) {
  if (!continuing) st.family.chapter += 1;
  st.family.chapterClosed = false;
  for (const c of st.characters) {
    c.scene = null;
    c.visiting = null;
    c.hadMigrationScene = false;
    c.deathRolled = false;
  }
  st.table = [];
  st.turn.phase = 'chapter-start';
  st.turn.scene = null;
  st.turn.sceneKind = null;
  st.chapterStart = { rolled: {}, borough: null, continuing };
}

/** End the session with a Closing Reflection (p.27). */
export function closeSession(st) {
  st.turn.phase = 'session-closed';
}

/** New Session Setup (p.31): a new Chapter, unless the last one is still open. */
export function newSession(st) {
  st.family.session += 1;
  startNewChapter(st, { continuing: !st.family.chapterClosed });
}

/* ------------------------------------------------------------ Death & Memory */

/**
 * An Elder rolls the Die at the start of each new Chapter; a roll equal to or
 * less than their crossed-off Marks means they have died of old age (p.32).
 */
export function rollForDeath(ch) {
  const roll = rollDie();
  ch.deathRolled = true;
  return { roll, died: roll <= ch.crossed };
}

/** When You Die, step 1: "Remove your token and return it to the box." (p.32) */
export function becomeMemory(st, ch) {
  ch.isMemory = true;
  ch.scene = null;
  ch.visiting = null;
  ch.hadMigrationScene = false;
}

/** "When you have shared your last Tradition Card, remove your Notecard from play." (p.33) */
export function checkForgotten(ch) {
  if (ch.isMemory && ch.hand.length === 0) { ch.forgotten = true; return true; }
  return false;
}

/** Memory Scene step 1: move another character's Token to a scene (p.32). */
export function memoryMoveToken(st, targetCh, sceneName) {
  targetCh.scene = sceneName;
  st.turn.scene = sceneName;
  st.turn.memoryTarget = targetCh.id;
  st.turn.phase = 'memory-share';
}

/** Memory Scene step 2: play a Tradition Card face down for that character. */
export function memoryPlay(st, memCh, cardId) {
  detach(st, cardId);
  st.table.push({ cardId, from: memCh.id, to: st.turn.memoryTarget, kind: 'memory', revealed: false });
  st.turn.sceneKind = 'memory';
}

/** Memory Scene step 4: give the card to the other player. */
export function memoryGive(st) {
  const t = st.table.find((x) => x.kind === 'memory');
  if (!t) return null;
  st.table = st.table.filter((x) => x !== t);
  const to = st.characters.find((c) => c.id === t.to);
  const from = st.characters.find((c) => c.id === t.from);
  if (to) to.hand.push(t.cardId);
  const forgotten = from ? checkForgotten(from) : false;
  st.turn.phase = 'end-scene';
  return { forgotten };
}

/* ------------------------------------------------------------------- Birth -- */

/** Birth (p.34): a chosen player gives the new character a name and a Child Bond. */
export function birth(st, { name, pronouns, giverId, bondPrompt, joiner = 'of', token }) {
  const ch = newCharacter({ name, pronouns, marks: 0, token: token || freeToken(st) });
  const giver = st.characters.find((c) => c.id === giverId);
  if (giver && bondPrompt) ch.bonds.push({ prompt: bondPrompt, joiner, subject: giver.name });
  st.characters.push(ch);
  if (!st.turn.order.includes(ch.id)) st.turn.order.push(ch.id);
  return ch;
}

/* ------------------------------------------------ leaving a game in progress */

/**
 * "If a player ever needs to leave a campaign or session in-progress,
 * transition their character to a side character and add their Tradition Cards
 * to the pool next time we Migrate the Family or end a Chapter." (p.35)
 */
export function retireLeavers(st) {
  for (const c of st.characters.filter((x) => x.leaving)) {
    st.pool.push(...c.hand);
    c.hand = [];
    if (!st.sideCharacters.some((s) => s.name === c.name)) {
      st.sideCharacters.push({ id: c.id, name: c.name, marks: c.marks });
    }
  }
  const gone = new Set(st.characters.filter((x) => x.leaving).map((c) => c.id));
  st.characters = st.characters.filter((c) => !gone.has(c.id));
  st.turn.order = st.turn.order.filter((id) => !gone.has(id));
}

/* --------------------------------------------------- The Wandering Borough -- */

/** "The Borough Wanders" was drawn and revealed (p.44). */
export function boroughArrives(st, station) {
  st.borough.inPlay = true;
  st.borough.station = station;
}

/** "Any visiting character tokens are returned to their home." (p.44) */
export function boroughLeaves(st, data) {
  st.borough.inPlay = false;
  st.borough.station = null;
  for (const c of st.characters) {
    if (c.visiting === data.wanderingBorough.name) { c.visiting = null; c.scene = null; }
  }
}

/** Living on the Borough: roll the Die and consult the table (p.45). */
export function boroughWanders(data) {
  const roll = rollDie();
  const line = data.transitLines.find((t) => t.die === roll);
  return { roll, line: line ? line.name : null, stations: line ? line.stations : [] };
}

/* ---------------------------------------------------------------- Ask Fate -- */

/** Ask Fate (p.47): 1-3 likely, 4-5 unlikely, 6 fateful. */
export function askFate(data) {
  const roll = rollDie();
  const band = roll <= 3 ? '1-3' : roll <= 5 ? '4-5' : '6';
  const outcome = data.askFate.find((o) => o.roll === band);
  return { roll, band, outcome };
}
