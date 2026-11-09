type Star = {
  x: number;
  y: number;
  depth: number;
  diameter: number;
  brightness: number;
  phase: number;
  twinkle: number;
  age: number;
  sprite: HTMLCanvasElement;
};

function starSprite(glow: boolean) {
  const sprite = document.createElement("canvas");
  sprite.width = sprite.height = 48;
  const ink = sprite.getContext("2d");
  if (!ink) return sprite;

  const light = ink.createRadialGradient(24, 24, 0, 24, 24, 24);
  light.addColorStop(0, "#fff");
  light.addColorStop(0.18, "rgb(255 255 255 / 0.92)");
  light.addColorStop(0.38, `rgb(255 255 255 / ${glow ? 0.54 : 0.36})`);
  light.addColorStop(0.66, `rgb(255 255 255 / ${glow ? 0.14 : 0.06})`);
  light.addColorStop(1, "rgb(255 255 255 / 0)");
  ink.fillStyle = light;
  ink.fillRect(0, 0, 48, 48);
  return sprite;
}

const padding = 10;
const vanishingPoint = { x: 0.5, y: 0.2 };
const expansionRates = [0.135, 0.153, 0.175];

export function createLaunchStarfield(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ink = context;
  const random = Math.random;
  const point = starSprite(false);
  const glow = starSprite(true);
  const stars: Star[] = [];
  let width = 0;
  let height = 0;
  let count = 0;
  let seconds = 0;
  let lastTime = 0;
  let frame: number | undefined;

  function draw(delta = 0) {
    if (!width || !height) return;
    ink.clearRect(0, 0, width, height);
    const expansion = expansionRates.map((rate) => Math.exp(rate * delta));
    const marginX = padding / width;
    const marginY = padding / height;
    for (let index = 0; index < count; index++) {
      const star = stars[index];
      const scale = expansion[star.depth];
      star.x = vanishingPoint.x + (star.x - vanishingPoint.x) * scale;
      star.y = vanishingPoint.y + (star.y - vanishingPoint.y) * scale;
      star.age += delta;
      if (
        star.x < -marginX || star.x > 1 + marginX ||
        star.y < -marginY || star.y > 1 + marginY
      ) {
        star.x = random();
        star.y = random();
        star.age = 0;
      }
      const diameter = star.diameter * (1 + Math.min(star.age * 0.04, 0.35));
      const half = diameter * 0.5;
      const shimmer = star.twinkle
        ? 1 - star.twinkle * (0.5 + 0.5 * Math.sin(seconds * 1.9 + star.phase))
        : 1;
      ink.globalAlpha = star.brightness * shimmer * Math.min(1, star.age * 1.6);
      ink.drawImage(star.sprite, star.x * width - half, star.y * height - half, diameter, diameter);
    }
  }

  function resize() {
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    if (!width || !height) return;

    const ratio = Math.min(
      devicePixelRatio,
      2,
      Math.sqrt(5_000_000 / (width * height)),
    );
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ink.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
    count = Math.min(2400, Math.round(width * height * 0.0016));
    while (stars.length < count) {
      const distance = random();
      const depth = distance < 0.62 ? 0 : distance < 0.90 ? 1 : 2;
      const brightness = random();
      const bright = depth === 2 && brightness > 0.45;
      stars.push({
        x: random(),
        y: random(),
        depth,
        diameter: 3.2 + depth * 1.45 + brightness * (bright ? 4.2 : 2.2),
        brightness: Math.min(1, 0.25 + depth * 0.13 + brightness ** 1.4 * 0.57),
        phase: random() * Math.PI * 2,
        twinkle: depth > 0 && random() < 0.4 ? 0.06 + random() * 0.10 : 0,
        age: 0.7 + random() * 5,
        sprite: bright ? glow : point,
      });
    }
    draw();
  }

  function tick(now: number) {
    const delta = Math.max(0, Math.min((now - lastTime) / 1000, 0.05));
    seconds += delta;
    lastTime = now;
    draw(delta);
    frame = requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(resize);
  return {
    setActive(visible: boolean, moving: boolean) {
      if (visible) {
        resize();
        observer.observe(canvas);
      } else {
        observer.disconnect();
      }

      if (visible && moving) {
        if (frame === undefined) {
          lastTime = performance.now();
          frame = requestAnimationFrame(tick);
        }
      } else if (frame !== undefined) {
        cancelAnimationFrame(frame);
        frame = undefined;
      }
    },
  };
}
