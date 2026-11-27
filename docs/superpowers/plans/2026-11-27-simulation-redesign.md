# Cooper Station Simulation Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Cooper Station a smooth, physically convincing space simulation with natural controls, an informative HUD and a launch-sequence entry.

**Architecture:** Keep the three.js scene and tuned camera flights. Remove freezes by keeping shader program keys constant and warming everything during entry; add an HDR post pipeline, a ray-marched Gargantua lens and a quality governor; rebuild the HUD in plain TS + CSS. Logic that can be pure (physics, springs, governor, warm-up sequencing, formatting, settings) lives in small tested modules; GL work is verified with a committed bench script.

**Tech Stack:** three.js ~0.182 (plus its bundled `three/addons` post-processing), TypeScript strict, Vite 8, Vitest 4, WebGL 2, Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-27-simulation-redesign-design.md`

## Global Constraints

- No new runtime dependencies. No UI framework. No new texture or audio downloads.
- Commands: `pnpm typecheck`, `pnpm test`, `pnpm build`. Dev server: `pnpm dev --port 5183`.
- No missions, ranks, XP, unlocks or progress tracking.
- After warm-up, no user action may change a material's program key (fog on/off, clipping-plane count, shadow-light count).
- Keep: URL-hash deep links, `prefers-reduced-motion` behaviour, WebGL context-loss recovery, the lazy-loaded 3D chunk, existing credits.
- Low tier renders straight to the screen as today (no HDR target, no bloom).
- Resolution scale never below 0.6 of the capped device ratio.
- Acceptance (M4, 1689×1267, bench method in the spec): no frame over 50 ms after entry; steady ≤ 8 ms median and ≤ 12 ms p95 on High; resolution unchanged on Auto during the tour.
- Work on branch `redesign/simulation`; commit locally per task; never push.

## Review Focus

1. **Cold deep link** (`#blackhole`, `#station/ground`): the linked destination is warmed first and nothing un-warmed is ever shown. Test in Task 3 (`warmOrder`).
2. **Tab hidden during warm-up**: stages still finish; progress never stalls waiting on animation frames. Test in Task 3 (no `requestAnimationFrame` dependency).
3. **A texture fails to load**: entry still completes; the body falls back to its flat tint. Test in Task 3 (optional stage failure).
4. **Storage blocked or holding garbage**: settings fall back to defaults without throwing. Test in Task 4 (`loadSettings`).
5. **Context loss with the composer active**: render targets and warm state rebuild; the picture returns. Manual check in Task 14 via `WEBGL_lose_context`.

---

## File map

| File | Responsibility |
|---|---|
| `scripts/bench.js` (new) | Dev-only frame-cost harness |
| `src/physics.ts` | Pure physics: gravity, dilation, light time, orbits |
| `src/spring.ts` (new) | Critically damped spring |
| `src/warmup.ts` (new) | Stage sequencing with progress |
| `src/settings.ts` (new) | Persisted user settings |
| `src/quality.ts` (new) | Tier table and governor |
| `src/post.ts` (new) | HDR target, bloom, final pass |
| `src/black-hole.ts` (new) | Gargantua lens (replaces `makeBlackHole`) |
| `src/bodies-data.ts` (new) | Orbital elements and data-card facts |
| `src/format.ts` (new) | Number and date formatting for the HUD |
| `src/input.ts` (new) | Pointer, wheel and key handling |
| `src/hud.ts` (new) | Data card, route rail, time control, hints, settings, labels |
| `src/audio.ts` (new) | Synthesized ambient sound |
| `src/entry.ts` (new) | Launch sequence |
| `src/flight.ts` | Renderer, camera rig, lighting (shrinks: input and resolution logic move out) |
| `src/atlas.ts`, `src/deep-space.ts`, `src/environment.ts` | Bodies, galaxy, stars and sky |
| `src/main.ts`, `index.html`, `src/style.css` | Wiring and markup |

---

### Task 1: Bench harness and baseline

**Files:** Create `scripts/bench.js`

**Interfaces:**
- Produces: `window.__bench` with `pump(n: number): void`, `measure(tag: string, action?: () => void, frames = 240): Promise<Result>`, `tour(): Promise<Result[]>`, where `Result = { tag, worstMs, medianMs, p95Ms, draws, tris, width }`.

- [ ] **Step 1:** Write `scripts/bench.js` as one IIFE implementing the four behaviours in the spec's "Measurement method" section. `tour()` runs the spec's scenario list in order, using `#enter-space`, the Atlas entry buttons and the station action buttons. `worstMs` is the largest JS + sync cost over the whole scenario including the first 3 frames.
- [ ] **Step 2:** Verify: load `http://localhost:5183/`, inject the script before pressing Enter, run `await __bench.tour()`. Expected: Cutaway `worstMs` ≈ 2000, enter habitat ≈ 1900 (the baseline in the spec).
- [ ] **Step 3:** Commit `chore: add frame-cost bench harness`.

### Task 2: Pure foundations (physics, spring)

**Files:** Modify `src/physics.ts`, `src/physics.test.ts`; create `src/spring.ts`, `src/spring.test.ts`

**Interfaces:**
- Produces:
  - `timeDilation(radiusInRs: number): number` — proper-time rate of a static observer, `sqrt(1 - 1/r)`; `0` at or inside `r = 1`.
  - `lightTimeSeconds(au: number): number` — `au * 499.004784`.
  - `daysSinceJ2000(date: Date): number` — days from 2000-01-01T12:00:00Z.
  - `orbitAngle(meanLongitudeDeg: number, periodDays: number, days: number): number` — radians in `[0, 2π)`.
  - `rimSpeed(rpm: number): number` — m/s at `RIM_RADIUS_METERS`.
  - `type Spring = { value: number; velocity: number }`
  - `stepSpring(spring: Spring, target: number, halfLife: number, dt: number): void` — exact critically damped update, mutates in place; `halfLife <= 0` snaps.

- [ ] **Step 1: Failing tests**

```ts
// physics.test.ts
expect(timeDilation(Infinity)).toBe(1);
expect(timeDilation(4)).toBeCloseTo(0.8660, 4);
expect(timeDilation(1)).toBe(0);
expect(timeDilation(0.5)).toBe(0);
expect(lightTimeSeconds(1)).toBeCloseTo(499.0, 1);
expect(daysSinceJ2000(new Date("2000-01-01T12:00:00Z"))).toBe(0);
expect(daysSinceJ2000(new Date("2000-01-02T12:00:00Z"))).toBe(1);
expect(orbitAngle(0, 360, 90)).toBeCloseTo(Math.PI / 2);
expect(orbitAngle(350, 360, 20)).toBeCloseTo((10 * Math.PI) / 180);
expect(rimSpeed(DEFAULT_RPM)).toBeCloseTo(177.6, 1);
// spring.test.ts
const s = { value: 0, velocity: 0 };
for (let i = 0; i < 600; i++) stepSpring(s, 1, 0.1, 1 / 60);
expect(s.value).toBeCloseTo(1, 4);                      // converges
const peak = /* max value over a 0→1 run from rest */; expect(peak).toBeLessThanOrEqual(1 + 1e-9); // no overshoot
// one 0.1 s step equals ten 0.01 s steps
expect(coarse.value).toBeCloseTo(fine.value, 9);
// halfLife 0 snaps and zeroes velocity; dt 0 changes nothing
```

- [ ] **Step 2:** Run `pnpm test`; expect failures for the missing exports.
- [ ] **Step 3:** Implement. Spring: `ω = 2·ln2 / halfLife`, `x = value − target`, `e = exp(−ω·dt)`, `t = (velocity + ω·x)·dt`, `velocity = (velocity − ω·t)·e`, `value = target + (x + t)·e`.
- [ ] **Step 4:** `pnpm test` passes; `pnpm typecheck` passes.
- [ ] **Step 5:** Commit `feat: add dilation, orbit and spring maths`.

### Task 3: Stable programs and warm-up

**Files:** Create `src/warmup.ts`, `src/warmup.test.ts`; modify `src/flight.ts`, `src/station.ts`, `src/atlas.ts`, `src/environment.ts`, `src/main.ts`

**Interfaces:**
- Produces:
  - `type Stage = { label: string; weight: number; optional?: boolean; run: () => void | Promise<void> }`
  - `runStages(stages: Stage[], onProgress: (fraction: number, label: string) => void, pause?: () => Promise<void>): Promise<void>` — runs in order, awaits `pause()` between stages (default: a `MessageChannel` macrotask, never `requestAnimationFrame`), reports `completedWeight / totalWeight` before each stage and `1` at the end. A failing `optional` stage is skipped; a failing required stage rejects.
  - `warmOrder(destination: Destination): WarmGroup[]` with `type WarmGroup = "station" | "system" | "galaxy" | "blackhole"` — the group owning `destination` first, the rest in the fixed order station, system, galaxy, blackhole.
  - `startFlight(options)` gains `onProgress(fraction, label)` and returns `ready: Promise<void>`; `onGraphics(true)` fires only after the entry stages finish.
  - `createStation(pause: () => Promise<void>): Promise<Station>` (same fields as today).
  - `flight.whenWarm(group: WarmGroup): Promise<void>`.

- [ ] **Step 1: Failing tests** (`src/warmup.test.ts`)

```ts
it("runs stages in order and reports weighted progress", …)   // weights 1,3 → progress calls [0,"a"],[0.25,"b"],[1,"b"]
it("pauses between stages without animation frames", …)        // vi.stubGlobal("requestAnimationFrame", () => { throw new Error("no rAF") })
it("skips a failing optional stage and still reaches 1", …)
it("rejects when a required stage fails", …)
it("warms the linked destination's group first", () => {
  expect(warmOrder("blackhole")).toEqual(["blackhole", "station", "system", "galaxy"]);
  expect(warmOrder("earth")[0]).toBe("system");
  expect(warmOrder("station")).toEqual(["station", "system", "galaxy", "blackhole"]);
});
```

- [ ] **Step 2:** `pnpm test` fails on the missing module.
- [ ] **Step 3:** Implement `warmup.ts`.
- [ ] **Step 4:** Stable programs in `flight.ts`:
  - `scene.fog = atmosphere` once; only `atmosphere.density` changes.
  - Terrain materials get `clippingPlanes = [cutPlane]` once at start; "off" is `cutPlane.set(anyNormal, 1e6)`.
  - `sun.castShadow = daylight.castShadow = true` permanently. Replace each toggle with `shadow.intensity` (0 or 1) and `shadow.needsUpdate`.
- [ ] **Step 5:** Warm-up in `flight.ts`: textures load through `ImageBitmapLoader` (`imageOrientation: "flipY"`, `premultiplyAlpha: "none"`) then `renderer.initTexture`; each texture is an optional stage. Entry stages = textures of the entry group, then `createStation` steps (exterior, landscape, city, infrastructure) when the entry group is the station, then `stationReflections`, then `renderer.compileAsync(scene, camera)` with that group visible, then one forced render of each shadow map. Remaining groups from `warmOrder` run afterwards one stage per idle slot; `whenWarm` resolves per group.
- [ ] **Step 6:** `pnpm test`, `pnpm typecheck` pass. Bench: Cutaway, enter habitat, land, first Solar System, first Milky Way all `worstMs < 50`.
- [ ] **Step 7:** Commit `perf: warm shaders and textures during entry, keep program keys stable`.

### Task 4: Settings, quality governor, even shadows

**Files:** Create `src/settings.ts`, `src/settings.test.ts`, `src/quality.ts`, `src/quality.test.ts`; modify `src/flight.ts`

**Interfaces:**
- Produces:
  - `type Tier = "low" | "balanced" | "high"`; `type Settings = { quality: Tier | "auto"; sound: boolean; guides: boolean }`
  - `defaultSettings: Settings = { quality: "auto", sound: true, guides: true }`
  - `loadSettings(storage?: Pick<Storage, "getItem">): Settings`, `saveSettings(settings: Settings, storage?: Pick<Storage, "setItem">): void` — key `cooper-station:settings:v1`; never throw; unknown or wrongly typed fields fall back per field.
  - `tierSettings: Record<Tier, { scale: number; hdr: boolean; bloom: boolean; shadowSize: 0 | 1024 | 2048; lensSteps: number; lensScale: number }>` = low `{0.6, false, false, 0, 48, 0.5}`, balanced `{0.8, true, true, 1024, 96, 0.75}`, high `{1, true, true, 2048, 160, 1}`.
  - `createGovernor(options: { initial: Tier; upThreshold: number }): { readonly tier: Tier; sample(load: number, nowMs: number): Tier | null; discard(): void; pin(tier: Tier | "auto"): Tier | null }` — `load` is cost ÷ budget (≥ 1 means over budget).
  - `flight.setQuality(quality: Tier | "auto")`.

Governor rules: 2000 ms windows; a window with fewer than 30 samples is ignored; step down after 2 consecutive windows with median load > 1; step up after 5 consecutive windows with median load < `upThreshold`; at least 4000 ms between changes; after a step down, the tier it left is blocked for 60 000 ms; `discard()` drops the current window and resets streaks; pinned → `sample` returns `null`.

- [ ] **Step 1: Failing tests**

```ts
// settings.test.ts
expect(loadSettings({ getItem: () => { throw new Error("blocked") } })).toEqual(defaultSettings);
expect(loadSettings({ getItem: () => "{not json" })).toEqual(defaultSettings);
expect(loadSettings({ getItem: () => '{"quality":"ultra","sound":"yes","guides":false}' }))
  .toEqual({ quality: "auto", sound: true, guides: false });
expect(() => saveSettings(defaultSettings, { setItem: () => { throw new Error("full") } })).not.toThrow();
// quality.test.ts (helper feed(g, load, fromMs, toMs) samples at 60 Hz)
it("steps down after two overloaded windows, not one")
it("ignores a window with too few samples")            // 10 samples of load 5 → no change
it("waits 4 s between changes")
it("steps up after five light windows when below upThreshold")
it("does not return to a tier it just left for 60 s")
it("discard resets the streak")
it("pinning stops automatic changes and returns the pinned tier")
it("never goes below low or above high")
```

- [ ] **Step 2:** `pnpm test` fails.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** In `flight.ts` delete `adaptResolution`, `slowFrames`, `fastFrames`, `previousDraw`. Feed the governor each drawn frame: GPU time from `EXT_disjoint_timer_query_webgl2` ÷ 11 ms when the extension exists (`upThreshold` 0.5), else frame interval ÷ (display interval × 1.15) (`upThreshold` 0.95; display interval = running 10th-percentile interval clamped to 6.9–16.7 ms). Call `discard()` on `visibilitychange`, resize, transition start, and warm-up slices. Initial tier: `balanced` when `(pointer: coarse)` matches or `hardwareConcurrency <= 4`, else `high`.
- [ ] **Step 5:** Shadows: refresh the sun shadow every frame the station spins, at `tierSettings[tier].shadowSize` (0 = intensity 0, no refresh). Before settling, find why the pass costs ~8 ms for ~35k triangles and fix the cause if it is cheap to fix.
- [ ] **Step 6:** Tests and typecheck pass. Bench station orbit: p95 ≤ 1.5 × median; `width` constant across the tour.
- [ ] **Step 7:** Commit `perf: replace resolution scaler with a quality governor`.

### Task 5: HDR post pipeline

**Files:** Create `src/post.ts`; modify `src/flight.ts`, `src/style.css`, `index.html`

**Interfaces:**
- Consumes: `tierSettings` (Task 4).
- Produces: `createPost(renderer: THREE.WebGLRenderer): { render(scene, camera, seconds: number): void; setSize(width: number, height: number, ratio: number): void; setTier(tier: Tier): void; setWarp(amount: number): void; rebuild(): void; dispose(): void }`.

- [ ] **Step 1:** Implement with `EffectComposer` over a `HalfFloatType`, `samples: 4` target: `RenderPass` → `UnrealBloomPass` (half resolution, threshold 1.0, strength 0.45, radius 0.7) → a final `ShaderPass` that applies, in order: radial warp blur (8 taps toward centre, scaled by `warp`), ACES tone mapping at exposure 1.15, vignette (corner darkening 0.28), sRGB transfer, grain (±0.012, animated by `seconds`). Tiers with `hdr: false` call `renderer.render` directly; `bloom: false` disables the bloom pass.
- [ ] **Step 2:** `flight.ts` renders through `post`; `rebuild()` runs on context restore. Remove the `.vignette` element and its CSS (keep a top and bottom legibility gradient behind HUD text only).
- [ ] **Step 3:** Raise emissive sources above 1.0: Sun surface × 3.5, station light bars and city window glow × 2.2 (via colour multiply on their `toneMapped: false` materials, HDR tiers only).
- [ ] **Step 4:** Verify by eye at station, Sun and city: light sources glow, nothing else blooms, no banding. Bench: every steady figure within the acceptance limits.
- [ ] **Step 5:** Commit `feat: HDR bloom pipeline with filmic output`.

### Task 6: Gargantua lens

**Files:** Create `src/black-hole.ts`; modify `src/deep-space.ts` (delete `makeBlackHole`), `src/atlas.ts`, `src/environment.ts`, `src/flight.ts`

**Interfaces:**
- Consumes: sky panorama uniform and orientation from `makeSkyDome` (expose `panorama` and `orientation` uniform objects), `tierSettings`.
- Produces: `makeBlackHole(sky: { panorama: THREE.IUniform; orientation: THREE.IUniform }): { mesh: THREE.Mesh; update(camera: THREE.Camera, seconds: number): void; setQuality(steps: number): void }`; `export const HORIZON_RADIUS = 0.84` (world units per r_s); `flight` reports `cameraRadiusInRs` in its telemetry (Task 11).

- [ ] **Step 1:** Camera-centred back-face sphere like the sky dome. Fragment shader, in units of r_s: start at the camera, direction from the fragment; `h² = |pos × vel|²`; loop up to `STEPS` with `dt = clamp(0.12·r, 0.02, 3.0)`, `vel += −1.5·h²·pos / r⁵ · dt`, `pos += vel·dt`. Exit black when `r < 1`. Exit to sky when `r > 40` and moving outward. On each crossing of the plane `y = 0` at radius 3–12: add disk light front-to-back (opacity 0.85).
- [ ] **Step 2:** Disk shading: brightness ∝ `r^-2.2`; streaks from noise in `(r, φ − ωt)` with `ω ∝ r^-1.5`; orbital speed `β = sqrt(0.5 / r)`; Doppler factor `D = 1 / (γ(1 − β·cosθ))`, applied as `mix(1, D³, 0.6)`; redshift `sqrt(1 − 1/r)`; colour ramp deep orange → warm white by brightness; peak radiance ≈ 6 so bloom catches it.
- [ ] **Step 3:** Sky: sample the panorama with `textureLod(…, 0.0)` along the final direction at exposure 0.2, plus hashed procedural stars. In this view hide `sky.mesh` and the point stars.
- [ ] **Step 4:** Zoom limits for this destination give a camera radius of 2–65 r_s; default orbit ≈ 25 r_s.
- [ ] **Step 5:** Verify by eye: Einstein ring, disk arcing over and under the shadow, stars sliding as you orbit, no seam at the panorama wrap. Bench Gargantua on High within limits; if not, lower High `lensSteps`.
- [ ] **Step 6:** Commit `feat: ray-marched gravitational lens for Gargantua`.

### Task 7: Planets, stars and Sun

**Files:** Modify `src/atlas.ts`, `src/environment.ts`

- [ ] **Step 1:** Atmosphere shell: one extra back-face additive sphere per body at scale 1.1, intensity `pow(rim, 3) × sunSide`, strengths Earth 1.0, Venus 0.8, Neptune 0.4, Uranus 0.4, Jupiter 0.3, Saturn 0.3, Mars 0.25; none for Mercury, Moon, Sun. Gas giants get limb darkening `pow(facing, 0.35)`.
- [ ] **Step 2:** Earth: water mask from the colour map (blue dominant), specular `pow(R·V, 60) × mask × (1 − cloud)`; cloud shadow by sampling clouds offset toward the sun, darkening ground by up to 0.35.
- [ ] **Step 3:** Saturn: ring shadow on the globe. Uniforms `ringNormal` (world), `ringMap`; intersect the sunward ray with the ring plane, darken by ring alpha when the hit radius is 1.19–2.32.
- [ ] **Step 4:** Sun: distort the surface lookup with time-varying flow noise.
- [ ] **Step 5:** Stars: no twinkle; colour by temperature class (weights: red 0.50, orange 0.22, yellow 0.14, white 0.10, blue 0.04); brightness power law with the top 1.5 % above 1.0.
- [ ] **Step 6:** Verify each body by eye on its day side, terminator and night side. Bench within limits.
- [ ] **Step 7:** Commit `feat: atmospheres, ocean glint, ring shadow and star colours`.

### Task 8: Real orbits, guides and time

**Files:** Create `src/bodies-data.ts`, `src/bodies-data.test.ts`; modify `src/atlas.ts`, `src/destinations.ts`, `src/flight.ts`

**Interfaces:**
- Consumes: `orbitAngle`, `daysSinceJ2000`, `lightTimeSeconds` (Task 2).
- Produces:
  - `orbital: Record<PlanetId, { au: number; periodDays: number; meanLongitudeDeg: number }>` — JPL approximate elements at J2000.
  - `rotationHours: Record<BodyId, number>` (negative = retrograde); `radiusKm: Record<BodyId, number>`.
  - `overviewSize(radiusKm: number): number` — `0.36 × (radiusKm / 6371) ** 0.45`.
  - `facts(destination: Destination): { summary: string; rows: { label: string; value: string }[] }` (rows for live values are added by the HUD).
  - `timeRates: { station: number[]; solar: number[] }` = `[1, 5, 15]` and `[1, 600, 3600, 86400, 864000]`; default solar index 1.
  - `flight.setTime(playing: boolean, rateIndex: number)`; `flight.setGuides(visible: boolean)`; `atlas.setDate(days: number)`.

- [ ] **Step 1: Failing tests**

```ts
it("orders overview sizes like the real bodies", () => {
  const order = ["sun","jupiter","saturn","uranus","neptune","earth","venus","mars","mercury"];
  const sizes = order.map((id) => overviewSize(radiusKm[id]));
  expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
});
it("has a summary and at least three rows for every destination", …) // iterate destinationGroups
it("gives Earth one AU, a 365.256 day year and a 23.934 h day", …)
it("lists solar rates in increasing order with real time first", …)
```

- [ ] **Step 2:** `pnpm test` fails.
- [ ] **Step 3:** Implement `bodies-data.ts`. Data-card rows per planet: From Sun (AU), Light time, Day, Year, Gravity (g), Radius (km). Station: Spin, Rim gravity, Rim speed, Radius 3.2 km. Gargantua: Mass 100 million Suns, Horizon radius, Distance (r_s), Time rate. Milky Way: Diameter 100,000 ly, Stars 100–400 billion, Sun from centre 26,000 ly. Leave known-moon counts out (they change too often to state as fact).
- [ ] **Step 4:** `atlas.ts`: Sun at the system origin; positions from `orbitAngle` at the simulation date, existing scene orbit radii and plane tilt kept; sizes from `overviewSize`; spin from `rotationHours`, with the spin rate capped at the 1 hour/s equivalent. Add orbit lines (opacity 0.18), an asteroid belt (3000 points, radius 14.3–16.6), both in a `guides` group.
- [ ] **Step 5:** `flight.ts`: simulation clock starts at `Date.now()` and advances by the solar rate; overview camera default yaw places Saturn nearest the camera; `setGuides` toggles the guides group.
- [ ] **Step 6:** Tests and typecheck pass. By eye: Sun largest, Saturn in the foreground at load, planets move at 10 days/s.
- [ ] **Step 7:** Commit `feat: date-driven orbits, true size order and guides`.

### Task 9: Milky Way

**Files:** Modify `src/deep-space.ts`

- [ ] **Step 1:** 40 000 stars on the four-arm pattern; a normal-blended dust quad that darkens (occludes) along arm inner edges; a warm bulge with HDR core; ~120 pink knots along the arms; `galaxy.userData.sol = new THREE.Vector3(5.56, 0, …)` on an arm spur 5.56 units from the centre, drawn as a small ring.
- [ ] **Step 2:** Verify by eye; bench Milky Way within limits.
- [ ] **Step 3:** Commit `feat: denser Milky Way with dust lanes and Sol marker`.

### Task 10: Controls and camera motion

**Files:** Create `src/input.ts`; modify `src/flight.ts`, `src/main.ts`

**Interfaces:**
- Consumes: `stepSpring` (Task 2), `post.setWarp` (Task 5), `flight.whenWarm` (Task 3).
- Produces:
  - `attachInput(host: HTMLElement, handlers: { aim(dx, dy): void; release(vx, vy): void; zoom(factor): void; tap(x, y): void; key(code: string, held: boolean): boolean; hop(direction: 1 | -1): void; allow(): boolean }): () => void`
  - `flight.setMoveVector(x: number, y: number)` (analog, −1..1); `flight.hop(direction)`; `flight.onAction` callbacks for `"toggle-hud" | "open-atlas" | "show-help" | "toggle-time"`.

- [ ] **Step 1:** Move pointer, wheel and key listeners from `flight.ts` into `input.ts` unchanged, then change behaviour: wheel and pinch always zoom; `[` `]` and PageUp/PageDown hop; Space, F, H, M, `?` raise actions; Shift doubles habitat speed; Q/E change flyover height within 0.12–1.2.
- [ ] **Step 2:** Semantic zoom: at a planet with zoom at its maximum (2.6), a further 300 px of outward scroll selects `system`.
- [ ] **Step 3:** Replace `interpolate` with springs: orbit yaw/pitch half-life 0.07 s, zoom 0.12 s, FOV 0.2 s. Drag release keeps angular velocity, decaying with half-life 0.35 s.
- [ ] **Step 4:** Establishing shot: on arrival, zoom starts at 1.45 and yaw 0.25 rad off, settling with half-life 0.5 s for the first 2 s. Solar flights add `6° × sin(π × legProgress)` of FOV. Idle 20 s → yaw drifts 0.01 rad/s until any input. All three off under reduced motion.
- [ ] **Step 5:** Region jumps (station / solar / galaxy / blackhole): 1.2 s warp, `setWarp` 0→1 over the first half, swap at the midpoint once `whenWarm(group)` resolves, 1→0 over the second half. Low tier or reduced motion: 400 ms cross-fade on the canvas instead.
- [ ] **Step 6:** Verify by hand with mouse, trackpad and (emulated) touch; bench tour still passes (update `bench.js` selectors if needed).
- [ ] **Step 7:** Commit `feat: zoom-everywhere controls, sprung camera and warp jumps`.

### Task 11: HUD

**Files:** Create `src/format.ts`, `src/format.test.ts`, `src/hud.ts`; modify `index.html`, `src/style.css`, `src/main.ts`, `src/flight.ts`

**Interfaces:**
- Consumes: `facts`, `timeRates` (Task 8); `timeDilation`, `rimSpeed`, `rimGravity`; `Settings` (Task 4); flight actions (Task 10).
- Produces:
  - `formatDuration(seconds: number): string` — two largest units: `"8 m 19 s"`, `"1 h 20 m"`, `"4 h 10 m"`, `"29.5 y"` above 2 years.
  - `formatRate(secondsPerSecond: number): string` — `"Real time"`, `"10 min/s"`, `"1 hour/s"`, `"1 day/s"`, `"10 days/s"`.
  - `formatDate(days: number): string` — `"27 Nov 2026"` from days since J2000 (UTC).
  - `formatDilation(rate: number): string` — `"1 h here = 1 h 09 m far away"`; `"Time stops"` at 0.
  - `flight.telemetry(): { cameraRadiusInRs: number; simDays: number; labels: { id: Destination; x: number; y: number; visible: boolean }[] }`, read by the HUD at most 10×/s (labels every frame).
  - `createHud(root: HTMLElement, api: HudApi): { update(state: HudState): void }`.

- [ ] **Step 1: Failing tests** (`src/format.test.ts`)

```ts
expect(formatDuration(499)).toBe("8 m 19 s");
expect(formatDuration(4800)).toBe("1 h 20 m");
expect(formatDuration(59)).toBe("59 s");
expect(formatDuration(86400 * 365.25 * 29.5)).toBe("29.5 y");
expect(formatRate(1)).toBe("Real time");
expect(formatRate(600)).toBe("10 min/s");
expect(formatRate(864000)).toBe("10 days/s");
expect(formatDate(0)).toBe("1 Jan 2000");
expect(formatDilation(0.8660)).toBe("1 h here = 1 h 09 m far away");
expect(formatDilation(0)).toBe("Time stops");
```

- [ ] **Step 2:** `pnpm test` fails; implement `format.ts`; tests pass.
- [ ] **Step 3:** Load the `frontend-design` skill, then rebuild markup and CSS to the spec's HUD section: top bar (wordmark, time control, sound, help, Atlas), right-edge zoom/reset, bottom-left data card, bottom route rail with date, station actions, thumb stick, settings sheet, controls sheet, first-use hints, body labels. Hairline panels, no skew; Orbitron for wordmark and location title only, Geist for text, IBM Plex Mono for numerals (import `@fontsource/ibm-plex-mono/400.css` and `500.css`); amber accent `#ffb86b` on near-black `#05070d`.
- [ ] **Step 4:** `hud.ts` renders from one `HudState` object; `main.ts` owns state and wiring. Data card collapses to its title under 640 px. Hints: "Drag to look around", "Scroll to zoom", "Click a planet to fly there", each shown once per session and removed on first matching input. H hides everything but the canvas.
- [ ] **Step 5:** Verify at 1280×800 and 375×812, keyboard only, and with reduced motion. Check focus order and that every control has a name.
- [ ] **Step 6:** Commit `feat: instrument HUD with data cards, route rail and time control`.

### Task 12: Entry sequence and sound

**Files:** Create `src/entry.ts`, `src/audio.ts`; modify `src/launch-stars.ts`, `src/main.ts`, `index.html`, `src/style.css`

**Interfaces:**
- Consumes: `startFlight(...).ready`, `onProgress` (Task 3); `Settings.sound` (Task 4).
- Produces:
  - `createLaunchStarfield(canvas)` result gains `setSpeed(multiplier: number): void` (1 = today's drift; streak length grows with speed).
  - `runEntry(options: { cinematic: boolean; reducedMotion: boolean; ready: Promise<void>; onProgress: (listener: (fraction: number, label: string) => void) => void }): Promise<void>` — resolves when the explorer may be revealed; minimum 2.5 s when `cinematic`.
  - `createAudio(): { start(): void; setPlace(place: "space" | "habitat" | "city"): void; setEnabled(on: boolean): void; tick(): void }`.

- [ ] **Step 1:** Markup: status line and progress bar under the Enter button; a sound toggle beside it. Collage photos animate apart with `transform`/`opacity` only.
- [ ] **Step 2:** `entry.ts`: on Enter, speed the starfield 1 → 14 over 2 s, show stage labels ("Loading star catalogue", "Building the station", "Preparing optics"), then reveal the explorer under a warp-out. Deep links: progress only. Reduced motion: cross-fade.
- [ ] **Step 3:** `audio.ts`: Web Audio only. Space: two detuned sine partials at 55 Hz and 82.5 Hz through a low-pass at 220 Hz, gain 0.05. Habitat and city: add filtered noise (band-pass 400 Hz) at gain 0.02. `tick()`: 30 ms 1.2 kHz blip at gain 0.03. Cross-fade places over 1.5 s. Starts only after the Enter click; suspended while the tab is hidden.
- [ ] **Step 4:** Verify cold load, deep link, reduced motion, sound off/on persistence.
- [ ] **Step 5:** Commit `feat: launch sequence entry and ambient sound`.

### Task 13: Credits and cleanup

**Files:** Modify `index.html`, `package.json`

- [ ] **Step 1:** Add to the Atlas credits: "Planetary data: NASA Planetary Fact Sheets. Gargantua is modelled as a non-rotating black hole."
- [ ] **Step 2:** Remove `@fontsource-variable/space-grotesk` if still unused. `pnpm install`.
- [ ] **Step 3:** Commit `chore: credits and unused dependency`.

### Task 14: Acceptance

- [ ] **Step 1:** `pnpm typecheck && pnpm test && pnpm build` all pass.
- [ ] **Step 2:** Bench tour on the dev build: record every scenario's worst, median and p95; all within Global Constraints.
- [ ] **Step 3:** Context loss: `gl.getExtension("WEBGL_lose_context").loseContext()` then `restoreContext()`; the launch page appears, then the picture returns with glow intact.
- [ ] **Step 4:** Eye check every destination and station view at desktop and phone width, reduced motion on and off, each quality tier pinned once.
- [ ] **Step 5:** Fix what fails, re-run steps 1–2, commit.
