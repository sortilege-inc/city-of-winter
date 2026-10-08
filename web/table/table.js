/* ==========================================================================
   table.js — the play surface.

   The page is laid out like the table itself: the Location we are at (the
   map), the Stage (whose turn it is and which step of which procedure we are
   on), the family's Notecards, and — to the side — the turn order, the decks,
   the face-up cards and the record of play.

   Every rule shown to players is the book's own text, looked up by name in the
   generated feed (data.proc / data.step / data.rule ...). Nothing here rewords
   a rule: the page only decides which words to show at which moment.
   ========================================================================== */

import { loadData } from '../app/data.js';
import { Store, makeAdapter, TOKENS } from '../app/store.js';
import * as G from '../app/game.js';
import {
  $, el, add, clear, mountNav, mountFooter, cardEl, shapeIcon, marksRow,
  choose, modal, fmtTime, tokenEl, ruleText, details, dieFace, miniMarkdown, xcard,
} from '../app/ui.js';

const data = await loadData();
const store = new Store(makeAdapter());
await store.init();

mountNav('table');
const root = $('#root');

/** Things only this screen needs to remember — never saved, never shared. */
const ui = {
  look: new Set(),        // notecards whose hand is turned face up
  holdFor: null,          // setup step 6: whose hand the spread is filling
  witness: null,          // { picks:[], to }
  memTarget: null,        // Memory Scene: whose token is being moved
  carry: null,            // Migration Scene: Set of card ids carried
  keep: {},               // Ending a Chapter: chId -> Set of card ids carried
  passPick: null,         // City witness: which card is passed on
  travel: false,          // the Travel list is open
  migrateScene: false,    // the Migration Scene is being played
  peek: null,             // a witnessed card being read privately
};

/* ----------------------------------------------------------------- helpers */

const S = () => store.state;
const card = (id) => data.byCard.get(id);
const chById = (id) => S().characters.find((c) => c.id === id);
/** A character's token — or, for a Memory, the quiet ☾ that replaces it. */
const tok = (ch, opts = {}) => (ch && ch.isMemory
  ? el('span', { class: `token ${opts.size || ''} memorytok`.trim(), title: `${ch.name} · a Memory`, 'aria-hidden': 'true', text: '☾' })
  : tokenEl(ch, TOKENS, opts));
const up = (fn, log) => store.update(fn, log);
const find = (s, id) => s.characters.find((x) => x.id === id);
const BOROUGH = data.wanderingBorough.name;

const instr = (text) => ruleText(text, { cls: 'instr' });
const teach = (text) => ruleText(text, { cls: 'teach aloud' });

/** The one sentence of a rule that contains `needle` — quoted whole, never trimmed. */
function sentence(text, needle) {
  const all = String(text).split(/\n+/).flatMap((p) => p.match(/[^.!?]+[.!?]+[”’)]*/g) || [p]);
  return (all.find((s) => s.includes(needle)) || '').trim();
}

/** The Location a character is at right now: where they travelled, or Home. */
function whereIs(st, ch) {
  const name = (ch && ch.visiting) || G.homeOf(st, ch);
  return data.byLocation.get(name) || null;
}

/** "Our Home", or whose Home it is when the family lives apart. */
function homeLabel(st, name) {
  if (name === st.family.home) return G.households(st).length > 1 ? 'The family’s Home' : 'Our Home';
  const there = G.livingCharacters(st).filter((c) => G.homeOf(st, c) === name);
  return there.length ? `Home to ${there.map((c) => c.name).join(' & ')}` : null;
}

function locName(name) { return name === BOROUGH ? data.wanderingBorough.printedTitle || name : name; }

/** A small "who" label: token and name. */
function who(ch, extra) {
  return el('span', { class: 'who' }, tok(ch, { size: 'sm' }), el('span', { text: ch.name }), extra || null);
}

/** Buttons for choosing a character (or several: pass a Set), each wearing their token. */
function pickChars(chars, selected, onPick, { disabled = () => false, note = () => '' } = {}) {
  const on = (c) => (selected instanceof Set ? selected.has(c.id) : c.id === selected);
  return el('div', { class: 'pickrow' }, chars.map((c) => el('button', {
    type: 'button', class: `pick ${on(c) ? 'on' : ''}`.trim(),
    'aria-pressed': String(on(c)), disabled: disabled(c),
    onclick: () => onPick(c),
  }, tok(c, { size: 'sm' }), el('span', { text: c.name }), note(c) ? el('span', { class: 'note', text: note(c) }) : null)));
}

/** The steps of a procedure, as the book numbers them, with where we are. */
function stepper(procName, active, { names } = {}) {
  const steps = names || data.proc(procName).steps.map((s) => s.name);
  const act = [].concat(active);
  const first = Math.min(...act);
  return el('ol', { class: 'stepper', 'aria-label': procName }, steps.map((nm, i) => {
    const n = i + 1;
    const cls = act.includes(n) ? 'on' : n < first ? 'done' : '';
    return el('li', { class: cls, 'aria-current': act.includes(n) ? 'step' : null },
      el('span', { class: 'n', text: n }), el('span', { class: 'nm', text: nm }));
  }));
}

/** A numbered section of a procedure laid out on the Stage. */
function stepBlock(n, name, state, ...kids) {
  return el('section', { class: `stepblock ${state || ''}`.trim() },
    el('h4', {}, el('span', { class: 'n', text: n }), name, state === 'done' ? el('span', { class: 'tick', text: '✓' }) : null),
    ...kids);
}

function stageHead(eyebrow, title, ch) {
  return el('header', { class: 'stagehead' },
    ch ? tok(ch, { size: 'lg' }) : null,
    el('div', {},
      el('div', { class: 'eyebrow', text: eyebrow }),
      el('h2', { text: title })));
}

/* ================================================================== RENDER == */

let lastView = null;
/** Which screen we are on: a change of step or turn scrolls it into view. */
function viewKey(st) {
  if (!st.setupComplete) return `setup:${st.setup?.stage}`;
  return `${st.turn.phase}:${st.turn.current}:${st.family.chapter}:${ui.migrateScene}`;
}

function render(st) {
  const y = window.scrollY;
  const key = viewKey(st);
  const moved = lastView !== null && key !== lastView;
  lastView = key;
  clear(root);
  add(root, el('datalist', { id: 'allnames' },
    [...st.characters.map((c) => c.name), ...st.sideCharacters.map((c) => c.name),
      ...data.decks.flatMap((k) => k.names || [])]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .map((n) => el('option', { value: n }))));

  add(root, st.setupComplete ? renderTable(st) : renderSetup(st));
  add(root, el('div', { class: 'tablefoot' },
    el('span', { class: 'small muted', text: `Room “${st.room}” · saved in this browser` }),
    el('button', { class: 'tiny ghost', text: 'Table settings…', onclick: settingsDialog })));
  requestAnimationFrame(() => {
    const target = root.querySelector('.setupstep, .stage');
    if (moved && target && (target.getBoundingClientRect().top < 60 || target.getBoundingClientRect().top > innerHeight * 0.5)) {
      window.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + window.scrollY - 70), behavior: 'smooth' });
    } else if (!moved) {
      window.scrollTo(0, y);
    }
  });
}

/* ================================================================== SETUP === */

const SETUP = 'First Session Setup';

function renderSetup(st) {
  const steps = data.proc(SETUP).steps;
  const stage = st.setup?.stage ?? 0;
  const wrap = el('div', { class: 'setup' });
  add(wrap, el('div', { class: 'setuphead' },
    el('div', { class: 'eyebrow', text: 'Before we play' }),
    el('h1', { text: SETUP })));

  const reachable = (i) => i <= stage || i <= maxSetupStage(st);
  add(wrap, el('ol', { class: 'stepper big' }, steps.map((s, i) => el('li', {
    class: i === stage ? 'on' : i < stage ? 'done' : '',
  }, el('button', {
    type: 'button', disabled: !reachable(i) || i === stage,
    onclick: () => up((x) => { x.setup.stage = i; }),
  }, el('span', { class: 'n', text: s.n }), el('span', { class: 'nm', text: s.name }))))));

  const step = steps[stage];
  const panel = el('div', { class: 'panel setupstep' });
  add(panel, el('div', { class: 'eyebrow', text: `Step ${step.n} of ${steps.length}` }), el('h2', { text: step.name }));
  const body = [setupIntro, setupHome, setupNames, setupAge, setupBonds, setupHold, setupTokens, setupUmbra][stage];
  add(panel, body(st, step));
  add(wrap, panel);
  return wrap;
}

/** How far setup may be navigated: a step needs the ones before it. */
function maxSetupStage(st) {
  if (!st.family.home) return 1;
  if (!st.characters.length) return 2;
  if (st.characters.some((c) => c.hand.length < G.handLimit(c))) return 5;
  return 7;
}

function setupNav(st, { back = true, next = 'Next', ok = true, why = '' } = {}) {
  const i = st.setup.stage;
  return el('div', { class: 'setupnav' },
    back && i > 0 ? el('button', { class: 'ghost', text: '← Back', onclick: () => up((s) => { s.setup.stage = i - 1; }) }) : el('span'),
    el('span', { class: 'grow' }),
    why ? el('span', { class: 'small muted', text: why }) : null,
    next ? el('button', { class: 'primary', text: `${next} →`, disabled: !ok, onclick: () => up((s) => { s.setup.stage = i + 1; }) }) : null);
}

/* ---- 1. Introduction */
function setupIntro(st, step) {
  return el('div', {},
    instr(step.instruction),
    el('div', { class: 'readaloud' }, step.substeps.map((ss) => el('section', {},
      el('h3', { text: ss.name }), teach(ss.teaching),
      ss.name.includes('X-Card') ? el('button', { class: 'xbtn', text: '✕ The X-Card', onclick: xcard }) : null))),
    setupNav(st, { back: false, next: 'Choose our home' }));
}

/* ---- 2. Choose Home & Tradition */
function setupHome(st, step) {
  const city = st.setup.start === 'city';
  const box = el('div', {});
  if (!city) add(box, instr(step.instruction), teach(step.teaching));

  const pickHome = (home, tradition, region) => up((s) => {
    // Changing our mind: cards already dealt go back to the old deck.
    for (const c of s.characters) {
      for (const id of c.hand) G.discard(s, data, id);
      c.hand = [];
    }
    s.inPlay = [];
    s.decks = {};
    s.family.home = home;
    s.family.region = region;
    s.family.tradition = tradition;
    G.bringDeckIntoPlay(s, data, tradition);
    for (const t of data.byLocation.get(home)?.traditions || []) {
      if (!t.startsWith('ANY:')) G.bringDeckIntoPlay(s, data, t);
    }
    s.borough = home === BOROUGH ? { inPlay: true, station: null, isHome: true } : { inPlay: false, station: null, isHome: false };
    s.setup.stage = Math.max(s.setup.stage, 2);
  }, `Our family’s home is ${locName(home)}. Our Family Tradition is ${tradition}.`);

  if (!city) {
    add(box, el('div', { class: 'homes' }, data.startingHomes.map((loc) => {
      const deck = loc.traditions[0];
      return homeCard(loc, deck, st.family.home === loc.name, () => pickHome(loc.name, deck, 'Riverlands'));
    })));
  } else {
    add(box, el('div', { class: 'callout' },
      el('h3', { text: 'Starting in the City' }),
      // the rule's lead sentence; its list of options is the cards below
      instr(data.rule('Starting in the City').split(/\n\s*\n/)[0]),
      details('Plan for a longer setup', instr(data.guidanceText('plan-for-a-longer-setup')))));
    add(box, el('div', { class: 'homes' }, data.cityStartingOptions.map((o) => {
      const home = /wandering/i.test(o.home) ? BOROUGH : o.home;
      const loc = data.byLocation.get(home);
      return homeCard(loc, o.tradition, st.family.home === home, () => pickHome(home, o.tradition, 'City'), o.text);
    })));
  }

  // other ways to begin
  const variants = el('div', { class: 'variants' });
  add(variants, el('div', { class: 'segmented', role: 'group', 'aria-label': 'Where the family begins' },
    el('button', { class: city ? '' : 'on', 'aria-pressed': String(!city), text: 'Begin on the River Scroll',
      onclick: () => !city || up((s) => { s.setup.start = 'riverlands'; s.variants['Fleeing the City'] = false; resetHome(s); }) }),
    el('button', { class: city ? 'on' : '', 'aria-pressed': String(city), text: 'Begin in the City',
      onclick: () => city || up((s) => { s.setup.start = 'city'; resetHome(s); }) })));
  add(variants, variantToggles(st, ['The Umbra Follows', 'Fleeing the City', 'Solo Play']));
  const vd = details('Variants and other ways to begin', variants);
  vd.open = city || Object.values(st.variants).some(Boolean);
  add(box, vd);
  add(box, setupNav(st, { next: 'Choose names', ok: !!st.family.home, why: st.family.home ? '' : 'Choose a home to go on.' }));
  return box;
}

function resetHome(s) {
  for (const c of s.characters) c.hand = [];
  s.family.home = null; s.family.tradition = null; s.family.region = s.setup.start === 'city' ? 'City' : 'Riverlands';
  s.inPlay = []; s.decks = {};
  s.borough = { inPlay: false, station: null, isHome: false };
}

function homeCard(loc, deck, on, onclick, label) {
  const k = data.byDeck.get(deck);
  return el('button', { type: 'button', class: `homecard ${on ? 'on' : ''} ${loc.region === 'City' ? 'city' : 'river'}`.trim(), 'aria-pressed': String(on), onclick },
    el('span', { class: 'cat' }, shapeIcon(k?.shape), label || deck),
    el('span', { class: 'nm', text: locName(loc.name) }),
    el('span', { class: 'scenes', text: loc.scenes.join(' · ') }),
    on ? el('span', { class: 'chosen', text: 'Our home' }) : null);
}

/** Optional rules, each with the book's own description. */
function variantToggles(st, names) {
  return el('div', { class: 'toggles' }, names.map((nm) => {
    const o = data.optional(nm);
    const on = !!st.variants[nm];
    const locked = nm === 'Fleeing the City' && st.setupComplete;
    return el('div', { class: `toggle ${on ? 'on' : ''}`.trim() },
      el('label', {},
        el('input', { type: 'checkbox', checked: on, disabled: locked, onchange: (e) => up((s) => {
          s.variants[nm] = e.target.checked;
          if (nm === 'Fleeing the City' && e.target.checked && s.setup.start !== 'city') { s.setup.start = 'city'; resetHome(s); }
          if (nm === 'The Umbra Follows' && s.setupComplete && s.family.region === 'City') {
            s.umbraInPlay = e.target.checked;
            if (e.target.checked) G.bringDeckIntoPlay(s, data, 'Umbra'); else s.inPlay = s.inPlay.filter((d) => d !== 'Umbra');
          }
        }, `${nm} is ${e.target.checked ? 'now in play' : 'set aside'}.`) }),
        el('span', { class: 'tname', text: nm })),
      instr(o.optionalText),
      details('The rule', instr(o.text)));
  }));
}

/* ---- 3. Choose Names */
function setupNames(st, step) {
  const deck = data.byDeck.get(st.family.tradition);
  const used = new Set([...st.characters.map((c) => c.name), ...st.sideCharacters.map((c) => c.name)]);
  const name = el('input', { id: 'newname', placeholder: 'a name from the Banner', autocomplete: 'off' });
  const pron = el('input', { id: 'newpron', placeholder: 'optional' });
  const submit = () => {
    const n = name.value.trim();
    if (!n) { name.focus(); return; }
    up((s) => {
      const c = G.newCharacter({ name: n, pronouns: pron.value.trim(), marks: 0, token: G.freeToken(s) });
      s.characters.push(c);
      s.turn.order = s.characters.map((x) => x.id);
    }, `${n} joins the family.`).then(() => $('#newname')?.focus());
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  pron.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const move = (i, d) => up((s) => {
    const j = i + d;
    [s.characters[i], s.characters[j]] = [s.characters[j], s.characters[i]];
    s.turn.order = s.characters.map((x) => x.id);
  });

  return el('div', {},
    instr(step.instruction), teach(step.teaching),
    st.variants['Solo Play'] ? el('div', { class: 'callout small' }, instr(data.guidanceText('solo-first-session'))) : null,
    el('div', { class: 'banner' },
      el('div', { class: 'bannerhead' }, shapeIcon(deck.shape), el('span', { text: `${deck.banner} Banner` })),
      el('div', { class: 'namechips' }, deck.names.map((n) => el('button', {
        type: 'button', class: 'namechip', text: n, disabled: used.has(n),
        onclick: () => { name.value = n; pron.focus(); },
      }))),
      el('div', { class: 'nameprompt', text: deck.namePrompt })),
    el('div', { class: 'addrow' },
      el('label', {}, 'Name', name),
      el('label', {}, 'Pronouns', pron),
      el('button', { class: 'primary', text: 'Add to the family', onclick: submit })),
    st.characters.length ? el('div', {},
      el('h3', { text: 'Our family' }),
      el('p', { class: 'small muted', text: 'Listed in turn order.' }),
      el('ol', { class: 'roster' }, st.characters.map((c, i) => el('li', {},
        tok(c), el('b', { text: c.name }), c.pronouns ? el('span', { class: 'pronouns', text: c.pronouns }) : null,
        el('span', { class: 'grow' }),
        el('button', { class: 'tiny ghost', text: '↑', title: 'Earlier in turn order', disabled: i === 0, onclick: () => move(i, -1) }),
        el('button', { class: 'tiny ghost', text: '↓', title: 'Later in turn order', disabled: i === st.characters.length - 1, onclick: () => move(i, 1) }),
        el('button', { class: 'tiny ghost', text: 'Remove', onclick: () => up((s) => {
          const x = find(s, c.id);
          for (const id of x.hand) G.discard(s, data, id);
          s.characters = s.characters.filter((y) => y.id !== c.id);
          s.turn.order = s.characters.map((y) => y.id);
        }, `${c.name} is removed from the family.`) }))))) : null,
    setupNav(st, { next: 'Mark Age', ok: st.characters.length > 0, why: st.characters.length ? '' : 'Add at least one character.' }));
}

/* ---- 4. Mark Age */
function setupAge(st, step) {
  return el('div', {},
    teach(step.teaching),
    el('div', { class: 'agelist' }, st.characters.map((c) => {
      const tier = data.tierForMarks(c.marks);
      const setMarks = (m) => up((s) => {
        const x = find(s, c.id);
        x.marks = m;
        while (x.hand.length > m) G.discard(s, data, x.hand.pop());
      }, `${c.name} is ${data.tierForMarks(m) === 'Elder' ? 'an' : 'a'} ${data.tierForMarks(m)} — ${m} Mark${m === 1 ? '' : 's'} of Age.`);
      return el('div', { class: 'agerow' },
        who(c),
        el('div', { class: 'segmented', role: 'group', 'aria-label': `${c.name}’s age` }, data.ageTiers.map((t) =>
          el('button', { class: tier === t.name ? 'on' : '', 'aria-pressed': String(tier === t.name), text: t.name,
            onclick: () => tier === t.name || setMarks(t.marks[0]) }))),
        el('div', { class: 'markpick' },
          (data.ageTiers.find((t) => t.name === tier)?.marks || []).length > 1
            ? data.ageTiers.find((t) => t.name === tier).marks.map((m) => el('button', {
              type: 'button', class: `mp ${c.marks === m ? 'on' : ''}`.trim(), 'aria-pressed': String(c.marks === m),
              title: `${m} Marks`, onclick: () => setMarks(m),
            }, marksRow(m, 0)))
            : marksRow(c.marks, 0)));
    })),
    setupNav(st, { next: 'Make Bonds' }));
}

/* ---- 5. Make Bonds */
function setupBonds(st, step) {
  const deck = data.byDeck.get(st.family.tradition);
  const mains = new Set(st.characters.map((c) => c.name));
  return el('div', {},
    teach(step.teaching),
    el('div', { class: 'bondgrid' }, st.characters.map((c) => {
      const withMain = c.bonds.some((b) => mains.has(b.subject));
      const status = c.bonds.length < 2 ? `${c.bonds.length} of 2 Bonds`
        : withMain || st.characters.length === 1 ? 'Two Bonds' : 'Needs a Bond with another main character';
      const ok = c.bonds.length >= 2 && (withMain || st.characters.length === 1);
      return el('div', { class: 'bondcard' },
        el('div', { class: 'bondhead' }, who(c, el('span', { class: 'tierlabel', text: data.tierForMarks(c.marks) })),
          el('span', { class: `status ${ok ? 'ok' : ''}`.trim(), text: status })),
        bondList(c),
        bondComposer(c, { lists: data.bondsAtOrBelow(data.tierForMarks(c.marks)), banners: [deck], exclude: c.name }));
    })),
    setupNav(st, { next: 'Hold Traditions' }));
}

/* ---- 6. Hold Traditions */
function setupHold(st, step) {
  const deckName = st.family.tradition;
  const pool = st.decks[deckName] || [];
  const choose1 = data.substep(SETUP, 'Hold Traditions', 'Choose Tradition Cards');
  const gather = data.substep(SETUP, 'Hold Traditions', 'Gather the Tradition Deck');
  const needing = st.characters.filter((c) => c.hand.length < G.handLimit(c));
  if (!ui.holdFor || !chById(ui.holdFor) || G.handLimit(chById(ui.holdFor)) === 0) ui.holdFor = (needing[0] || st.characters.find((c) => c.marks > 0) || {}).id || null;
  const forCh = chById(ui.holdFor);

  const give = (id) => {
    if (!forCh || forCh.hand.length >= G.handLimit(forCh)) return;
    up((s) => {
      const c = find(s, forCh.id);
      c.hand.push(id);
      s.decks[deckName] = s.decks[deckName].filter((x) => x !== id);
    }, `${forCh.name} holds “${card(id).prompt}”.`).then(() => {
      const me = chById(forCh.id);
      if (me && me.hand.length >= G.handLimit(me)) {
        const nxt = S().characters.find((c) => c.hand.length < G.handLimit(c));
        if (nxt) { ui.holdFor = nxt.id; render(S()); }
      }
    });
  };
  const putBack = (ch, id) => up((s) => {
    const c = find(s, ch.id);
    c.hand = c.hand.filter((x) => x !== id);
    s.decks[deckName].push(id);
  }, `${ch.name} puts back “${card(id).prompt}”.`);

  return el('div', {},
    el('h3', { text: choose1.name }), instr(choose1.instruction), teach(choose1.teaching),
    el('div', { class: 'holdtabs', role: 'tablist' }, st.characters.map((c) => {
      const lim = G.handLimit(c);
      return el('button', {
        type: 'button', role: 'tab', class: `holdtab ${c.id === ui.holdFor ? 'on' : ''} ${c.hand.length >= lim ? 'full' : ''}`.trim(),
        'aria-selected': String(c.id === ui.holdFor), disabled: lim === 0,
        onclick: () => { ui.holdFor = c.id; render(S()); },
      }, tok(c, { size: 'sm' }), el('span', { class: 'nm', text: c.name }),
        el('span', { class: 'count', text: lim === 0 ? 'Child' : `${c.hand.length}/${lim}` }));
    })),
    forCh ? el('div', { class: 'holding' },
      el('div', { class: 'small muted', text: forCh.hand.length ? `${forCh.name} holds — choose a card to put it back:` : `${forCh.name} holds nothing yet.` }),
      el('div', { class: 'cardrow' }, forCh.hand.map((id) => cardEl(card(id), data, { onclick: () => putBack(forCh, id), title: 'Put it back' })))) : null,
    el('h4', { text: forCh && forCh.hand.length < G.handLimit(forCh) ? `The spread — choosing for ${forCh.name}` : 'The spread' }),
    el('div', { class: 'cardrow spread' }, pool.map((id) => cardEl(card(id), data, {
      onclick: forCh && forCh.hand.length < G.handLimit(forCh) ? () => give(id) : undefined,
    }))),
    el('h3', { text: gather.name }), instr(gather.instruction),
    setupNav(st, { next: 'Choose Tokens', ok: !needing.length, why: needing.length ? `${needing.map((c) => c.name).join(', ')} still ${needing.length === 1 ? 'needs' : 'need'} cards.` : '' }));
}

/* ---- 7. Choose Tokens */
function setupTokens(st, step) {
  return el('div', {},
    instr(step.instruction), teach(step.teaching),
    el('p', { class: 'small muted', text: 'The boxed Tokens are picture discs; here each character wears a colour and their initial.' }),
    el('div', { class: 'tokengrid' }, st.characters.map((c) => el('div', { class: 'tokenrow' },
      who(c),
      el('div', { class: 'swatches' }, TOKENS.map((t) => {
        const taken = st.characters.find((x) => x.token === t.id && x.id !== c.id);
        return el('button', {
          type: 'button', class: `swatch ${c.token === t.id ? 'on' : ''}`.trim(), style: `--tok:${t.color}`,
          title: taken ? `${t.name} — ${taken.name}’s` : t.name, 'aria-label': `${t.name} token`,
          'aria-pressed': String(c.token === t.id), disabled: !!taken,
          onclick: () => up((s) => { find(s, c.id).token = t.id; }, `${c.name} takes the ${t.name} token.`),
        });
      }))))),
    setupNav(st, { next: 'Introduce the Umbra' }));
}

/* ---- 8. Introduce the Umbra */
function setupUmbra(st, step) {
  const city = st.setup.start === 'city';
  const fleeing = !!st.variants['Fleeing the City'];
  const follows = !!st.variants['The Umbra Follows'];
  const umbra = !city || fleeing || follows;
  const box = el('div', {});
  if (!city) {
    add(box, instr(step.instruction), el('div', { class: 'prelude' }, teach(step.teaching)),
      instr(step.followUp), teach(step.teachingTwo));
  } else if (fleeing) {
    const paras = data.optional('Fleeing the City').text.split(/\n\s*\n/);
    const prelude = paras[paras.indexOf('New Prelude') + 1];
    add(box, instr(step.instruction), el('div', { class: 'prelude' }, teach(prelude)),
      instr(step.followUp), teach(step.teachingTwo));
  } else {
    add(box, variantToggles(st, ['The Umbra Follows']),
      follows ? teach(step.teachingTwo) : null);
  }
  add(box, el('div', { class: 'setupnav' },
    el('button', { class: 'ghost', text: '← Back', onclick: () => up((s) => { s.setup.stage = 6; }) }),
    el('span', { class: 'grow' }),
    el('button', {
      class: 'primary big', text: umbra ? 'Place the Umbra Deck and begin' : 'Begin the first Chapter',
      onclick: () => up((s) => {
        s.umbraInPlay = umbra;
        if (umbra) G.bringDeckIntoPlay(s, data, 'Umbra');
        s.setupComplete = true;
        s.turn.order = s.characters.map((c) => c.id);
        s.turn.current = 0;
        s.family.chapter = 1;
        s.turn.phase = 'chapter-start';
        s.chapterStart = { rolled: {}, borough: null, continuing: false, first: true };
      }, umbra
        ? `The Umbra Deck is placed beside the ${city ? 'City Map' : 'River Scroll'}. Chapter 1 begins at ${locName(st.family.home)}.`
        : `Chapter 1 begins at ${locName(st.family.home)}.`),
    })));
  return box;
}

/* ================================================================== BONDS === */

/** How a stored Bond reads: "Ward of Rye", "Befriended by Dim", "Lost to Vale". */
export function bondText(b) { return `${b.prompt} ${b.joiner || 'of'} ${b.subject}`; }

function bondList(ch, { removable = true } = {}) {
  if (!ch.bonds.length) return el('p', { class: 'small muted nobonds', text: 'No Bonds yet.' });
  return el('ul', { class: 'bonds' }, ch.bonds.map((b, i) => el('li', { class: b.city ? 'city' : b.memory ? 'memory' : '' },
    el('span', { text: bondText(b) }),
    removable ? el('button', { class: 'x', title: 'Remove this Bond', 'aria-label': `Remove ${bondText(b)}`, text: '×',
      onclick: () => up((s) => { find(s, ch.id).bonds.splice(i, 1); }, `${ch.name} lets go of the Bond “${bondText(b)}”.`) }) : null)));
}

/**
 * Compose a Bond: a prompt from the lists this character may use, joined by
 * that list's own word, to a name. Names the rules point to (the Banner) are
 * offered as chips; any name may be typed.
 */
function bondComposer(ch, { lists, banners = [], exclude, label = 'Make the Bond', city = false, memory = false, onDone } = {}) {
  const opts = [];
  const sel = el('select', { 'aria-label': 'Bond prompt' });
  for (const l of lists) {
    const joiner = data.bondJoiner(l);
    const g = el('optgroup', { label: l.kind === 'City Bonds' ? `${l.tier} (City)` : l.kind === 'Memory Bonds' ? 'Memory' : l.tier });
    for (const p of l.prompts) { opts.push({ prompt: p, joiner }); add(g, el('option', { value: opts.length - 1, text: `${p} ${joiner}…` })); }
    const open = data.openPromptWord(l);
    if (open) { opts.push({ prompt: open, joiner }); add(g, el('option', { value: opts.length - 1, text: `${open} ${joiner}…` })); }
    add(sel, g);
  }
  const whom = el('input', { placeholder: 'whom', list: 'allnames', 'aria-label': 'Bond with whom', autocomplete: 'off' });
  const submit = () => {
    const subject = whom.value.trim();
    if (!subject) { whom.focus(); return; }
    const o = opts[Number(sel.value)];
    up((s) => {
      find(s, ch.id).bonds.push({ prompt: o.prompt, joiner: o.joiner, subject, city: city || undefined, memory: memory || undefined });
      if (!s.sideCharacters.some((x) => x.name === subject) && !s.characters.some((x) => x.name === subject)) {
        s.sideCharacters.push({ id: 'side-' + Math.random().toString(36).slice(2, 8), name: subject, marks: 0 });
      }
    }, `${ch.name} is ${o.prompt} ${o.joiner} ${subject}.`).then(() => onDone && onDone());
  };
  whom.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  const st = S();
  const taken = new Set([...st.characters.map((c) => c.name), ...st.sideCharacters.map((c) => c.name)]);
  const mains = st.characters.filter((c) => c.name !== exclude && !c.forgotten).map((c) => c.name);
  const chips = el('div', { class: 'namechips small' },
    mains.map((n) => el('button', { type: 'button', class: 'namechip main', text: n, title: 'a main character', onclick: () => { whom.value = n; } })),
    banners.flatMap((k) => k.names.filter((n) => !taken.has(n)).map((n) => el('button', {
      type: 'button', class: 'namechip', text: n, title: `from the ${k.banner} Banner`, onclick: () => { whom.value = n; },
    }))));
  return el('div', { class: 'composer' },
    el('div', { class: 'composerow' }, sel, whom, el('button', { class: 'tiny primary', text: label, onclick: submit })),
    chips);
}

/* ============================================================== THE TABLE == */

function renderTable(st) {
  const frag = document.createDocumentFragment();
  const cur = G.currentCharacter(st);

  add(frag, chronicleBar(st));

  const layout = el('div', { class: 'tablelayout' });
  const main = el('div', { class: 'mainarea' });
  const rail = el('aside', { class: 'rail' });
  add(layout, main, rail);

  add(main, renderStage(st, cur));
  const plateCh = st.turn.phase === 'memory-share' ? chById(st.turn.memoryTarget)
    : cur && cur.isMemory && ui.memTarget ? chById(ui.memTarget) : cur;
  if (!['session-closed'].includes(st.turn.phase)) add(main, plate(st, whereIs(st, plateCh && !plateCh.isMemory ? plateCh : null), cur));
  add(main, familySection(st, cur));

  add(rail, turnOrder(st, cur), decksPanel(st));
  if (st.pool.length && !['migrate-family', 'end-chapter'].includes(st.turn.phase)) {
    add(rail, el('section', { class: 'panel' },
      el('h3', { text: `Face-up on the table · ${st.pool.length}` }),
      el('div', { class: 'cardrow tight' }, st.pool.map((id) => cardEl(card(id), data, { size: 'sm' })))));
  }
  add(rail, recordPanel(st));
  add(frag, layout);
  return frag;
}

/* ---------------------------------------------------------- chronicle bar -- */

function chronicleBar(st) {
  const ph = st.turn.phase;
  const busy = ['end-chapter', 'chapter-start', 'session-closed', 'city-arrival'].includes(ph);
  const midMigration = G.migrationUnderway(st);
  return el('div', { class: 'chronicle' },
    el('div', { class: 'cfield' }, el('span', { class: 'k', text: 'Chapter' }), el('span', { class: 'v', text: st.family.chapter })),
    el('div', { class: 'cfield' }, el('span', { class: 'k', text: 'Session' }), el('span', { class: 'v', text: st.family.session })),
    homesField(st),
    el('div', { class: 'ctags' },
      st.umbraInPlay ? el('span', { class: 'tag umbra', text: 'Umbra Deck in play' }) : null,
      st.borough.inPlay ? el('span', { class: 'tag spire', text: st.borough.station ? `The Borough is at ${st.borough.station}` : 'The Borough wanders' }) : null,
      Object.entries(st.variants).filter(([, v]) => v).map(([k]) => el('span', { class: 'tag', text: k }))),
    el('span', { class: 'grow' }),
    el('div', { class: 'cactions' },
      store.canUndo ? el('button', { class: 'tiny ghost', text: '↶ Undo', title: `Undo: ${st.log[0]?.text || ''}`, onclick: () => store.undo() }) : null,
      el('button', { class: 'tiny', text: '🎲 Ask Fate', onclick: askFateDialog }),
      el('button', {
        class: 'tiny', text: 'End the Chapter', disabled: busy || midMigration,
        title: midMigration ? data.guidanceText('chapters-and-pacing').split(/\n\s*\n/).pop() : '',
        onclick: async () => {
          const ok = await choose('End the Chapter?', [{ label: 'Bring the Chapter to a close', value: true, class: 'primary' }],
            { body: instr(data.proc('Ending a Chapter').instruction) });
          if (ok) up((s) => G.beginEndingChapter(s), `We bring Chapter ${S().family.chapter} to a close.`);
        },
      }),
      el('button', {
        class: 'tiny ghost', text: 'End the session', disabled: busy || midMigration,
        onclick: async () => {
          const ok = await choose('End the session here?', [{ label: 'End the session — the Chapter continues next time', value: true }],
            { body: el('div', {}, instr(data.guidanceText('chapters-and-pacing'))) });
          if (ok) up((s) => G.closeSession(s), `The session ends mid-Chapter.`);
        },
      })));
}

/** The Home in the chronicle bar — or each household's, once the family lives apart. */
function homesField(st) {
  const hh = G.households(st);
  if (hh.length <= 1) {
    return el('div', { class: 'cfield home' }, el('span', { class: 'k', text: st.family.region === 'City' ? 'Home · the City' : 'Home · the Riverlands' }),
      el('span', { class: 'v', text: locName(st.family.home) || '—' }));
  }
  return el('div', { class: 'cfield home' }, el('span', { class: 'k', text: 'Homes · living apart' }),
    el('span', { class: 'homes-list' }, hh.map((h) => el('span', { class: 'hh' },
      el('span', { class: 'v', text: locName(h.home) }), el('span', { class: 'hhtoks' }, h.members.map((c) => tok(c, { size: 'xs' })))))));
}

/* ------------------------------------------------------------ the location -- */

/** The Location as a plate: its name, Local Traditions, and Scenes with tokens on them. */
function plate(st, loc, cur) {
  if (!loc) return el('div');
  const ph = st.turn.phase;
  const isBorough = loc.name === BOROUGH;
  const region = isBorough ? 'borough' : loc.region === 'City' ? 'city' : 'river';
  const here = (c) => (c.visiting || G.homeOf(st, c)) === loc.name;
  const onScene = new Map();
  const atLoc = [];
  for (const c of G.activeCharacters(st)) {
    if (c.isMemory || !here(c)) continue;
    if (c.scene && loc.scenes.includes(c.scene)) onScene.set(c.scene, [...(onScene.get(c.scene) || []), c]);
    else atLoc.push(c);
  }

  // who is placing a token, and on whose behalf
  let pick = null;
  if (ph === 'choose-scene' && cur && !cur.isMemory && !ui.migrateScene) {
    pick = (s) => up((x) => G.chooseScene(x, find(x, cur.id), s), `${cur.name} places their token on “${s}”${cur.visiting ? ` at ${locName(cur.visiting)}` : ''}.`);
  } else if (ph === 'choose-scene' && cur && cur.isMemory && ui.memTarget) {
    const t = chById(ui.memTarget);
    pick = (s) => up((x) => G.memoryMoveToken(x, find(x, t.id), s), `${cur.name}, as a Memory, places ${t.name}’s token on “${s}”.`)
      .then(() => { ui.memTarget = null; });
  }

  const lines = data.transitLines.filter((l) => l.stations.includes(isBorough ? st.borough.station : loc.name));
  const icons = data.localDecks(loc.name);
  return el('section', { class: `plate ${region} ${pick ? 'picking' : ''}`.trim(), 'aria-label': `The location: ${locName(loc.name)}` },
    el('header', { class: 'platehead' },
      el('div', {},
        el('div', { class: 'eyebrow', text: [isBorough ? 'The Wandering Borough' : loc.region === 'City' ? 'The City of Winter' : 'The Riverlands',
          loc.route ? `by ${loc.route}` : null, cur?.visiting === loc.name ? `${cur.name} is visiting` : homeLabel(st, loc.name)].filter(Boolean).join(' · ') }),
        el('h2', { text: locName(loc.name) })),
      el('div', { class: 'localtrads' }, icons.map((i) => el('span', { class: `ltrad ${i.blank ? 'blank' : ''}`.trim(), title: i.blank ? `Blank ${i.shape} icon: any of ${i.decks.join(', ')}` : i.decks[0] },
        shapeIcon(i.shape), i.blank ? `any ${i.shape}` : i.decks[0])))),
    lines.length || isBorough ? el('div', { class: 'lines' },
      isBorough ? el('span', { class: 'small', text: st.borough.station ? `At ${st.borough.station}’s Station` : 'Not yet at a Station' }) : null,
      lines.map((l) => el('span', { class: 'line', text: l.name }))) : null,
    pick ? el('div', { class: 'pickhint', text: ph === 'choose-scene' && cur.isMemory ? `Choose a Scene for ${chById(ui.memTarget)?.name}’s token` : 'Choose a Scene' }) : null,
    el('div', { class: 'scenegrid' }, loc.scenes.map((s) => {
      const toks = onScene.get(s) || [];
      const mine = cur && toks.some((c) => c.id === cur.id);
      return el(pick ? 'button' : 'div', {
        type: pick ? 'button' : null, class: `scenetile ${toks.length ? 'taken' : ''} ${mine ? 'mine' : ''}`.trim(),
        onclick: pick ? () => pick(s) : null,
      }, el('span', { class: 'sname', text: s }), toks.length ? el('span', { class: 'toks' }, toks.map((c) => tok(c, { size: 'sm' }))) : null);
    })),
    atLoc.length ? el('div', { class: 'athome' }, el('span', { class: 'k', text: 'Tokens on the location' }), atLoc.map((c) => tok(c, { size: 'sm' }))) : null);
}

/* -------------------------------------------------------------- the stage -- */

function renderStage(st, cur) {
  const ph = st.turn.phase;
  const stage = el('section', { class: `stage ph-${ph}`, 'aria-live': 'polite' });
  if (ph === 'chapter-start') return chapterStartStage(st, stage);
  if (ph === 'end-chapter') return endChapterStage(st, stage);
  if (ph === 'session-closed') return sessionClosedStage(st, stage);
  if (ph === 'city-arrival') return cityArrivalStage(st, stage);
  if (ph === 'who-first') return whoFirstStage(st, stage, data.step('Migrate the Family', 'Migrate the family').instruction.split(/\n\s*\n/).pop());
  if (ph === 'migrate-family') return migrateStage(st, stage);
  if (ph === 'apart-offer') return apartOfferStage(st, stage);

  if (!cur) {
    add(stage, stageHead('The family', 'No one can take a turn'),
      instr(data.rule('Becoming forgotten')),
      el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Birth', onclick: () => birthDialog() })));
    return stage;
  }
  if (cur.isMemory && ['choose-scene', 'memory-share'].includes(ph)) return memoryStage(st, cur, stage);
  if (ui.migrateScene && ph === 'choose-scene') return migrationSceneStage(st, cur, stage);

  const TS = 'Tradition Scene';
  if (ph === 'choose-scene') {
    const s1 = data.step(TS, 'Choose a Scene');
    add(stage, stageHead(`${cur.name}’s turn · ${TS}`, s1.name, cur), stepper(TS, 1), instr(s1.instruction));
    const acts = el('div', { class: 'altacts' });
    if (G.regionOf(st, data, cur) === 'City') add(acts, travelBox(st, cur));
    const mig = data.proc('Migration Scene');
    const canMig = G.canPlayMigrationScene(cur);
    add(acts, el('div', { class: 'alt' },
      el('button', { class: 'warm', text: 'Play a Migration Scene instead', disabled: !canMig,
        onclick: () => { ui.migrateScene = true; ui.carry = null; render(S()); } }),
      el('div', { class: 'small muted', text: sentence(mig.instruction, 'play a Migration Scene') })));
    add(stage, acts);
    return stage;
  }

  if (ph === 'share-or-witness') {
    const s2 = data.step(TS, 'Share or witness?');
    add(stage, stageHead(`${cur.name}’s turn · ${TS}`, st.turn.scene, cur), stepper(TS, 2), instr(s2.instruction));
    add(stage, el('div', { class: 'options two' }, shareOption(st, cur, s2), witnessOption(st, cur, s2)));
    add(stage, el('div', { class: 'btnrow' }, el('button', { class: 'ghost tiny', text: '← Choose a different Scene',
      onclick: () => up((s) => { const c = find(s, cur.id); c.scene = null; s.turn.scene = null; s.turn.phase = 'choose-scene'; }) })));
    return stage;
  }

  if (ph === 'lead') return leadStage(st, cur, stage);

  if (ph === 'end-scene') {
    const peek = G.peekPass(st, data);
    const wasMemory = st.turn.sceneKind === 'memory';
    const text = wasMemory ? data.step('Memory Scene', 'Pass the Turn').instruction : data.step(TS, 'End the Scene').instruction;
    add(stage, stageHead(`${cur.name}’s turn · ${wasMemory ? 'Memory Scene' : TS}`, wasMemory ? 'Pass the Turn' : 'End the Scene', cur),
      stepper(wasMemory ? 'Memory Scene' : TS, 5), instr(text));
    const solo = !!st.variants['Solo Play'];
    const btns = el('div', { class: 'btnrow' });
    if (peek) {
      add(btns, el('button', { class: 'primary big', onclick: () => up((s) => G.passTurn(s, data), `${cur.name} ends the scene.`) },
        peek.kind === 'turn' ? ['Pass the turn to ', tok(peek.c, { size: 'sm' }), ` ${peek.c.name}`]
          : peek.kind === 'migrate' ? (G.households(st).length > 1 ? `Pass the turn — ${peek.household.members.map((c) => c.name).join(' & ')} migrate` : 'Pass the turn — the family migrates')
            : 'Pass the turn'));
    }
    add(stage, btns);
    if (solo) {
      add(stage, el('h4', { text: 'Or act as another main character' }),
        pickChars(G.activeCharacters(st).filter((c) => c.id !== cur.id && !c.hadMigrationScene), null,
          (c) => up((s) => G.giveTurnTo(s, c.id), `${cur.name} ends the scene; the story turns to ${c.name}.`)));
    }
    return stage;
  }

  add(stage, stageHead('The table', 'The table is quiet'),
    el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Begin a turn',
      onclick: () => up((s) => { s.turn.phase = 'choose-scene'; }) })));
  return stage;
}

/* ---- Travel (City) */
function travelBox(st, cur) {
  const reach = G.travelTargets(st, data, cur);
  const box = el('div', { class: 'alt' });
  add(box, el('button', {
    text: ui.travel ? 'Close the Transit map' : `Travel… (${cur.cityMarks} City Mark${cur.cityMarks === 1 ? '' : 's'})`,
    disabled: !reach.length && !cur.visiting, onclick: () => { ui.travel = !ui.travel; render(S()); },
  }), el('div', { class: 'small muted', text: sentence(data.rule('Transit Lines & Stations'), 'option to Travel') }));
  if (ui.travel) {
    add(box, el('div', { class: 'travel' },
      instr(data.rule('Travel')),
      reach.some((r) => r.derived) ? el('p', { class: 'small muted', text: '* Wintermount is absent from the printed distance table; its distances are derived from its Moon Path adjacencies.' }) : null,
      el('div', { class: 'destgrid' }, reach.map((r) => el('button', {
        type: 'button', class: `dest ${cur.visiting === r.to ? 'on' : ''}`.trim(),
        onclick: () => up((s) => { const c = find(s, cur.id); c.visiting = r.to === G.homeOf(s, c) ? null : r.to; c.scene = null; },
          `${cur.name} travels to ${locName(r.to)}.`).then(() => { ui.travel = false; render(S()); }),
      }, el('span', { class: 'nm', text: locName(r.to) }), el('span', { class: 'cost', text: `${r.cost}${r.derived ? '*' : ''}` })))),
      cur.visiting ? el('button', { class: 'ghost tiny', text: `Return Home to ${locName(G.homeOf(st, cur))}`,
        onclick: () => up((s) => { const c = find(s, cur.id); c.visiting = null; c.scene = null; }, `${cur.name} returns home.`) }) : null));
  }
  return box;
}

/* ---- Share / Witness options */
function shareOption(st, cur, s2) {
  const o = s2.options.find((x) => x.name === 'Share a Tradition');
  const can = cur.hand.length > 0;
  return el('div', { class: `option ${can ? '' : 'off'}`.trim() },
    el('h3', { text: o.name }), instr(o.instruction),
    can ? el('div', {},
      el('div', { class: 'small muted', text: 'Choose the card from your hand:' }),
      el('div', { class: 'cardrow' }, cur.hand.map((id) => cardEl(card(id), data, {
        onclick: () => up((s) => G.shareTradition(s, find(s, cur.id), id), `${cur.name} plays a card face down.`),
      })))) : null);
}

function witnessOption(st, cur, s2) {
  const loc = whereIs(st, cur);
  const opts = G.witnessOptions(st, data, loc.name);
  const inCity = G.regionOf(st, data, cur) === 'City';
  const solo = !!st.variants['Solo Play'];
  const recips = G.activeCharacters(st).filter((c) => c.id !== cur.id);
  if (!ui.witness || ui.witness.loc !== loc.name || ui.witness.n !== opts.length) {
    ui.witness = { loc: loc.name, n: opts.length, picks: opts.map((o) => (o.blank ? (o.decks.length === 1 ? o.decks[0] : null) : o.decks[0])), to: recips.length === 1 ? recips[0].id : null };
  }
  const w = ui.witness;
  const o = s2.options.find((x) => x.name === 'Witness a Tradition');
  const box = el('div', { class: 'option' }, el('h3', { text: o.name }));
  if (inCity) {
    add(box, instr(data.rule('Witnessing in the City')));
    if (opts.some((x) => x.blank)) add(box, details('Blank Tradition Icons', instr(data.rule('Blank Tradition Icons'))));
  } else {
    add(box, instr(o.instruction));
  }
  if (solo) add(box, details('Solo Play', instr(sentence(data.optional('Solo Play').text, 'When you would Witness'))));
  opts.forEach((op, i) => {
    add(box, el('div', { class: 'drawrow' },
      el('span', { class: 'k' }, shapeIcon(op.shape), op.blank ? `Blank ${op.shape} icon` : `${op.decks[0]} icon`),
      el('div', { class: 'deckpicks' }, op.decks.map((d) => el('button', {
        type: 'button', class: `deckpick ${w.picks[i] === d ? 'on' : ''} ${d === 'Umbra' ? 'umbra' : ''}`.trim(), 'aria-pressed': String(w.picks[i] === d),
        onclick: () => { w.picks[i] = d; render(S()); },
      }, shapeIcon(data.byDeck.get(d)?.shape), d)))));
  });
  add(box, el('div', { class: 'k small', text: solo ? 'Give the cards to (optional in Solo Play)' : 'Give the cards to' }),
    pickChars(recips, w.to, (c) => { w.to = w.to === c.id ? null : c.id; render(S()); }),
    details('Juggling roles', instr(data.guidanceText('role-juggling'))));
  const ready = w.picks.every(Boolean) && (w.to || solo);
  add(box, el('div', { class: 'btnrow' }, el('button', {
    class: 'primary', text: `Draw ${w.picks.length} card${w.picks.length === 1 ? '' : 's'}`, disabled: !ready,
    onclick: () => up((s) => G.witnessTradition(s, data, find(s, cur.id), w.to, w.picks),
      `${cur.name} draws from ${w.picks.join(', ')}${w.to ? ` and gives ${w.picks.length === 1 ? 'it' : 'them'} to ${chById(w.to).name}` : ''}.`)
      .then(() => { ui.witness = null; ui.passPick = null; }),
  })));
  return box;
}

/* ---- Steps 3–4: lead the scene, pass on the Tradition */
function leadStage(st, cur, stage) {
  const TS = 'Tradition Scene';
  const s3 = data.step(TS, 'Lead the scene');
  const kind = st.turn.sceneKind;
  add(stage, stageHead(`${cur.name}’s turn · ${TS}`, st.turn.scene, cur), stepper(TS, [3, 4]),
    el('h4', { text: s3.name }), instr(s3.instruction),
    details('Scene Advice', el('div', { class: 'lore', html: miniMarkdown(data.loreByTitle('Scene Advice').markdown.replace(/^# .*\n/, '')) })));

  const s4 = data.step(TS, 'Pass on the Tradition');
  add(stage, el('h4', { text: s4.name }), instr(s4.instruction));
  const entries = st.table;

  if (kind === 'share') {
    const t = entries[0];
    const o = s4.options.find((x) => x.name === 'Share the Tradition');
    const recips = G.livingCharacters(st).filter((c) => c.id !== cur.id);
    add(stage, el('div', { class: 'tablecards' }, entries.map((e) => el('div', { class: 'tslot' },
      cardEl(card(e.cardId), data, { facedown: !e.revealed, onclick: () => up((s) => { const x = s.table.find((y) => y.cardId === e.cardId); x.revealed = !x.revealed; }),
        title: e.revealed ? 'Turn it face down' : 'Turn it over' }),
      el('span', { class: 'small muted', text: e.revealed ? 'played' : 'face down — turn it over when you share it' })))),
    instr(o.instruction),
    el('div', { class: 'k small', text: 'Share it with' }),
    pickChars(recips, t?.to, (c) => up((s) => G.setShareRecipient(s, t.cardId, c.id))),
    el('div', { class: 'btnrow' }, el('button', {
      class: 'primary big', text: t?.to ? `Pass the card to ${chById(t.to)?.name}` : 'Pass on the Tradition', disabled: !t || !t.to,
      onclick: () => up((s) => G.passOnTradition(s, data, t.cardId), `${cur.name} shares “${card(t.cardId).prompt}” with ${chById(t.to).name}.`),
    })));
    return stage;
  }

  // Witness
  const o = s4.options.find((x) => x.name === 'Witness the Tradition');
  const holder = entries[0]?.to ? chById(entries[0].to) : null;
  const inCity = G.regionOf(st, data, cur) === 'City';
  // A face-down card must not give itself away: only a revealed Borough card is marked unpassable.
  const passable = entries.filter((e) => !(card(e.cardId).isBoroughWanders && e.revealed));
  if (!passable.some((e) => e.cardId === ui.passPick)) ui.passPick = passable.length === 1 ? passable[0].cardId : null;

  add(stage, holder
    ? el('p', { class: 'holder' }, who(holder), ` holds ${entries.length === 1 ? 'the card' : `${entries.length} cards`} and reads ${entries.length === 1 ? 'it' : 'them'} privately.`)
    : null,
  instr(o.instruction),
  inCity && entries.length > 1 ? details('During a scene (City)', instr(data.rule('During a scene'))) : null);

  add(stage, el('div', { class: 'tablecards' }, entries.map((e) => {
    const c = card(e.cardId);
    const peeking = ui.peek === e.cardId;
    const slot = el('div', { class: `tslot ${ui.passPick === e.cardId ? 'kept' : ''}`.trim() },
      cardEl(c, data, { facedown: !e.revealed && !peeking }));
    const peekBtn = el('button', { class: 'tiny ghost', text: peeking ? 'Reading…' : 'Hold to read privately', disabled: e.revealed });
    const on = (ev) => { ev.preventDefault(); ui.peek = e.cardId; render(S()); };
    const off = () => { if (ui.peek) { ui.peek = null; render(S()); } };
    peekBtn.addEventListener('pointerdown', on);
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) peekBtn.addEventListener(ev, off);
    add(slot, el('div', { class: 'slotacts' },
      e.revealed ? null : peekBtn,
      el('button', { class: 'tiny', text: e.revealed ? 'Played' : 'Play it', disabled: e.revealed,
        onclick: () => up((s) => { s.table.find((y) => y.cardId === e.cardId).revealed = true; },
          `${holder?.name || 'The holder'} plays “${c.prompt}”.`).then(() => { if (c.isBoroughWanders) boroughPanel(); }) }),
      entries.length > 1 && !(c.isBoroughWanders && e.revealed) ? el('button', { class: `tiny ${ui.passPick === e.cardId ? 'primary' : 'ghost'}`, text: ui.passPick === e.cardId ? 'Passed on' : 'Pass this one',
        onclick: () => { ui.passPick = e.cardId; render(S()); } }) : null,
      c.isBoroughWanders && e.revealed ? el('span', { class: 'small muted', text: 'See The Borough Wanders, below.' }) : null));
    return slot;
  })));

  if (entries.some((e) => card(e.cardId).isBoroughWanders && e.revealed)) {
    add(stage, el('div', { class: 'callout borough' }, instr(data.rule('The Borough Wanders')),
      el('div', { class: 'btnrow' }, el('button', { class: 'tiny', text: 'The Wandering Borough…', onclick: boroughPanel }))));
  }

  const pick = ui.passPick;
  add(stage, el('div', { class: 'btnrow' }, el('button', {
    class: 'primary big',
    text: pick ? `Pass the card to ${cur.name}` : passable.length ? 'Choose the card to pass on' : 'End the scene — nothing to pass on',
    disabled: passable.length > 0 && !pick,
    onclick: () => up((s) => G.passOnTradition(s, data, pick),
      pick && !card(pick).isBoroughWanders ? `${holder?.name || 'The locals'} pass${holder ? 'es' : ''} “${card(pick).prompt}” to ${cur.name}.` : 'The witnessed cards go to the bottom of their decks.')
      .then(() => { ui.passPick = null; }),
  })));
  return stage;
}

/* ---- Migration Scene */
function migrationSceneStage(st, cur, stage) {
  const MS = 'Migration Scene';
  const proc = data.proc(MS);
  const lim = G.handLimit(cur);
  if (!ui.carry) ui.carry = new Set(cur.hand.slice(0, lim));
  const over = cur.hand.length > lim;
  add(stage, stageHead(`${cur.name}’s turn`, MS, cur), stepper(MS, [1, 2, 3]),
    details('What a Migration Scene is', instr(proc.instruction)),
    stepBlock(1, proc.steps[0].name, '', instr(proc.steps[0].instruction)),
    stepBlock(2, proc.steps[1].name, '', instr(proc.steps[1].instruction),
      over ? el('div', {},
        el('p', { class: 'small', text: `${cur.name} may carry ${lim} — carrying ${ui.carry.size}.` }),
        el('div', { class: 'cardrow' }, cur.hand.map((id) => cardEl(card(id), data, {
          chosen: ui.carry.has(id), dim: !ui.carry.has(id),
          onclick: () => { if (ui.carry.has(id)) ui.carry.delete(id); else if (ui.carry.size < lim) ui.carry.add(id); render(S()); },
        }))))
        : el('p', { class: 'small muted', text: `${cur.name} holds ${cur.hand.length} of ${lim} and carries everything.` })),
    stepBlock(3, proc.steps[2].name, '', instr(proc.steps[2].instruction),
      el('div', { class: 'btnrow' },
        el('button', { class: 'ghost', text: '← Not yet', onclick: () => { ui.migrateScene = false; render(S()); } }),
        el('button', {
          class: 'primary big', text: 'Pass the turn', disabled: over && ui.carry.size !== lim,
          onclick: () => {
            const keep = over ? [...ui.carry] : cur.hand.slice();
            const laid = cur.hand.length - keep.length;
            ui.migrateScene = false; ui.carry = null;
            up((s) => {
              const c = find(s, cur.id);
              G.layDownExcess(s, c, keep);
              G.finishMigrationScene(s, c);
              G.passTurn(s, data);
            }, `${cur.name} plays a Migration Scene${laid ? ` and lays down ${laid} card${laid === 1 ? '' : 's'}` : ''}.`);
          },
        }))));
  return stage;
}

/* ---- Migrate the Family */
function migrateStage(st, stage) {
  const MF = 'Migrate the Family';
  const proc = data.proc(MF);
  const [s1, s2, s3, s4] = proc.steps;
  const dests = G.migrationDestinations(st, data);
  const m = st.migration || { destination: null, entrance: null };
  const dest = m.destination;
  const arrival = dest && G.isArrival(data, dest);
  const destLoc = dest ? data.byLocation.get(dest) : null;
  const short = G.migrationSavers(st);
  const cards = G.migrationCards(st);
  const group = (m.group || []).map(chById).filter(Boolean);
  const whole = !m.apart && G.households(st).length <= 1;
  const fromRegion = data.byLocation.get(m.from || st.family.home)?.region;
  const setDest = (s, to) => { s.migration = { ...s.migration, destination: to, entrance: null }; };

  add(stage, stageHead(m.apart ? `${group.map((c) => c.name).join(' & ')} · from ${locName(m.from)}` : whole ? 'The whole family' : `${group.map((c) => c.name).join(' & ')} · from ${locName(m.from)}`,
    m.apart ? 'Migrate Apart' : MF),
  stepper(MF, [!dest || (arrival && !m.entrance) ? 1 : cards.length ? (short.length ? 2 : 3) : 4]),
  m.apart ? el('div', { class: 'callout' }, el('h3', { text: 'Migrate apart' }), instr(data.rule('Migrate apart')), details('Living apart', instr(data.guidanceText('different-homes'))))
    : whole ? instr(proc.instruction) : el('div', {}, instr(proc.instruction), details('Living apart', instr(data.guidanceText('different-homes')))),
  group.length ? el('div', { class: 'pickrow' }, group.map((c) => el('span', { class: 'pick on' }, tok(c, { size: 'sm' }), el('span', { text: c.name })))) : null);

  // 1. destination
  add(stage, stepBlock(1, s1.name, dest && (!arrival || m.entrance) ? 'done' : '',
    instr(fromRegion === 'City' ? data.rule('Migration in the City') : s1.instruction),
    dests.some((d) => d.route) ? details('By ship or by caravan', instr(data.guidanceText('by-ship-or-by-caravan'))) : null,
    el('div', { class: 'destgrid' }, dests.map((d) => el('button', {
      type: 'button', class: `dest ${dest === d.to ? 'on' : ''}`.trim(), 'aria-pressed': String(dest === d.to),
      onclick: () => up((s) => setDest(s, d.to)),
    }, el('span', { class: 'nm', text: locName(d.to) }), el('span', { class: 'why', text: d.why }),
      el('span', { class: 'trads' }, (data.byLocation.get(d.to)?.traditions || []).map((t) => shapeIcon(t.startsWith('ANY:') ? t.slice(4) : data.byDeck.get(t)?.shape)))))),
    arrival ? el('div', { class: 'entrances' },
      el('h4', { text: locName(dest) }),
      el('div', { class: 'destgrid' }, destLoc.entrances.map((e) => el('button', {
        type: 'button', class: `dest entrance ${m.entrance === e.target ? 'on' : ''}`.trim(), 'aria-pressed': String(m.entrance === e.target),
        onclick: () => up((s) => { s.migration.entrance = e.target; }),
      }, el('span', { class: 'nm', text: e.text }))))) : null));

  // 2. what is saved
  const saveable = cards.length && short.length;
  add(stage, stepBlock(2, s2.name, !saveable ? 'done' : '', instr(s2.instruction),
    saveable ? el('div', { class: 'poolsave' }, cards.map((id) => el('div', { class: 'tslot' },
      cardEl(card(id), data),
      el('div', { class: 'slotacts' }, short.map((c) => el('button', {
        class: 'tiny', title: `${c.name} saves it`,
        onclick: () => up((s) => G.saveTradition(s, find(s, c.id), id), `${c.name} saves “${card(id).prompt}”.`),
      }, tok(c, { size: 'xs' }), ` ${c.name}`)))))) : el('p', { class: 'small muted', text: cards.length ? 'Every hand is full.' : 'Nothing was left face-up.' })));

  // 3. what is left
  add(stage, stepBlock(3, s3.name, !cards.length ? 'done' : '', instr(s3.instruction),
    cards.length ? el('div', { class: 'poolsave' }, cards.map((id) => el('div', { class: 'tslot' },
      cardEl(card(id), data),
      el('div', { class: 'slotacts' }, el('button', { class: 'tiny danger', text: 'Left behind',
        onclick: () => up((s) => G.leaveBehind(s, data, id), `“${card(id).prompt}” is left behind.`) }))))) : null));

  // 4. migrate
  const target = arrival ? m.entrance : dest;
  const ready = target && !cards.length;
  add(stage, stepBlock(4, s4.name, '', instr(s4.instruction),
    el('div', { class: 'btnrow' }, el('button', {
      class: 'primary big', disabled: !ready,
      text: ready ? `Migrate to ${locName(target)}` : !dest ? 'Choose a destination first' : arrival && !m.entrance ? 'Choose how we enter the City' : 'Save or leave behind every face-up card first',
      onclick: () => up((s) => {
        const r = G.migrateFamily(s, data, target);
        // A group Migrating Apart used its turn to do so; play goes on from there.
        if (r.apart) G.passTurn(s, data);
        else s.turn.phase = r.entering ? 'city-arrival' : 'who-first';
      }, arrival ? `At last we reach the City of Winter ${destLoc.entrances.find((e) => e.target === target).text.replace(/^\.\.\./, '…')}`
        : m.apart ? `${group.map((c) => c.name).join(' & ')} migrate${group.length === 1 ? 's' : ''} apart, to ${locName(target)}.`
          : whole ? `The family migrates to ${locName(target)}.` : `${group.map((c) => c.name).join(' & ')} migrate${group.length === 1 ? 's' : ''} to ${locName(target)}.`),
    }))));
  return stage;
}

/**
 * Migrate Apart (p.43): the turn has reached someone who has had their
 * Migration Scene. They wait — skipping the turn — or Migrate Apart, with any
 * who have also had theirs.
 */
function apartOfferStage(st, stage) {
  const c = chById(st.turn.offer) || G.currentCharacter(st);
  const MS = data.proc('Migration Scene');
  const companions = G.apartCompanions(st, c);
  if (!ui.apart || ui.apart.for !== c.id) ui.apart = { for: c.id, join: new Set() };
  const join = ui.apart.join;
  add(stage, stageHead(`${c.name}’s turn · waiting to migrate`, 'Migrate Apart?', c),
    instr(MS.steps[2].instruction),
    el('div', { class: 'callout' }, instr(data.rule('Migrate apart')), details('Living apart', instr(data.guidanceText('different-homes')))),
    el('div', { class: 'options two' },
      el('div', { class: 'option' }, el('h3', { text: 'Wait for the family' }),
        el('p', { class: 'small muted', text: `${c.name}’s turn passes to the next player.` }),
        el('button', { text: 'Skip the turn', onclick: () => up((s) => G.passTurn(s, data), `${c.name} waits for the family.`) })),
      el('div', { class: 'option' }, el('h3', { text: 'Migrate Apart' }),
        companions.length ? el('div', {}, el('div', { class: 'k small', text: 'Who joins them?' }),
          pickChars(companions, join, (x) => { if (join.has(x.id)) join.delete(x.id); else join.add(x.id); render(S()); },
            { note: (x) => (join.has(x.id) ? 'joins' : '') })) : el('p', { class: 'small muted', text: 'No one else has had their Migration Scene yet.' }),
        el('button', { class: 'warm', text: join.size ? `Migrate Apart — ${[c, ...companions.filter((x) => join.has(x.id))].map((x) => x.name).join(' & ')}` : `${c.name} migrates apart`,
          onclick: () => {
            const ids = [...join];
            ui.apart = null;
            up((s) => G.migrateApart(s, c.id, ids), `${[c, ...companions.filter((x) => ids.includes(x.id))].map((x) => x.name).join(' & ')} choose${ids.length ? '' : 's'} to Migrate Apart.`);
          } }))));
  return stage;
}

function cityArrivalStage(st, stage) {
  const P = data.proc('Migrating to the City');
  add(stage, stageHead('The City of Winter', P.name), instr(P.instruction),
    P.steps.map((s) => stepBlock(s.n, s.name, 'done', instr(s.instruction))),
    el('div', { class: 'btnrow' }, el('button', { class: 'primary big', text: 'Open the City Map', onclick: () => up((s) => { s.turn.phase = 'who-first'; }) })));
  return stage;
}

function whoFirstStage(st, stage, text) {
  add(stage, stageHead(locName(st.family.home), 'Who takes the first turn?'), instr(text),
    pickChars(G.activeCharacters(st), null, (c) => up((s) => G.giveTurnTo(s, c.id), `${c.name} takes the first turn.`)));
  return stage;
}

/* ---- Memory Scene */
function memoryStage(st, cur, stage) {
  const MS = 'Memory Scene';
  const proc = data.proc(MS);
  const [s1, s2, s3, s4] = proc.steps;
  const ph = st.turn.phase;
  const targets = G.livingCharacters(st).filter((c) => c.id !== cur.id);

  if (ph === 'choose-scene') {
    add(stage, stageHead(`${cur.name}’s turn · a Memory`, MS, cur), stepper(MS, 1),
      details('Playing a Memory', instr(proc.instruction)), instr(s1.instruction));
    if (!targets.length) {
      add(stage, el('p', { class: 'muted', text: 'There is no living character whose token could be moved.' }),
        el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Pass the turn', onclick: () => up((s) => G.passTurn(s, data)) })));
      return stage;
    }
    if (!targets.some((t) => t.id === ui.memTarget)) ui.memTarget = targets.length === 1 ? targets[0].id : null;
    add(stage, el('div', { class: 'k small', text: 'Whose token?' }),
      pickChars(targets, ui.memTarget, (c) => { ui.memTarget = c.id; render(S()); }),
      ui.memTarget ? el('p', { class: 'small muted', text: `Now choose a Scene below for ${chById(ui.memTarget).name}.` }) : null);
    return stage;
  }

  // memory-share
  const target = chById(st.turn.memoryTarget);
  const played = st.table.find((t) => t.kind === 'memory');
  add(stage, stageHead(`${cur.name}’s turn · a Memory`, st.turn.scene, cur), stepper(MS, played ? [3, 4] : 2),
    stepBlock(2, s2.name, played ? 'done' : '', instr(s2.instruction),
      played ? el('div', { class: 'tablecards' }, el('div', { class: 'tslot' }, cardEl(card(played.cardId), data, {
        facedown: !played.revealed, onclick: () => up((s) => { const x = s.table.find((y) => y.kind === 'memory'); x.revealed = !x.revealed; }),
      })))
        : el('div', { class: 'cardrow' }, cur.hand.map((id) => cardEl(card(id), data, {
          onclick: () => up((s) => G.memoryPlay(s, find(s, cur.id), id), `${cur.name}’s memory plays a card face down for ${target.name}.`),
        })))),
    played ? stepBlock(3, s3.name, '', instr(s3.instruction)) : null,
    played ? stepBlock(4, s4.name, '', instr(s4.instruction),
      el('div', { class: 'btnrow' }, el('button', { class: 'primary big', text: `Give the card to ${target.name}`,
        onclick: () => up((s) => {
          const r = G.memoryGive(s);
          s.turn.sceneKind = 'memory';
          if (r?.forgotten) s.log.unshift({ at: new Date().toISOString(), text: `${cur.name} has shared their last Tradition and is forgotten.`, ch: s.family.chapter });
        }, `${cur.name}’s memory shares “${card(played.cardId).prompt}” with ${target.name}.`) }))) : null);
  return stage;
}

/* ---- Ending a Chapter */
function endChapterStage(st, stage) {
  const EC = 'Ending a Chapter';
  const proc = data.proc(EC);
  const [s1, s2, s3, s4] = proc.steps;
  const ce = st.chapterEnd || { marked: {}, held: {} };
  const living = G.livingCharacters(st);
  const cityOf = (c) => G.regionOf(st, data, c) === 'City';
  const inCity = living.some(cityOf);
  const allMarked = living.every((c) => ce.marked[c.id]);
  const gained = living.filter((c) => ['age', 'city'].includes(ce.marked[c.id]));
  const overs = living.filter((c) => c.hand.length > G.handLimit(c));
  const unders = living.filter((c) => c.hand.length < G.handLimit(c));
  const at = !allMarked ? 1 : overs.length || st.pool.length ? 3 : 4;

  add(stage, stageHead(`Chapter ${st.family.chapter}`, EC), stepper(EC, at === 1 ? 1 : at === 3 ? [2, 3] : 4), instr(proc.instruction));

  // 1. Mark Age
  add(stage, stepBlock(1, s1.name, allMarked ? 'done' : '', instr(s1.instruction),
    inCity ? details('City Marks', instr(data.concept('City Marks'))) : null,
    el('div', { class: 'markrows' }, living.map((c) => {
      const done = ce.marked[c.id];
      const elder = G.isElder(c);
      const inCity = cityOf(c);
      const doMark = (opts = {}) => up((s) => {
        const x = find(s, c.id);
        const r = G.markAge(s, data, x, opts);
        s.chapterEnd.marked[c.id] = r.kind;
      }, elder ? `${c.name} crosses off a ${opts.crossCityMark ? 'City ' : ''}Mark.` : `${c.name} gains a ${inCity ? 'City ' : ''}Mark.`);
      return el('div', { class: `markrow ${done ? 'done' : ''}`.trim() },
        who(c), el('span', { class: 'tierlabel', text: data.tierForMarks(c.marks) }),
        el('span', { class: 'mk' }, marksRow(c.marks, c.crossed), c.cityMarks ? marksRow(c.cityMarks, c.cityCrossed, 'city') : null),
        el('span', { class: 'grow' }),
        done
          ? el('span', { class: 'did' }, { age: 'gained a Mark', city: 'gained a City Mark', cross: 'crossed off a Mark', 'cross-city': 'crossed off a City Mark' }[done],
            el('button', { class: 'x', title: 'Undo', text: '↶', onclick: () => up((s) => { G.unmarkAge(find(s, c.id), done); delete s.chapterEnd.marked[c.id]; }) }))
          : el('span', { class: 'btnrow tight' },
            el('button', { class: 'tiny primary', text: elder ? 'Cross off a Mark' : inCity ? 'Add a City Mark' : 'Add a Mark', onclick: () => doMark() }),
            elder && c.cityMarks > c.cityCrossed ? el('button', { class: 'tiny', text: 'Cross off a City Mark', onclick: () => doMark({ crossCityMark: true }) }) : null));
    }))));

  // 2. New Bonds
  add(stage, stepBlock(2, s2.name, '', instr(s2.instruction),
    gained.length ? el('div', { class: 'bondgrid' }, gained.map((c) => el('div', { class: 'bondcard' },
      el('div', { class: 'bondhead' }, who(c, el('span', { class: 'tierlabel', text: data.tierForMarks(c.marks) }))),
      bondList(c),
      bondComposer(c, { lists: data.bondsAtOrBelow(data.tierForMarks(c.marks)), banners: G.bondBanners(st, data, c), exclude: c.name }),
      c.cityMarks >= 1 ? details('Or a City Bond', instr(data.rule('City Bonds')),
        bondComposer(c, { lists: data.cityBondsAtOrBelow(c.cityMarks), banners: G.bondBanners(st, data, c), exclude: c.name, label: 'Make the City Bond', city: true })) : null)))
      : el('p', { class: 'small muted', text: allMarked ? 'No one gained a Mark this Chapter.' : 'Mark Age first.' })));

  // 3. Hold Traditions
  const hold = el('div', {});
  for (const c of overs) {
    const lim = G.handLimit(c);
    if (!ui.keep[c.id]) ui.keep[c.id] = new Set(c.hand.slice(0, lim));
    const keep = ui.keep[c.id];
    add(hold, el('div', { class: 'holdrow' },
      el('div', { class: 'small' }, who(c), ` carries ${lim} of ${c.hand.length} — choose which:`),
      el('div', { class: 'cardrow' }, c.hand.map((id) => cardEl(card(id), data, { chosen: keep.has(id), dim: !keep.has(id), size: 'sm',
        onclick: () => { if (keep.has(id)) keep.delete(id); else if (keep.size < lim) keep.add(id); render(S()); } }))),
      el('div', { class: 'btnrow' }, el('button', { class: 'tiny primary', text: 'Place the extras face-up', disabled: keep.size !== lim,
        onclick: () => up((s) => G.holdTraditions(s, find(s, c.id), [...keep]), `${c.name} places ${c.hand.length - lim} card${c.hand.length - lim === 1 ? '' : 's'} face-up.`)
          .then(() => { delete ui.keep[c.id]; }) }))));
  }
  if (st.pool.length) {
    const takers = unders.filter((c) => !overs.includes(c));
    add(hold, el('div', { class: 'poolsave' }, st.pool.map((id) => el('div', { class: 'tslot' },
      cardEl(card(id), data, { size: 'sm' }),
      el('div', { class: 'slotacts' }, takers.map((c) => el('button', { class: 'tiny', title: `${c.name} takes it`,
        onclick: () => up((s) => G.saveTradition(s, find(s, c.id), id), `${c.name} takes “${card(id).prompt}”.`) }, tok(c, { size: 'xs' }), ` ${c.name}`)))))),
    el('div', { class: 'btnrow' }, el('button', { class: 'tiny danger', text: `Discard the remaining ${st.pool.length}`, disabled: overs.length > 0,
      onclick: () => up((s) => G.discardPool(s, data), `The remaining ${S().pool.length} card${S().pool.length === 1 ? ' is' : 's are'} discarded.`) })));
  }
  if (!overs.length && !st.pool.length) add(hold, el('p', { class: 'small muted', text: 'Every hand is within its Marks of Age.' }));
  add(stage, stepBlock(3, s3.name, !overs.length && !st.pool.length ? 'done' : '', instr(s3.instruction), hold));

  // 4. New Chapter or End the session?
  const ready = allMarked && !overs.length && !st.pool.length;
  const [newCh, reflect] = s4.options;
  add(stage, stepBlock(4, s4.name, '', instr(s4.instruction),
    el('div', { class: 'options two' },
      el('div', { class: 'option' }, el('h3', { text: newCh.name }), instr(newCh.instruction),
        el('button', { class: 'primary', text: `Begin Chapter ${st.family.chapter + 1}`, disabled: !ready,
          onclick: () => up((s) => { G.closeChapter(s, data); G.startNewChapter(s); }, `Chapter ${S().family.chapter} closes. Chapter ${S().family.chapter + 1} begins.`) })),
      el('div', { class: 'option' }, el('h3', { text: reflect.name }), instr(reflect.instruction),
        el('button', { class: '', text: 'End the session', disabled: !ready,
          onclick: () => up((s) => { G.closeChapter(s, data); G.closeSession(s); }, `Chapter ${S().family.chapter} closes, and the session ends.`) }))),
    !ready ? el('p', { class: 'small muted', text: !allMarked ? 'Everyone marks age first.' : 'Hold Traditions first.' }) : null,
    el('div', { class: 'btnrow' }, el('button', { class: 'ghost tiny', text: '← Not yet — back to the Chapter',
      disabled: Object.keys(ce.marked).length > 0,
      title: Object.keys(ce.marked).length ? 'Undo the Marks first' : '',
      onclick: () => up((s) => { s.chapterEnd = null; s.turn.phase = 'choose-scene'; }, 'The Chapter goes on.') }))));
  return stage;
}

/* ---- The start of a Chapter */
function chapterStartStage(st, stage) {
  const cs = st.chapterStart || { rolled: {}, continuing: false };
  const rolls = !cs.continuing && !cs.first;
  const elders = rolls ? G.livingCharacters(st).filter((c) => G.isElder(c)) : [];
  const died = st.characters.filter((c) => cs.rolled[c.id]?.died);
  const allRolled = elders.every((c) => cs.rolled[c.id]);
  const boroughDue = !cs.continuing && st.borough.isHome;
  const boroughDone = !boroughDue || !!cs.borough?.station;

  add(stage, stageHead(`Session ${st.family.session}`, cs.continuing ? `Chapter ${st.family.chapter} continues` : `Chapter ${st.family.chapter} begins`));
  if (cs.fromSession) {
    const NS = data.proc('New Session Setup');
    add(stage, el('div', { class: 'steps compact' }, NS.steps.map((s) => stepBlock(s.n, s.name, '', instr(s.instruction)))));
  } else if (!cs.first) {
    add(stage, instr(data.step('Ending a Chapter', 'New Chapter or End the session?').options[0].instruction));
  }

  // Death & Memory
  if (elders.length) {
    const WD = data.proc('When You Die');
    add(stage, stepBlock('☾', 'The Elders roll', allRolled ? 'done' : '', instr(WD.instruction.split(/\n\s*\n/).slice(0, 2).join('\n\n')),
      el('div', { class: 'markrows' }, elders.map((c) => {
        const r = cs.rolled[c.id];
        return el('div', { class: `markrow ${r ? 'done' : ''}`.trim() },
          who(c), el('span', { class: 'mk' }, marksRow(c.marks, c.crossed)),
          el('span', { class: 'small muted', text: `${c.crossed} crossed off` }),
          el('span', { class: 'grow' }),
          r ? el('span', { class: 'rolled' }, dieFace(r.roll, { size: 34 }), el('span', { text: r.died ? 'dies of old age' : 'lives on' }))
            : el('button', { class: 'tiny primary', text: '🎲 Roll the Die', onclick: () => {
              const res = G.rollForDeath({ ...c });
              up((s) => {
                s.chapterStart.rolled[c.id] = { roll: res.roll, died: res.died };
                const x = find(s, c.id);
                x.deathRolled = true;
                if (res.died) G.becomeMemory(s, x);
              }, `${c.name} rolls ${res.roll} against ${c.crossed} crossed-off Mark${c.crossed === 1 ? '' : 's'} — ${res.died ? 'and dies of old age, passing into memory.' : 'and lives on.'}`);
            } }));
      }))));
    for (const c of died) {
      const madeBond = c.bonds.some((b) => b.memory);
      add(stage, stepBlock('☾', `${c.name} becomes a Memory`, madeBond ? 'done' : '',
        WD.steps.map((s) => el('div', {}, el('b', { text: s.name }), instr(s.instruction))),
        bondList(c, { removable: false }),
        madeBond ? null : bondComposer(c, { lists: [data.memoryBonds()], exclude: c.name, label: 'Make the Memory Bond', memory: true })));
    }
  }

  // Living on the Borough
  if (boroughDue) {
    add(stage, stepBlock('⌂', 'Living on the Borough', boroughDone ? 'done' : '', instr(data.rule('Living on the Borough')), boroughRoller(st, 'chapter')));
  }

  // Birth
  const bornFor = st.characters.filter((c) => c.isMemory || c.forgotten);
  if (!cs.first) {
    const B = data.proc('Birth');
    add(stage, stepBlock('✦', B.name, '', instr(B.instruction),
      details(bornFor.length ? `A new character for ${bornFor.map((c) => c.name).join(', ')}’s player` : 'A new player joins the family',
        birthForm(), instr(data.guidanceText('rejoining-as-children')))));
  }

  // who goes first
  const ready = allRolled && boroughDone && died.every((c) => c.bonds.some((b) => b.memory));
  add(stage, stepBlock('→', 'Who takes the first turn?', '', instr(data.rule('Starting a New Chapter')),
    ready ? pickChars(G.activeCharacters(st), null, (c) => up((s) => { G.giveTurnTo(s, c.id); s.chapterStart = null; }, `${c.name} takes the first turn of Chapter ${S().family.chapter}.`))
      : el('p', { class: 'small muted', text: !allRolled ? 'Every Elder rolls first.' : !boroughDone ? 'Roll for the Borough first.' : 'Make the Memory Bond first.' })));
  return stage;
}

function sessionClosedStage(st, stage) {
  const reflect = data.step('Ending a Chapter', 'New Chapter or End the session?').options.find((o) => o.name === 'Closing Reflection');
  add(stage, stageHead(`Session ${st.family.session}`, reflect.name), instr(reflect.instruction),
    details('Ending a Campaign', instr(data.guidanceText('ending-a-campaign'))),
    details('Storing the game', instr(data.rule('Storing the Game'))),
    el('div', { class: 'btnrow' }, el('button', { class: 'primary big', text: `Begin Session ${st.family.session + 1}`,
      onclick: () => up((s) => { G.newSession(s); s.chapterStart.fromSession = true; }, `Session ${S().family.session + 1} begins at ${locName(S().family.home)}.`) })),
    el('p', { class: 'small muted', text: st.family.chapterClosed ? `The next session begins Chapter ${st.family.chapter + 1}.` : `Chapter ${st.family.chapter} is still open; the next session continues it.` }));
  return stage;
}

/* ---- Birth */
function birthForm() {
  const st = S();
  const givers = G.livingCharacters(st);
  const childList = data.bondLists.find((b) => b.kind === 'Bonds' && b.tier === 'Child');
  const joiner = data.bondJoiner(childList);
  const name = el('input', { placeholder: 'the name they give you', autocomplete: 'off' });
  const pron = el('input', { placeholder: 'optional' });
  const giver = el('select', {}, givers.map((g) => el('option', { value: g.id, text: g.name })));
  const bond = el('select', {}, [...childList.prompts, data.openPromptWord(childList)].map((p) => el('option', { value: p, text: `${p} ${joiner}…` })));
  const B = data.proc('Birth');
  return el('div', { class: 'birth' },
    el('ol', { class: 'plain' }, B.steps.map((s) => el('li', {}, s.instruction.startsWith(s.name) ? null : el('b', { text: `${s.name}. ` }), s.instruction))),
    el('div', { class: 'addrow' },
      el('label', {}, 'Chosen player', giver),
      el('label', {}, 'Name', name),
      el('label', {}, 'Pronouns', pron),
      el('label', {}, 'Child Bond', bond),
      el('button', { class: 'primary', text: 'Born into the family', disabled: !givers.length, onclick: () => {
        if (!name.value.trim()) { name.focus(); return; }
        const g = givers.find((x) => x.id === giver.value);
        up((s) => G.birth(s, { name: name.value.trim(), pronouns: pron.value.trim(), giverId: g.id, bondPrompt: bond.value, joiner }),
          `${name.value.trim()} is born into the family — ${bond.value} ${joiner} ${g.name}.`);
      } })));
}

/* ---- The Wandering Borough */
function boroughRoller(st, why) {
  const cs = st.chapterStart;
  const r = why === 'chapter' ? cs?.borough : null;
  if (r?.station) return el('p', { class: 'small', text: `The Borough settles at ${r.station}.` });
  if (r?.roll) {
    return el('div', {}, el('div', { class: 'rolled' }, dieFace(r.roll, { size: 40 }), el('b', { text: r.line })),
      el('div', { class: 'destgrid' }, r.stations.map((loc) => el('button', { type: 'button', class: 'dest',
        onclick: () => up((s) => { G.boroughArrives(s, loc); s.chapterStart.borough.station = loc; }, `The Wandering Borough settles at ${loc}.`),
      }, el('span', { class: 'nm', text: loc })))));
  }
  return el('button', { class: 'primary tiny', text: '🎲 Roll the Die', onclick: () => {
    const w = G.boroughWanders(data);
    up((s) => { s.chapterStart.borough = { roll: w.roll, line: w.line, stations: w.stations }; }, `The Die shows ${w.roll}: the Borough wanders along ${w.line}.`);
  } });
}

function boroughPanel() {
  const st = S();
  const cur = G.currentCharacter(st);
  const at = whereIs(st, cur)?.name;
  return modal('The Wandering Borough', (close) => {
    const body = el('div', {}, instr(data.rule('The Wandering Borough')));
    if (st.borough.isHome) {
      add(body, instr(data.rule('Living on the Borough')));
      let res = null;
      const out = el('div', {});
      add(body, out, el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: '🎲 Roll the Die', onclick: () => {
        res = G.boroughWanders(data);
        add(clear(out), el('div', { class: 'rolled' }, dieFace(res.roll, { size: 44 }), el('b', { text: res.line })),
          el('div', { class: 'destgrid' }, res.stations.map((loc) => el('button', { type: 'button', class: 'dest',
            onclick: () => up((s) => G.boroughArrives(s, loc), `The Die shows ${res.roll} — the Borough wanders along ${res.line} to ${loc}.`).then(() => close()),
          }, el('span', { class: 'nm', text: loc })))));
      } })));
    } else if (st.borough.inPlay) {
      add(body, instr(data.rule('The Borough Leaves')),
        el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'The Borough departs',
          onclick: () => up((s) => G.boroughLeaves(s, data), 'The Wandering Borough departs.').then(() => close()) })));
    } else {
      const station = at === BOROUGH ? null : at;
      add(body, instr(data.rule('The Borough Wanders').split(/\n\s*\n/).slice(1).join('\n\n')),
        el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: `The Borough arrives near ${station}`, disabled: !station,
          onclick: () => up((s) => G.boroughArrives(s, station), `The Wandering Borough arrives near ${station}.`).then(() => close()) })),
        details('Transit and the Borough', instr(data.rule('Transit and The Borough'))));
    }
    add(body, el('div', { class: 'btnrow' }, el('button', { class: 'ghost', text: 'Close', onclick: () => close() })));
    return body;
  });
}

/* ---------------------------------------------------------------- family -- */

function familySection(st, cur) {
  const sec = el('section', { class: 'family' },
    el('div', { class: 'sechead' }, el('h2', { text: 'The family' }),
      el('span', { class: 'small muted', text: data.guidanceText('keep-cards-face-down') })));
  add(sec, el('div', { class: 'notecards' }, st.characters.map((c) => notecard(st, c, cur))));
  add(sec, sideCharacters(st));
  return sec;
}

/** Phases in which someone is taking a turn (and so is highlighted). */
const TURN_PHASES = ['choose-scene', 'share-or-witness', 'lead', 'end-scene', 'memory-share', 'apart-offer'];

function notecard(st, c, cur) {
  const isTurn = cur && cur.id === c.id && TURN_PHASES.includes(st.turn.phase);
  const lim = G.handLimit(c);
  const looking = ui.look.has(c.id);
  const apart = c.home && c.home !== st.family.home && !c.isMemory;
  const state = c.forgotten ? 'forgotten' : c.isMemory ? 'a Memory' : c.leaving ? 'leaving' : c.hadMigrationScene ? 'migrating'
    : c.visiting ? `visiting ${locName(c.visiting)}` : apart ? `lives at ${locName(c.home)}` : null;
  return el('article', { class: `notecard ${isTurn ? 'turn' : ''} ${c.isMemory ? 'memory' : ''} ${c.forgotten ? 'forgotten' : ''}`.trim(),
    style: `--tok:${(TOKENS.find((t) => t.id === c.token) || {}).color || 'var(--edge)'}` },
    el('header', {},
      tok(c, { size: 'lg' }),
      el('div', { class: 'nmblock' },
        el('h3', {}, c.name, c.pronouns ? el('span', { class: 'pronouns', text: c.pronouns }) : null),
        el('div', { class: 'sub' }, el('span', { class: 'tierlabel', text: data.tierForMarks(c.marks) }),
          state ? el('span', { class: 'state', text: state }) : null,
          isTurn ? el('span', { class: 'turnflag', text: 'their turn' }) : null)),
      el('button', { class: 'menu', title: 'More', 'aria-label': `More for ${c.name}`, text: '⋯', onclick: () => characterMenu(c) })),
    el('div', { class: 'marksline' }, marksRow(c.marks, c.crossed), c.cityMarks ? marksRow(c.cityMarks, c.cityCrossed, 'city') : null),
    c.scene && !c.isMemory ? el('div', { class: 'onscene' }, el('span', { class: 'k', text: 'On' }), ` ${c.scene}`) : null,
    c.bonds.length ? el('ul', { class: 'bonds' }, c.bonds.map((b) => el('li', { class: b.city ? 'city' : b.memory ? 'memory' : '', text: bondText(b) }))) : null,
    el('div', { class: 'handhead' },
      el('span', { class: `handcount ${c.hand.length > lim ? 'over' : ''}`.trim(), text: `Holds ${c.hand.length} of ${lim}` }),
      c.hand.length ? el('button', { class: 'tiny ghost', text: looking ? 'Turn face down' : 'Look', 'aria-pressed': String(looking),
        onclick: () => { if (looking) ui.look.delete(c.id); else ui.look.add(c.id); render(S()); } }) : null),
    c.hand.length ? el('div', { class: `hand ${looking ? 'up' : 'down'}` }, c.hand.map((id) => cardEl(card(id), data, { facedown: !looking, size: 'sm' }))) : null);
}

function characterMenu(c) {
  const st = S();
  return modal(c.name, (close) => {
    const body = el('div', { class: 'charmenu' });
    const living = !c.isMemory && !c.forgotten;
    add(body, el('h3', { text: 'Bonds' }), bondList(c));
    if (!c.forgotten) {
      add(body, bondComposer(c, { lists: c.isMemory ? [data.memoryBonds()] : data.bondsAtOrBelow(data.tierForMarks(c.marks)), banners: G.bondBanners(st, data, c), exclude: c.name,
        memory: c.isMemory, onDone: () => { close(); characterMenu(chById(c.id)); } }));
      if (c.cityMarks >= 1) add(body, details('City Bonds', instr(data.rule('City Bonds')),
        bondComposer(c, { lists: data.cityBondsAtOrBelow(c.cityMarks), banners: G.bondBanners(st, data, c), exclude: c.name, label: 'Make the City Bond', city: true,
          onDone: () => { close(); characterMenu(chById(c.id)); } })));
    }
    if (living) {
      add(body, el('h3', { text: 'Token' }), el('div', { class: 'swatches' }, TOKENS.map((t) => {
        const taken = st.characters.find((x) => x.token === t.id && x.id !== c.id);
        return el('button', { type: 'button', class: `swatch ${c.token === t.id ? 'on' : ''}`.trim(), style: `--tok:${t.color}`, title: t.name,
          disabled: !!taken, onclick: () => up((s) => { find(s, c.id).token = t.id; }).then(() => close()) });
      })));
    }
    const acts = el('div', { class: 'menuacts' });
    const turnPhases = ['choose-scene', 'share-or-witness'];
    if (!c.forgotten && !c.leaving && turnPhases.includes(st.turn.phase) && G.currentCharacter(st)?.id !== c.id && !c.hadMigrationScene) {
      add(acts, el('div', { class: 'act' }, el('button', { text: 'Take the turn', onclick: () => up((s) => G.giveTurnTo(s, c.id), `${c.name} takes the turn.`).then(() => close()) }),
        el('span', { class: 'small muted', text: 'Out of order — for when the table agrees.' })));
    }
    if (living) {
      add(acts, el('div', { class: 'act' },
        el('button', { class: 'ghost', text: 'Pass into memory', onclick: async () => {
          close();
          const ok = await choose(`${c.name} dies`, [{ label: `${c.name} becomes a Memory`, value: true, class: 'primary' }],
            { body: el('div', {}, instr(data.guidanceText('other-ways-to-die')), instr(data.proc('When You Die').steps.map((s) => s.instruction).join('\n\n'))) });
          if (!ok) return;
          await up((s) => G.becomeMemory(s, find(s, c.id)), `${c.name} dies and becomes a Memory.`);
          modal(`${c.name} becomes a Memory`, (cl) => el('div', {}, instr(data.step('When You Die', 'Make a Memory Bond').instruction),
            bondComposer(chById(c.id), { lists: [data.memoryBonds()], exclude: c.name, label: 'Make the Memory Bond', memory: true, onDone: () => cl() })));
        } }),
        el('span', { class: 'small muted', text: sentence(data.guidanceText('other-ways-to-die'), 'you always decide') })));
      add(acts, el('div', { class: 'act' },
        el('button', { class: 'ghost', text: c.leaving ? 'Staying after all' : 'Leaving the game', onclick: () => up((s) => { find(s, c.id).leaving = !c.leaving; },
          c.leaving ? `${c.name} stays with the family.` : `${c.name}’s player must leave; ${c.name} will become a side-character.`).then(() => close()) }),
        el('span', { class: 'small muted', text: data.guidanceText('leaving-mid-game') })));
    }
    if (acts.childNodes.length) add(body, el('h3', { text: 'At the table' }), acts);
    add(body, el('div', { class: 'btnrow' }, el('button', { class: 'ghost', text: 'Close', onclick: () => close() })));
    return body;
  });
}

function sideCharacters(st) {
  const input = el('input', { placeholder: 'a new side-character', list: 'allnames', autocomplete: 'off' });
  const submit = () => {
    const n = input.value.trim();
    if (!n) return;
    up((s) => { if (!s.sideCharacters.some((x) => x.name === n)) s.sideCharacters.push({ id: 'side-' + Math.random().toString(36).slice(2, 8), name: n, marks: 0 }); },
      `${n} enters the story.`);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  return el('div', { class: 'sides' },
    el('h3', { text: 'Side-Characters' }),
    details('About side-characters', instr(data.guidanceText('side-characters')), instr(data.guidanceText('side-characters-and-age'))),
    el('div', { class: 'sidechips' }, st.sideCharacters.map((s) => el('span', { class: 'sidechip' }, s.name,
      el('button', { class: 'x', title: `Remove ${s.name}`, text: '×', onclick: () => up((x) => { x.sideCharacters = x.sideCharacters.filter((y) => y.id !== s.id); }) }))),
      el('span', { class: 'addside' }, input, el('button', { class: 'tiny', text: 'Add', onclick: submit }))));
}

/* ------------------------------------------------------------------ rail -- */

function turnOrder(st, cur) {
  if (!TURN_PHASES.includes(st.turn.phase)) cur = null;
  const order = st.turn.order.map(chById).filter((c) => c && !c.forgotten);
  return el('section', { class: 'panel turnorder' },
    el('h3', { text: 'Turn order' }),
    el('ol', {}, order.map((c) => el('li', { class: `${cur && cur.id === c.id ? 'now' : ''} ${c.hadMigrationScene ? 'skip' : ''} ${c.isMemory ? 'mem' : ''}`.trim() },
      tok(c, { size: 'sm' }),
      el('span', { class: 'nm', text: c.name }),
      el('span', { class: 'note', text: c.hadMigrationScene ? 'migrating' : c.isMemory ? 'Memory' : c.leaving ? 'leaving' : '' })))));
}

function decksPanel(st) {
  return el('section', { class: 'panel' },
    el('h3', { text: 'Tradition Decks in play' }),
    el('div', { class: 'decks' }, st.inPlay.map((d) => {
      const k = data.byDeck.get(d);
      const n = (st.decks[d] || []).length;
      return el('div', { class: `deckchip ${data.palette(d)}`, title: `${n} cards in the deck` },
        el('span', { class: 'stack' }, shapeIcon(k?.shape)), el('span', { class: 'nm', text: d }), el('span', { class: 'n', text: n }));
    })),
    details('Shuffling', instr(data.substep(SETUP, 'Hold Traditions', 'Gather the Tradition Deck').instruction.split(/\n\s*\n/).pop())));
}

function recordPanel(st) {
  const items = [];
  let lastCh = null;
  for (const l of (st.log || []).slice(0, 80)) {
    if (l.ch && l.ch !== lastCh) { items.push(el('li', { class: 'chsep', text: `Chapter ${l.ch}` })); lastCh = l.ch; }
    items.push(el('li', { class: l.undo ? 'undo' : '' }, el('span', { class: 'when', text: fmtTime(l.at) }), l.text));
  }
  return el('section', { class: 'panel' }, el('h3', { text: 'The record' }), el('ul', { class: 'log' }, items));
}

/* ---------------------------------------------------------------- dialogs -- */

function askFateDialog() {
  const AF = data.proc('Ask Fate');
  const [s1, s2, s3] = AF.steps;
  return modal('Ask Fate', (close) => {
    const q = el('input', { placeholder: 'the question for Fate', class: 'wide' });
    const fields = data.askFate.map((o) => ({ o, input: el('textarea', { rows: 2, placeholder: o.definition }) }));
    const out = el('div', { class: 'fateout' });
    return el('div', { class: 'fate' },
      instr(AF.instruction),
      stepBlock(1, s1.name, '', instr(s1.instruction), q),
      stepBlock(2, s2.name, '', instr(s2.instruction.split(/\n\s*\n/)[0]),
        el('div', { class: 'outcomes' }, fields.map(({ o, input }) => el('label', { class: 'outcome', dataset: { band: o.roll } },
          el('span', { class: 'band', text: o.roll }), el('span', { class: 'oname', text: o.outcome }), input)))),
      stepBlock(3, s3.name, '', out,
        el('div', { class: 'btnrow' },
          el('button', { class: 'primary big', text: '🎲 Roll the Die', onclick: async () => {
            const r = G.askFate(data);
            const chosen = fields.find((f) => f.o.roll === r.band);
            for (const f of fields) f.input.closest('.outcome').classList.toggle('hit', f === chosen);
            add(clear(out), el('div', { class: 'rolled big' }, dieFace(r.roll, { size: 64 }),
              el('div', {}, el('b', { text: r.outcome.outcome }), el('p', { text: chosen.input.value.trim() || r.outcome.definition }))));
            await up(() => {}, `Fate is asked${q.value.trim() ? ` “${q.value.trim()}”` : ''} and answers ${r.roll}: ${r.outcome.outcome.toLowerCase()}${chosen.input.value.trim() ? ` — ${chosen.input.value.trim()}` : ''}.`);
          } }),
          el('button', { class: 'ghost', text: 'Close', onclick: () => close() }))),
      details('Advice on asking Fate', instr(data.guidanceText('fate-advice'))));
  });
}

function settingsDialog() {
  const st = S();
  return modal('Table settings', (close) => el('div', { class: 'settings' },
    el('h3', { text: 'Variants' }),
    variantToggles(st, st.setupComplete ? ['The Umbra Follows', 'Solo Play'] : ['The Umbra Follows', 'Fleeing the City', 'Solo Play']),
    st.setupComplete && st.variants['Fleeing the City'] ? el('p', { class: 'small muted', text: 'Fleeing the City was chosen at setup.' }) : null,
    el('h3', { text: 'This table' }),
    el('p', { class: 'small muted', text: `Room “${st.room}”, saved in this browser only. Add ?room=another-name to the address to keep a second family.` }),
    el('div', { class: 'btnrow' },
      el('button', { class: 'danger', text: 'Reset this table…', onclick: async () => {
        close();
        const ok = await choose('Reset the table?', [{ label: 'Yes, put everything back in the box', value: true, class: 'danger' }],
          { body: el('p', { class: 'small muted', text: 'This clears the family, the decks and the record for this room.' }) });
        if (ok) { Object.assign(ui, { look: new Set(), holdFor: null, witness: null, memTarget: null, carry: null, keep: {}, passPick: null, travel: false, migrateScene: false }); store.reset(); }
      } }),
      el('button', { class: 'ghost', text: 'Close', onclick: () => close() }))));
}

function birthDialog() {
  return modal('Birth', (close) => el('div', {}, instr(data.proc('Birth').instruction), birthForm(),
    el('div', { class: 'btnrow' }, el('button', { class: 'ghost', text: 'Close', onclick: () => close() }))));
}

// Last, so every const above exists before the first render.
store.subscribe(render);
render(store.state);
mountFooter();
