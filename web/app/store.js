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

export const STATE_VERSION = 3;

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
    family: { name: '', region: 'Riverlands', home: null, chapter: 1, session: 1 },
    characters: [],
    sideCharacters: [],
    decks: {},          // deckName -> [cardId] (top of deck first)
    inPlay: [],         // deck names brought into play
    pool: [],           // face-up cards left on the table
    table: [],          // { cardId, from, to, kind:'share'|'witness', revealed }
    turn: { order: [], current: 0, phase: 'idle', scene: null, sceneKind: null },
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
    const next = structuredClone(this.state);
    fn(next);
    next.rev = (this.state.rev || 0) + 1;
    if (logLine) {
      next.log = next.log || [];
      next.log.unshift({ at: new Date().toISOString(), text: logLine });
      if (next.log.length > 500) next.log.length = 500;
    }
    this.state = next;
    await this.adapter.save(next);
    this.emit();
    return next;
  }

  async reset() {
    this.state = blankState(this.adapter.room);
    await this.adapter.save(this.state);
    this.emit();
  }
}

function migrate(old) {
  // No released versions to migrate from yet; start clean but keep the log so a
  // player does not lose their record of play.
  const fresh = blankState(old.room || 'family');
  fresh.log = Array.isArray(old.log) ? old.log : [];
  fresh.log.unshift({
    at: new Date().toISOString(),
    text: `Saved table was version ${old.version}; this build expects ${STATE_VERSION}. State was reset, the log kept.`,
  });
  return fresh;
}
