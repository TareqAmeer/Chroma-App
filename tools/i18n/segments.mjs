// Finds every user-visible English segment in a site page: text between tags, readable
// attributes, the <head> meta copy, JSON-LD strings and quoted UI strings in inline scripts.
// Shared by extract (lists what still needs Arabic) and build (swaps it in), so the two can't drift.
export const ATTRS = ['alt', 'aria-label', 'title', 'placeholder', 'data-lab', 'data-goatcounter-title'];
const SKIP_ATTR_TITLE = new Set(['data-goatcounter-title']);   // analytics ids, never shown
const isWords = (s) => /[A-Za-z]{2,}/.test(s) && !/^[\w.-]+\.(webp|png|svg|html|js|css|json|otf|woff2)$/i.test(s.trim());

// Returns [{start,end,text,kind}] over the raw HTML string, non-overlapping, in order.
export function findSegments(html) {
  const out = [];
  const push = (start, end, kind) => {
    const text = html.slice(start, end);
    const t = text.trim();
    if (!t || !isWords(t)) return;
    const lead = text.length - text.trimStart().length, trail = text.length - text.trimEnd().length;
    out.push({ start: start + lead, end: end - trail, text: t, kind });
  };
  const re = /<(script|style|svg)\b[^>]*>[\s\S]*?<\/\1>|<!--[\s\S]*?-->|<[^>]+>/gi;
  let last = 0, m;
  while ((m = re.exec(html))) {
    push(last, m.index, 'text');
    const tag = m[0], base = m.index;
    const low = tag.slice(0, 8).toLowerCase();
    if (low.startsWith('<script')) {
      const open = tag.indexOf('>') + 1, close = tag.lastIndexOf('</');
      const body = tag.slice(open, close), off = base + open;
      if (/application\/ld\+json/.test(tag)) {
        for (const s of body.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
          const prev = body.slice(0, s.index).trimEnd();
          if (prev.endsWith(':') && /"(name|text|description|alternateName|applicationSubCategory)"\s*:$/.test(prev) && /\s/.test(s[1])) push(off + s.index + 1, off + s.index + 1 + s[1].length, 'jsonld');
        }
      } else {
        for (const s of body.matchAll(/'((?:[^'\\\n]|\\.)*)'/g)) {
          const v = s[1];
          if (/[A-Za-z]{2,}[^']*\s[A-Za-z]/.test(v) && !/[{};=<>]|\b(var|const|function|querySelector)\b|^[.#\[]|\(/.test(v)) push(off + s.index + 1, off + s.index + 1 + v.length, 'js');
        }
      }
    } else if (!low.startsWith('<style') && !low.startsWith('<svg') && !low.startsWith('<!--')) {
      const isMeta = /^<meta\b/i.test(tag), isTitle = false;
      for (const a of tag.matchAll(/\s([a-z-:]+)="([^"]*)"/gi)) {
        const name = a[1].toLowerCase();
        const vStart = base + a.index + a[0].indexOf('"') + 1;
        const ok = (ATTRS.includes(name) && !SKIP_ATTR_TITLE.has(name)) ||
          (isMeta && name === 'content' && /(name|property)="(description|og:title|og:description|og:image:alt|twitter:title|twitter:description)"/.test(tag));
        if (ok) push(vStart, vStart + a[2].length, 'attr');
      }
    }
    last = re.lastIndex;
  }
  push(last, html.length, 'text');
  return out;
}
