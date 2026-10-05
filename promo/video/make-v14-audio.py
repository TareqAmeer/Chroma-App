# v14 (87.9 s, 41 bars at 112 BPM): one hopeful groove from frame 1. Every picture cut sits on this grid.
# The old way is the SAME groove low-passed (muffled), and the filter opens on "One app." Felt piano + room, dry tactile hits, silence at the low point.
# All synthesised here: no samples, no licensing. Writes public/music/ep1-film.wav (48 kHz stereo).
import numpy as np, wave

SR, DUR = 48000, 41 * 4 * 60 / 112
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


def noise_hit(dur, lo, hi, decay, gain):
    t = np.arange(int(dur * SR)) / SR
    n = lowpass(rng.normal(0, 1, len(t)), hi); n = n - lowpass(n, lo)
    return n * np.exp(-t * decay) * gain
def whoosh(t0, dur, gain=.05, pan=0.0):
    t = np.arange(int(dur * SR)) / SR
    env = np.sin(np.pi * t / dur) ** 2
    add(lowpass(rng.normal(0, 1, len(t)), 2000) * env * gain, t0, 1.0, pan)
def flip(t0, pan=.5):
    add(tap(2400, 180, .09), t0, 1.0, pan); add(tap(1700, 160, .08), t0 + .05, 1.0, pan)

BPM = 112; B = 60 / BPM; BAR = 4 * B
b = lambda n: n * B
ML, MR = np.zeros(N), np.zeros(N)
def madd(sig, t, gain=1.0, pan=0.0):
    i = int(t * SR); n = min(len(sig), N - i)
    if n <= 0: return
    ML[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 - pan)) * 1.414
    MR[i:i+n] += sig[:n] * gain * np.sqrt(0.5 * (1 + pan)) * 1.414
def mchord(t, notes, vel, spread=.006):
    for j, n in enumerate(notes): madd(piano(note(n), 2.6, vel * (0.8 if j else 1.0)), t + j * spread, 1.0, (j / max(1, len(notes) - 1) - .5) * .5)
def hat(): return noise_hit(.07, 6000, 12000, 70, .028)
def clap(): return noise_hit(.16, 1200, 6000, 28, .05)
PROG = [['A2', 'E3', 'A3', 'C#4', 'E4'], ['E2', 'B2', 'E3', 'G#3', 'B3'], ['F#2', 'C#3', 'F#3', 'A3', 'C#4'], ['D2', 'A2', 'D3', 'F#3', 'A3']]
ARP = [['A4', 'C#5', 'E5', 'B4'], ['G#4', 'B4', 'E5', 'F#5'], ['A4', 'C#5', 'F#5', 'E5'], ['F#4', 'A4', 'D5', 'E5']]
DROP = [(b(48), b(50))]            # a held breath before the square punches out
OPEN = b(56)                       # bar 14: the app; the filter is fully open
for bi in range(40):
    t0 = b(4 * bi); ch = PROG[bi % 4]; ar = ARP[bi % 4]
    intro = bi < 2; hook = bi < 4
    mchord(t0, ch[1:], .2 if intro else .26)
    if not intro: madd(piano(note(ch[0]), 2.4, .55, .3), t0, .9); madd(piano(note(ch[0]), 1.2, .35, .3), t0 + b(2.5), .8)
    for e in range(8):
        tt = t0 + e * B / 2
        if any(a <= tt < c for a, c in DROP): continue
        if intro and e % 2: continue
        madd(piano(note(ar[e % 4]), 1.0, .2 if e % 2 else .28), tt, .9, (e % 2 - .5) * .5)
        if not intro and e in (0, 4): madd(thud(56, .32, 11), tt)
        if not hook:
            if e % 2: madd(hat(), tt, 1.0, .35)
            if e in (2, 6): madd(clap(), tt, 1.0, -.15)
mchord(b(160), ['A2', 'E3', 'A3', 'C#4', 'E4', 'B4'], .3)   # bar 40: the held end chord under the lockup
def lp_sweep(x, a, c, f0, f1):
    i0, i1 = int(a * SR), int(c * SR); y = x.copy(); s = 0.0
    for i in range(i0, min(i1, len(x))):
        f = f0 + (f1 - f0) * (i - i0) / max(1, i1 - i0); k = np.exp(-2 * np.pi * f / SR)
        s = (1 - k) * x[i] + k * s; y[i] = s
    return y
for ch in (ML, MR):
    ch[:] = lp_sweep(ch, b(18), b(48), 1600, 320)       # the old way: muffled, closing in
    ch[int(b(18) * SR):int(b(50) * SR)] *= 0.8
L += ML; R += MR
silence = (int(b(1) * SR), int(b(1) * SR))
# ---- SFX on the picture ----
add(tap(980), .75, .5); add(tap(760, 70), 2.2, .9, .2); add(thud(70, .25, 12), 2.2)          # leaves the logo, lands
for k in range(4): add(tap(2200, 160, .06), 2.9 + k * 2 * B, 1.0, .1)                        # each look in the window
t = np.arange(int(1.1 * SR)) / SR
add(lowpass(rng.normal(0, 1, len(t)), 3000) * (t / 1.1) ** 2 * .07, 7.2)                      # riser into "On film."
add(thud(42, .6, 5), 8.3); add(tap(1300, 90, .28), 8.3)
for i in range(4):
    t0 = b(20) + i * 6 * B
    whoosh(t0 - .5, .6, .04, .4); add(tap(700 - 60 * i, 60, .14), t0 + .15); add(thud(60 - 5 * i, .3 + .08 * i, 8), t0 + .9 + i * .12)
for i in range(4): add(thud(50 - 3 * i, .45, 9), b(43.6) + i * .28 + .4); add(tap(500 - 40 * i, 50, .16), b(43.6) + i * .28 + .4)  # the pile
add(tap(1500, 90, .35), b(48) + .3); add(thud(42, .8, 4.5), b(48) + .3)                       # punches out
whoosh(28.9, 1.1, .06)                                                                         # the dive
for c in [33.4, 35.5, 37.6, 39.7, 41.3]: add(tap(2200, 160, .07), c, 1.0, .45)                # clicks
flip(43.2, .5); flip(53.3, .6); flip(57.2, .6)
for a, c, p in [(44.3, 46.5, .45), (54.0, 56.2, .55)]:
    for k in range(int((c - a) / .09)): add(tap(1700 + 30 * (k % 5), 220, .018), a + k * .09, 1.0, p)
for a, d in [(31.6, .9), (41.4, 1.0), (b(88), .6)]: whoosh(a, d, .035)
for i in range(4): whoosh(b(116) + 1.4 + i * 2 * B - .05, .8, .04, (i / 3 - .5) * .8)        # cells develop
for tt in (b(128) + 1.0, b(128) + 5.3): whoosh(tt, 1.6, .045)                                 # split sweeps
for i in range(5): add(tap(1000 + 60 * i, 80, .18), b(140) + .4 + i * 2 * B, 1.0, .3)          # list lines
add(tap(700, 70, .3), b(152) + 1.4); add(thud(65, .2, 14), b(152) + 1.4)                       # docks home
for k, n in enumerate(['E5', 'A5', 'B5', 'C#6', 'E6']): add(piano(note(n), 2.0, .14), b(152) + 1.45 + k * .07, 1.0, (k / 4 - .5) * .7)

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

# fades + normalise to -1 dBFS peak (finish.sh then loudness-normalises to -14 LUFS)
fi = int(0.02 * SR); fo = int(0.6 * SR)
for ch in (L, R): ch[:fi] *= np.linspace(0, 1, fi); ch[-fo:] *= np.linspace(1, 0, fo)
peak = max(np.abs(L).max(), np.abs(R).max()); g = 0.89 / peak
data = (np.stack([L, R], 1) * g * 32767).astype('<i2')
with wave.open('public/music/ep1-v14.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote public/music/ep1-v14.wav', DUR, 's')
