
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

