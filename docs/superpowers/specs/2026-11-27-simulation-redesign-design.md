# Cooper Station: simulation redesign

Date: 2026-11-27 · Status: awaiting approval

## Intent

Cooper Station is a public, browser-based 3D tour of the Solar System, the
Milky Way, Gargantua and the inside of Cooper Station. Today it works, but it
reads as a viewer you click through. The owner wants visitors to feel they
have entered space: it should look physically real, move smoothly, be easy and
satisfying to control, and be attractive from the first second.

It stays a **simulation**. The owner considered a mission/game layer and
rejected it ("I want only simulation").

## Goals

1. **Smooth.** No freezes when changing view or destination; even frame pacing.
2. **Real.** Light, gravity, scale cues and motion behave the way they would in
   space. Gargantua actually bends the sky behind it.
3. **Controllable.** Controls match what people expect (drag to look, scroll to
   zoom), are discoverable without reading anything, and feel weighted.
4. **Informative.** Wherever you are, the HUD shows true numbers about it.
5. **A proper entrance.** Entering is a short launch sequence, and that sequence
   is also where loading happens.

## Non-goals

- Missions, objectives, ranks, XP, unlocks, progress tracking of any kind.
- Free-flight piloting (thrust, fuel). Navigation stays destination-based.
- Rebuilding the station exterior, habitat landscape or city geometry.
- True-scale distances (unusable on a screen). Distances stay compressed; the
  HUD gives the real figures.
- New texture or audio asset downloads. Existing maps are reused; all sound is
  synthesized.
- A rotating (Kerr) black hole. Gargantua is modeled as non-rotating.
- A UI framework, a backend, accounts.

## Anti-goals (it has failed if…)

- Any view change still freezes the picture.
- The HUD covers the thing you came to look at, or needs explaining.
- "Sci-fi" decoration that breaks realism: twinkling stars, coloured fog
  everywhere, lens-flare ghosts, whooshes in vacuum.
- The image goes soft because the app lowered resolution after a hiccup.
- Motion ignores the OS reduced-motion setting, or deep links (`#earth`,
  `#station/ground`) stop working.

## Where it stands today (measured)

Machine: Apple M4, canvas 1689×1267. Method: frames driven at a fixed 60 Hz
clock, cost = JS time + a forced GPU sync per frame.

| Scenario | Steady cost (median / p95) | Worst single frame |
|---|---|---|
| Station orbit | 3.4 / 11.1 ms | 12 ms |
| Toggle Cutaway | 3.3 / 15 ms | **2152 ms** |
| Enter habitat | 4.9 / 7.2 ms | **1901 ms** (mid-flight) |
| Land in city | 5.2 / 5.6 ms | **323 ms** |
| First Solar System open | 1.5 / 4.8 ms | **439 ms** |
| First Milky Way / Gargantua | 5.3 / 6.9 ms | 75–90 ms |

Causes, confirmed against three.js r182 (`WebGLPrograms.js` cache key):

- **Shader recompiles on state change.** The program key includes fog on/off,
  the number of clipping planes and the number of shadow-casting directional
  lights. `flight.ts` toggles all three (`scene.fog = … : null`,
  `material.clippingPlanes = enabled ? [cutPlane] : null`,
  `sun.castShadow` / `daylight.castShadow`), so every lit material recompiles
  at that instant.
- **First-use compile and upload.** Groups are hidden until visited, so their
  shaders compile and textures (up to 4096×2048) decode and upload on the frame
  they first appear.
- **Uneven shadow cost.** The station sun shadow (2048²) re-renders roughly
  every third frame while spinning, so frame cost alternates ~3 ms / ~11 ms.
- **Resolution scaler reads the wrong signal.** `adaptResolution` uses time
  between frames, so a freeze or a background tab looks like an overloaded GPU.
  It then lowers resolution (observed 1689 → 781 px wide) and reallocates the
  framebuffer, which is itself a hitch.
- **Startup is one long task.** The whole station is built synchronously on
  Enter (230 ms + 122 ms long tasks).

Visual gaps: Gargantua is a camera-facing billboard with painted bands and no
lensing; no HDR glow; planets have a thin rim tint rather than an atmosphere;
the galaxy is sparse; cuts between regions are instant.

UI gaps: scroll means "next planet" in the Solar System but "zoom" elsewhere;
nothing tells you that; no facts about anything; time controls only affect
station spin; touch movement is four arrow buttons.

## Constraints

- three.js `~0.182`, Vite 8, TypeScript strict, WebGL 2. No new runtime
  dependencies (three's bundled addons are fine).
- Package manager is pnpm (`pnpm typecheck`, `pnpm test`, `pnpm build`).
- Keep URL-hash deep links, reduced-motion support, WebGL-loss recovery, the
  lazy-loaded 3D chunk, and the image/sky credits.
- Must remain usable on a phone. The bar: the Low tier is never heavier than
  today's renderer. Low draws straight to the screen as the app does now (no
  HDR target, no bloom, no multisampled float buffer) and uses the cheapest
  Gargantua setting. This is the builder's call and can only be checked here at
  phone width in a desktop browser, not on a real handset.

## Approaches considered

**A. Evolve in place (chosen).** Keep the three.js scene and the tuned camera
flights. Add a post-processing pipeline, replace the Gargantua shader, add a
warm-up stage and a quality governor, rebuild the HUD in plain TS + CSS.
Lowest risk, and it attacks the measured causes directly.

**B. Move to WebGPU + TSL.** Better long-term post-processing, but all seven
hand-written GLSL materials would be rewritten, browser support is uneven, and
it does nothing for the freezes, which are a state-management problem.

**C. Bring in React / react-three-fiber.** Easier HUD state, but a rewrite of
working imperative code plus bundle weight, for a HUD small enough to manage
with a typed store and render functions.

The owner left the how to the builder; A is the builder's call.

## Design

### 1. Smoothness

**Stable programs.** After warm-up, no user action may change a material's
program key.
- Fog: one `FogExp2` assigned permanently; only its density changes (0 outside).
- Cutaway: terrain materials always carry the one clipping plane; "off" moves
  the plane out of range instead of removing it.
- Shadows: `sun.castShadow` and `daylight.castShadow` stay constant. Turn a
  shadow off with `shadow.intensity = 0` and stop refreshing its map.

**Warm-up during entry.** Entry becomes a staged loader that yields to the
browser between stages and reports real progress:
1. decode textures off the main thread (`ImageBitmapLoader`) and upload them
   ahead of use (`renderer.initTexture`);
2. build the station, landscape and city in separate steps;
3. `renderer.compileAsync` each group in every state it can be shown in, and
   render each shadow map once.
Entry warms the entry destination and every station state. The remaining
groups warm up afterwards in small slices while the visitor looks at the first
scene. The 50 ms limit applies from the moment entry ends, so each slice must
fit inside a frame, and a jump to a destination that is not warm yet holds its
warp until that destination is ready.

**Even shadow cost.** Refresh the station sun shadow on a steady cadence at a
tier-dependent size (default: every frame at 1024²; 2048² on High; frozen on
Low). The builder should first find out why the current pass costs ~8 ms for
~35k triangles.

**Quality governor** (replaces `adaptResolution`). Tiers: High, Balanced, Low,
plus Auto. Auto decides from render cost: GPU timer queries where the browser
exposes them, otherwise the median frame interval over a ~2 s window. Windows
that include a hidden tab, a warm-up, or a lone outlier are discarded. At most
one tier change every few seconds, with hysteresis. A tier sets resolution
scale (never below 0.6 of the capped device ratio), bloom on/off, shadow size
and black-hole step count. Users can pin a tier in Settings.

### 2. Realism

**HDR pipeline.** Render to a half-float multisampled target, then bloom
(half resolution), then one output pass doing tone mapping, colour conversion,
a light vignette and fine film grain. The CSS vignette goes away. Emissive
things (Sun, accretion disk, station light bars, city windows) are authored
brighter than 1.0 so they glow because they are bright, not because glow was
painted on.

**Gargantua.** Replace the billboard with a full-screen ray-marched
Schwarzschild lens: each pixel's light path is integrated around the hole; it
samples a procedural accretion disk where the path crosses the disk plane
(inner edge at 3 r_s, relativistic beaming and redshift, softened so the far
side stays visible) and samples the sky panorama plus a procedural star layer
in the bent direction. This yields the Einstein ring, the disk image wrapped
over and under the shadow, and stars sliding around the hole as you orbit.
Point stars and the sky dome are hidden in this view because the shader draws
the sky itself. Lower tiers use fewer steps and half resolution.

**Planets.**
- Atmosphere as a separate additive shell, lit on the sun side, thickness per
  body (Earth and Venus strong; Mars thin; none on Mercury or the Moon).
- Earth: sun glint on water (mask derived from the existing colour map), cloud
  shadows offset from the cloud layer, existing night lights kept.
- Saturn: ring shadow cast onto the globe (planet shadow on rings exists).
- Sun: slowly churning surface, HDR brightness feeding bloom, existing corona.

**Solar System overview.** Faint orbit lines, an asteroid belt, and name labels
that fade with distance; all three hide together under one "Guides" toggle.
Planet positions follow each body's real orbital period and mean longitude at
J2000 on circular, coplanar orbits, so the layout matches the simulation date.

Body sizes in the overview use one compressed scale that keeps the true order
(Sun largest, then Jupiter, Saturn, Uranus, Neptune, Earth, Venus, Mars,
Mercury). Today Saturn is drawn 2.85× and ends up larger than the Sun. Saturn
stays the foreground subject through camera placement, not inflation. Close-up
views are unaffected because each is framed by its own radius.

**Milky Way.** Denser star field following the arm pattern, dark dust lanes
that actually occlude, a warm bulge, pink star-forming knots, and a small
"Sol" marker ~26,000 light-years from the centre.

**Stars.** No twinkle. Colours follow a temperature distribution; a few bright
stars carry most of the light and catch the bloom.

### 3. Controls and motion

| Input | Space views | Habitat / city |
|---|---|---|
| Drag / one finger | Orbit, with inertia on release | Look |
| Scroll / pinch | Zoom, everywhere | – |
| Click a body or its label | Fly to it | – |
| `[` `]` or PageUp/PageDown, route rail | Previous / next body | – |
| W A S D, on-screen stick | – | Move (Shift = faster) |
| Q / E | – | Lower / raise (flyover only) |
| Space | Pause / resume time | same |
| F | Reset the view | same |
| H | Hide the HUD (clean view) | same |
| M | Open the Atlas | same |
| ? | Show controls | same |

- **Scroll now always zooms.** Zooming far out from a planet pulls back to the
  Solar System overview. Planet-to-planet travel moves to the route rail, the
  bracket keys and clicking.
- **Touch movement** is a single thumb stick instead of four arrows.
- **First-use hints**: one short line per input ("Drag to look around"), shown
  once and dismissed the moment the visitor does it.

Motion:
- Camera values follow a critically damped spring instead of a fixed lerp, and
  drags carry momentum.
- Arriving anywhere starts wide and settles in (an establishing shot).
- Travel inside the Solar System stays one continuous flight, with a gentle
  field-of-view swell at speed.
- Jumping between regions (Solar System ↔ Milky Way ↔ Gargantua ↔ station) gets
  a ~1.2 s warp: radial streak and FOV push in the output pass, covering the
  swap. Reduced motion replaces it with a cross-fade.
- After ~20 s without input the camera drifts slowly; any input stops it.

**Time control** becomes a visible, global control: pause plus a rate. Rates
are per context: station spin 1× / 5× / 15× as today; Solar System real time,
10 minutes/s (default), 1 hour/s, 1 day/s, 10 days/s, with a simulation date
readout. The clock starts at the visitor's real date and time. Planet spin
follows real rotation periods and is visually capped at high rates. The default
keeps planets turning about as fast as they do today.

### 4. HUD and information

Thin-lined flight-instrument look: hairline panels, no skewed buttons,
monospaced numerals, one warm accent (the accretion-disk amber) on a cool
near-black. Type: Orbitron only for the wordmark and location title, Geist for
text, IBM Plex Mono (already a dependency) for numbers.

```
┌─────────────────────────────────────────────────────────────────────┐
│ ◎ COOPER STATION                         ⏸ 1 day/s   ♪  ?  ☰ Atlas │
│                                                                     │
│                                                                  +  │
│                          ( the view )                            −  │
│                                                                  ⟲  │
│ ┌ SATURN ─────────────────────┐                                     │
│ │ Ringed gas giant            │                                     │
│ │ FROM SUN     9.58 AU        │                                     │
│ │ LIGHT TIME   1 h 20 m       │                                     │
│ │ DAY          10.7 h         │                                     │
│ │ GRAVITY      1.07 g         │                                     │
│ └─────────────────────────────┘                                     │
│ [ Visit Cooper Station ↗ ]   ●─●─●─●─●─●─◉─●─●   27 Nov 2026        │
└─────────────────────────────────────────────────────────────────────┘
```

- **Data card** per location, with true figures. Planets: distance from Sun,
  light time, day, year, gravity, radius, moons. Station: spin, rim gravity,
  rim speed, dimensions. Gargantua: mass, horizon radius, camera distance in
  r_s, and live time dilation at the camera's distance. Milky Way: diameter,
  star count, the Sun's distance from the centre. The card collapses to its
  title on small screens.
- **Route rail** (Solar System only): one dot per stop, Sun to Neptune.
- **Atlas** replaces the Destinations dialog: the same groups, each entry with
  a one-line description.
- **Settings**: quality tier, sound, guides.
- Planet and physics figures come from NASA fact sheets and are credited next
  to the existing credits. New pure functions (time dilation, light time,
  orbital angle, rim speed) live in `physics.ts` with tests.

### 5. Entry

The landing page keeps its headline and photo collage. Pressing Enter starts a
launch sequence: the collage drifts apart and fades, the existing star field
accelerates into streaks, and a status line with a thin progress bar reports
the real warm-up stages. When warm-up finishes (minimum ~2.5 s so it never
flashes), the view warps in and settles on Cooper Station above Saturn with the
establishing shot. Deep links skip the cinematic and show progress only.
Reduced motion gets a cross-fade with the progress bar.

**Sound.** A low synthesized ambient bed that differs by place (near-silence
in open space, a soft air-handling hum inside the habitat) and quiet interface
ticks. It starts only after the Enter click, has a toggle on the landing page
and in the HUD, and the choice is remembered.

## Left to the builder

- Module boundaries. `flight.ts` (1020 lines) already mixes renderer, camera,
  input and lighting; split along the seams this work touches (quality,
  post-processing, warm-up, input, HUD) rather than adding to it.
- Exact shader maths, spring constants, bloom strength, colours, spacing.
- Which phases ship together. Suggested order: smoothness → realism →
  controls and motion → HUD → entry. Each leaves the app working.
- Use the `frontend-design` skill for the HUD pass.

## Calls the builder made (owner did not decide these)

1. Scroll changes from "next planet" to "zoom" in the Solar System.
2. Sound is on by default after the Enter click, with a visible toggle.
3. The film-still collage stays on the landing page. Note: those stills belong
   to Paramount / Warner Bros.; on a public site that is a rights risk the
   owner may want to revisit.
4. Gargantua is modeled as non-rotating, which is simpler than the film's
   fast-spinning hole; the HUD says so.
5. `.claude/launch.json` was added so the app can be previewed.
6. Overview body sizes are corrected to the true order, which changes the
   current Saturn-dominated composition.
7. The Low tier keeps today's direct-to-screen rendering as the phone path.
8. The simulation clock starts at the real date, at 10 minutes per second.

## Acceptance

On the M4 at 1689×1267, measured the same way as the table above, after the
entry sequence completes:

- No single frame over 50 ms for: Cutaway on/off, enter habitat, land, take
  off, return to orbit, and the first visit to every destination.
- Steady cost at or under 8 ms median and 12 ms p95 in every view on High.
- On Auto, canvas resolution does not change during a scripted tour.
- `pnpm typecheck`, `pnpm test` and `pnpm build` pass.
- Each view checked by eye in the browser at desktop and phone widths, with
  reduced motion on and off.

### Measurement method

The numbers in this document came from a script injected into the running dev
page before pressing Enter. The first build task is to commit it as a dev-only
script so the acceptance run is repeatable. It does four things:

1. Replaces `requestAnimationFrame` / `cancelAnimationFrame` with a queue, so
   nothing depends on the browser's own frame timing (a hidden or background
   tab throttles real frames).
2. `pump(n)` runs n frames back to back, passing a synthetic timestamp that
   advances 1000/60 ms per frame, so the app sees a steady 60 Hz.
3. Per frame it records JS time for the callbacks, then calls
   `gl.readPixels` on one pixel of the default framebuffer and records how long
   that takes. That forces the GPU to finish the frame; JS + sync is the
   frame's cost.
4. It wraps the four WebGL draw calls to count draws and triangles.

A scenario is: perform the action, pump 3 frames (worst-frame capture), wait
1.8 s of real time for textures, pump 20 frames to settle, then record 240
frames for the steady figures. The tour is: station orbit, Cutaway on, Cutaway
off, enter habitat, land, take off, return to orbit, Solar System, Sun, Earth,
Jupiter, Saturn, Milky Way, Gargantua, back to the station.
