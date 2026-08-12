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

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

export function nav(active) {
  const items = [
    ['index.html', 'Home', ''],
    ['table/index.html', 'The Table', 'table'],
    ['atlas/index.html', 'Atlas', 'atlas'],
    ['traditions/index.html', 'Traditions', 'traditions'],
    ['rules/index.html', 'Rules', 'rules'],
  ];
  const depth = location.pathname.replace(/\/[^/]*$/, '').split('/').filter(Boolean);
  // pages live one directory deep except the landing page
  const up = active === '' ? '' : '../';
  return el('nav', { class: 'topnav' },
    el('a', { class: 'brand', href: up + 'index.html', text: 'City of Winter' }),
    items.map(([href, label, key]) =>
      el('a', { href: up + href, class: key === active ? 'active' : '', text: label })),
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
  const row = el('span', { class: 'marks' });
  for (let i = 0; i < n; i++) {
    row.append(el('span', { class: `mark ${kind} ${i < crossed ? 'off' : ''}`.trim() }));
  }
  if (n === 0) row.append(el('span', { class: 'small muted', text: 'no Marks' }));
  return row;
}

export function shapeIcon(shape) {
  return el('span', { class: `shape ${shape || 'circle'}`, title: shape });
}

/** A Tradition Card in the game's own printing. */
export function cardEl(card, data, opts = {}) {
  const palette = data.palette(card.deck);
  const node = el('div', {
    class: `tcard ${opts.selectable ? 'selectable' : ''} ${opts.chosen ? 'chosen' : ''} ${opts.facedown ? 'facedown' : ''}`.trim(),
    dataset: { palette, card: card.id },
    title: opts.facedown ? 'face down' : `${card.prompt} — ${card.deck}`,
    onclick: opts.onclick,
  },
    card.isBoroughWanders ? el('span', { class: 'borough', text: '⌂' }) : null,
    el('div', { class: 'prompt', text: opts.facedown ? '' : card.prompt }),
    el('div', { class: 'deck', text: opts.facedown ? '' : card.deck }));
  return node;
}

export function rollDie() { return 1 + Math.floor(Math.random() * 6); }

export function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

export function uid() {
  return 'c' + Math.random().toString(36).slice(2, 9);
}

/** Markdown-ish rendering for the .lore bodies carried in the feed. */
export function miniMarkdown(md) {
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const lines = md.split('\n');
  let out = '', inList = false, inQuote = false;
  const closeList = () => { if (inList) { out += '</ul>'; inList = false; } };
  const closeQuote = () => { if (inQuote) { out += '</blockquote>'; inQuote = false; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const inline = (s) => esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      closeList(); closeQuote();
      out += `<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`;
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      closeQuote();
      if (!inList) { out += '<ul>'; inList = true; }
      out += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList();
      if (!inQuote) { out += '<blockquote>'; inQuote = true; }
      out += `<p>${inline(m[1])}</p>`;
    } else if (line === '---') {
      closeList(); closeQuote(); out += '<div class="flourish"></div>';
    } else if (!line) {
      closeList(); closeQuote();
    } else {
      closeQuote();
      if (inList) out += `<li>${inline(line)}</li>`;
      else out += `<p>${inline(line)}</p>`;
    }
  }
  closeList(); closeQuote();
  return out;
}
