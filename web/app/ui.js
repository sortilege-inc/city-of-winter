/* ==========================================================================
   ui.js — small DOM helpers shared by every page. No framework.
   ========================================================================== */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

/** node.append, but skipping null/false/undefined — which append() would print. */
export function add(node, ...kids) {
  for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) node.append(k);
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

export function nav(active) {
  const items = [
    ['index.html', 'Home', ''],
    ['table/index.html', 'The Table', 'table'],
    ['atlas/index.html', 'Atlas', 'atlas'],
    ['traditions/index.html', 'Traditions', 'traditions'],
    ['rules/index.html', 'Rules', 'rules'],
  ];
  // pages live one directory deep except the landing page
  const up = active === '' ? '' : '../';
  return el('nav', { class: 'topnav' },
    el('a', { class: 'brand', href: up + 'index.html', text: 'City of Winter' }),
    el('span', { class: 'links' }, items.map(([href, label, key]) =>
      el('a', { href: up + href, class: key === active ? 'active' : '', 'aria-current': key === active ? 'page' : null, text: label }))),
    el('span', { class: 'spacer' }),
    el('a', {
      href: '#', class: 'xcard', text: '✕ X-Card',
      onclick: (e) => { e.preventDefault(); xcard(); },
    }));
}

export function mountNav(active) {
  document.body.prepend(nav(active));
}

/** The X-Card, as the rules define it (p.11). Available on every page. */
export function xcard() {
  const dlg = el('dialog', { class: 'xcard-dialog' },
    el('h2', { text: '✕ The X-Card' }),
    el('p', { class: 'lede', html: '&ldquo;The X-Card is a safety tool. It reminds us that we all have the power to remove anything from the story that is making us feel uncomfortable, or spoiling our fun. To do so, simply tap this card, or say &lsquo;I&rsquo;d like to X card that,&rsquo; and we&rsquo;ll find another way to tell our story. No questions asked.&rdquo;' }),
    el('p', { class: 'small muted', text: 'The X-Card was created by John Stavropoulos.' }),
    el('div', { class: 'btnrow' },
      el('button', { class: 'primary', text: 'No questions asked', onclick: () => dlg.close() })));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

export function footer(extra) {
  return el('footer', { class: 'foot' },
    el('span', { class: 'mark', text: '❋' }),
    'City of Winter · Heart of the Deernicorn · design by Ross Cowman',
    extra ? el('div', { class: 'small', style: 'margin-top:0.5rem', text: extra }) : null);
}

export function mountFooter(extra) { document.body.append(footer(extra)); }

/** A modal that resolves to the chosen value (or null if dismissed). */
export function choose(title, options, { body = null, cancel = 'Never mind' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); dlg.close(); } };
    const dlg = el('dialog', {},
      el('h2', { text: title }),
      body,
      el('div', { class: 'btnrow' },
        options.map((o) => el('button', {
          class: o.class || '', text: o.label,
          onclick: () => finish(o.value),
        })),
        cancel ? el('button', { class: 'ghost', text: cancel, onclick: () => finish(null) }) : null));
    document.body.append(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); if (!done) { done = true; resolve(null); } });
    dlg.showModal();
  });
}

/** A modal with arbitrary content; resolves when closed. `render(close)` builds it. */
export function modal(title, render) {
  return new Promise((resolve) => {
    const dlg = el('dialog', {});
    const close = (v) => { dlg.close(); resolve(v); };
    dlg.append(el('h2', { text: title }), render(close));
    document.body.append(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(undefined); });
    dlg.showModal();
  });
}

export function marksRow(n, crossed, kind = '') {
  const row = el('span', { class: 'marks', title: `${n} ${kind === 'city' ? 'City Mark' : 'Mark'}${n === 1 ? '' : 's'}${crossed ? `, ${crossed} crossed off` : ''}` });
  for (let i = 0; i < n; i++) {
    row.append(el('span', { class: `mark ${kind} ${i < crossed ? 'off' : ''}`.trim() }));
  }
  if (n === 0 && kind !== 'city') row.append(el('span', { class: 'nomarks', text: 'no Marks' }));
  return row;
}

export function shapeIcon(shape) {
  return el('span', { class: `shape ${shape || 'circle'}`, title: shape });
}

/**
 * A Tradition Card in the game's own printing. Face down it shows its back —
 * "every card has an icon on the back showing which deck it belongs to" (p.8).
 * Selectable cards are real buttons, so they work from the keyboard.
 */
export function cardEl(card, data, opts = {}) {
  const palette = data.palette(card.deck);
  const deck = data.byDeck.get(card.deck);
  const tag = opts.onclick ? 'button' : 'div';
  const node = el(tag, {
    type: tag === 'button' ? 'button' : null,
    class: ['tcard', opts.selectable || opts.onclick ? 'selectable' : '', opts.chosen ? 'chosen' : '',
      opts.facedown ? 'facedown' : '', opts.dim ? 'dim' : '', opts.size ? `sz-${opts.size}` : ''].filter(Boolean).join(' '),
    dataset: { palette, card: card.id },
    title: opts.title ?? (opts.facedown ? `${card.deck} — face down` : `${card.prompt} — ${card.deck}`),
    'aria-pressed': opts.chosen === undefined || tag !== 'button' ? null : String(!!opts.chosen),
    onclick: opts.onclick,
  });
  if (opts.facedown) {
    node.append(el('span', { class: 'back' }, shapeIcon(deck?.shape), el('span', { class: 'deck', text: card.deck })));
  } else {
    if (card.isBoroughWanders) node.append(el('span', { class: 'borough', title: 'The Borough Wanders', text: '⌂' }));
    node.append(
      el('span', { class: 'prompt', text: card.prompt }),
      el('span', { class: 'deck' }, shapeIcon(deck?.shape), card.deck));
  }
  if (opts.badge) node.append(el('span', { class: 'cbadge', text: opts.badge }));
  return node;
}

/** A character's token: the colour they chose, worn with their initial. */
export function tokenEl(ch, tokens, { size = '', title } = {}) {
  const t = tokens.find((x) => x.id === ch?.token) || { color: 'var(--chalk-faint)', name: '' };
  const initial = (ch?.name || '?').trim().charAt(0).toUpperCase();
  return el('span', {
    class: `token ${size}`.trim(), style: `--tok:${t.color}`,
    title: title ?? `${ch?.name || ''}${t.name ? ` · ${t.name} token` : ''}`,
    'aria-hidden': 'true', text: initial,
  });
}

/**
 * The book's own words, laid out: blank lines are paragraphs, "- " lines are a
 * list. Nothing is reworded — this only chooses where the breaks fall.
 */
export function ruleText(text, { cls = '', tag = 'div' } = {}) {
  const node = el(tag, { class: `rtext ${cls}`.trim() });
  if (!text) return node;
  let list = null;
  for (const para of String(text).split(/\n\s*\n/)) {
    const t = para.trim();
    if (!t) continue;
    const m = t.match(/^-\s+([\s\S]*)$/);
    if (m) {
      if (!list) { list = el('ul'); node.append(list); }
      list.append(el('li', { text: m[1] }));
    } else {
      list = null;
      node.append(el('p', { text: t }));
    }
  }
  return node;
}

/** A collapsible aside, closed by default. */
export function details(summary, ...kids) {
  return el('details', { class: 'aside' }, el('summary', {}, summary), ...kids);
}

/** A die face with pips, for rolls the table can see. */
export function dieFace(n, { size = 64 } = {}) {
  const P = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]],
    4: [[1, 1], [3, 1], [1, 3], [3, 3]], 5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]],
    6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] }[n] || [];
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('class', 'die'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `the Die shows ${n}`);
  const r = document.createElementNS(ns, 'rect');
  Object.entries({ x: 2, y: 2, width: 36, height: 36, rx: 7 }).forEach(([k, v]) => r.setAttribute(k, v));
  svg.append(r);
  for (const [cx, cy] of P) {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx * 10); c.setAttribute('cy', cy * 10); c.setAttribute('r', 3.4);
    svg.append(c);
  }
  return svg;
}

export function rollDie() { return 1 + Math.floor(Math.random() * 6); }

export function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export function uid() {
  return 'c' + Math.random().toString(36).slice(2, 9);
}

/**
 * Markdown-ish rendering for the .lore bodies carried in the feed. The source
 * is hard-wrapped, so consecutive lines join into one paragraph (or one list
 * item, for an indented continuation) — a line break is not a paragraph.
 */
export function miniMarkdown(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
  const blocks = [];          // { kind: 'h'|'p'|'li'|'q'|'hr', level, text }
  let cur = null;
  const flush = () => { if (cur) blocks.push(cur); cur = null; };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); blocks.push({ kind: 'h', level: m[1].length, text: m[2] }); continue; }
    if (line === '---') { flush(); blocks.push({ kind: 'hr' }); continue; }
    if ((m = line.match(/^[-*]\s+(.*)$/))) { flush(); cur = { kind: 'li', text: m[1] }; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {
      if (cur && cur.kind === 'q') { cur.text += m[1] ? ' ' + m[1] : '\n'; } else { flush(); cur = { kind: 'q', text: m[1] }; }
      continue;
    }
    if (cur && (cur.kind === 'p' || cur.kind === 'li')) { cur.text += ' ' + line.trim(); continue; }
    flush(); cur = { kind: 'p', text: line.trim() };
  }
  flush();
  let out = '', inList = false;
  for (const b of blocks) {
    if (b.kind !== 'li' && inList) { out += '</ul>'; inList = false; }
    if (b.kind === 'h') out += `<h${b.level + 1}>${inline(b.text)}</h${b.level + 1}>`;
    else if (b.kind === 'hr') out += '<div class="flourish"></div>';
    else if (b.kind === 'li') { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(b.text)}</li>`; }
    else if (b.kind === 'q') out += `<blockquote>${b.text.split('\n').filter((x) => x.trim()).map((x) => `<p>${inline(x.trim())}</p>`).join('')}</blockquote>`;
    else out += `<p>${inline(b.text)}</p>`;
  }
  if (inList) out += '</ul>';
  return out;
}
