# v12 (82 s): same felt-piano kit and SFX, but hopeful: a bright I-V-vi-IV groove in A major carries the whole new workflow. Felt piano + room, dry tactile hits, silence at the low point.
# All synthesised here: no samples, no licensing. Writes public/music/ep1-film.wav (48 kHz stereo).
import numpy as np, wave

SR, DUR = 48000, 82.0
N = int(SR * DUR)
L, R = np.zeros(N), np.zeros(N)
rng = np.random.default_rng(1)
F = lambda frame: frame / 24.0  # frame -> seconds

def add(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR); n = min(len(sig), N - i)
    if n <= 0: return
    L[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 - pan)) * 1.414
    R[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 + pan)) * 1.414

def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR); y = np.empty_like(x); s = 0.0
    for i in range(len(x)): s = (1 - a) * x[i] + a * s; y[i] = s
    return y

def piano(freq, dur=4.0, vel=1.0, dull=0.0, detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for k in range(1, 10):
        fk = freq * k * np.sqrt(1 + 0.0004 * k * k) * (1 + detune)
        amp = (1 / k ** 1.25) * np.exp(-k * dull * 0.6)
        out += amp * np.sin(2 * np.pi * fk * t) * np.exp(-t * (0.55 + 0.35 * k * (1 + dull)))
    hammer = rng.normal(0, 1, len(t)) * np.exp(-t * 180) * 0.08
    env = np.minimum(1, t / 0.006)
    return (out * env + hammer) * vel * 0.18

def note(name):
    names = {'C': -9, 'C#': -8, 'D': -7, 'D#': -6, 'E': -5, 'F': -4, 'F#': -3, 'G': -2, 'G#': -1, 'A': 0, 'A#': 1, 'B': 2}
    return 440 * 2 ** ((names[name[:-1]] + 12 * (int(name[-1]) - 4)) / 12)

def chord(t, notes, vel=1.0, dull=0.0, detune=0.0, spread=0.012):
    for j, n in enumerate(notes):
        add(piano(note(n), 4.5, vel * (0.8 if j else 1.0), dull, detune), t + j * spread, 1.0, (j / max(1, len(notes) - 1) - 0.5) * 0.5)

def tap(freq=900, decay=60, gain=0.25):
    t = np.arange(int(0.25 * SR)) / SR
    body = np.sin(2 * np.pi * freq * t) * np.exp(-t * decay)
    click = lowpass(rng.normal(0, 1, len(t)) * np.exp(-t * 400), 3500)
    return (body * 0.6 + click * 0.8) * gain

def thud(freq=55, gain=0.6, decay=9):
    t = np.arange(int(0.8 * SR)) / SR
    return np.sin(2 * np.pi * (freq + 40 * np.exp(-t * 30)) * t) * np.exp(-t * decay) * gain

def heartbeat(t0):
    add(thud(48, 0.55, 12), t0); add(thud(44, 0.35, 14), t0 + 0.22)



def noise_hit(dur, lo, hi, decay, gain):
    t = np.arange(int(dur * SR)) / SR
    n = lowpass(rng.normal(0, 1, len(t)), hi) - lowpass(rng.normal(0, 1, len(t)), lo) * 0
    n = n - lowpass(n, lo)  # crude band-pass
    return n * np.exp(-t * decay) * gain

def whoosh(t0, dur, gain=.05, pan=0.0):
    t = np.arange(int(dur * SR)) / SR
    env = np.sin(np.pi * t / dur) ** 2
    n = lowpass(rng.normal(0, 1, len(t)), 900 + 2200 * env.mean()) * env * gain
    add(n, t0, 1.0, pan)

def flip(t0, pan=.5):
    add(tap(2400, 180, .09), t0, 1.0, pan); add(tap(1700, 160, .08), t0 + .05, 1.0, pan)

def blip(t0, pan=0.0, g=.11):
    add(tap(1500, 120, g), t0, 1.0, pan); add(thud(90, .06, 20), t0)

# ---- open + photo: hopeful from the first note ----
chord(0.05, ['A2', 'E3', 'C#4', 'B4'], 0.55)
add(tap(980), 1.95, 0.8); add(tap(760, 70), 2.6, 1.0, 0.3); add(thud(70, 0.18, 14), 2.6)
chord(3.2, ['D2', 'A2', 'F#3', 'E4'], 0.45)
blip(4.3); add(tap(820), 5.6, .55, .2)
chord(5.6, ['E2', 'B2', 'G#3', 'E4'], 0.35)
# ---- the old way: heavier landings, duller, flatter chords (the contrast) ----
olds = [(10.0, 10.8), (12.0, 13.1), (14.2, 15.5), (16.4, 17.9)]
seq = [['E2', 'B2', 'G#3', 'D4'], ['C#2', 'G#2', 'E3', 'B3'], ['A1', 'E2', 'C#3', 'G#3'], ['F#1', 'C#2', 'A2', 'E3']]
whoosh(7.0, 1.6, .04)
for k in range(4): blip(7.6 + k * .15, (k / 3 - .5) * .8, .06)
chord(8.7, ['E2', 'B2', 'E3', 'G#3'], 0.35, dull=0.4)
for i, (a, b) in enumerate(olds):
    k = i / 3
    add(tap(700 - 60 * i, 60, .14), a)
    add(thud(60 - 5 * i, .35 + .1 * i, 8), b); add(tap(500 - 40 * i, 50, .18), b)
    chord(b, seq[i], 0.5 - 0.06 * i, dull=0.4 + 1.3 * k, detune=-0.014 * k * k)
add(tap(420, 40, .12), 18.3); add(tap(400, 40, .1), 18.7); whoosh(18.0, 1.8, .03)
add(thud(46, 0.7, 6), 19.3); add(lowpass(rng.normal(0, 1, int(0.8 * SR)), 400) * np.linspace(0.08, 0, int(0.8 * SR)), 19.3)
silence = (int(19.9 * SR), int(21.6 * SR))
# ---- the turn: snap, a rising pickup, Meet Chromasmith ----
add(tap(1400, 90, 0.35), 21.6)
t = np.arange(int(2.4 * SR)) / SR
add(lowpass(rng.normal(0, 1, len(t)), 2500) * (t / 2.4) ** 2 * 0.06, 21.6, 1.0, 0.0)
BPM = 112; B = 60 / BPM; BAR = 4 * B; G0 = 24.0   # the groove's first downbeat lands on the app's pop
pick = ['A3', 'C#4', 'E4', 'A4', 'B4', 'C#5', 'E5', 'A5']
for k, n in enumerate(pick): add(piano(note(n), 1.6, .32 + .03 * k), G0 - (8 - k) * B / 2, 1.0, (k / 7 - .5) * .5)
add(tap(1100, 80, .3), 23.4); chord(23.4, ['A2', 'E3', 'A3', 'C#4', 'E4'], 0.5)
# ---- the groove: I-V-vi-IV, eighth-note piano pulse, soft kick, shaker, offbeat claps ----
PROG = [['A2', 'E3', 'A3', 'C#4', 'E4'], ['E2', 'B2', 'E3', 'G#3', 'B3'], ['F#2', 'C#3', 'F#3', 'A3', 'C#4'], ['D2', 'A2', 'D3', 'F#3', 'A3']]
ARP = [['A4', 'C#5', 'E5', 'B4'], ['G#4', 'B4', 'E5', 'F#5'], ['A4', 'C#5', 'F#5', 'E5'], ['F#4', 'A4', 'D5', 'E5']]
breath = [(45.5, 47.5), (54.8, 56.8)]  # drums drop out while the camera holds on the photo
G_END = 75.5
nbars = int((G_END - G0) / BAR)
for bi in range(nbars):
    t0 = G0 + bi * BAR; ch = PROG[bi % 4]; ar = ARP[bi % 4]
    lift = 1.0 if t0 < 67.3 else 1.15
    add(piano(note(ch[0]), 2.4, .55, .3), t0, .9); add(piano(note(ch[0]), 1.2, .35, .3), t0 + 2.5 * B, .8)
    chord(t0, ch[1:], .26 * lift, spread=.006)
    for e in range(8):
        tt = t0 + e * B / 2
        add(piano(note(ar[e % 4]), 1.0, (.22 if e % 2 else .3) * lift), tt, .9, (e % 2 - .5) * .5)
        quiet = any(a <= tt < b for a, b in breath)
        if not quiet:
            if e % 2: add(noise_hit(.08, 5000, 12000, 60, .035), tt, 1.0, .35)
            if e in (0, 4): add(thud(56, .32, 11), tt)
            if e in (2, 6): add(noise_hit(.16, 1200, 6000, 28, .06), tt, 1.0, -.15)
# ---- features: a bright landing per tool, UI sounds panned to where the cursor is ----
for i, b in enumerate([27.5, 33.5, 39.35, 49.2, 59.15, 63.6]):
    add(tap(1050 + 40 * (i % 3), 80, .2), b, 1.0, .45)
clicks = [(28.2, .4), (29.2, .45), (30.2, .4), (31.2, .45), (32.3, .45), (33.05, .7), (38.9, .7), (48.75, .7), (59.5, .75), (64.0, -.6)]
for c, p in clicks: add(tap(2200, 160, .07), c, 1.0, p)
for c in [33.7, 40.2, 50.2]: flip(c, .55)
for c in [24.0, 59.6]: blip(c, 0, .14)
for c, p in [(27.6, .1), (33.9, .1), (40.5, .1), (45.6, 0), (50.4, .1), (54.9, 0)]: blip(c, p, .05)
for a, b, p in [(35.0, 36.2, .45), (37.2, 38.4, .45), (41.9, 44.0, .45), (51.4, 53.4, .5), (64.0, 66.3, -.2)]:  # slider detents
    for k in range(int((b - a) / .09)): add(tap(1700 + 30 * (k % 5), 220, .018), a + k * .09, 1.0, p)
for a, d in [(26.3, 1.0), (44.3, 1.2), (47.5, 1.1), (53.6, 1.2), (56.8, 1.0), (57.9, 1.0), (62.6, .8), (67.0, 1.0)]: whoosh(a, d, .035)
for k in range(28): add(tap(1600 + 37 * (k % 7), 200, .025), 60.6 + k * .05, 1.0, (k % 2 - .5) * .6)  # export run
add(tap(1300, 90, .2), 62.0)
for i in range(5): add(tap(1000 + 50 * i, 80, .16), 68.4 + 1.25 * i - .08, 1.0, .3)
# ---- home: resolve on A, a sparkle as the square docks and the prism lights up ----
chord(75.5, ['D2', 'A2', 'F#3', 'C#4', 'E4'], .45)
add(tap(700, 70, 0.3), 77.2); add(thud(65, 0.2, 14), 77.2); chord(77.2, ['A1', 'E2', 'C#3', 'E3', 'B3', 'E4'], 0.7)
for k, n in enumerate(['E5', 'A5', 'B5', 'C#6', 'E6']): add(piano(note(n), 2.0, .16), 77.3 + k * .07, 1.0, (k / 4 - .5) * .7)

# room: short early reflections + a soft plate tail, by FFT convolution
ir_t = np.arange(int(1.6 * SR)) / SR
ir = rng.normal(0, 1, len(ir_t)) * np.exp(-ir_t * 3.2) * 0.05
ir[0] = 1.0
def conv(x):
    n = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x)]
L, R = conv(L), conv(np.roll(R, 9))

# tape-like room tone under everything except the low point, where it drops right down
hiss = lowpass(rng.normal(0, 1, N), 5000) * 0.004
L += hiss; R += np.roll(hiss, 31)
a, b = silence
fade = np.ones(N); fade[a:b] = 0.12; ramp = int(0.03 * SR); fade[a - ramp:a] = np.linspace(1, 0.12, ramp)
L *= fade; R *= fade
heart = np.zeros(N); L2 = L; L, R = L2, R
add(thud(48, 0.55, 12), 20.9); add(thud(44, 0.35, 14), 21.12)

# fades + normalise to -1 dBFS peak (finish.sh then loudness-normalises to -14 LUFS)
fi = int(0.02 * SR); fo = int(0.6 * SR)
for ch in (L, R): ch[:fi] *= np.linspace(0, 1, fi); ch[-fo:] *= np.linspace(1, 0, fo)
peak = max(np.abs(L).max(), np.abs(R).max()); g = 0.89 / peak
data = (np.stack([L, R], 1) * g * 32767).astype('<i2')
with wave.open('public/music/ep1-v12.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote public/music/ep1-v12.wav', DUR, 's')
