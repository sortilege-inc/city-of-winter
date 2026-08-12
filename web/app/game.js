/* ==========================================================================
   game.js — the rules of play, as operations on the table state.

   Every function here corresponds to a named procedure or rule in the corpus,
   and the page numbers in the comments are the rulebook's. The UI calls these;
   it does not reimplement them.
   ========================================================================== */

import { uid, rollDie } from './ui.js';

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
    isMemory: false, forgotten: false,
    scene: null, hadMigrationScene: false, deathRolled: false,
  };
}

export function tierOf(data, ch) { return data.tierForMarks(ch.marks); }
export function isElder(ch) { return ch.marks >= 6; }

/** Hand size a character may hold: their Marks of Age (p.16). */
export function handLimit(ch) { return ch.marks; }

/* ------------------------------------------------------- the turn sequence -- */

export function activeCharacters(st) {
  return st.characters.filter((c) => !c.forgotten);
}

export function currentCharacter(st) {
  const order = st.turn.order.filter((id) => st.characters.some((c) => c.id === id && !c.forgotten));
  if (!order.length) return null;
  return st.characters.find((c) => c.id === order[st.turn.current % order.length]) || null;
}

export function setTurnOrder(st, ids) {
  st.turn.order = ids;
  st.turn.current = 0;
}

/** Pass the turn. Characters who have had a Migration Scene are skipped (p.24). */
export function passTurn(st) {
  const order = st.turn.order.filter((id) => {
    const c = st.characters.find((x) => x.id === id);
    return c && !c.forgotten;
  });
  if (!order.length) return;
  for (let i = 1; i <= order.length; i++) {
    const idx = (st.turn.current + i) % order.length;
    const c = st.characters.find((x) => x.id === order[idx]);
    if (c && !c.hadMigrationScene) { st.turn.current = idx; break; }
  }
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  st.turn.sceneKind = null;
}

/** Everyone has had their Migration Scene → the family migrates as a group (p.24). */
export function allHadMigrationScene(st) {
  const eligible = activeCharacters(st).filter((c) => !c.isMemory);
  return eligible.length > 0 && eligible.every((c) => c.hadMigrationScene);
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
  st.turn.phase = 'pass-tradition';
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
  st.turn.phase = 'pass-tradition';
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

/**
 * Pass on the Tradition (p.23). One card reaches the hand of the player whose
 * turn it is; in a City Witness Scene the rest are discarded to the bottom of
 * their decks (p.39).
 */
export function passOnTradition(st, data, keptCardId) {
  const entries = st.table.slice();
  const turnCh = currentCharacter(st);
  for (const t of entries) {
    if (t.cardId === keptCardId) {
      const receiver = t.kind === 'share'
        ? st.characters.find((c) => c.id === t.to)
        : turnCh;
      st.table = st.table.filter((x) => x.cardId !== t.cardId);
      if (receiver) receiver.hand.push(t.cardId);
    } else {
      st.table = st.table.filter((x) => x.cardId !== t.cardId);
      discard(st, data, t.cardId);
    }
  }
  st.turn.phase = 'end-scene';
}

/** Share a Tradition names its recipient before the card is passed. */
export function setShareRecipient(st, cardId, recipientId) {
  const t = st.table.find((x) => x.cardId === cardId);
  if (t) t.to = recipientId;
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

/** Migrate the Family step 4 (p.25). Also handles arriving in the City (p.37). */
export function migrateFamily(st, data, destination) {
  const dest = data.byLocation.get(destination);
  const entering = dest && dest.region === 'City' && st.family.region !== 'City';
  st.family.home = destination;
  if (dest) st.family.region = dest.region;

  if (entering) {
    // Migrating to the City: the River Scroll and the Umbra Deck go back in the
    // box; a player already holding an Umbra Tradition keeps it (p.37).
    st.umbraInPlay = !!st.variants['The Umbra Follows'];
    st.inPlay = st.inPlay.filter((d) => d !== 'Umbra' || st.umbraInPlay);
  }

  for (const t of dest ? dest.traditions : []) {
    if (!t.startsWith('ANY:')) bringDeckIntoPlay(st, data, t);
  }
  for (const c of st.characters) {
    c.hadMigrationScene = false;
    c.scene = null;
  }
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  return { entering };
}

/** Destinations available to the family right now. */
export function migrationDestinations(st, data) {
  const home = st.family.home;
  if (!home) return [];
  if (st.family.region !== 'City') {
    return data.adjacent(home).map((to) => ({ to, why: 'connected by a river or other path' }));
  }
  // In the City: any adjacent Location, plus anywhere a migrating family member
  // could reach through Travel with their City Marks (p.43).
  const out = new Map();
  for (const line of data.transitLines) {
    const i = line.stations.indexOf(home);
    if (i < 0) continue;
    for (const j of [i - 1, i + 1]) {
      if (line.stations[j]) out.set(line.stations[j], { to: line.stations[j], why: `adjacent on ${line.name}` });
    }
  }
  for (const c of activeCharacters(st)) {
    if (c.isMemory) continue;
    for (const r of data.travelReach(home, c.cityMarks)) {
      if (!out.has(r.to)) out.set(r.to, { to: r.to, why: `${c.name} can Travel ${r.cost}` });
    }
  }
  if (st.borough.inPlay) out.set(data.wanderingBorough.name, { to: data.wanderingBorough.name, why: 'the Wandering Borough is here' });
  return [...out.values()].sort((a, b) => a.to.localeCompare(b.to));
}

/* -------------------------------------------------------------- Travel (City) */

/** Travel to another Location on your turn (p.42). Distance is measured from Home. */
export function travelTargets(st, data, ch) {
  if (st.family.region !== 'City' || !st.family.home) return [];
  const reach = data.travelReach(st.family.home, ch.cityMarks);
  if (st.borough.inPlay && st.borough.station) {
    // "The Borough occupies the same Station in the Transit Line as the Location
    // where it appeared. Any character who could interact with that Location may
    // interact in the same way with the Wandering Borough" (p.45).
    const at = st.borough.station;
    if (at === st.family.home || reach.some((r) => r.to === at)) {
      reach.push({ to: data.wanderingBorough.name, cost: reach.find((r) => r.to === at)?.cost ?? 0 });
    }
  }
  return reach;
}

/* ----------------------------------------------------------- Ending a Chapter */

/** Step 1: Mark Age. An Elder crosses a Mark off instead of adding one (p.26). */
export function markAge(st, ch, opts = {}) {
  const inCity = st.family.region === 'City';
  if (isElder(ch)) {
    // An Elder with both kinds of Mark may cross off either (p.40).
    if (opts.crossCityMark && ch.cityMarks > ch.cityCrossed) ch.cityCrossed += 1;
    else ch.crossed = Math.min(ch.marks, ch.crossed + 1);
    return { gained: false };
  }
  if (inCity) { ch.cityMarks += 1; return { gained: true, kind: 'city' }; }
  ch.marks = Math.min(6, ch.marks + 1);
  return { gained: true, kind: 'age' };
}

/** Step 2: when your character gains a Mark, make a Bond (p.27). */
export function addBond(ch, prompt, subject) {
  ch.bonds.push({ prompt, subject });
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

export function startNewChapter(st) {
  st.family.chapter += 1;
  for (const c of st.characters) {
    c.scene = null;
    c.hadMigrationScene = false;
    c.deathRolled = false;
  }
  st.turn.phase = 'choose-scene';
  st.turn.scene = null;
  st.turn.sceneKind = null;
}

export function newSession(st) {
  st.family.session += 1;
  for (const c of st.characters) { c.scene = null; c.deathRolled = false; }
  st.turn.phase = 'choose-scene';
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

export function becomeMemory(st, ch) {
  ch.isMemory = true;
  ch.scene = null;
  ch.token = '';
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
  st.turn.phase = 'memory-share';
}

/* ------------------------------------------------------------------- Birth -- */

/** Birth (p.34): a chosen player gives the new character a name and a Child Bond. */
export function birth(st, { name, pronouns, giverId, bondPrompt, token }) {
  const ch = newCharacter({ name, pronouns, marks: 0, token });
  const giver = st.characters.find((c) => c.id === giverId);
  if (giver && bondPrompt) addBond(ch, bondPrompt, giver.name);
  st.characters.push(ch);
  if (!st.turn.order.includes(ch.id)) st.turn.order.push(ch.id);
  return ch;
}

/* --------------------------------------------------- The Wandering Borough -- */

/** "The Borough Wanders" was drawn and revealed (p.44). */
export function boroughArrives(st, station) {
  st.borough.inPlay = true;
  st.borough.station = station;
}

export function boroughLeaves(st) {
  st.borough.inPlay = false;
  st.borough.station = null;
  for (const c of st.characters) {
    if (c.scene && (st.borough.isHome === false)) {
      // "Any visiting character tokens are returned to their home." (p.44)
    }
  }
}

/** Living on the Borough: roll the Die and consult the table (p.45). */
export function boroughWanders(st, data) {
  const roll = rollDie();
  const line = data.transitLines.find((t) => t.boroughDie === roll);
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
