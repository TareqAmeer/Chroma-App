// Tool rail icon families for the playground. Each family maps the 11 desktop rail buttons (as the app's
// buildToolRail emits them: groups folded) to SVG inner markup on a 24px grid.
// Classes: default = hairline stroke in ink; .t = flat tone plane (grey); .t2 = second, lighter tone;
// .k = solid ink fill (dots). Families that need clip paths take a unique id `u`.
window.TOOL_RAIL = [
  ['looks', 'Looks'], ['adjust', 'Adjust', 1], ['color', 'Color', 1], ['detail', 'Detail', 1], ['retouch', 'Retouch'],
  ['crop', 'Crop', 1], ['masks', 'Masks', 1], ['film', 'Film', 1], ['frame', 'Frame', 1], ['export', 'Export', 1], ['info', 'Info'],
];

// helpers ------------------------------------------------------------------
const _hatch = (u, clip, ang = 0, gap = 2, extra = '') => {
  let l = '';
  for (let i = -24; i <= 48; i += gap) l += `M${i} -12V36`;
  return `<clipPath id="${u}"><${clip}/></clipPath><g clip-path="url(#${u})"><path d="${l}" transform="rotate(${ang} 12 12)" ${extra}/></g>`;
};
const _dots = (rows) => {
  let s = ''; const n = rows.length, g = 20 / (n - 1);
  rows.forEach((r, y) => [...r].forEach((c, x) => {
    const cx = (2 + x * g).toFixed(2), cy = (2 + y * g).toFixed(2);
    s += c === '1' ? `<circle class="k" cx="${cx}" cy="${cy}" r="1.15"/>` : c === 'o' ? `<circle cx="${cx}" cy="${cy}" r="1.1"/>` : `<circle class="k t" cx="${cx}" cy="${cy}" r=".45"/>`;
  }));
  return s;
};

window.ICON_FAMILIES = {
  current: { name: 'Current (app)', note: 'What the app ships today, for reference.', icons: () => ({
    looks: '<path d="M5 3v4M3 5h4"/><path d="M13 3l2.4 6.6L22 12l-6.6 2.4L13 21l-2.4-6.6L4 12l6.6-2.4z"/>',
    adjust: '<path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h6M14 18h6"/><circle cx="14" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="12" cy="18" r="2"/>',
    color: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M6 18c6 0 6-12 12-12"/>',
    detail: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    retouch: '<rect x="2" y="8.5" width="20" height="7" rx="3.5" transform="rotate(-45 12 12)"/><circle cx="12" cy="12" r="2.4"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M2 6h14a2 2 0 0 1 2 2v14"/>',
    masks: '<circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
    film: '<circle cx="6" cy="7" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="18" cy="8" r="1"/><circle cx="8" cy="13" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="19" cy="16" r="1"/><circle cx="6" cy="18" r="1"/><circle cx="12" cy="19" r="1"/>',
    frame: '<rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10"/>',
    export: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 21h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>' }) },

  bauhaus: { name: 'A · Primitives', note: 'Bauhaus: every icon built from circle, square and triangle, one grey plane each.', icons: () => ({
    looks: '<rect class="t" x="3" y="3" width="11" height="11"/><rect x="3" y="3" width="11" height="11"/><circle cx="15" cy="15" r="6"/>',
    adjust: '<path d="M3 8h18M3 16h18"/><circle class="t" cx="8" cy="8" r="2.6"/><circle cx="8" cy="8" r="2.6"/><rect x="13.5" y="13.5" width="5" height="5"/>',
    color: '<circle class="t" cx="12" cy="8.5" r="5.2"/><circle cx="12" cy="8.5" r="5.2"/><circle cx="8.5" cy="14.8" r="5.2"/><circle cx="15.5" cy="14.8" r="5.2"/>',
    detail: '<path d="M12 3 21 20H3Z"/><path class="t" d="M12 11 15.5 17h-7Z"/>',
    retouch: '<circle cx="12" cy="12" r="8.5"/><path class="t" d="M12 3.5a8.5 8.5 0 0 1 0 17Z"/><path d="M12 3.5v17"/><circle cx="12" cy="12" r="2.5"/>',
    crop: '<rect class="t" x="7" y="7" width="10" height="10"/><path d="M7 3v14h14M3 7h14v14"/>',
    masks: '<rect x="3" y="3" width="18" height="18"/><circle class="t" cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="5.5"/>',
    film: '<rect x="3" y="5" width="18" height="14"/><path d="M5.5 7.5h1.5M9.5 7.5H11M13 7.5h1.5M17 7.5h1.5M5.5 16.5h1.5M9.5 16.5H11M13 16.5h1.5M17 16.5h1.5"/><circle class="t" cx="12" cy="12" r="2.5"/>',
    frame: '<path class="t" fill-rule="evenodd" d="M3 3h18v18H3ZM7 7v10h10V7Z"/><rect x="3" y="3" width="18" height="18"/><rect x="7" y="7" width="10" height="10"/>',
    export: '<rect x="3" y="8" width="13" height="13"/><path class="t" d="M14 3h7v7Z"/><path d="M9 15 21 3"/>',
    info: '<circle cx="12" cy="12" r="9"/><rect class="t" x="11" y="10.5" width="2" height="7"/><circle class="k" cx="12" cy="7.3" r="1.1"/>' }) },

  hatch: { name: 'B · Line fields', note: 'Op-art (Riley, Vasarely): no outlines, shapes are made only from parallel hairlines; density and angle carry the meaning.', icons: (u) => ({
    looks: _hatch(u + 'a', 'rect x="3" y="3" width="12" height="12"', 0, 2) + _hatch(u + 'b', 'rect x="9" y="9" width="12" height="12"', 90, 2),
    adjust: '<path d="M3 6h18M3 10h10M3 14h15M3 18h6"/><path d="M13 8v4M18 12v4M9 16v4"/>',
    color: _hatch(u + 'a', 'circle cx="12" cy="8.5" r="5.5"', 0, 2) + _hatch(u + 'b', 'circle cx="8.5" cy="15" r="5.5"', 60, 2) + _hatch(u + 'c', 'circle cx="15.5" cy="15" r="5.5"', -60, 2),
    detail: '<path d="M3 4v16M8 4v16M11.5 4v16M14 4v16M16 4v16M17.6 4v16M19 4v16M20.2 4v16M21.2 4v16"/>',
    retouch: _hatch(u + 'a', 'path d="M12 3a9 9 0 1 0 .01 0ZM12 8a4 4 0 1 1-.01 0Z" fill-rule="evenodd" clip-rule="evenodd"', 45, 2) + '<circle cx="12" cy="12" r="4"/>',
    crop: _hatch(u + 'a', 'rect x="7" y="7" width="10" height="10"', 45, 2) + '<path d="M7 3v14h14M3 7h14v14"/>',
    masks: _hatch(u + 'a', 'path d="M3 3h18v18H3ZM12 6.5a5.5 5.5 0 1 0 .01 0Z" fill-rule="evenodd" clip-rule="evenodd"', 90, 2) + _hatch(u + 'b', 'circle cx="12" cy="12" r="5.5"', 0, 2),
    film: '<path d="M3 5h18M3 19h18"/>' + _hatch(u + 'a', 'rect x="3" y="7.5" width="18" height="9"', 90, 1.5) + '<path d="M5 3v1M9 3v1M13 3v1M17 3v1M5 20v1M9 20v1M13 20v1M17 20v1"/>',
    frame: _hatch(u + 'a', 'path d="M3 3h18v18H3ZM7 7v10h10V7Z" fill-rule="evenodd" clip-rule="evenodd"', 45, 1.8),
    export: _hatch(u + 'a', 'path d="M3 21V9h12v12Z"', 0, 2) + '<path d="M11 13 21 3M15 3h6v6"/>',
    info: _hatch(u + 'a', 'rect x="10" y="10" width="4" height="11"', 0, 1.3) + _hatch(u + 'b', 'rect x="10" y="3" width="4" height="4"', 90, 1.3) }) },

  dots: { name: 'C · Dot matrix', note: 'Karl Gerstner / LED matrix: a 7×7 field, lit dots draw the tool, unlit ones stay as a faint grid.', icons: () => ({
    looks: _dots(['1111...', '1..1...', '1..1111', '1111..1', '...1..1', '...1111', '.......'].map((r) => r)),
    adjust: _dots(['.......', '1111o11', '.......', '11o1111', '.......', '11111o1', '.......']),
    color: _dots(['1111111', '111111.', '11111..', '1111...', '111....', '11.....', '1......']),
    detail: _dots(['1.1.1.1', '.......', '1.1.1.1', '.......', '1111111', '1111111', '1111111']),
    retouch: _dots(['..111..', '.1...1.', '1..1..1', '1.111.1', '1..1..1', '.1...1.', '..111..']),
    crop: _dots(['.1.....', '.1.....', '111111.', '.1...1.', '.1...1.', '.111111', '.....1.']),
    masks: _dots(['1111111', '1.....1', '1.111.1', '1.111.1', '1.111.1', '1.....1', '1111111']),
    film: _dots(['1.1.1.1', '.......', '1111111', '1.....1', '1111111', '.......', '1.1.1.1']),
    frame: _dots(['1111111', '1111111', '11...11', '11...11', '11...11', '1111111', '1111111']),
    export: _dots(['...1111', '.....11', '....1.1', '1..1..1', '1.1....', '1......', '11111..']),
    info: _dots(['...1...', '.......', '..11...', '...1...', '...1...', '...1...', '..111..']) }) },

  arcs: { name: 'D · Arcs', note: 'Truchet tiles and Swiss concentric posters: everything drawn from quarter and half circles.', icons: () => ({
    looks: '<path class="t" d="M3 15a6 6 0 0 1 6 6H3Z"/><path d="M3 15a6 6 0 0 1 6 6M3 9a12 12 0 0 1 12 12M3 3a18 18 0 0 1 18 18M3 3v18h18"/>',
    adjust: '<path d="M3 12h18"/><path d="M5 12a4 4 0 0 1 8 0"/><path class="t" d="M11 12a4 4 0 0 0 8 0Z"/><path d="M11 12a4 4 0 0 0 8 0"/>',
    color: '<circle cx="12" cy="12" r="9"/><path class="t" d="M12 12V3a9 9 0 0 1 7.8 13.5Z"/><path d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5"/>',
    detail: '<path d="M3 12a9 9 0 0 1 18 0M6 12a6 6 0 0 0 12 0M9 12a3 3 0 0 1 6 0"/><circle class="k" cx="12" cy="12" r="1"/>',
    retouch: '<circle cx="12" cy="12" r="9"/><path d="M5 17a7 7 0 0 1 7-5 7 7 0 0 0 7-5"/><circle class="t" cx="12" cy="12" r="2.2"/>',
    crop: '<path class="t" d="M3 3h6a6 6 0 0 1-6 6Z"/><path d="M3 9a6 6 0 0 0 6-6M21 15a6 6 0 0 0-6 6"/><path class="t" d="M21 21h-6a6 6 0 0 1 6-6Z"/><rect x="3" y="3" width="18" height="18"/>',
    masks: '<circle cx="12" cy="12" r="9"/><path class="t" d="M12 3a9 9 0 0 0 0 18Z"/><path d="M12 7a5 5 0 0 1 0 10"/>',
    film: '<path d="M3 6h18M3 18h18"/><path d="M4 6a2 2 0 0 0 4 0M10 6a2 2 0 0 0 4 0M16 6a2 2 0 0 0 4 0M4 18a2 2 0 0 1 4 0M10 18a2 2 0 0 1 4 0M16 18a2 2 0 0 1 4 0"/><circle class="t" cx="12" cy="12" r="2.5"/>',
    frame: '<path d="M3 9a6 6 0 0 0 6-6M15 3a6 6 0 0 0 6 6M21 15a6 6 0 0 0-6 6M9 21a6 6 0 0 0-6-6"/><rect class="t" x="8" y="8" width="8" height="8"/>',
    export: '<path d="M3 21A18 18 0 0 1 21 3"/><path class="t" d="M3 21a8 8 0 0 1 8-8v8Z"/><path d="M15 3h6v6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path class="t" d="M9.5 7.5a2.5 2.5 0 0 1 5 0Z"/><path d="M12 11v6"/>' }) },

  construct: { name: 'E · Constructivist', note: 'Lissitzky / Rodchenko: diagonals, wedges and bars at 45°, one grey plane driving through.', icons: () => ({
    looks: '<path d="M3 13 13 3M7 17 17 7M11 21 21 11"/><path class="t" d="M5 15 15 5l2 2L7 17Z"/>',
    adjust: '<path d="M3 7h18M3 17h18"/><path class="t" d="M9 4h4l-2 6h-4Z"/><path d="M15 14h3l-2 6h-3Z"/>',
    color: '<circle cx="11" cy="13" r="7"/><path class="t" d="M3 21 21 3v5L8 21Z"/>',
    detail: '<path d="M3 21 21 3M3 21l18-9M3 21l9-18"/><circle class="k" cx="3.2" cy="20.8" r="1.1"/>',
    retouch: '<circle cx="14" cy="10" r="6"/><path class="t" d="M3 19 15 7l2 2L5 21Z"/><path d="M3 19 15 7l2 2L5 21Z"/>',
    crop: '<path d="M6 3v15h15M3 6h15v15"/><path d="M3 21 21 3"/>',
    masks: '<circle cx="14" cy="10" r="7"/><path class="t" d="M3 21 13 8l3 3Z"/>',
    film: '<path d="M3 15 15 3M9 21 21 9"/><path d="M6 16l2 2M9 13l2 2M12 10l2 2M15 7l2 2"/><path class="t" d="M9 15l3-3 3 3-3 3Z" transform="translate(-1 -1)"/>',
    frame: '<rect x="3" y="3" width="18" height="18"/><path class="t" d="M12 5l7 7-7 7-7-7Z"/><path d="M12 5l7 7-7 7-7-7Z"/>',
    export: '<path d="M3 9h10M3 9v12h12V11"/><path class="t" d="M9 17 19 3l2 2Z"/><path d="M14 3h7v7"/>',
    info: '<path class="t" d="M10 10h3v11h-3Z" transform="rotate(-8 12 15)"/><rect x="10" y="3.5" width="3.2" height="3.2" transform="rotate(20 11.6 5.1)"/><path d="M4 21h16"/>' }) },

  construct2: { name: 'E2 · Constructivist wedge', note: 'Heavier Lissitzky: a grey wedge or bar is the main shape, a single hairline cuts across it.', icons: () => ({
    looks: '<path class="t" d="M3 21 21 3v6L9 21Z"/><path d="M3 15 15 3M3 21 21 3"/>',
    adjust: '<path class="t" d="M3 5h12l-3 4H3ZM9 15h12v4H6Z"/><path d="M3 12h18"/>',
    color: '<path class="t" d="M12 3a9 9 0 0 1 0 18Z"/><circle cx="12" cy="12" r="9"/><path d="M3 21 21 3"/>',
    detail: '<path class="t" d="M3 21 21 3 12 21Z"/><path d="M3 21 21 3M3 21h18"/>',
    retouch: '<path class="t" d="M3 17 17 3l4 4L7 21Z"/><path d="M3 21l18-18"/><circle cx="17" cy="17" r="3"/>',
    crop: '<path class="t" d="M6 6h12v12Z"/><path d="M6 3v15h15M3 6h15v15"/>',
    masks: '<circle class="t" cx="12" cy="12" r="7"/><path d="M3 21 21 3M3 12 12 3M12 21l9-9"/>',
    film: '<path class="t" d="M3 13 13 3h4L3 17Z"/><path d="M7 21 21 7M9 13l2 2M12 10l2 2M15 7l2 2"/>',
    frame: '<path class="t" fill-rule="evenodd" d="M3 3h18v18H3ZM12 6l6 6-6 6-6-6Z"/><path d="M12 6l6 6-6 6-6-6Z"/>',
    export: '<path class="t" d="M3 21V11l10 10Z"/><path d="M3 21 21 3M14 3h7v7"/>',
    info: '<path class="t" d="M10 9h4v12h-4Z"/><path d="M4 21 20 5"/><rect x="10" y="3" width="4" height="3"/>' }) },

  construct3: { name: 'E3 · Constructivist hatched', note: 'Hybrid of E and B: constructivist diagonals and wedges, but every plane is filled with hairline hatching instead of grey.', icons: (u) => ({
    looks: _hatch(u + 'a', 'path d="M5 15 15 5l2 2L7 17Z"', 45, 1.4) + '<path d="M3 13 13 3M11 21 21 11"/>',
    adjust: '<path d="M3 7h18M3 17h18"/>' + _hatch(u + 'a', 'path d="M9 4h4l-2 6H7Z"', 0, 1.3) + '<path d="M15 14h3l-2 6h-3Z"/>',
    color: '<circle cx="11" cy="13" r="7"/>' + _hatch(u + 'a', 'path d="M3 21 21 3v5L8 21Z"', 45, 1.5),
    detail: _hatch(u + 'a', 'path d="M3 21 21 3 12 21Z"', 0, 1.5) + '<path d="M3 21 21 3M3 21l9-18"/>',
    retouch: '<circle cx="14" cy="10" r="6"/>' + _hatch(u + 'a', 'path d="M3 19 15 7l2 2L5 21Z"', 0, 1.3) + '<path d="M3 19 15 7l2 2L5 21Z"/>',
    crop: _hatch(u + 'a', 'path d="M6 6h12v12Z"', 90, 1.6) + '<path d="M6 3v15h15M3 6h15v15"/>',
    masks: '<circle cx="14" cy="10" r="7"/>' + _hatch(u + 'a', 'path d="M3 21 13 8l3 3Z"', 90, 1.4),
    film: '<path d="M3 15 15 3M9 21 21 9"/>' + _hatch(u + 'a', 'path d="M3 15 15 3 21 9 9 21Z"', 45, 2),
    frame: '<rect x="3" y="3" width="18" height="18"/>' + _hatch(u + 'a', 'path d="M12 5l7 7-7 7-7-7Z"', 0, 1.5),
    export: '<path d="M3 9h10M3 9v12h12V11M14 3h7v7"/>' + _hatch(u + 'a', 'path d="M9 17 19 3l2 2Z"', 0, 1.2),
    info: _hatch(u + 'a', 'path d="M10 10h3v11h-3Z"', 45, 1.2) + '<rect x="10" y="3.5" width="3.2" height="3.2" transform="rotate(20 11.6 5.1)"/><path d="M4 21h16"/>' }) },

  construct4: { name: 'E4 · Constructivist lines', note: 'Constructivist geometry with the grey removed: hairlines only, the diagonal does all the work.', icons: () => ({
    looks: '<path d="M3 13 13 3M7 17 17 7M11 21 21 11M5 15l2 2"/>',
    adjust: '<path d="M3 7h18M3 17h18M9 4l4 0-2 6H7ZM15 14h3l-2 6h-3Z"/>',
    color: '<circle cx="11" cy="13" r="7"/><path d="M3 21 21 3M8 21 21 8"/>',
    detail: '<path d="M3 21 21 3M3 21l18-9M3 21l9-18M3 21h18"/>',
    retouch: '<circle cx="14" cy="10" r="6"/><path d="M3 19 15 7l2 2L5 21Z"/>',
    crop: '<path d="M6 3v15h15M3 6h15v15M3 21 21 3"/>',
    masks: '<circle cx="14" cy="10" r="7"/><path d="M3 21 13 8l3 3Z"/>',
    film: '<path d="M3 15 15 3M9 21 21 9M6 16l2 2M9 13l2 2M12 10l2 2M15 7l2 2"/>',
    frame: '<rect x="3" y="3" width="18" height="18"/><path d="M12 5l7 7-7 7-7-7Z"/>',
    export: '<path d="M3 9h10M3 9v12h12V11M9 15 21 3M14 3h7v7"/>',
    info: '<path d="M11 10v11M4 21h16"/><rect x="10" y="3.5" width="3.2" height="3.2" transform="rotate(20 11.6 5.1)"/>' }) },

  hatch2: { name: 'B2 · Line fields diagonal', note: 'Line fields tilted to 45°, finer spacing, so they sit closer to the constructivist family.', icons: (u) => ({
    looks: _hatch(u + 'a', 'rect x="3" y="3" width="12" height="12"', 45, 1.6) + _hatch(u + 'b', 'rect x="9" y="9" width="12" height="12"', -45, 1.6),
    adjust: _hatch(u + 'a', 'rect x="3" y="5" width="18" height="4"', 45, 1.4) + _hatch(u + 'b', 'rect x="3" y="15" width="11" height="4"', 45, 1.4) + '<path d="M13 3v8M14 13v8"/>',
    color: _hatch(u + 'a', 'circle cx="9" cy="12" r="6"', 45, 1.6) + _hatch(u + 'b', 'circle cx="15" cy="12" r="6"', -45, 1.6),
    detail: _hatch(u + 'a', 'path d="M3 21 21 3v18Z"', 45, 1.1) + '<path d="M3 21 21 3"/>',
    retouch: _hatch(u + 'a', 'path d="M12 3a9 9 0 1 0 .01 0ZM12 8a4 4 0 1 1-.01 0Z" fill-rule="evenodd" clip-rule="evenodd"', -45, 1.6) + '<circle cx="12" cy="12" r="4"/>',
    crop: _hatch(u + 'a', 'rect x="7" y="7" width="10" height="10"', -45, 1.5) + '<path d="M7 3v14h14M3 7h14v14"/>',
    masks: _hatch(u + 'a', 'path d="M3 3h18v18H3ZM12 6.5a5.5 5.5 0 1 0 .01 0Z" fill-rule="evenodd" clip-rule="evenodd"', 45, 1.8) + '<circle cx="12" cy="12" r="5.5"/>',
    film: '<path d="M3 5h18M3 19h18"/>' + _hatch(u + 'a', 'rect x="3" y="7.5" width="18" height="9"', 45, 1.4),
    frame: _hatch(u + 'a', 'path d="M3 3h18v18H3ZM7 7v10h10V7Z" fill-rule="evenodd" clip-rule="evenodd"', -45, 1.4) + '<rect x="7" y="7" width="10" height="10"/>',
    export: _hatch(u + 'a', 'path d="M3 21V9h12v12Z"', 45, 1.6) + '<path d="M11 13 21 3M15 3h6v6"/>',
    info: _hatch(u + 'a', 'rect x="10" y="10" width="4" height="11"', 45, 1) + '<rect x="10" y="3" width="4" height="4"/>' }) },

  line: { name: 'F · Single line', note: 'Continuous-line drawing (Aicher-thin): each tool is one unbroken stroke, no fills at all.', icons: () => ({
    looks: '<path d="M3 21V11h6V5h6V3h6v10h-6v6H9v2Z"/>',
    adjust: '<path d="M3 7h7a2 2 0 1 0 4 0h7M21 17h-7a2 2 0 1 0-4 0H3"/>',
    color: '<path d="M12 12a5 5 0 1 1 5-5 5 5 0 1 1-5 10 5 5 0 1 1-5-10 5 5 0 0 1 5 5"/>',
    detail: '<path d="M3 20h18L12 4 3 20l9-5 9 5"/>',
    retouch: '<path d="M4 20c4 0 4-6 8-6s4 6 8 6M12 14V4m-3 3h6"/>',
    crop: '<path d="M7 3v14h14M3 7h14v14"/>',
    masks: '<path d="M3 3h18v18H3V12a9 9 0 0 1 9-9 9 9 0 0 1 0 18"/>',
    film: '<path d="M3 5h18v14H3ZM6 5v14M18 5v14M6 12h12"/>',
    frame: '<path d="M3 3h18v18H3V7h14v10H7v-6h6"/>',
    export: '<path d="M10 4H4v16h16v-6M13 11l8-8m-5 0h5v5"/>',
    info: '<path d="M12 4v1M9 10h3v10m-3 0h6"/>' }) },

  orbit: { name: 'G · Orbits', note: 'Astronomical diagrams: rings, tangents and small bodies — quiet, precise, very thin.', icons: () => ({
    looks: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle class="k" cx="12" cy="3" r="1.3"/><circle class="t" cx="17" cy="12" r="1.8"/>',
    adjust: '<path d="M3 12h18"/><circle cx="12" cy="12" r="9"/><circle class="t" cx="7.5" cy="12" r="2.2"/><circle class="k" cx="16.5" cy="12" r="1.1"/>',
    color: '<ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="4" transform="rotate(120 12 12)"/><circle class="t" cx="12" cy="12" r="2"/>',
    detail: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="3"/><path d="M12 2v20"/>',
    retouch: '<circle cx="12" cy="12" r="8"/><circle class="t" cx="12" cy="12" r="3.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
    crop: '<path d="M7 3v14h14M3 7h14v14"/><circle cx="12" cy="12" r="2.5"/>',
    masks: '<circle cx="12" cy="12" r="9"/><circle class="t" cx="15" cy="12" r="6"/><circle cx="15" cy="12" r="6"/>',
    film: '<circle cx="8" cy="12" r="5"/><circle cx="16" cy="12" r="5"/><path d="M3 12h18"/><circle class="k" cx="8" cy="12" r="1"/><circle class="k" cx="16" cy="12" r="1"/>',
    frame: '<circle cx="12" cy="12" r="9"/><rect x="5.6" y="5.6" width="12.8" height="12.8"/><circle class="t" cx="12" cy="12" r="4"/>',
    export: '<circle cx="9" cy="15" r="6"/><path d="M13.2 10.8 21 3M16 3h5v5"/><circle class="t" cx="9" cy="15" r="2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v8"/><circle class="t" cx="12" cy="6.5" r="1.6"/>' }) },

  planes: { name: 'H · Two-tone planes', note: 'Flat paper cut-outs (Matisse, Josef Albers): two greys overlap, a single hairline marks the edge that matters.', icons: () => ({
    looks: '<rect class="t2" x="3" y="3" width="12" height="12"/><rect class="t" x="9" y="9" width="12" height="12"/><path d="M9 9h6v6"/>',
    adjust: '<rect class="t2" x="3" y="5" width="18" height="5"/><rect class="t" x="3" y="14" width="11" height="5"/><path d="M14 13v7M9 4v7"/>',
    color: '<circle class="t2" cx="9" cy="12" r="6"/><circle class="t" cx="15" cy="12" r="6"/><path d="M12 6.8a6 6 0 0 1 0 10.4"/>',
    detail: '<path class="t2" d="M3 21 12 3l9 18Z"/><path class="t" d="M12 3l9 18h-9Z"/><path d="M12 3v18"/>',
    retouch: '<circle class="t2" cx="12" cy="12" r="9"/><circle class="t" cx="12" cy="12" r="4"/><path d="M3 12h18"/>',
    crop: '<rect class="t2" x="3" y="3" width="18" height="18"/><rect class="t" x="7" y="7" width="14" height="14"/><path d="M7 3v14h14"/>',
    masks: '<rect class="t2" x="3" y="3" width="18" height="18"/><path class="t" d="M12 6a6 6 0 0 1 0 12Z"/><circle cx="12" cy="12" r="6"/>',
    film: '<rect class="t2" x="3" y="4" width="18" height="16"/><rect class="t" x="7" y="7" width="10" height="10"/><path d="M3 4v16M21 4v16"/>',
    frame: '<rect class="t" x="3" y="3" width="18" height="18"/><rect class="t2" x="7" y="7" width="10" height="10"/><rect x="7" y="7" width="10" height="10"/>',
    export: '<rect class="t2" x="3" y="9" width="12" height="12"/><path class="t" d="M9 3h12v12Z"/><path d="M9 15 21 3"/>',
    info: '<circle class="t2" cx="12" cy="12" r="9"/><rect class="t" x="10.5" y="10" width="3" height="8"/><path d="M12 5.5v1.5"/>' }) },
};
