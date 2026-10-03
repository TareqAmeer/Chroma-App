# Storyboard v8 — Ep 1 "Old vs New" (pilot)

18s · 540 frames · 30 fps · 1920×1080 master + 1080×1920 vertical. Copy source of truth: [script.md](script.md). v6 storyboard is in `archive/`.

The pilot exists to lock four things that every later episode reuses: **the square's rig, the shared open/close, the sound kit, and the Swiss layout grid.** Nothing past Ep 1 gets animated until those are approved.

---

## 1. Tooling — what to use for the smoothest result

| Need | Use | Why |
|---|---|---|
| Animation engine | **Remotion** (already in `promo/video`) | Frame-exact, scriptable, renders the same every time. Claude can write and revise it directly. |
| Agent knowledge | **Official Remotion skills**, installed into `promo/video` only: `npx skills add remotion-dev/skills` (`remotion-best-practices`, `remotion-markup`, `remotion-render`) | Teaches the frame-driven rules below. Install project-local so other projects are not affected. |
| Motion rules the skill enforces | Everything driven by `useCurrentFrame()` + `interpolate()` / `spring()`. **No CSS transitions or animations** (they don't render frame-accurately). | The main cause of jitter in AI-made Remotion videos. |
| Easing | Custom `Easing.bezier` curves per motion type (table §4), `spring()` only for the square's body | Defaults (linear, plain ease) are the strongest sign of cheap motion. |
| Review loop | `remotion still` at the key frames listed in §6, then a short MP4 proof, viewed by a person | AI judgement of its own motion is not a substitute; check frames, then watch in real time. |
| Sound | Original synthesised kit in `make-audio.py` / `make-sfx.sh` (extend, don't buy library packs) | Keeps a unique sonic identity and no licensing issues. |
| Loudness check | `ffmpeg -af loudnorm=print_format=summary` → target **−14 LUFS integrated, −1 dBTP** | Social platforms normalise to roughly this; louder gets turned down and sounds squashed. |

### Other open-source skills reviewed

| Skill | Verdict |
|---|---|
| [remotion-dev/skills](https://github.com/remotion-dev/skills) (4.8k★, official) | **Use.** The base layer. |
| [haidrrrry/claude-remotion-skill](https://github.com/haidrrrry/claude-remotion-skill) (MIT) | **Borrow the render → inspect frames → fix loop and the exit/stagger rules only.** Ignore its house style: Ken Burns on every still, "breathing" idle motion, gradient mesh backgrounds, fade+rise+scale on every entrance. Those are the generic AI look and break the Swiss rules. |
| [Liamrjohnston/remotion-motion-graphics-skill](https://github.com/Liamrjohnston/remotion-motion-graphics-skill) | Worth a read before the pilot; not installed yet. |
| [kylezantos/design-motion-principles](https://github.com/kylezantos/design-motion-principles) (1.2k★, MIT) | **Use its anti-slop checklist as a review step.** Built for app UI, but the tells it flags apply to video: blur on every entrance, uniform fade-ins, stagger everywhere, bouncy springs on utility elements. |
| [kjooncho/ux-motion-skills](https://github.com/kjooncho/ux-motion-skills) | Its `ai-slop-detector` and `design-critique` make a good second opinion on rendered stills. |
| Manim / Lottie / p5 skills | Not a fit: maths explainers, UI icons, hand-drawn styles. |

Install everything into `promo/video` only, read each skill file before use, and let the rules in §2–§5 win any conflict.

Claude workflow per shot: write scene → render 3 stills (start, middle of the move, settled) → fix → render a 2s clip → next shot. Keep one file per shot so a beat can be changed without re-rendering the film.

---

## 2. Swiss design in motion — the rules for this series

Swiss (International Typographic) style is order, grid, objective type and no ornament. In motion it becomes **time on a grid**: every move travels between grid positions, on a beat, for a reason.

1. **12-column grid, 8-row baseline module** (1920×1080: 120px columns-ish with 40px gutters, 64px outer margin; vertical: 6 columns). The square's rest size = 1 module. It only ever comes to rest *on* grid intersections.
2. **Flush-left, ragged-right type**, one sans weight pair (Gramatika as in the app), large size contrast: headline ~96px, label ~24px. No centred paragraphs, no drop shadows, no outlines.
3. **Colour is functional:** paper, ink, logo red. Red belongs only to the square (and the logo slot). If red appears anywhere else the eye loses the hero.
4. **Time grid:** music at 112 BPM ≈ one beat every 16 frames. Major moves start on a beat; type appears on the off-beat. This is what makes motion feel "designed" instead of floaty.
5. **Asymmetric layouts:** the photo and the square sit off-centre; the empty space is part of the composition.
6. **Type moves like type:** lines slide in along the baseline or mask up from the baseline, by whole lines. No per-letter bouncing, spinning or scaling. The square is the only thing with personality; the typography stays calm and objective. That contrast is the style.
7. **Hard cuts are allowed and very Swiss.** Not every change needs a transition; a cut on the beat often looks cleaner than a wipe.

---

## 3. Good vs bad motion — the tiny differences

| Bad | Good |
|---|---|
| Linear or default ease | Custom curve: fast out, long gentle settle |
| Everything moves at once | Stagger by 2–4 frames; one lead element, others follow |
| Object stops dead | Overshoot 3–8%, settle in 6–10 frames |
| Squash that changes size | **Volume preserved**: width × height stays constant (squash 1.2×0.83) |
| Stretch with no direction | Stretch along the direction of travel, peaks at top speed, returns before contact |
| Move starts instantly | **Anticipation**: 3–6 frame counter-move before every jump |
| All parts stop together | **Follow-through**: corners/edges settle 2 frames after the body |
| Constant bounce everywhere | Bounce is personality, used on the square only; UI and type don't bounce |
| Motion with no purpose | Each move explains something (what it is, where it goes) |
| Holds too short to read | Copy holds ≥ 1.5s + 0.3s per word after it settles |
| Perfect symmetry, same timing on every move | Vary timing slightly (hops 10/12/9 frames): mechanical repeats look robotic |
| Motion blur missing at speed | Directional smear frames or 180° shutter-style blur on fast moves only |
| Floaty spring with long wobble | Springs damped to settle in ≤ 12 frames |
| Arcs as straight lines | Jumps travel on arcs; nothing living moves in a straight line |

### The square's spring presets (Remotion)

| Name | Use | Config |
|---|---|---|
| `hop` | Normal jumps, landings | `{stiffness: 220, damping: 14, mass: 0.8}` |
| `snap` | Snapping back to life, locking onto grid | `{stiffness: 400, damping: 22}` |
| `drag` | Old-workflow dead weight | No spring, `Easing.bezier(0.6,0,0.9,0.4)` slow ease-in, no overshoot |
| `type` | Text entry | No spring, `Easing.bezier(0.16,1,0.3,1)`, 12–16 frames |

---

## 4. Good vs bad sound

| Bad | Good |
|---|---|
| Generic whoosh on every transition | Sound only on contact, change of state, or emotion; silence between |
| Library clichés (cartoon boing, swish packs) | Small, dry, material sounds: felt tap, paper slide, soft wooden click |
| SFX louder than music | SFX sit 3–6 dB under the beat except one or two hero moments |
| Sounds a frame late | Contact sound lands **on** the contact frame (or 1 frame early: the ear forgives early, not late) |
| Same sample every landing | 3–4 variations with tiny pitch shifts (±2 semitones) so repeats don't machine-gun |
| Music wall-to-wall | Music *drops out* for the low point; silence makes the comeback hit |
| Wide reverb on everything | Dry and close; reverb only on the "dying record" moment |
| Mix built on laptop speakers only | Check on phone speaker and headphones; most viewers start muted, so the film must read without sound too |

**Sound kit (reused every episode):** opening tap · closing tap (same tap, slightly lower) · hop ×4 variations · land ×3 · squeak (squeeze) · creak (stretch) · stamp · tick · one heartbeat · groove (112 BPM, A-major) + muffled/slowed version of the same groove.

---

## 5. Camera — what to use and what to avoid

Swiss style mostly keeps the camera still and moves the content. Camera moves are rare, so they mean something.

| Move | Use in Ep 1 | Rule |
|---|---|---|
| **Locked-off frame** | Default for most shots | Lets the grid read; the square provides the motion |
| **Slow push-in** (2–4% scale over 3–4s) | During the old-workflow pile-up, to feel trapped | Ease-in only; ends on the cut |
| **Snap zoom / push** (8–12 frames) | The "Meet Chromasmith" snap | One sharp move with overshoot; once per episode max |
| **Follow / tracking** | When the square hops across the frame | Camera lags the square by 3–4 frames and settles after it |
| **Parallax** | Not used in Ep 1 | Fakes depth; Swiss is flat. Keep for later only if a shot needs space |
| **Whip pan** | Not used | Reads as generic YouTube transition |
| **Shake** | Avoid | Unless it's a tiny 2-frame impact on the hero landing |

Avoid: constant slow drift (makes everything feel unfixed), zooms that cut type off the grid, camera and square moving in the same direction at the same speed (motion cancels out).

---

## 6. Shot list — frame by frame

Beat grid: 16 frames per beat at 112 BPM. **K** = key still to render for review.

| # | Frames | Picture / layout (16:9) | Square | Camera | Sound | Vertical 9:16 |
|---|---|---|---|---|---|---|
| 1 Open | 0–44 | Real logo, centred on the grid, square in its slot. **K f0** | f0–15 still. f16 wiggle (±3° twice). f28 anticipation squash (1.2×0.83, 4f). f32 hop out on an arc, stretch on rise. | Locked | f0 opening tap; f32 hop | Logo upper third |
| 2 Photo | 45–119 | Flat raw photo drops onto cols 5–12; copy "You shot something beautiful." cols 1–4, flush left, enters f60 on the off-beat. **K f100** | Lands on photo (squash, overshoot). Two smaller hops (heights 60%, 35%). Leans 8° toward the photo, holds. | Locked | Land, hop, hop (pitch varied) | Photo top, copy below |
| 3 Import | 120–209 | Generic grey window cols 3–10; slow progress bar. Copy "Import in one app…" **K f170** | Pulled into the bar; stretches to 6× width, 0.3× height following bar fill, `drag` curve. No bounce. | Slow push-in starts (100% → 104% by f359) | Creak; groove switches to muffled version | Window full width |
| 4 Grade | 210–284 | Second window overlaps first, tiny sliders. Copy "…grade in another…" **K f250** | Squeezed into a tiny slider thumb (0.4×), edges blur 0 → 2px, colour desaturates 20%. | Push continues | Squeak | Same |
| 5 Pile-up | 285–359 | Windows stack, offset by grid modules; "Exporting 3 of 12…" dialog. Copy "…plugin, export, re-export." **K f330** | Smears across windows (directional blur 8px), greys to 60% saturation, sags and slumps flat at the bottom edge with a dead thud (no overshoot). | Push ends at 104% | Music slows and pitch drops ("dying record"), dead thud f355 | Same |
| 6 Low point | 360–389 | Hard cut: everything gone except the flat grey square on paper. **K f370** | Still for 20f. f381 a single twitch. | Locked | Silence; one heartbeat f381 | Square centred low |
| 7 Snap back | 390–479 | Real Chromasmith window builds around it on the grid (panels slide in by whole modules, staggered 3f); the finished photo. Copy "Meet Chromasmith. One app." enters f420. **K f400, f460** | f390 anticipation crouch (4f). f394 **snap** up to full square, colour floods back to logo red over 6f, blur clears. Shakes side to side (3 shakes, decaying). Lands on the grid in the app, small proud hop. | One snap push 100% → 108% → 106% (overshoot) at f394–406 | f394 groove kicks in at full energy on the downbeat; land tap | App fills frame, copy below |
| 8 Close | 480–539 | App fades to paper on the grid; logo with empty slot reappears exactly as f0. CTA "Download free · Mac · Windows" fades in f490, out by f525. **K f539 must equal f0 pixel for pixel** | Arcs back to the slot, overshoots by ~10px, mid-air correction, drops in, squash, settles by f530. f530–539 still. | Locked | Closing tap f528, then silence | Same layout as f0 vertical |

### Done criteria for the pilot

- f0 and f539 are identical images (diff check with ffmpeg / pixel compare).
- Every landing has anticipation, squash with volume preserved, overshoot and settle.
- The square rests only on grid intersections; all type sits on the baseline grid.
- Each copy line holds long enough to read with sound off.
- Contact sounds land on their contact frames; integrated loudness −14 LUFS ±1.
- Watched at real speed on a phone in both 16:9 and 9:16 by a person, not just checked as stills.

---

## Sources

- [Remotion agent skills (official)](https://www.remotion.dev/docs/ai/skills) · [Remotion agent skills guide 2026](https://aividpipeline.com/blog/remotion-agent-skills-guide-2026) · [claude-remotion-skill](https://github.com/haidrrrry/claude-remotion-skill)
- [The influence of Swiss design in motion graphics](https://wearefevr.com/the-influence-of-swiss-design) · [Swiss typography in motion: Mat Voyce](https://foro3d.com/en/2026/agosto/tipografia-suiza-en-movimiento-el-orden-visual-de-mat-voyce.html) · [Müller-Brockmann grid philosophy](https://www.neugraphic.com/muller-brockmann/muller-brockmann-text2.html) · [Swiss Style (Wikipedia)](https://en.wikipedia.org/wiki/Swiss_Style_(design))
- [Motion design principles](https://madegooddesigns.com/motion-design-principles/) · [Overshoot easings issue](https://github.com/MatthewLacerda2/scorsese/issues/587) · [eBay motion playbook](https://playbook.ebay.com/foundations/motion/using-motion-in-product)
- [Sound design for explainer videos](https://www.motiontheagency.com/blog/sound-design-for-explainer-videos) · [Whoosh: sound design in animation](https://medium.com/@amir.otaifa/whoosh-the-importance-of-sound-design-in-animation-video-70393f012718) · [Best whoosh SFX guide](https://soundmorph.com/blogs/news/best-whoosh-sound-effects-for-film-trailers-and-ui-a-designer-s-guide) · [UI sounds vs SFX](https://itch.io/blog/1627304/ui-sounds-vs-common-sound-effects-whats-the-difference)
- [Camera moves in 2D animation](https://digicel.net/camera-moves-in-2d-animation/) · [Whip pan](https://en.wikipedia.org/wiki/Whip_pan)
