/* ==========================================================================
   store.js — the family's state, and where it lives.

   The table state goes through a storage ADAPTER rather than touching
   localStorage directly, because this game is meant to be played by several
   people at once: the eventual backend has to serve one shared family to
   several devices, with changes arriving while you are looking at the table.
   That means the adapter interface is deliberately async and push-capable even
   though the only adapter shipped today is a local one.

     LocalAdapter   — this browser only. Works offline; no sharing.
     RemoteAdapter  — a stub, documented below, for the shared backend.

   Switch with ?store=remote&room=<id> once a backend exists.
   ========================================================================== */

export const STATE_VERSION = 4;

/* --------------------------------------------------------------- adapters -- */

class LocalAdapter {
  constructor(room) { this.key = `cow:${room}`; this.room = room; this.subs = new Set(); }
  get name() { return 'local'; }

  async load() {
    try { return JSON.parse(localStorage.getItem(this.key)) || null; }
    catch { return null; }
  }

  async save(state) {
    localStorage.setItem(this.key, JSON.stringify(state));
    // another tab in this browser is the one case a local adapter can sync.
    for (const cb of this.subs) cb(state);
  }

  subscribe(cb) {
    this.subs.add(cb);
    const onStorage = (e) => {
      if (e.key === this.key && e.newValue) {
        try { cb(JSON.parse(e.newValue)); } catch { /* ignore malformed */ }
      }
    };
    addEventListener('storage', onStorage);
    return () => { this.subs.delete(cb); removeEventListener('storage', onStorage); };
  }

  async listRooms() {
    return Object.keys(localStorage)
      .filter((k) => k.startsWith('cow:'))
      .map((k) => k.slice(4));
  }
}

/**
 * RemoteAdapter — not implemented yet, kept here so the shape of the eventual
 * backend is fixed by the app rather than discovered later.
 *
 * Requirements it has to meet, which GitHub Pages alone cannot:
 *   - one shared family document per room, readable and writable by several
 *     players from different devices;
 *   - change notification (SSE, WebSocket, or polling with an ETag) so a player
 *     sees another player's turn without reloading;
 *   - last-write-wins is not good enough for the deck: drawing a card mutates
 *     shared order, so writes need either a revision check (optimistic
 *     concurrency, retry on conflict) or server-side intent endpoints
 *     ("draw from deck X") rather than whole-document PUTs.
 *
 * Any of Cloudflare Workers + Durable Objects / KV, Supabase (Postgres +
 * realtime), Firebase, or a small VPS service behind the existing
 * sortilege.online reverse proxy would satisfy this. The static site can stay
 * on Pages; only this adapter needs an origin.
 */
class RemoteAdapter {
  constructor(room, base) { this.room = room; this.base = base; }
  get name() { return 'remote'; }
  async load() { throw new Error('RemoteAdapter is not implemented yet — see store.js'); }
  async save() { throw new Error('RemoteAdapter is not implemented yet — see store.js'); }
  subscribe() { return () => {}; }
  async listRooms() { return []; }
}

/* ------------------------------------------------------------------ store -- */

export function makeAdapter() {
  const q = new URLSearchParams(location.search);
  const room = q.get('room') || 'family';
  return q.get('store') === 'remote'
    ? new RemoteAdapter(room, q.get('api') || '')
    : new LocalAdapter(room);
}

export function blankState(room = 'family') {
  return {
    version: STATE_VERSION,
    room,
    rev: 0,
    setupComplete: false,
    setup: { stage: 0, start: 'riverlands' },   // stage = book step − 1 (0..7)
    family: {
      name: '', region: 'Riverlands', home: null, tradition: null,
      chapter: 1, session: 1, chapterClosed: false,
    },
    characters: [],
    sideCharacters: [],
    decks: {},          // deckName -> [cardId] (top of deck first)
    inPlay: [],         // deck names brought into play
    pool: [],           // face-up cards left on the table
    table: [],          // { cardId, from, to, kind:'share'|'witness'|'memory', revealed }
    turn: { order: [], current: 0, phase: 'idle', scene: null, sceneKind: null, memoryTarget: null },
    migration: null,    // { destination, entrance } while the family is migrating
    chapterEnd: null,   // { marked:{id:kind}, held:{id:true} } while a Chapter is closing
    chapterStart: null, // { rolled:{id:roll}, boroughRolled:bool } at the start of a Chapter
    borough: { inPlay: false, station: null, isHome: false },
    umbraInPlay: true,
    variants: {},       // optional-rule name -> boolean
    log: [],
  };
}

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = blankState(adapter.room);
    this.listeners = new Set();
    this._unsub = null;
    this.history = [];   // earlier states, this page only — for Undo
  }

  async init() {
    const loaded = await this.adapter.load();
    if (loaded && loaded.version === STATE_VERSION) this.state = loaded;
    else if (loaded) this.state = migrate(loaded);
    this._unsub = this.adapter.subscribe((s) => {
      if (s && s.rev >= this.state.rev) { this.state = s; this.emit(); }
    });
    this.emit();
    return this.state;
  }

  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
  emit() { for (const cb of this.listeners) cb(this.state); }

  /** Mutate through here so every change is persisted, revisioned and broadcast. */
  async update(fn, logLine) {
    const before = this.state;
    const next = structuredClone(this.state);
    fn(next);
    next.rev = (this.state.rev || 0) + 1;
    if (logLine) {
      next.log = next.log || [];
      next.log.unshift({ at: new Date().toISOString(), text: logLine, ch: next.family?.chapter });
      if (next.log.length > 500) next.log.length = 500;
    }
    if (next.rev !== before.rev) {
      this.history.push(before);
      if (this.history.length > 60) this.history.shift();
    }
    this.state = next;
    await this.adapter.save(next);
    this.emit();
    return next;
  }

  get canUndo() { return this.history.length > 0; }

  /** Step back to the state before the last change, noting it in the record. */
  async undo() {
    const prev = this.history.pop();
    if (!prev) return;
    const undone = this.state.log?.[0]?.text;
    const next = structuredClone(prev);
    next.rev = (this.state.rev || 0) + 1;
    next.log = [{ at: new Date().toISOString(), text: `Undone: ${undone || 'the last change'}`, ch: next.family?.chapter, undo: true }, ...(prev.log || [])];
    this.state = next;
    await this.adapter.save(next);
    this.emit();
  }

  async reset() {
    this.history = [];
    this.state = blankState(this.adapter.room);
    await this.adapter.save(this.state);
    this.emit();
  }
}

/**
 * Bring an older saved table forward. v3 → v4 keeps the family, the decks and
 * the record: it adds tokens, the eight-step setup and the procedure states.
 * Anything older has no released play to protect and starts clean.
 */
function migrate(old) {
  if (old.version === 3) {
    const s = { ...blankState(old.room || 'family'), ...old, version: STATE_VERSION };
    s.family = { ...blankState().family, ...old.family, tradition: old.family?.tradition || null };
    // v3 setup had four screens: home, family, hand, Umbra.
    const stageMap = [1, 2, 5, 7];
    s.setup = { stage: stageMap[old.setupStage || 0] ?? 0, start: 'riverlands' };
    delete s.setupStage;
    s.characters = (old.characters || []).map((c, i) => ({ visiting: null, ...c,
      token: (c.token && TOKENS.some((t) => t.id === c.token)) ? c.token : TOKENS[i % TOKENS.length].id }));
    if (s.turn?.phase === 'pass-tradition') s.turn.phase = 'lead';
    s.turn = { memoryTarget: null, ...s.turn };
    s.log = [{ at: new Date().toISOString(), text: 'The table was carried forward to a new version of the play surface.', ch: s.family.chapter }, ...(old.log || [])];
    return s;
  }
  const fresh = blankState(old.room || 'family');
  fresh.log = Array.isArray(old.log) ? old.log : [];
  fresh.log.unshift({
    at: new Date().toISOString(),
    text: `Saved table was version ${old.version}; this build expects ${STATE_VERSION}. State was reset, the log kept.`,
  });
  return fresh;
}

/**
 * Tokens. The boxed game's Tokens are double-sided picture discs; the app's
 * stand-ins are colours, each worn with the character's initial.
 */
export const TOKENS = [
  { id: 'frost', name: 'Frost', color: '#bcd8e6' },
  { id: 'ember', name: 'Ember', color: '#e8912e' },
  { id: 'rose',  name: 'Rose',  color: '#f48cbe' },
  { id: 'moss',  name: 'Moss',  color: '#9fbf7a' },
  { id: 'gold',  name: 'Gold',  color: '#edc76a' },
  { id: 'dusk',  name: 'Dusk',  color: '#a99be0' },
  { id: 'rust',  name: 'Rust',  color: '#c1703c' },
  { id: 'sea',   name: 'Sea',   color: '#5fb3b0' },
  { id: 'ash',   name: 'Ash',   color: '#b9b7b4' },
  { id: 'wine',  name: 'Wine',  color: '#c0455a' },
];
