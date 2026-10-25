#!/usr/bin/env python3
"""Real-app screenshots of the Masks sidebar: scenarios x theme x panel width (min/default/max) x scroll (top/bottom).
Needs the app started with `app_control.py start --automation` and a photo open in the Editor.
Restores localStorage cs_panelw / chromasmith_msk_groups and the theme class afterwards.
Usage: mask_panel_shots.py OUTDIR TAG [scenario ...]"""
import json, os, subprocess, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
OUT, TAG = sys.argv[1], sys.argv[2]
SCEN = sys.argv[3:] or ['empty', 'brush', 'radial', 'linear', 'ai', 'skin', 'color']
os.makedirs(OUT, exist_ok=True)

def ev(code, to=30, raw=False):
    # the app's eval hook takes ONE expression: wrap statements in an IIFE (a bare 'a;b;1' fails with a Function syntax error)
    if not raw: code = '(()=>{' + code.rstrip(';') + ';return 1})()'
    r = subprocess.run([sys.executable, os.path.join(HERE, 'app_control.py'), 'run', '--timeout', str(to), '--code', code], capture_output=True, text=True)
    try: return json.loads(r.stdout)['result']
    except Exception: print('eval failed', r.stdout, r.stderr); return None

def winid():
    return subprocess.run(['swift', os.path.join(HERE, 'native_helpers', 'find_window.swift'), '--', 'Chromasmith'], capture_output=True, text=True).stdout.split()[0]

SETUP = {
 'empty': "fxState.masks.length=0;mskSel=-1;",
 'brush': "fxState.masks.length=0;mskAdd('brush');mskSel=0;",
 'radial': "fxState.masks.length=0;mskAdd('radial');mskSel=0;",
 'linear': "fxState.masks.length=0;mskAdd('linear');mskSel=0;",
 'ai': "fxState.masks.length=0;mskAdd('ai');mskSel=0;",
 'skin': "fxState.masks.length=0;mskAdd('skin');mskSel=0;Object.assign(fxState.masks[0],{crOn:true,crSamples:[{rgb:[200,150,120],h:0.6,s:0.05,v:0.7},{rgb:[180,130,100],h:0.62,s:0.06,v:0.6}]});",
 'color': "fxState.masks.length=0;mskAdd('color');mskSel=0;",
}
saved = ev("JSON.stringify([localStorage.getItem('cs_panelw'),localStorage.getItem('chromasmith_msk_groups2'),localStorage.getItem('csThemeEditor'),document.body.classList.contains('light')])", raw=True)
saved = json.loads(saved)
ev("fxSection('local');document.getElementById('tg-local').classList.add('on')")
wid = winid()
try:
    for theme in ('dark', 'light'):
        ev("document.body.classList.toggle('light',%s)" % ('true' if theme == 'light' else 'false'))
        for wname, w in (('min', 220), ('default', 320), ('max', 440)):
            ev("document.body.style.setProperty('--panel-w-user','%dpx');window.dispatchEvent(new Event('resize'))" % w)
            for sc in SCEN:
                ev("localStorage.removeItem('chromasmith_msk_groups2');if(typeof mskGroupsResetDefaults==='function')mskGroupsResetDefaults();else Object.assign(_mskGroupOpen,{selection:true,adjust:true,adjColor:true,adjEffects:false,adjDetail:false,skin:true,coattone:false});%smskRebuild()" % SETUP[sc])
                time.sleep(0.4)
                for pos in ('top', 'bottom'):
                    ev("(()=>{const c=document.getElementById('local-ctl');const sp=_mskScrollParent(c);if(sp)sp.scrollTop=%s;return 1})()" % ('0' if pos == 'top' else '1e6'), raw=True)
                    time.sleep(0.25)
                    f = os.path.join(OUT, f"{TAG}_{sc}_{theme}_{wname}_{pos}.png")
                    subprocess.run(['screencapture', '-l', wid, '-o', f])
finally:
    ev("fxState.masks.length=0;mskSel=-1;mskRebuild();%s%s%s;document.body.classList.toggle('light',%s);document.body.style.removeProperty('--panel-w-user');1" % (
        ("localStorage.setItem('cs_panelw','%s');document.body.style.setProperty('--panel-w-user','%spx');" % (saved[0], saved[0])) if saved[0] else "localStorage.removeItem('cs_panelw');",
        ("localStorage.setItem('chromasmith_msk_groups2',%s);" % json.dumps(saved[1])) if saved[1] else "localStorage.removeItem('chromasmith_msk_groups2');",
        ("localStorage.setItem('csThemeEditor',%s)" % json.dumps(saved[2])) if saved[2] else "1", 'true' if saved[3] else 'false'))
print('done', OUT)
