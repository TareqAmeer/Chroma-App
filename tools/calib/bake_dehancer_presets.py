#!/usr/bin/env python3
"""Bake the 67 Dehancer-extracted LUTs (calib/dehancer/cubes/*.cube) + their calibrated
Grain/Halation/Bloom Amount defaults (calib/dehancer/film_fx_defaults.json) into
chromasmith-22.html: extends LUT_PRESETS, LUT_META, LUT_CATEGORY_ORDER, adds a new
LUT_FX_DEFAULTS const, and patches selectLUT() to apply those FX defaults whenever a
preset with an entry in LUT_FX_DEFAULTS is picked (grain/halation/bloom enabled + Amount
set; format and every other sub-parameter are left as whatever the user currently has, and
the sliders remain freely adjustable afterward -- this only sets a starting point).

Ships publicly by design (user-confirmed) -- these are Dehancer Online screen-scraped/
API-derived looks, distinct from the calib/dehancer/ note in CLAUDE.md which was about
*not* shipping them; that decision was revisited and the user explicitly opted to ship.

Run: python calib/bake_dehancer_presets.py
"""
import base64
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HTML_PATH = os.path.join(ROOT, "chromasmith-22.html")
CUBES_DIR = os.path.join(HERE, "dehancer", "cubes")
FX_DEFAULTS_PATH = os.path.join(HERE, "dehancer", "film_fx_defaults.json")
FILMS_JSON_PATH = os.path.join(HERE, "dehancer", "films.json")

NEW_CATEGORY = "Dehancer Online"


def parse_cube(path):
    """Same logic as gen_lut_presets.py's parse_cube -- kept identical on purpose so both
    scripts produce byte-identical output for the same .cube."""
    size = None
    data = bytearray()
    n = 0
    with open(path, "r", errors="replace") as f:
        for line in f:
            s = line.strip()
            if not s or s.startswith("#"):
                continue
            up = s.upper()
            if up.startswith("LUT_3D_SIZE"):
                size = int(s.split()[-1]); continue
            if up.startswith("TITLE") or up.startswith("LUT_") or up.startswith("DOMAIN"):
                continue
            parts = s.split()
            if len(parts) < 3:
                continue
            try:
                r, g, b = float(parts[0]), float(parts[1]), float(parts[2])
            except ValueError:
                continue
            data.append(max(0, min(255, round(r * 255))))
            data.append(max(0, min(255, round(g * 255))))
            data.append(max(0, min(255, round(b * 255))))
            n += 1
    return size, n, bytes(data)


def js_key(key):
    return '"%s"' % key.replace("\\", "\\\\").replace('"', '\\"')


def is_bw(base_film_name, films_by_caption):
    info = films_by_caption.get(base_film_name)
    if not info:
        return False
    return "bw" in (info.get("tags") or "").split(", ") or info.get("tags") == "bw" or "bw" in (info.get("tags") or "")


def main():
    with open(FX_DEFAULTS_PATH) as f:
        fx_defaults = json.load(f)

    films_by_caption = {}
    if os.path.exists(FILMS_JSON_PATH):
        with open(FILMS_JSON_PATH) as f:
            for entry in json.load(f):
                films_by_caption[entry["caption"]] = entry

    cube_files = sorted(glob.glob(os.path.join(CUBES_DIR, "*.cube")))
    if not cube_files:
        sys.exit("no .cube files in %r" % CUBES_DIR)

    preset_entries, meta_entries, fx_entries = [], [], []
    for path in cube_files:
        key = os.path.splitext(os.path.basename(path))[0]
        size, n, data = parse_cube(path)
        expect = (size or 0) ** 3
        if size != 33 or n != expect:
            sys.stderr.write("WARN %s: size=%s entries=%s expected=%s\n" % (key, size, n, expect))
        b64 = base64.b64encode(data).decode("ascii")
        preset_entries.append("  %s:'%s'" % (js_key(key), b64))

        base_film = fx_defaults.get(key, {}).get("base_film", key)
        category = "B&W" if is_bw(base_film, films_by_caption) else NEW_CATEGORY
        meta_entries.append('  %s:"%s"' % (js_key(key), category))

        d = fx_defaults.get(key)
        if d and all(d.get(e) is not None for e in ("grain", "halation", "bloom")):
            fx_entries.append("  %s:{grain:%s,halation:%s,bloom:%s}" % (
                js_key(key), d["grain"], d["halation"], d["bloom"]))

    html = open(HTML_PATH).read()

    # 1) extend LUT_PRESETS
    m = re.search(r"(const LUT_PRESETS=\{\n)(.*?)(\n\};)", html, re.S)
    if not m:
        sys.exit("could not find const LUT_PRESETS={...}; block")
    html = html[:m.end(2)] + ",\n" + ",\n".join(preset_entries) + html[m.end(2):]

    # 2) extend LUT_META
    m = re.search(r"(const LUT_META=\{\n)(.*?)(\n\};)", html, re.S)
    if not m:
        sys.exit("could not find const LUT_META={...}; block")
    html = html[:m.end(2)] + ",\n" + ",\n".join(meta_entries) + html[m.end(2):]

    # 3) add the new category to LUT_CATEGORY_ORDER (before 'Other', after 'B&W')
    old_order = "const LUT_CATEGORY_ORDER=['Fujify Looks','C41 Still','Cinema','Reversal','Instant','Niche','B&W','Other'];"
    new_order = "const LUT_CATEGORY_ORDER=['Fujify Looks','C41 Still','Cinema','Reversal','Instant','Niche','B&W','%s','Other'];" % NEW_CATEGORY
    if old_order not in html:
        sys.exit("could not find the exact LUT_CATEGORY_ORDER line to patch -- check for drift")
    html = html.replace(old_order, new_order, 1)

    # 4) insert LUT_FX_DEFAULTS right after LUT_META's closing '};'
    fx_const = "const LUT_FX_DEFAULTS={\n" + ",\n".join(fx_entries) + "\n};\n"
    marker = re.search(r"const LUT_META=\{.*?\n\};\n", html, re.S)
    if not marker:
        sys.exit("could not find LUT_META block end to insert LUT_FX_DEFAULTS after")
    insert_at = marker.end()
    if "const LUT_FX_DEFAULTS=" in html:
        html = re.sub(r"const LUT_FX_DEFAULTS=\{.*?\n\};\n", fx_const, html, count=1, flags=re.S)
    else:
        html = html[:insert_at] + fx_const + html[insert_at:]

    # 5) patch selectLUT() to apply FX defaults when present for the picked preset key
    old_select = """async function selectLUT(v){
  const del=document.getElementById('btn-lut-del');del.disabled=!v.startsWith('l:');
  if(typeof syncSectionEnabled==='function')syncSectionEnabled();
  try{
    if(!v){fxState.lut=null;renderPreview();log('LUT off');return}
    let lut;
    if(v.startsWith('p:'))lut=lutFromBytes(b64ToBytes(LUT_PRESETS[v.slice(2)]));
    else{const rec=await lutLibGet(v.slice(2));if(!rec){log('LUT not found in library','err');return}lut=lutFromBytes(rec.data)}
    FX.setLUT(lut);fxState.lut=lut;renderPreview();log(`LUT applied: ${v.slice(2)}`,'ok');
  }catch(e){log('LUT error: '+e.message,'err')}
}"""
    new_select = """async function selectLUT(v){
  const del=document.getElementById('btn-lut-del');del.disabled=!v.startsWith('l:');
  if(typeof syncSectionEnabled==='function')syncSectionEnabled();
  try{
    if(!v){fxState.lut=null;renderPreview();log('LUT off');return}
    let lut;
    if(v.startsWith('p:'))lut=lutFromBytes(b64ToBytes(LUT_PRESETS[v.slice(2)]));
    else{const rec=await lutLibGet(v.slice(2));if(!rec){log('LUT not found in library','err');return}lut=lutFromBytes(rec.data)}
    FX.setLUT(lut);fxState.lut=lut;
    // Dehancer-derived looks carry a calibrated Grain/Halation/Bloom starting point (per-film
    // measured against Dehancer Online, see calib/dehancer/ONE_FILM_GATE.md) -- apply it as a
    // default every time this look is picked. Sliders stay freely adjustable afterward; this
    // never touches format or any other sub-parameter, and looks without an entry here (the
    // original 46 built-ins) are completely unaffected.
    if(v.startsWith('p:')&&typeof LUT_FX_DEFAULTS!=='undefined'&&LUT_FX_DEFAULTS[v.slice(2)]){
      const d=LUT_FX_DEFAULTS[v.slice(2)];
      const setAmt=(tgId,slId,valId,amt)=>{
        const tg=document.getElementById(tgId),sl=document.getElementById(slId),vl=document.getElementById(valId);
        if(tg)tg.classList.add('on');if(sl)sl.value=amt;if(vl)vl.textContent=Math.round(amt);
      };
      setAmt('tg-grain','sl-grain-a','vl-grain-a',d.grain);
      setAmt('tg-hal','sl-hal-a','vl-hal-a',d.halation);
      setAmt('tg-bloom','sl-bloom-a','vl-bloom-a',d.bloom);
      if(typeof syncSectionEnabled==='function')syncSectionEnabled();
    }
    renderPreview();log(`LUT applied: ${v.slice(2)}`,'ok');
  }catch(e){log('LUT error: '+e.message,'err')}
}"""
    if old_select not in html:
        sys.exit("could not find the exact selectLUT() function body to patch -- check for drift")
    html = html.replace(old_select, new_select, 1)

    with open(HTML_PATH, "w") as f:
        f.write(html)

    print(f"baked {len(preset_entries)} presets, {len(fx_entries)} with FX defaults")
    print(f"wrote {HTML_PATH}")


if __name__ == "__main__":
    main()
