/* ==========================================================================
   table.js — the play surface.

   Renders the family, the decks and the current scene, and drives the rulebook
   procedures through app/game.js. Every prompt shown to players is the book's
   own text, taken from the generated feed.
   ========================================================================== */

import { loadData } from '../app/data.js';
import { Store, makeAdapter } from '../app/store.js';
import * as G from '../app/game.js';
import {
  $, el, clear, mountNav, mountFooter, cardEl, shapeIcon, marksRow,
  choose, modal, uid, fmtTime, rollDie,
} from '../app/ui.js';

const data = await loadData();
const store = new Store(makeAdapter());
await store.init();

mountNav('table');
const root = $('#root');
store.subscribe(render);
render(store.state);

/* ----------------------------------------------------------------- helpers */

const S = () => store.state;
const card = (id) => data.byCard.get(id);
const chById = (id) => S().characters.find((c) => c.id === id);
const others = (ch) => G.activeCharacters(S()).filter((c) => c.id !== ch.id && !c.forgotten);
const homeLoc = () => data.byLocation.get(S().family.home);

function up(fn, log) { return store.update(fn, log); }

function say(text) { return el('p', { class: 'prompt', text }); }

/* ================================================================= SETUP === */

function renderSetup(st) {
  const w = el('div', { class: 'panel wizard' });
  const steps = ['Home & Tradition', 'The family', 'Traditions in hand', 'The Umbra'];
  const stage = st.setupStage || 0;
  w.append(el('div', { class: 'stepnav' }, steps.map((s, i) =>
    el('span', { class: i === stage ? 'on' : i < stage ? 'done' : '', text: `${i + 1}. ${s}` }))));

  if (stage === 0) {
    const proc = data.procedures.find((p) => p.name === 'First Session Setup');
    const step = proc.steps.find((s) => s.name === 'Choose Home & Tradition');
    w.append(el('h2', { text: 'Choose Home & Tradition' }),
      el('div', { class: 'teaching', style: 'font-style:italic;color:var(--chalk-2)', text: step.teaching }),
      el('div', { class: 'grid' }, data.startingHomes.map((loc) => {
        const deck = loc.traditions[0];
        return el('a', {
          class: 'card', href: '#',
          onclick: async (e) => {
            e.preventDefault();
            await up((s) => {
              s.family.home = loc.name;
              s.family.region = 'Riverlands';
              G.bringDeckIntoPlay(s, data, deck);
              s.setupStage = 1;
            }, `Our family's home is ${loc.name}. Our Family Tradition is ${deck}.`);
          },
        },
          el('span', { class: 'cat' }, shapeIcon(data.byDeck.get(deck).shape), deck),
          el('h3', { text: loc.name }),
          el('p', { text: loc.scenes.join(' · ') }));
      })));
    return w;
  }

  if (stage === 1) {
    const deck = homeLoc()?.traditions[0];
    const banner = data.byDeck.get(deck);
    w.append(el('h2', { text: 'Choose Names, Mark Age, Make Bonds' }),
      el('p', { class: 'small muted', text: 'Choose a name for your main character from this list and write it down on your Notecard. The names list ends with a prompt you can use to make up additional names.' }),
      el('div', { class: 'well namelist' },
        el('div', { class: 'small muted', style: 'margin-bottom:0.3rem' }, shapeIcon(banner.shape), banner.banner + ' Banner'),
        banner.names.map((n) => el('button', {
          class: 'tiny', text: n,
          onclick: () => { $('#newname').value = n; },
        })),
        el('div', { class: 'small muted', style: 'margin-top:0.3rem', text: banner.namePrompt })));

    const form = el('div', { class: 'charform', style: 'margin-top:0.8rem' },
      el('div', {}, el('label', { for: 'newname', text: 'Name' }), el('br'),
        el('input', { id: 'newname', placeholder: 'name' })),
      el('div', {}, el('label', { for: 'newpron', text: 'Pronouns' }), el('br'),
        el('input', { id: 'newpron', placeholder: 'they/them' })),
      el('div', {}, el('label', { for: 'newtier', text: 'Age' }), el('br'),
        el('select', { id: 'newtier' }, data.ageTiers.map((t) =>
          el('option', { value: t.name, text: `${t.name} — ${t.marksText}` })))),
      el('div', {}, el('label', { for: 'newmarks', text: 'Marks' }), el('br'),
        el('select', { id: 'newmarks' })),
      el('div', {}, el('button', {
        class: 'primary', text: 'Add character',
        onclick: async () => {
          const name = $('#newname').value.trim();
          if (!name) return;
          const marks = Number($('#newmarks').value);
          await up((s) => {
            s.characters.push(G.newCharacter({
              name, pronouns: $('#newpron').value.trim(), marks,
              token: '',
            }));
            s.turn.order = s.characters.map((c) => c.id);
          }, `${name} joins the family — ${data.tierForMarks(marks)}, ${marks} Marks of Age.`);
          $('#newname').value = ''; $('#newpron').value = '';
        },
      })));
    w.append(form);

    // marks select follows the chosen tier
    queueMicrotask(() => {
      const tier = $('#newtier'), marks = $('#newmarks');
      const sync = () => {
        const t = data.ageTiers.find((x) => x.name === tier.value);
        clear(marks);
        for (const m of t.marks) marks.append(el('option', { value: m, text: `${m} Mark${m === 1 ? '' : 's'}` }));
      };
      tier.addEventListener('change', sync); sync();
    });

    w.append(el('div', { style: 'margin-top:0.9rem' }, st.characters.map((ch) =>
      el('div', { class: 'well', style: 'margin-bottom:0.5rem' },
        el('b', { text: ch.name }), el('span', { class: 'pronouns', text: ch.pronouns }),
        ' ', marksRow(ch.marks, 0),
        el('span', { class: 'tierlabel', style: 'margin-left:0.5rem', text: data.tierForMarks(ch.marks) }),
        el('button', { class: 'tiny ghost', style: 'float:right', text: 'remove',
          onclick: () => up((s) => {
            s.characters = s.characters.filter((c) => c.id !== ch.id);
            s.turn.order = s.characters.map((c) => c.id);
          }, `${ch.name} is removed from the family.`) }),
        bondEditor(ch)))));

    w.append(el('div', { class: 'btnrow' },
      el('button', {
        class: 'primary', text: 'Everyone is named and bonded →',
        disabled: st.characters.length === 0,
        onclick: () => up((s) => { s.setupStage = 2; }),
      })));
    return w;
  }

  if (stage === 2) {
    const deck = homeLoc()?.traditions[0];
    const pool = st.decks[deck] || [];
    w.append(el('h2', { text: 'Hold Traditions' }),
      el('p', { class: 'small muted', text: 'Each main character begins with a Hand of Tradition Cards equal to their Marks of Age (Children begin with no Tradition Cards). Everyone can choose at once. Pick Tradition Cards that you feel drawn to.' }));
    for (const ch of st.characters) {
      const need = G.handLimit(ch) - ch.hand.length;
      w.append(el('h4', {}, `${ch.name} — `,
        el('span', { class: need > 0 ? 'handcount under' : 'handcount', text: `${ch.hand.length}/${G.handLimit(ch)}` })));
      w.append(el('div', { class: 'cardrow' }, ch.hand.map((id) => cardEl(card(id), data, {
        selectable: true,
        onclick: () => up((s) => {
          const c = s.characters.find((x) => x.id === ch.id);
          c.hand = c.hand.filter((x) => x !== id);
          s.decks[deck].push(id);
        }, `${ch.name} puts back “${card(id).prompt}”.`),
      }))));
    }
    const shortest = st.characters.find((c) => c.hand.length < G.handLimit(c));
    w.append(el('h4', { text: shortest ? `Spread face-up — choosing for ${shortest.name}` : 'Spread face-up' }),
      el('div', { class: 'cardrow' }, pool.map((id) => cardEl(card(id), data, {
        selectable: !!shortest,
        onclick: shortest ? () => up((s) => {
          const c = s.characters.find((x) => x.id === shortest.id);
          if (c.hand.length >= G.handLimit(c)) return;
          c.hand.push(id);
          s.decks[deck] = s.decks[deck].filter((x) => x !== id);
        }, `${shortest.name} takes “${card(id).prompt}”.`) : undefined,
      }))));
    w.append(el('div', { class: 'btnrow' },
      el('button', {
        class: 'primary', text: 'Gather the deck →',
        disabled: !!shortest,
        onclick: () => up((s) => { s.setupStage = 3; }),
      }),
      shortest ? el('span', { class: 'small muted', text: `${shortest.name} still needs cards.` }) : null));
    return w;
  }

  // stage 3 — Choose Tokens & Introduce the Umbra
  const proc = data.procedures.find((p) => p.name === 'First Session Setup');
  const umbra = proc.steps.find((s) => s.name === 'Introduce the Umbra');
  w.append(el('h2', { text: 'Introduce the Umbra' }),
    el('p', { class: 'small muted', text: umbra.instruction }),
    el('div', { class: 'teaching', style: 'font-style:italic;color:var(--ice)', text: umbra.teaching }),
    el('p', { class: 'small muted', text: umbra.followUp }),
    el('div', { class: 'teaching', style: 'font-style:italic;color:var(--chalk-2)', text: umbra.teachingTwo }),
    el('div', { class: 'btnrow' },
      el('button', {
        class: 'primary', text: 'We are ready to play',
        onclick: () => up((s) => {
          G.bringDeckIntoPlay(s, data, 'Umbra');
          s.umbraInPlay = true;
          s.setupComplete = true;
          s.setupStage = undefined;
          s.turn.order = s.characters.map((c) => c.id);
          s.turn.current = 0;
          s.turn.phase = 'choose-scene';
        }, `The Umbra Deck is placed beside the scroll. Chapter 1 begins at ${S().family.home}.`),
      })));
  return w;
}

/** How a stored Bond reads: "Ward of Rye", "Befriended by Dim", "Lost to Vale". */
export function bondText(b) { return `${b.prompt} ${b.joiner || 'of'} ${b.subject}`; }

/**
 * The Bond picker. Options are keyed by list so the joining word travels with
 * the prompt — the lists do not all join with "of".
 */
function bondPicker(ch, lists, { label = 'Bond', cityMark = false } = {}) {
  const opts = [];
  lists.forEach((l, li) => {
    const joiner = data.bondJoiner(l);
    for (const p of l.prompts) opts.push({ key: `${li}|${p}`, prompt: p, joiner, tier: l.tier });
    opts.push({ key: `${li}|*`, prompt: data.openPromptWord(l), joiner, tier: l.tier, open: true });
  });
  const sel = el('select', {}, opts.map((o) =>
    el('option', { value: o.key, text: `${o.prompt} ${o.joiner}…  (${o.tier})` })));
  const who = el('input', { placeholder: 'whom…', list: 'allnames', style: 'max-width:150px' });
  return el('div', { class: 'btnrow', style: 'margin:0.3rem 0 0' }, sel, who,
    el('button', {
      class: 'tiny', text: label,
      onclick: () => {
        const subject = who.value.trim();
        if (!subject) return;
        const o = opts.find((x) => x.key === sel.value);
        if (!o) return;
        const prompt = o.open && !o.prompt ? sel.selectedOptions[0].text.split(' ')[0] : o.prompt;
        up((s) => {
          const c = s.characters.find((x) => x.id === ch.id);
          c.bonds.push({ prompt, joiner: o.joiner, subject, city: cityMark });
          if (!s.sideCharacters.some((x) => x.name === subject) &&
              !s.characters.some((x) => x.name === subject)) {
            s.sideCharacters.push({ id: uid(), name: subject, marks: 0 });
          }
        }, `${ch.name} is ${prompt} ${o.joiner} ${subject}.`);
        who.value = '';
      },
    }));
}

function bondEditor(ch) {
  const tier = data.tierForMarks(ch.marks);
  const lists = data.bondsAtOrBelow(tier);
  const wrap = el('div', { style: 'margin-top:0.4rem' });
  wrap.append(el('ul', { class: 'bonds' }, ch.bonds.map((b, i) =>
    el('li', {}, bondText(b),
      el('button', {
        class: 'tiny ghost', style: 'margin-left:0.4rem', text: '×',
        onclick: () => up((s) => {
          s.characters.find((c) => c.id === ch.id).bonds.splice(i, 1);
        }, `${ch.name} loses the Bond “${bondText(b)}”.`),
      })))));
  wrap.append(bondPicker(ch, lists));
  return wrap;
}

/* ============================================================== THE TABLE == */

function renderTable(st) {
  const frag = document.createDocumentFragment();
  const cur = G.currentCharacter(st);
  const loc = homeLoc();

  // --- status bar
  frag.append(el('div', { class: 'statusbar' },
    el('div', { class: 'field' }, el('span', { class: 'k', text: 'Home' }),
      el('span', { class: 'v home', text: st.family.home || '—' })),
    el('div', { class: 'field' }, el('span', { class: 'k', text: 'Region' }),
      el('span', { class: 'v', text: st.family.region })),
    el('div', { class: 'field' }, el('span', { class: 'k', text: 'Chapter' }),
      el('span', { class: 'v', text: st.family.chapter })),
    el('div', { class: 'field' }, el('span', { class: 'k', text: 'Session' }),
      el('span', { class: 'v', text: st.family.session })),
    st.borough.inPlay
      ? el('span', { class: 'tag spire', text: `Wandering Borough at ${st.borough.station || '—'}` })
      : null,
    st.umbraInPlay ? el('span', { class: 'tag umbra', text: 'Umbra Deck in play' }) : null,
    el('span', { class: 'grow' }),
    el('button', { class: 'tiny', text: '🎲 Ask Fate', onclick: askFateDialog }),
    el('button', { class: 'tiny', text: 'Chapter ▸', onclick: endChapterDialog }),
    el('button', { class: 'tiny ghost', text: 'Session ▸', onclick: sessionDialog })));

  const layout = el('div', { class: 'tablelayout' });
  const main = el('div');
  const rail = el('div', { class: 'rail' });
  layout.append(main, rail);

  // --- the stage
  main.append(renderStage(st, cur, loc));

  // --- characters
  main.append(el('h2', { text: 'The family' }));
  main.append(el('div', { class: 'chars' }, st.characters.map((ch) => charCard(st, ch, cur))));

  if (st.sideCharacters.length) {
    main.append(el('h3', { text: 'Side characters' }),
      el('p', { class: 'small muted' }, st.sideCharacters.map((s) => s.name).join(' · ')));
  }

  // --- rail: decks, pool, log
  rail.append(el('div', { class: 'panel' },
    el('h3', { text: 'Tradition Decks in play' }),
    el('div', { class: 'decks' }, st.inPlay.map((d) => {
      const k = data.byDeck.get(d);
      return el('div', { class: 'deckchip', title: `${(st.decks[d] || []).length} cards` },
        el('span', { class: 'n' }, shapeIcon(k?.shape), (st.decks[d] || []).length),
        el('span', { class: 'nm', text: d }));
    })),
    el('p', { class: 'small muted', style: 'margin-bottom:0' , text: 'Cards are never shuffled: discards go to the bottom, and the order shifts naturally from session to session.' })));

  if (st.pool.length) {
    rail.append(el('div', { class: 'panel' },
      el('h3', { text: `Face-up on the table (${st.pool.length})` }),
      el('div', { class: 'pool' }, st.pool.map((id) => cardEl(card(id), data)))));
  }

  rail.append(el('div', { class: 'panel' },
    el('h3', { text: 'The record' }),
    el('ul', { class: 'log' }, (st.log || []).slice(0, 60).map((l) =>
      el('li', {}, el('span', { class: 'when', text: fmtTime(l.at) }), l.text)))));

  frag.append(layout);
  return frag;
}

function charCard(st, ch, cur) {
  const isTurn = cur && cur.id === ch.id;
  const limit = G.handLimit(ch);
  const over = ch.hand.length > limit, under = ch.hand.length < limit;
  const node = el('div', {
    class: `ch ${isTurn ? 'turn' : ''} ${ch.isMemory ? 'memory' : ''} ${ch.forgotten ? 'forgotten' : ''}`.trim(),
  },
    ch.forgotten ? el('span', { class: 'badge', text: 'forgotten' })
      : ch.isMemory ? el('span', { class: 'badge', text: 'a Memory' })
      : ch.hadMigrationScene ? el('span', { class: 'badge', text: 'migrating' }) : null,
    el('h3', {}, ch.name, el('span', { class: 'pronouns', text: ch.pronouns || '' })),
    el('div', { class: 'row' },
      el('span', { class: 'tierlabel', text: data.tierForMarks(ch.marks) }),
      marksRow(ch.marks, ch.crossed),
      st.family.region === 'City' || ch.cityMarks
        ? marksRow(ch.cityMarks, ch.cityCrossed, 'city') : null,
      el('span', { class: `handcount ${over ? 'over' : under ? 'under' : ''}`.trim(),
        text: `hand ${ch.hand.length}/${limit}` }),
      ch.scene ? el('span', { class: 'scenechip', text: '❋ ' + ch.scene }) : null),
    ch.bonds.length ? el('ul', { class: 'bonds' }, ch.bonds.map((b) =>
      el('li', { text: bondText(b) }))) : null,
    el('div', { class: 'hand' }, ch.hand.map((id) => cardEl(card(id), data))),
    el('div', { class: 'btnrow' },
      el('button', { class: 'tiny ghost', text: 'Bonds…', onclick: () => bondsDialog(ch) }),
      !ch.forgotten && !isTurn
        ? el('button', { class: 'tiny ghost', text: 'Take the turn',
            onclick: () => up((s) => {
              const i = s.turn.order.indexOf(ch.id);
              if (i >= 0) { s.turn.current = i; s.turn.phase = 'choose-scene'; s.turn.scene = null; }
            }, `${ch.name} takes the turn.`) })
        : null));
  return node;
}

/* ------------------------------------------------------------------ stage -- */

function renderStage(st, cur, loc) {
  const stage = el('div', { class: 'stage' });
  if (!cur) {
    stage.append(el('h2', { text: 'No one can take a turn' }),
      say('Every character has been forgotten. Follow the Birth rules to bring a new character into the family.'),
      el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Birth', onclick: birthDialog })));
    return stage;
  }

  const phase = st.turn.phase || 'choose-scene';

  if (phase === 'choose-scene') {
    if (cur.isMemory) return memoryStage(st, cur, loc, stage);
    stage.append(el('div', { class: 'phase', text: `Tradition Scene · step 1 · ${cur.name}’s turn` }),
      el('h2', { text: 'Choose a Scene' }),
      say('Each location has several prompts called Scenes. On your turn, move your token to a scene at our family’s current location. You may choose any scene, even if another player’s token is already there.'));

    const where = boroughOrHome(st, cur);
    stage.append(sceneGrid(st, where, (sceneName) =>
      up((s) => {
        const c = s.characters.find((x) => x.id === cur.id);
        G.chooseScene(s, c, sceneName);
      }, `${cur.name} places their token on “${sceneName}”.`)));

    // Travel (City) and the Migration Scene are both available at step 1
    const rowBtns = [];
    if (st.family.region === 'City') {
      const reach = G.travelTargets(st, data, cur);
      rowBtns.push(el('button', {
        class: 'tiny', text: `Travel… (${cur.cityMarks} City Marks)`,
        disabled: !reach.length,
        onclick: () => travelDialog(cur, reach),
      }));
    }
    if (!cur.hadMigrationScene) {
      rowBtns.push(el('button', { class: 'tiny warm', text: 'Play a Migration Scene',
        onclick: () => migrationSceneDialog(cur) }));
    }
    stage.append(el('div', { class: 'btnrow' }, rowBtns));
    return stage;
  }

  if (phase === 'share-or-witness') {
    stage.append(el('div', { class: 'phase', text: `Tradition Scene · step 2 · ${cur.name}` }),
      el('h2', { text: st.turn.scene }),
      say('During this scene, your character will either share or witness a Tradition.'),
      el('div', { class: 'btnrow' },
        el('button', { class: 'primary', text: 'Share a Tradition',
          disabled: cur.hand.length === 0, onclick: () => shareDialog(cur) }),
        el('button', { class: 'primary', text: 'Witness a Tradition',
          onclick: () => witnessDialog(cur) }),
        cur.hand.length === 0
          ? el('span', { class: 'small muted', text: 'You must have at least one card in hand to Share.' })
          : null));
    return stage;
  }

  if (phase === 'pass-tradition') {
    stage.append(el('div', { class: 'phase', text: `Tradition Scene · steps 3–4 · ${cur.name}` }),
      el('h2', { text: st.turn.scene }),
      say(st.turn.sceneKind === 'share'
        ? 'Use the prompt on your card to describe how you share a tradition with another player’s character and pass them the Card to add to their Hand.'
        : 'It is the receiving player’s job to look for opportunities to introduce this tradition into the scene. When you are done, pass the Card to the player whose turn it is.'));

    const entries = st.table;
    stage.append(el('div', { class: 'cardrow', style: 'margin:0.7rem 0' },
      entries.map((t) => cardEl(card(t.cardId), data, {
        facedown: !t.revealed,
        selectable: true,
        onclick: () => up((s) => {
          const x = s.table.find((y) => y.cardId === t.cardId);
          if (x) x.revealed = !x.revealed;
        }),
      }))));
    stage.append(el('p', { class: 'small muted', text: 'Click a card to turn it over. In the City you may play several, but only one is passed on — the rest are discarded to the bottom of their decks.' }));

    if (st.turn.sceneKind === 'share') {
      const t = entries[0];
      const to = t && t.to ? chById(t.to) : null;
      stage.append(el('div', { class: 'btnrow' },
        el('span', { class: 'small muted', text: to ? `Passing to ${to.name}` : 'Pass to:' }),
        others(cur).map((o) => el('button', {
          class: t && t.to === o.id ? 'primary tiny' : 'tiny', text: o.name,
          onclick: () => up((s) => G.setShareRecipient(s, t.cardId, o.id)),
        }))));
      stage.append(el('div', { class: 'btnrow' },
        el('button', {
          class: 'primary', text: 'Pass on the Tradition', disabled: !t || !t.to,
          onclick: () => up((s) => G.passOnTradition(s, data, t.cardId),
            `${cur.name} shares “${card(t.cardId).prompt}” with ${chById(t.to).name}.`),
        })));
    } else {
      stage.append(el('div', { class: 'btnrow' },
        el('span', { class: 'small muted', text: 'Keep which card?' }),
        entries.map((t) => el('button', {
          class: 'tiny', text: card(t.cardId).prompt,
          onclick: () => up((s) => G.passOnTradition(s, data, t.cardId),
            `${chById(t.to)?.name || 'A player'} witnesses “${card(t.cardId).prompt}” and passes it to ${cur.name}.`),
        }))));
    }
    return stage;
  }

  if (phase === 'end-scene') {
    stage.append(el('div', { class: 'phase', text: `Tradition Scene · step 5 · ${cur.name}` }),
      el('h2', { text: 'End the Scene' }),
      say('When you are ready for your scene to end, let the group know. It’s now the next player’s turn.'),
      el('div', { class: 'btnrow' },
        el('button', { class: 'primary', text: 'Pass the turn',
          onclick: () => up((s) => {
            G.passTurn(s);
            if (G.allHadMigrationScene(s)) s.turn.phase = 'migrate-family';
          }, `${cur.name} ends the scene.`) })));
    return stage;
  }

  if (phase === 'migrate-family') {
    return migrateStage(st, stage);
  }

  if (phase === 'memory-share') return memoryShareStage(st, cur, stage);

  stage.append(el('h2', { text: 'The table is quiet' }),
    el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Begin a turn',
      onclick: () => up((s) => { s.turn.phase = 'choose-scene'; }) })));
  return stage;
}

function boroughOrHome(st, ch) {
  if (ch.visiting && data.byLocation.get(ch.visiting)) return data.byLocation.get(ch.visiting);
  return homeLoc();
}

function sceneGrid(st, loc, onPick) {
  if (!loc) return el('p', { class: 'muted', text: 'No location.' });
  const taken = new Map();
  for (const c of st.characters) if (c.scene) taken.set(c.scene, (taken.get(c.scene) || []).concat(c.name));
  return el('div', { class: 'scenes' }, loc.scenes.map((s) =>
    el('div', { class: `scene ${taken.has(s) ? 'taken' : ''}`.trim(), onclick: () => onPick(s) },
      s, taken.has(s) ? el('span', { class: 'who', text: taken.get(s).join(', ') }) : null)));
}

/* ------------------------------------------------------- share and witness -- */

function shareDialog(ch) {
  return modal('Share a Tradition', (close) => el('div', {},
    el('p', { class: 'small muted', text: 'Play a card from your hand, face down onto the table.' }),
    el('div', { class: 'cardrow' }, ch.hand.map((id) => cardEl(card(id), data, {
      selectable: true,
      onclick: async () => {
        await up((s) => {
          const c = s.characters.find((x) => x.id === ch.id);
          G.shareTradition(s, c, id);
        }, `${ch.name} plays a card face down.`);
        close();
      },
    })))));
}

function witnessDialog(ch) {
  const st = S();
  const loc = boroughOrHome(st, ch);
  const opts = G.witnessOptions(st, data, loc.name);
  const picks = opts.map((o) => (o.decks.length === 1 ? o.decks[0] : null));
  let recipient = others(ch)[0]?.id || null;

  return modal('Witness a Tradition', (close) => {
    const body = el('div', {});
    const rerender = () => {
      clear(body);
      body.append(el('p', { class: 'small muted', text: `Draw one Tradition Card for each Local Tradition icon at ${loc.name}, and give all of the cards you have drawn to one other player, who reads them privately.` }));
      opts.forEach((o, i) => {
        body.append(el('h4', {}, shapeIcon(o.shape),
          o.blank ? `Blank ${o.shape} icon — choose a deck` : `${o.decks[0]}`));
        body.append(el('div', { class: 'btnrow' }, o.decks.map((d) => el('button', {
          class: picks[i] === d ? 'primary tiny' : 'tiny',
          onclick: () => { picks[i] = d; rerender(); },
        }, shapeIcon(data.byDeck.get(d)?.shape), d))));
      });
      body.append(el('h4', { text: 'Give the cards to' }));
      body.append(el('div', { class: 'btnrow' }, others(ch).map((o) => el('button', {
        class: recipient === o.id ? 'primary tiny' : 'tiny', text: o.name,
        onclick: () => { recipient = o.id; rerender(); },
      }))));
      body.append(el('div', { class: 'btnrow' }, el('button', {
        class: 'primary', text: 'Draw',
        disabled: picks.some((p) => !p) || !recipient,
        onclick: async () => {
          await up((s) => {
            const c = s.characters.find((x) => x.id === ch.id);
            const drawn = G.witnessTradition(s, data, c, recipient, picks);
            for (const id of drawn) {
              const cd = data.byCard.get(id);
              if (cd.isBoroughWanders) s.pendingBorough = true;
            }
          }, `${ch.name} draws ${picks.length} card${picks.length === 1 ? '' : 's'} (${picks.join(', ')}) for ${chById(recipient).name}.`);
          close();
          if (S().pendingBorough) boroughDialog();
        },
      })));
    };
    rerender();
    return body;
  });
}

/* -------------------------------------------------------------- migration -- */

function migrationSceneDialog(ch) {
  return modal('Migration Scene', (close) => {
    const body = el('div', {});
    const keep = new Set(ch.hand.slice(0, G.handLimit(ch)));
    const rerender = () => {
      clear(body);
      body.append(
        el('h4', { text: '1. Why You Must Leave' }),
        el('p', { class: 'small muted', text: 'Place your Token on your Notecard and describe why your character knows it is time to leave.' }),
        el('h4', { text: '2. What You Carry' }),
        el('p', { class: 'small muted', text: `If you hold more Tradition Cards than Marks of Age, decide which you will carry on the journey, and place the extras face-up on the table. ${ch.name} may carry ${G.handLimit(ch)}.` }),
        el('div', { class: 'cardrow' }, ch.hand.map((id) => cardEl(card(id), data, {
          selectable: true, chosen: keep.has(id),
          onclick: () => {
            if (keep.has(id)) keep.delete(id);
            else if (keep.size < G.handLimit(ch)) keep.add(id);
            rerender();
          },
        }))),
        el('p', { class: 'small', text: `Carrying ${keep.size} of ${G.handLimit(ch)}.` }),
        el('div', { class: 'btnrow' }, el('button', {
          class: 'primary', text: '3. Pass the turn',
          disabled: keep.size > G.handLimit(ch),
          onclick: async () => {
            await up((s) => {
              const c = s.characters.find((x) => x.id === ch.id);
              const laid = G.layDownExcess(s, c, [...keep]);
              G.finishMigrationScene(s, c);
              G.passTurn(s);
              if (G.allHadMigrationScene(s)) s.turn.phase = 'migrate-family';
              s._laid = laid.length;
            }, `${ch.name} plays a Migration Scene and lays down ${ch.hand.length - keep.size} card(s).`);
            close();
          },
        })));
    };
    rerender();
    return body;
  });
}

function migrateStage(st, stage) {
  const dests = G.migrationDestinations(st, data);
  stage.append(el('div', { class: 'phase', text: 'Migrate the Family' }),
    el('h2', { text: 'The family moves' }),
    say('After each player has had a Migration Scene, we Migrate the Family as a group.'));

  // step 2 — what is saved
  const short = st.characters.filter((c) => !c.forgotten && !c.isMemory && c.hand.length < G.handLimit(c));
  if (st.pool.length && short.length) {
    stage.append(el('h4', { text: '2. What is saved' }),
      el('p', { class: 'small muted', text: 'Players holding fewer cards than their Marks of Age may take from the face-up cards left behind. Describe how they save or preserve these traditions.' }));
    for (const c of short) {
      stage.append(el('div', { class: 'btnrow' },
        el('span', { class: 'small', text: `${c.name} (${c.hand.length}/${G.handLimit(c)})` }),
        st.pool.map((id) => el('button', {
          class: 'tiny', text: card(id).prompt,
          onclick: () => up((s) => {
            const cc = s.characters.find((x) => x.id === c.id);
            G.saveTradition(s, cc, id);
          }, `${c.name} saves “${card(id).prompt}”.`),
        }))));
    }
  }

  // step 3 — what is left
  if (st.pool.length) {
    stage.append(el('h4', { text: '3. What is Left' }),
      el('p', { class: 'small muted', text: 'For each remaining card, one of us must describe how this Tradition is left behind, forgotten, or practiced for the last time, and discard that card.' }),
      el('div', { class: 'btnrow' }, st.pool.map((id) => el('button', {
        class: 'tiny danger', text: `Leave “${card(id).prompt}”`,
        onclick: () => up((s) => G.leaveBehind(s, data, id),
          `“${card(id).prompt}” is left behind.`),
      }))));
  }

  // step 4 — destination
  stage.append(el('h4', { text: '1. / 4. Choose a destination' }),
    el('p', { class: 'small muted', text: st.family.region === 'City'
      ? 'We may always choose an adjacent Location, and any Location a migrating family member could reach through Travel with their City Marks.'
      : 'We may travel to any location that is connected by a river or other path to our current location.' }),
    el('div', { class: 'btnrow' }, dests.map((d) => el('button', {
      class: 'primary tiny', title: d.why,
      onclick: async () => {
        const target = data.byLocation.get(d.to);
        if (target && target.entrances && target.entrances.length) {
          const pick = await choose('At last we reach the City of Winter…',
            target.entrances.map((e) => ({ label: e.text, value: e.target })));
          if (!pick) return;
          await up((s) => {
            const r = G.migrateFamily(s, data, pick);
            s.pendingCityArrival = r.entering;
          }, `The family reaches the City of Winter — ${pick}.`);
          return;
        }
        await up((s) => G.migrateFamily(s, data, d.to),
          `The family migrates to ${d.to}.`);
      },
    }, d.to, el('span', { class: 'small muted', text: ` — ${d.why}` })))));

  if (st.pool.length) {
    stage.append(el('p', { class: 'small muted', text: 'Unclaimed cards must be saved or left behind before the family moves on.' }));
  }
  return stage;
}

function travelDialog(ch, reach) {
  return modal('Travel', (close) => el('div', {},
    el('p', { class: 'small muted', text: 'To Travel, pick up your token and describe your character’s journey. Then place your token on any Scene at your destination, and continue your turn as normal. Traveling distance is always measured from Home.' }),
    el('div', { class: 'btnrow' }, reach.map((r) => el('button', {
      class: 'tiny', text: `${r.to} (${r.cost})`,
      onclick: async () => {
        await up((s) => {
          const c = s.characters.find((x) => x.id === ch.id);
          c.visiting = r.to;
          c.scene = null;
        }, `${ch.name} travels to ${r.to} (${r.cost} Stations + transfers).`);
        close();
      },
    }))),
    ch.visiting ? el('div', { class: 'btnrow' }, el('button', {
      class: 'ghost tiny', text: 'Return home',
      onclick: async () => {
        await up((s) => { s.characters.find((x) => x.id === ch.id).visiting = null; },
          `${ch.name} returns home.`);
        close();
      },
    })) : null));
}

/* ------------------------------------------------------ chapters & sessions */

function endChapterDialog() {
  const st = S();
  return modal('Ending a Chapter', (close) => {
    const body = el('div', {});
    const rerender = () => {
      clear(body);
      const s2 = S();
      body.append(el('p', { class: 'small muted', text: 'At the end of each Chapter, time passes and our characters grow older.' }));

      body.append(el('h4', { text: '1. Mark Age' }));
      for (const ch of s2.characters.filter((c) => !c.forgotten)) {
        const elder = G.isElder(ch);
        body.append(el('div', { class: 'btnrow' },
          el('span', { style: 'min-width:8rem' }, ch.name, ' ', marksRow(ch.marks, ch.crossed),
            ch.cityMarks ? marksRow(ch.cityMarks, ch.cityCrossed, 'city') : null),
          el('button', {
            class: 'tiny', text: elder ? 'Cross off a Mark' : (s2.family.region === 'City' ? 'Add a City Mark' : 'Add a Mark'),
            onclick: async () => {
              await up((s) => {
                const c = s.characters.find((x) => x.id === ch.id);
                const r = G.markAge(s, c);
                c._gained = r.gained;
              }, elder ? `${ch.name} crosses off a Mark.` : `${ch.name} gains a Mark.`);
              rerender();
            },
          }),
          elder && ch.cityMarks > ch.cityCrossed ? el('button', {
            class: 'tiny ghost', text: 'Cross off a City Mark',
            onclick: async () => {
              await up((s) => {
                const c = s.characters.find((x) => x.id === ch.id);
                G.markAge(s, c, { crossCityMark: true });
              }, `${ch.name} crosses off a City Mark.`);
              rerender();
            },
          }) : null));
      }

      body.append(el('h4', { text: '2. New Bonds' }),
        el('p', { class: 'small muted', text: 'When your character gains a Mark, make a Bond. You may use names from our Family Tradition Banners, or any other Banner matching a Tradition Card that you hold.' }));
      for (const ch of s2.characters.filter((c) => !c.forgotten)) {
        body.append(el('div', { class: 'well', style: 'margin-bottom:0.4rem' },
          el('b', { text: ch.name }), bondEditor(ch)));
      }

      body.append(el('h4', { text: '3. Hold Traditions' }),
        el('p', { class: 'small muted', text: 'If you hold more cards than Marks of Age, place the extras face-up. If you hold fewer, you may fill up from the face-up cards. Remaining cards are discarded.' }));
      for (const ch of s2.characters.filter((c) => !c.forgotten)) {
        const over = ch.hand.length - G.handLimit(ch);
        if (over > 0) {
          body.append(el('div', { class: 'btnrow' },
            el('span', { class: 'small', text: `${ch.name} must lay down ${over}` }),
            ch.hand.map((id) => el('button', {
              class: 'tiny', text: card(id).prompt,
              onclick: async () => {
                await up((s) => {
                  const c = s.characters.find((x) => x.id === ch.id);
                  G.holdTraditions(s, c, c.hand.filter((x) => x !== id));
                }, `${ch.name} lays down “${card(id).prompt}”.`);
                rerender();
              },
            }))));
        } else if (ch.hand.length < G.handLimit(ch) && s2.pool.length) {
          body.append(el('div', { class: 'btnrow' },
            el('span', { class: 'small', text: `${ch.name} may take ${G.handLimit(ch) - ch.hand.length}` }),
            s2.pool.map((id) => el('button', {
              class: 'tiny', text: card(id).prompt,
              onclick: async () => {
                await up((s) => {
                  const c = s.characters.find((x) => x.id === ch.id);
                  G.saveTradition(s, c, id);
                }, `${ch.name} takes “${card(id).prompt}”.`);
                rerender();
              },
            }))));
        }
      }
      if (s2.pool.length) {
        body.append(el('div', { class: 'btnrow' }, el('button', {
          class: 'tiny danger', text: `Discard the remaining ${s2.pool.length}`,
          onclick: async () => {
            await up((s) => { G.discardPool(s, data); }, 'The remaining cards are discarded.');
            rerender();
          },
        })));
      }

      body.append(el('h4', { text: '4. New Chapter or End the session?' }),
        el('div', { class: 'btnrow' },
          el('button', {
            class: 'primary', text: 'Start a New Chapter',
            onclick: async () => {
              await up((s) => {
                G.startNewChapter(s);
                if (s.borough.inPlay && !s.borough.isHome) { s.borough.inPlay = false; s.borough.station = null; }
              }, `Chapter ${S().family.chapter + 1} begins. Everyone places their Token on our Home.`);
              close();
              await deathChecks();
            },
          }),
          el('button', {
            class: 'ghost', text: 'Closing Reflection',
            onclick: () => { close(); closingReflection(); },
          })));
    };
    rerender();
    return body;
  });
}

function closingReflection() {
  return modal('Closing Reflection', (close) => el('div', {},
    el('p', { class: 'small muted', text: 'Go around the circle and give each player space to reflect on their experience. Some things to consider sharing:' }),
    el('ul', {}, ['A moment you enjoyed', 'How you are feeling right now',
      'An appreciation of another player', 'Something you found challenging or difficult',
      'A moment of silence'].map((t) => el('li', { text: t }))),
    el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'End the session', onclick: () => { close(); } }))));
}

function sessionDialog() {
  return modal('New Session Setup', (close) => el('div', {},
    el('p', { class: 'small muted', text: '1. Distribute the Character Notecards and Tradition Cards saved from the previous Session. 2. Place the Tokens on the Location that was our Home in the previous Chapter. 3. Any player may take the first turn.' }),
    el('div', { class: 'btnrow' },
      el('button', {
        class: 'primary', text: 'Begin the session',
        onclick: async () => { await up((s) => G.newSession(s), `Session ${S().family.session + 1} begins at ${S().family.home}.`); close(); await deathChecks(); },
      }))));
}

/** Death & Memory: every Elder rolls at the start of a new Chapter (p.32). */
async function deathChecks() {
  for (const ch of S().characters.filter((c) => G.isElder(c) && !c.isMemory && !c.forgotten && !c.deathRolled)) {
    let result = null;
    await modal(`${ch.name} is an Elder`, (close) => {
      const body = el('div', {},
        el('p', { class: 'small muted', text: 'If your character is an Elder (has 6 Marks), roll the Die at the start of each new Chapter. If your roll is equal to or less than the crossed-off Marks, your character has died of old age and becomes a Memory.' }),
        el('p', {}, `Crossed-off Marks: `, marksRow(ch.marks, ch.crossed)));
      const out = el('div', {});
      body.append(out, el('div', { class: 'btnrow' }, el('button', {
        class: 'primary', text: '🎲 Roll the Die',
        onclick: async () => {
          const r = G.rollForDeath(ch);
          result = r;
          clear(out).append(el('p', { class: 'fate', text: r.roll }),
            el('p', { text: r.died ? `${ch.name} has died of old age and becomes a Memory.` : `${ch.name} lives on.` }));
          await up((s) => {
            const c = s.characters.find((x) => x.id === ch.id);
            c.deathRolled = true;
            if (r.died) G.becomeMemory(s, c);
          }, `${ch.name} rolls a ${r.roll} against ${ch.crossed} crossed-off Marks — ${r.died ? 'and passes into memory.' : 'and lives on.'}`);
          out.append(el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Continue', onclick: () => close() })));
        },
      })));
      return body;
    });
    if (result && result.died) await memoryBondDialog(ch);
  }
}

function memoryBondDialog(ch) {
  const list = data.memoryBonds();
  return modal(`${ch.name} becomes a Memory`, (close) => el('div', {},
    el('p', { class: 'small muted', text: 'Remove your token and return it to the box. Make a final bond using this list:' }),
    bondPicker(ch, [list], { label: 'Make the Memory Bond' }),
    el('div', { class: 'btnrow' },
      el('button', { class: 'primary', text: 'Done', onclick: () => close() }))));
}

function memoryStage(st, cur, loc, stage) {
  stage.append(el('div', { class: 'phase', text: `Memory Scene · ${cur.name}` }),
    el('h2', { text: 'Move another Player’s Token' }),
    say('Move another character’s Token to any scene they would normally have access to.'));
  const target = others(cur).filter((c) => !c.isMemory)[0];
  if (!target) {
    stage.append(el('p', { class: 'muted', text: 'There is no other character to move.' }),
      el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Pass the turn', onclick: () => up((s) => G.passTurn(s)) })));
    return stage;
  }
  stage.append(el('div', { class: 'btnrow' }, el('span', { class: 'small muted', text: 'Moving ' + target.name })));
  stage.append(sceneGrid(st, loc, (sceneName) =>
    up((s) => {
      const t = s.characters.find((x) => x.id === target.id);
      G.memoryMoveToken(s, t, sceneName);
      s.turn.memoryTarget = target.id;
    }, `${cur.name}, as a memory, places ${target.name}’s token on “${sceneName}”.`)));
  return stage;
}

function memoryShareStage(st, cur, stage) {
  const target = chById(st.turn.memoryTarget);
  stage.append(el('div', { class: 'phase', text: `Memory Scene · ${cur.name}` }),
    el('h2', { text: st.turn.scene }),
    say('Choose a Tradition Card to share with this player’s character, and play it face down on the table. Lead the scene, roleplaying as our memory of your character. Before the end of the scene, describe how you share your tradition and give your Tradition Card to the other player.'),
    el('div', { class: 'cardrow' }, cur.hand.map((id) => cardEl(card(id), data, {
      selectable: true,
      onclick: async () => {
        await up((s) => {
          const c = s.characters.find((x) => x.id === cur.id);
          const t = s.characters.find((x) => x.id === target.id);
          c.hand = c.hand.filter((x) => x !== id);
          t.hand.push(id);
          G.checkForgotten(c);
          G.passTurn(s);
        }, `${cur.name}’s memory shares “${card(id).prompt}” with ${target.name}.`);
        const me = chById(cur.id);
        if (me && me.forgotten) {
          await modal('Becoming forgotten', (close) => el('div', {},
            el('p', { class: 'small muted', text: 'When you have shared your last Tradition Card, remove your Notecard from play. You may no longer take turns. At the start of the next Chapter, follow the Birth rules to create a new character.' }),
            el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Birth', onclick: () => { close(); birthDialog(); } }),
              el('button', { class: 'ghost', text: 'Later', onclick: () => close() }))));
        }
      },
    }))),
    cur.hand.length === 0
      ? el('div', { class: 'btnrow' }, el('button', { class: 'primary', text: 'Pass the turn', onclick: () => up((s) => G.passTurn(s)) }))
      : null);
  return stage;
}

function birthDialog() {
  const st = S();
  const givers = st.characters.filter((c) => !c.forgotten);
  const childList = data.bondLists.find((b) => b.kind === 'Bonds' && b.tier === 'Child');
  return modal('Birth', (close) => {
    const name = el('input', { placeholder: 'the name you are given' });
    const pron = el('input', { placeholder: 'they/them' });
    const giver = el('select', {}, givers.map((g) => el('option', { value: g.id, text: g.name })));
    const bond = el('select', {}, [...childList.prompts, childList.openPrompt].map((p) =>
      el('option', { value: p, text: p })));
    return el('div', {},
      el('p', { class: 'small muted', text: '1. Choose another player. 2. That player gives you a name. 3. The player you chose gives you a Child Bond with their character. 4. Choose a Token and place it on our family’s Home.' }),
      el('div', { class: 'charform' },
        el('div', {}, el('label', { text: 'Name' }), el('br'), name),
        el('div', {}, el('label', { text: 'Pronouns' }), el('br'), pron),
        el('div', {}, el('label', { text: 'Chosen player' }), el('br'), giver),
        el('div', {}, el('label', { text: 'Child Bond' }), el('br'), bond)),
      el('div', { class: 'btnrow' }, el('button', {
        class: 'primary', text: 'A new character joins the family',
        onclick: async () => {
          if (!name.value.trim()) return;
          await up((s) => G.birth(s, {
            name: name.value.trim(), pronouns: pron.value.trim(),
            giverId: giver.value,
            bondPrompt: bond.value.replace(/^or /, '').replace(/\.\.\.$/, '').replace(/ of$/, ''),
          }), `${name.value.trim()} is born into the family.`);
          close();
        },
      })));
  });
}

/* --------------------------------------------------------------- the Borough */

function boroughDialog() {
  const st = S();
  return modal('The Borough Wanders', (close) => {
    const body = el('div', {},
      el('p', { class: 'small muted', text: st.borough.inPlay
        ? 'If “The Borough Wanders” card is drawn while the Borough is already in play, the Borough now leaves. Describe the Borough departing at some point during the scene and then remove it from play.'
        : 'During a scene, we treat this card like a normal Tradition prompt, using it to inspire a description of the arrival of the Borough. Place the Wandering Borough Location Card next to the edge of the map near where the scene took place.' }));
    if (st.borough.inPlay) {
      body.append(el('div', { class: 'btnrow' }, el('button', {
        class: 'primary', text: 'The Borough leaves',
        onclick: async () => {
          await up((s) => { G.boroughLeaves(s); s.pendingBorough = false; },
            'The Wandering Borough departs.');
          close();
        },
      })));
    } else {
      body.append(el('div', { class: 'btnrow' },
        [S().family.home, ...data.transitLines.flatMap((t) => t.stations)]
          .filter((v, i, a) => v && a.indexOf(v) === i)
          .map((loc) => el('button', {
            class: 'tiny', text: loc,
            onclick: async () => {
              await up((s) => { G.boroughArrives(s, loc); s.pendingBorough = false; },
                `The Wandering Borough appears at ${loc}.`);
              close();
            },
          }))));
    }
    body.append(el('div', { class: 'btnrow' }, el('button', {
      class: 'ghost', text: 'Roll to see where it wanders',
      onclick: async () => {
        const r = G.boroughWanders(S(), data);
        await up((s) => { s.pendingBorough = false; },
          `The Die shows ${r.roll} — ${r.line || 'no line'}. Choose any location along it.`);
        clear(body).append(el('p', { class: 'fate', text: r.roll }),
          el('p', {}, el('b', { text: r.line || '—' })),
          el('div', { class: 'btnrow' }, r.stations.map((loc) => el('button', {
            class: 'tiny', text: loc,
            onclick: async () => {
              await up((s) => G.boroughArrives(s, loc), `The Wandering Borough moves to ${loc}.`);
              close();
            },
          }))));
      },
    })));
    return body;
  });
}

/* ---------------------------------------------------------------- Ask Fate */

function askFateDialog() {
  return modal('Ask Fate', (close) => {
    const out = el('div', {});
    const likely = el('input', { placeholder: 'a likely outcome' });
    const unlikely = el('input', { placeholder: 'an unlikely outcome' });
    const fateful = el('input', { placeholder: 'a fateful outcome' });
    return el('div', {},
      el('p', { class: 'small muted', text: 'When a question arises that no one wants to answer, ask Fate. As a group, agree to a likely, an unlikely, and a fateful outcome.' }),
      el('div', { style: 'display:grid;gap:0.4rem' },
        el('div', {}, el('label', { text: 'Likely (1–3)' }), el('br'), likely),
        el('div', {}, el('label', { text: 'Unlikely (4–5)' }), el('br'), unlikely),
        el('div', {}, el('label', { text: 'Fateful (6)' }), el('br'), fateful)),
      out,
      el('div', { class: 'btnrow' }, el('button', {
        class: 'primary', text: '🎲 Fate Answers',
        onclick: async () => {
          const r = G.askFate(data);
          const chosen = { '1-3': likely.value, '4-5': unlikely.value, '6': fateful.value }[r.band];
          clear(out).append(el('p', { class: 'fate', text: r.roll }),
            el('p', {}, el('b', { text: r.outcome.outcome }), ' — ', chosen || r.outcome.definition));
          await up(() => {}, `Fate is asked and answers ${r.roll}: ${r.outcome.outcome}${chosen ? ` — ${chosen}` : ''}.`);
        },
      }), el('button', { class: 'ghost', text: 'Close', onclick: () => close() })));
  });
}

function bondsDialog(ch) {
  return modal(`${ch.name}’s Bonds`, () => {
    const body = el('div', {}, bondEditor(ch));
    if (ch.cityMarks >= 1) {
      body.append(el('h4', { text: 'City Bonds' }),
        el('p', { class: 'small muted', text: 'If your character has at least one City Mark, you may alternately choose a prompt from the City Bonds list when making a Bond. The prompts are organized by number of Marks, and you may only choose from a list that has the same or fewer number of City Marks as your character.' }),
        bondPicker(ch, data.cityBondsAtOrBelow(ch.cityMarks), { label: 'City Bond', cityMark: true }));
    }
    return body;
  });
}

/* ------------------------------------------------------------------ render */

function render(st) {
  clear(root);
  root.append(el('datalist', { id: 'allnames' },
    [...st.characters.map((c) => c.name), ...st.sideCharacters.map((c) => c.name),
     ...data.decks.flatMap((k) => k.names || [])]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .map((n) => el('option', { value: n }))));

  if (!st.setupComplete) {
    root.append(el('h2', { text: 'First Session Setup' }));
    root.append(renderSetup(st));
  } else {
    root.append(renderTable(st));
  }

  root.append(el('div', { class: 'btnrow', style: 'margin-top:2rem' },
    el('button', {
      class: 'ghost tiny', text: 'Reset this table',
      onclick: async () => {
        const ok = await choose('Reset the table?',
          [{ label: 'Yes, put everything back in the box', value: true, class: 'danger' }],
          { body: el('p', { class: 'small muted', text: 'This clears the family, the decks and the record for this room.' }) });
        if (ok) store.reset();
      },
    }),
    el('span', { class: 'small muted', text: `room “${st.room}” · saved in this browser` })));
}

mountFooter();
