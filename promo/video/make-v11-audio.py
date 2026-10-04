# v11 motion-design cut (82 s): the v10 felt-piano score, same instruments, retimed to the new beats. Felt piano + room, dry tactile hits, silence at the low point.
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


# ---- open + photo ----
chord(0.05, ['A2', 'E3', 'C#4', 'B4'], 0.55)
add(tap(980), 1.95, 0.8); add(tap(760, 70), 2.6, 1.0, 0.3); add(thud(70, 0.18, 14), 2.6)
chord(3.2, ['F#2', 'C#3', 'A3', 'E4'], 0.45)
add(tap(880), 4.35, .5, .2); add(tap(820), 5.6, .55, .2)
# ---- the old way: heavier landings, duller, flatter chords ----
olds = [(10.0, 10.8), (12.0, 13.1), (14.2, 15.5), (16.4, 17.9)]
seq = [['E2', 'B2', 'G#3', 'D4'], ['C#2', 'G#2', 'E3', 'B3'], ['A1', 'E2', 'C#3', 'G#3'], ['F#1', 'C#2', 'A2', 'E3']]
chord(8.7, ['E2', 'B2', 'E3', 'G#3'], 0.35, dull=0.4)
for k in range(4): add(tap(600, 50, .08), 7.6 + k * .15, 1.0, (k / 3 - .5) * .8)
for i, (a, b) in enumerate(olds):
    k = i / 3
    add(tap(700 - 60 * i, 60, .14), a)
    add(thud(60 - 5 * i, .35 + .1 * i, 8), b); add(tap(500 - 40 * i, 50, .18), b)
    chord(b, seq[i], 0.5 - 0.06 * i, dull=0.4 + 1.3 * k, detune=-0.014 * k * k)
add(tap(420, 40, .12), 18.3); add(tap(400, 40, .1), 18.7)
add(thud(46, 0.7, 6), 19.3); add(lowpass(rng.normal(0, 1, int(0.8 * SR)), 400) * np.linspace(0.08, 0, int(0.8 * SR)), 19.3)
silence = (int(19.9 * SR), int(21.6 * SR))
# ---- snap, Meet Chromasmith, the app rises ----
add(tap(1400, 90, 0.35), 21.6)
t = np.arange(int(1.8 * SR)) / SR
add(lowpass(rng.normal(0, 1, len(t)), 1800) * (t / 1.8) ** 2 * 0.07, 21.8, 1.0, 0.0)
add(tap(1100, 80, .3), 23.4); chord(23.4, ['A1', 'A2', 'E3', 'C#4', 'G#4', 'B4'], 0.9); add(thud(42, 0.8, 4.5), 23.6)
add(tap(950, 80, .25), 25.0)
# ---- features: one bright landing per tool, a soft click per UI click ----
prog = [['F#2', 'C#3', 'A3', 'E4'], ['D2', 'A2', 'F#3', 'C#4'], ['E2', 'B2', 'G#3', 'D4'], ['A1', 'E2', 'C#3', 'B3'], ['F#2', 'C#3', 'A3', 'E4'], ['D2', 'A2', 'F#3', 'C#4', 'E4'], ['A1', 'E2', 'C#3', 'G#3', 'E4']]
for i, b in enumerate([27.5, 33.5, 39.35, 50.2, 60.15, 64.6, 69.0]):
    add(tap(1050 + 40 * (i % 3), 80, .22), b, 1.0, (i % 2 - .5) * .4); chord(b, prog[i], .45)
for c in [28.2, 29.2, 30.2, 31.2, 32.3, 33.05, 38.9, 40.4, 41.2, 42.0, 49.75, 51.2, 60.5]: add(tap(2200, 160, .07), c, 1.0, .3)
for a, b in [(35.0, 36.2), (37.2, 38.4), (43.2, 45.0), (52.4, 54.4), (65.0, 67.3)]:  # slider detents
    for k in range(int((b - a) / .09)): add(tap(1700 + 30 * (k % 5), 220, .02), a + k * .09, 1.0, .2)
for k in range(28): add(tap(1600 + 37 * (k % 7), 200, .03), 61.6 + k * .05, 1.0, (k % 2 - .5) * .6)  # export run
add(tap(1300, 90, .2), 63.0)
for i in range(1, 5): add(tap(1000 + 50 * i, 80, .18), 69.4 + 1.25 * i - .08, 1.0, (i % 2 - .5) * .3)
chord(74.3, ['D2', 'A2', 'F#3', 'C#4', 'A4'], .5)
# ---- home ----
chord(76.6, ['E2', 'B2', 'G#3', 'D4'], 0.4)
add(tap(700, 70, 0.3), 78.1); add(thud(65, 0.2, 14), 78.1); chord(78.1, ['A1', 'E2', 'C#3', 'E4'], 0.6)

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
with wave.open('public/music/ep1-v11.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote public/music/ep1-v11.wav', DUR, 's')
