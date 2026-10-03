#!/usr/bin/env python3
"""Square One Ep 1 soundtrack: original synthesis only, cues locked to animation frames.
Writes public/music/ep1.wav (48 kHz stereo). Run loudnorm afterwards (see storyboard)."""
from pathlib import Path
import wave
import numpy as np

SR = 48000; FPS = 30; DUR = 29.0; B = 60 / 112
OUT = Path(__file__).resolve().parent / 'public' / 'music' / 'ep1.wav'
rng = np.random.default_rng(1)
fr = lambda f: f / FPS

def note(n, dur, kind='keys'):
    t = np.arange(int(dur * SR)) / SR; hz = 440 * 2 ** ((n - 69) / 12)
    if kind == 'bass':
        a = np.sin(2 * np.pi * hz * t) + .24 * np.sin(4 * np.pi * hz * t) * np.exp(-t * 7)
        return a * (1 - np.exp(-t * 120)) * np.minimum((dur - t) * 30, 1) * np.exp(-t * 2)
    a = np.sin(2 * np.pi * hz * t) * np.exp(-t * 2.3)
    for k, g, d in [(2, .32, 4), (3, .12, 8), (5, .04, 12)]: a += g * np.sin(2 * np.pi * hz * k * t) * np.exp(-t * d)
    return a * (1 - np.exp(-t * 240)) * np.minimum((dur - t) * 25, 1)

def put(buf, a, at, gain=1., pan=0.):
    s = int(at * SR)
    if s >= len(buf) or s + len(a) <= 0: return
    if s < 0: a = a[-s:]; s = 0
    e = min(len(buf), s + len(a)); a = a[:e - s] * gain
    buf[s:e, 0] += a * np.sqrt((1 - pan) / 2); buf[s:e, 1] += a * np.sqrt((1 + pan) / 2)

def groove(seconds):
    g = np.zeros((int(seconds * SR), 2))
    chords = [[57, 61, 64, 68, 71], [50, 57, 61, 64, 66], [54, 57, 61, 64, 68], [52, 59, 61, 66, 68]]
    for bar, at in enumerate(np.arange(0, seconds, 4 * B)):
        c = chords[bar % 4]
        for off in [0, .75, 2, 3.5]:
            for j, n in enumerate(c[1:]): put(g, note(n, 1.4), at + off * B, .04 if off in (0, 2) else .028, (j - 1.5) * .25)
        for off, n, d in [(0, c[0] - 12, .7), (1.5, c[0] - 12, .35), (2.5, c[0] - 5, .4), (3.25, c[0] - 12, .25)]:
            put(g, note(n, d, 'bass'), at + off * B, .19)
    for i, at in enumerate(np.arange(0, seconds, B)):
        t = np.arange(int(.25 * SR)) / SR
        if i % 2 == 0: put(g, np.sin(2 * np.pi * (52 + 70 * np.exp(-t * 30)) * t) * np.exp(-t * 14), at, .32)
        else: put(g, rng.uniform(-1, 1, len(t)) * np.exp(-t * 30), at, .07)
        for h in (0, .5):
            n = rng.uniform(-1, 1, int(.04 * SR)); n = np.diff(n, prepend=0) * np.exp(-np.arange(len(n)) / SR * 90)
            put(g, n, at + h * B, .05, .4 if h else -.4)
    return g

def lowpass(x, hz):
    a = np.exp(-2 * np.pi * hz / SR); y = np.zeros_like(x); prev = np.zeros(x.shape[1])
    for i in range(len(x)): prev = (1 - a) * x[i] + a * prev; y[i] = prev
    return y

def env(n, fade_in=0.005, fade_out=0.02):
    e = np.ones(n); i = int(fade_in * SR); o = int(fade_out * SR)
    e[:i] = np.linspace(0, 1, i); e[-o:] = np.linspace(1, 0, o); return e

# --- SFX: dry, low, unanimated. No pitched chirps. ---
def felt(gain=1., hz=150):
    t = np.arange(int(.14 * SR)) / SR
    return (np.sin(2 * np.pi * hz * t) * np.exp(-t * 34) + lowpass(rng.uniform(-1, 1, (len(t), 1)), 1800)[:, 0] * np.exp(-t * 120) * .6) * gain
def air(dur=.12):
    t = np.arange(int(dur * SR)) / SR
    return lowpass(rng.uniform(-1, 1, (len(t), 1)), 1200)[:, 0] * np.sin(np.pi * t / dur) * .5
def tension(dur=.4):
    t = np.arange(int(dur * SR)) / SR
    return lowpass(rng.uniform(-1, 1, (len(t), 1)), 300 + 0 * t[0])[:, 0] * (t / dur) ** 2 * .9
def release():
    t = np.arange(int(.07 * SR)) / SR
    return lowpass(rng.uniform(-1, 1, (len(t), 1)), 2600)[:, 0] * np.exp(-t * 60) * .8
def creak(dur):
    t = np.arange(int(dur * SR)) / SR
    saw = (np.mod(t * 34, 1) - .5) * np.exp(-((np.mod(t, .23)) * 10))
    return lowpass(saw[:, None], 900)[:, 0] * env(len(t), .05, .3) * .7
def click():
    t = np.arange(int(.03 * SR)) / SR
    return rng.uniform(-1, 1, len(t)) * np.exp(-t * 300) * .35
def thud():
    t = np.arange(int(.5 * SR)) / SR
    return np.sin(2 * np.pi * (62 - 24 * t) * t) * np.exp(-t * 9) * .9
def heart():
    t = np.arange(int(.45 * SR)) / SR
    b = lambda d: np.sin(2 * np.pi * 48 * (t - d)) * np.exp(-np.maximum(t - d, 0) * 22) * (t >= d)
    return (b(0) + .6 * b(.18)) * .8
def wind(dur):
    t = np.arange(int(dur * SR)) / SR
    return lowpass(rng.uniform(-1, 1, (len(t), 1)), 700)[:, 0] * np.sin(np.pi * t / dur) ** 2 * .6

mix = np.zeros((int(DUR * SR), 2)); music = np.zeros_like(mix)
G = groove(20)
def place(buf, seg, f):
    s0 = int(fr(f) * SR); e = min(len(buf), s0 + len(seg)); buf[s0:e] += seg[:e - s0]
place(music, G[:int(fr(110) * SR)] * .55, 0)
place(music, lowpass(G[int(fr(110) * SR):int(fr(440) * SR)], 520) * .7, 110)
src = lowpass(G[int(fr(440) * SR):int(fr(440) * SR) + int(3 * SR)], 420) * .7
n_out = int(fr(498 - 440) * SR); pos = np.cumsum(np.linspace(1, .25, n_out)); pos = pos[pos < len(src) - 1]
dying = np.stack([np.interp(pos, np.arange(len(src)), src[:, c]) for c in (0, 1)], 1) * np.linspace(1, 0, len(pos))[:, None]
place(music, dying, 440)
full = G[:int(fr(870 - 546) * SR)].copy(); fo = int(fr(830 - 546) * SR)
fd = np.ones(len(full)); fd[fo:] = np.linspace(1, 0, len(full) - fo); place(music, full * fd[:, None] * .85, 546)
mix += music

cues = [(felt(.8), 0, .5), (air(), 30, .35), (felt(1, 130), 54, .55),
        (air(), 118, .3), (felt(1, 120), 142, .5), (creak(1.6), 150, .4),
        (tension(), 210, .5), (release(), 222, .5), (felt(1, 170), 240, .45),
        (tension(), 302, .5), (release(), 314, .5), (felt(1, 160), 332, .45),
        (tension(), 392, .5), (release(), 404, .5), (felt(1, 150), 422, .45), (click(), 448, .6), (click(), 472, .6),
        (thud(), 500, .9), (heart(), 525, .9), (release(), 546, .55), (felt(1, 190), 550, .4),
        (air(.2), 556, .35), (felt(1, 140), 584, .5),
        (air(.14), 600, .35), (wind(0.5), 610, .5), (thud(), 622, .5), (felt(1, 170), 648, .4),
        (air(.12), 690, .3), (wind(0.6), 698, .45), (felt(1, 120), 716, .45), (wind(1.4), 718, .4),
        (felt(.8, 160), 760, .4), (click(), 778, .5), (click(), 784, .4), (click(), 796, .5), (click(), 814, .5),
        (air(), 828, .3), (felt(1, 130), 848, .5), (felt(.8), 856, .45)]
for a, f, g in cues: put(mix, a * env(len(a)), fr(f), g)

mix = np.tanh(mix * 1.2) / 1.2
pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
OUT.parent.mkdir(exist_ok=True, parents=True)
with wave.open(str(OUT), 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', OUT)
