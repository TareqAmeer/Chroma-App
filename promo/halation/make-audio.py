# Original score for Ep1Film (24 fps, 22 s). Felt piano + room, dry tactile hits, silence at the low point.
# All synthesised here: no samples, no licensing. Writes public/music/ep1-film.wav (48 kHz stereo).
import numpy as np, wave

SR, DUR = 48000, 32.0
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


# ---- halation film timeline (seconds) ----
def pad(t0, t1, notes, gain=.04):
    t = np.arange(int((t1 - t0) * SR)) / SR
    env = np.minimum(1, t / 1.5) * np.minimum(1, (t1 - t0 - t) / 1.5)
    sig = sum(np.sin(2 * np.pi * note(n) * t + j) * (1 / (j + 1)) for j, n in enumerate(notes))
    add(lowpass(sig * env * gain, 1200), t0)

pad(0.2, 10.4, ['A1', 'E2', 'B2'], .05)
chord(0.8, ['A2', 'E3', 'B3'], .35, dull=.6)            # light has an edge (cold, dull)
chord(5.2, ['F#2', 'C#3', 'A3', 'E4'], .45)              # the filament
t = np.arange(int(3.2 * SR)) / SR
add(lowpass(rng.normal(0, 1, len(t)), 900) * np.sin(np.pi * t / 3.2) ** 2 * .05, 6.0)  # bloom swell
pad(10.4, 17.6, ['D2', 'A2', 'F#3'], .045)
chord(10.9, ['D2', 'A2', 'F#3', 'C#4'], .4)
add(tap(300, 30, .25), 12.4); add(thud(52, .35, 9), 12.4)   # light reaches the base
add(tap(1800, 120, .08), 13.4)                               # remjet lifts away
chord(14.4, ['A2', 'E3', 'C#4', 'G#4', 'B4'], .55)            # the red bounce
pad(17.6, 28, ['E2', 'B2', 'G#3'], .04)
chord(18.3, ['E2', 'B2', 'G#3', 'D4'], .45)
for k in range(13): add(tap(2000 + 30 * k, 180, .03), 19 + k * .25, 1.0, -.4)   # slider detents
chord(24.6, ['C#2', 'G#2', 'E3', 'B3'], .45, dull=.3)
add(tap(950), 28.4, .5); add(thud(60, .25, 10), 28.4)
chord(28.4, ['A1', 'A2', 'E3', 'C#4', 'E4'], .7)

# room: short early reflections + a soft plate tail, by FFT convolution
ir_t = np.arange(int(1.6 * SR)) / SR
ir = rng.normal(0, 1, len(ir_t)) * np.exp(-ir_t * 3.2) * 0.05
ir[0] = 1.0
def conv(x):
    n = 1 << int(np.ceil(np.log2(len(x) + len(ir))))
    return np.fft.irfft(np.fft.rfft(x, n) * np.fft.rfft(ir, n), n)[:len(x)]
L, R = conv(L), conv(np.roll(R, 9))

hiss = lowpass(rng.normal(0, 1, N), 5000) * 0.003
L += hiss; R += np.roll(hiss, 31)
# fades + normalise to -1 dBFS peak (finish.sh then loudness-normalises to -14 LUFS)
fi = int(0.02 * SR); fo = int(0.6 * SR)
for ch in (L, R): ch[:fi] *= np.linspace(0, 1, fi); ch[-fo:] *= np.linspace(1, 0, fo)
peak = max(np.abs(L).max(), np.abs(R).max()); g = 0.89 / peak
data = (np.stack([L, R], 1) * g * 32767).astype('<i2')
with wave.open('score.wav', 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data.tobytes())
print('wrote score.wav', DUR, 's')
