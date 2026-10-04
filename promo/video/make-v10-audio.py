# Original score for the v10 one-shot (45 s). Felt piano + room, dry tactile hits, silence at the low point.
# All synthesised here: no samples, no licensing. Writes public/music/ep1-film.wav (48 kHz stereo).
import numpy as np, wave

SR, DUR = 48000, 45.0
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
add(tap(980), 1.7, 0.8); add(tap(760, 70), 2.6, 1.0, 0.3); add(thud(70, 0.18, 14), 2.6)
add(tap(880), 4.3, .5, .2); add(tap(820), 4.9, .45, .2)
chord(2.6, ['F#2', 'C#3', 'A3', 'E4'], 0.45)
# ---- the old way: heavier landings, duller, flatter chords ----
olds = [(5.9, 7.0), (8.9, 9.9), (11.4, 12.5), (14.0, 15.3)]
seq = [['E2', 'B2', 'G#3', 'D4'], ['C#2', 'G#2', 'E3', 'B3'], ['A1', 'E2', 'C#3', 'G#3'], ['F#1', 'C#2', 'A2', 'E3']]
for i, (a, b) in enumerate(olds):
    k = i / 3
    add(tap(700 - 60 * i, 60, .14), a)
    add(thud(60 - 5 * i, .35 + .1 * i, 8), b); add(tap(500 - 40 * i, 50, .18), b)
    chord(b, seq[i], 0.5 - 0.06 * i, dull=0.4 + 1.3 * k, detune=-0.014 * k * k)
add(tap(420, 40, .12), 16.2); add(tap(400, 40, .1), 16.8)
add(thud(46, 0.7, 6), 18.0); add(lowpass(rng.normal(0, 1, int(0.8 * SR)), 400) * np.linspace(0.08, 0, int(0.8 * SR)), 18.0)
silence = (int(18.25 * SR), int(19.6 * SR))
# ---- snap, the app rises ----
add(tap(1400, 90, 0.35), 19.6)
t = np.arange(int(1.8 * SR)) / SR
add(lowpass(rng.normal(0, 1, len(t)), 1800) * (t / 1.8) ** 2 * 0.09, 19.7, 1.0, 0.0)
add(thud(42, 0.9, 4.5), 21.4); chord(21.4, ['A1', 'A2', 'E3', 'C#4', 'G#4', 'B4'], 1.0)
# ---- features: one bright landing each, a click per look ----
prog = [['F#2', 'C#3', 'A3', 'E4'], ['D2', 'A2', 'F#3', 'C#4'], ['E2', 'B2', 'G#3', 'D4'], ['A1', 'E2', 'C#3', 'B3'], ['F#2', 'C#3', 'A3', 'E4'], ['D2', 'A2', 'F#3', 'C#4', 'E4']]
for i, b in enumerate([24.4, 27.0, 29.6, 32.2, 34.8, 37.5]):
    add(tap(1050 + 40 * (i % 3), 80, .22), b, 1.0, (i % 2 - .5) * .4); chord(b, prog[i], .5)
for c in [24.5, 25.1, 25.7, 26.3]: add(tap(2200, 160, .07), c, 1.0, .3)
for k in range(24): add(tap(1600 + 37 * (k % 7), 200, .035), 37.6 + k * .035 + .3, 1.0, (k % 2 - .5) * .8)
# ---- home ----
add(tap(950), 40.4, 0.6); chord(41.2, ['E2', 'B2', 'G#3', 'D4'], 0.45)
add(tap(700, 70, 0.3), 43.0); add(thud(65, 0.2, 14), 43.0); chord(43.0, ['A1', 'E2', 'C#3', 'E4'], 0.6)

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
add(thud(48, 0.55, 12), 18.9); add(thud(44, 0.35, 14), 19.12)

# fades + normalise to -1 dBFS peak (finish.sh then loudness-normalises to -14 LUFS)
fi = int(0.02 * SR); fo = int(0.6 * SR)
for ch in (L, R): ch[:fi] *= np.linspace(0, 1, fi); ch[-fo:] *= np.linspace(1, 0, fo)
peak = max(np.abs(L).max(), np.abs(R).max()); g = 0.89 / peak
data = (np.stack([L, R], 1) * g * 32767).astype('<i2')
with wave.open('public/music/ep1-v10.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote public/music/ep1-v10.wav', DUR, 's')
