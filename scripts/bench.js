// Dev-only frame-cost harness. Load it in the running dev page BEFORE pressing
// Enter:  await import("/scripts/bench.js");  await __bench.tour()
//
// It replaces requestAnimationFrame with a queue driven by a synthetic 60 Hz
// clock, so results do not depend on the browser's own frame timing (hidden or
// background tabs throttle real frames). A frame's cost is the JS time of its
// callbacks plus a one-pixel readPixels, which forces the GPU to finish.
// Dev builds also report the app's own GPU timer queries as gpuMs.
(() => {
  if (window.__bench) return;
  const queue = new Map();
  let nextId = 1;
  let clock = performance.now();
  let draws = 0;
  let triangles = 0;
  let recording = null;
  const pixel = new Uint8Array(4);

  const gl2 = WebGL2RenderingContext.prototype;
  for (const name of [
    "drawElements",
    "drawArrays",
    "drawElementsInstanced",
    "drawArraysInstanced",
  ]) {
    const original = gl2[name];
    gl2[name] = function (...args) {
      draws++;
      if (args[0] === 4) {
        const count = (name.startsWith("drawElements") ? args[1] : args[2]) || 0;
        const copies = name.endsWith("Instanced") ? args[args.length - 1] || 1 : 1;
        triangles += (count / 3) * copies;
      }
      return original.apply(this, args);
    };
  }

  // The app stops drawing while the document is hidden; measure regardless.
  Object.defineProperty(document, "hidden", { get: () => false });
  Object.defineProperty(document, "visibilityState", { get: () => "visible" });

  // Frames requested before this script loaded hold real ids; forward their
  // cancellation and keep our ids far away from the browser's.
  const cancelReal = window.cancelAnimationFrame.bind(window);
  nextId = 1e9;
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    if (id >= 1e9) queue.delete(id);
    else cancelReal(id);
  };

  const canvas = () => document.querySelector("#world canvas");
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function pump(frames) {
    for (let i = 0; i < frames; i++) {
      const ids = [...queue.keys()];
      clock += 1000 / 60;
      const drawsBefore = draws;
      const trianglesBefore = triangles;
      const start = performance.now();
      for (const id of ids) {
        // A callback cancelled by an earlier one this frame must not run.
        const callback = queue.get(id);
        if (!callback) continue;
        queue.delete(id);
        callback(clock);
      }
      const scripted = performance.now();
      const target = canvas();
      if (!target || draws === drawsBefore) continue;
      const gl = target.getContext("webgl2");
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      recording?.push({
        ms: performance.now() - start,
        js: scripted - start,
        draws: draws - drawsBefore,
        tris: Math.round(triangles - trianglesBefore),
        width: target.width,
      });
    }
  }
  // Keeps the page alive between measurements.
  setInterval(() => recording === null && pump(1), 40);

  const round = (value) => Math.round(value * 10) / 10;
  function quantile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  }

  async function measure(tag, action, frames = 240) {
    recording = [];
    action?.();
    pump(3);
    // Real time for image decodes and async shader compiles; frames keep
    // running and are recorded, so a freeze in this period is still caught.
    for (let waited = 0; waited < 1800; waited += 60) {
      await sleep(60);
      pump(4);
    }
    pump(20);
    const settle = recording;
    recording = [];
    // The app's own GPU timer queries (dev builds) are the steadier signal;
    // results arrive a few frames late, hence the short tail.
    const gpu = window.__gpuSamples;
    if (gpu) gpu.length = 0;
    pump(frames);
    const steady = recording;
    recording = null;
    await sleep(20);
    pump(4);
    const gpuSorted = gpu ? [...gpu].sort((a, b) => a - b) : [];
    const cost = steady.map((frame) => frame.ms).sort((a, b) => a - b);
    const last = steady[steady.length - 1] ?? settle[settle.length - 1];
    return {
      tag,
      worstMs: round(Math.max(0, ...settle.map((frame) => frame.ms), ...cost)),
      medianMs: round(quantile(cost, 0.5) ?? 0),
      p95Ms: round(quantile(cost, 0.95) ?? 0),
      gpuMs: gpuSorted.length ? round(quantile(gpuSorted, 0.5)) : null,
      gpuP95Ms: gpuSorted.length ? round(quantile(gpuSorted, 0.95)) : null,
      draws: last?.draws ?? 0,
      tris: last?.tris ?? 0,
      width: last?.width ?? 0,
    };
  }

  const press = (id) => () => document.getElementById(id).click();
  const visit = (name) => () => {
    const button = [...document.querySelectorAll("#destination-list button")].find(
      (entry) => entry.dataset.destination === name || entry.textContent.trim() === name,
    );
    if (!button) throw new Error(`No Atlas entry for ${name}`);
    button.click();
  };

  async function enter() {
    recording = [];
    const started = performance.now();
    document.getElementById("enter-space").click();
    const explorer = document.getElementById("explorer");
    const launch = document.getElementById("launch");
    while (performance.now() - started < 60000) {
      pump(2);
      await sleep(50);
      if (canvas() && !explorer.hidden && (launch.hidden || launch.inert)) break;
    }
    // CSS and Web Animations do not advance in a hidden pane; finish them so
    // screenshots show the scene rather than a half-faded launch page.
    for (const animation of document.getAnimations()) animation.finish();
    const frames = recording;
    recording = null;
    return {
      tag: "entry",
      seconds: round((performance.now() - started) / 1000),
      worstMs: round(Math.max(0, ...frames.map((frame) => frame.ms))),
    };
  }

  async function tour() {
    const results = [];
    if (!canvas()) results.push(await enter());
    const steps = [
      ["station orbit", visit("Cooper Station")],
      ["cutaway on", press("cutaway")],
      ["cutaway off", press("cutaway")],
      ["enter habitat", press("enter-habitat")],
      ["land", press("land-city")],
      ["take off", press("take-off")],
      ["return to orbit", press("exit-habitat")],
      ["solar system", visit("Solar System")],
      ["sun", visit("Sun")],
      ["earth", visit("Earth")],
      ["jupiter", visit("Jupiter")],
      ["saturn", visit("Saturn")],
      ["milky way", visit("Milky Way")],
      ["gargantua", visit("Gargantua")],
      ["station again", visit("Cooper Station")],
    ];
    for (const [tag, action] of steps) results.push(await measure(tag, action));
    return results;
  }

  window.__bench = { pump, measure, tour, enter, press, visit, sleep };
})();
