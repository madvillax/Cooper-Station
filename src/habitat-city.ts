import * as THREE from "three";
import {
  canvasTexture,
  instances,
  seededRandom,
  type Detail,
} from "./environment";
import {
  CITY_DECK,
  CITY_HALF_LENGTH,
  CITY_HALF_WIDTH,
  CITY_LANDING,
  cityPoint,
  citySurface,
  surfaceAngle,
} from "./habitat-surface";

type Footprint = { x: number; z: number; width: number; depth: number };
type Tower = Footprint & { height: number; tier: number };
const axis = new THREE.Vector3(0, 0, 1);
const towerRows = [-0.85, -0.59, -0.31, -0.02, 0.26, 0.51, 0.81];
const towerColumns = [-0.57, -0.44, -0.23, -0.12, 0.12, 0.23, 0.44, 0.57];

function rotationAt(x: number) {
  return new THREE.Quaternion().setFromAxisAngle(
    axis,
    surfaceAngle(citySurface(x, 0).u) + Math.PI / 2,
  );
}

function facadeTexture() {
  return canvasTexture(256, 512, (ctx) => {
    const random = seededRandom(4528);
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, "#7d9db4");
    sky.addColorStop(0.48, "#314b66");
    sky.addColorStop(1, "#101e31");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 256, 512);
    for (let floor = 0; floor < 32; floor++) {
      for (let bay = 0; bay < 12; bay++) {
        const x = bay * 21.33;
        const y = floor * 16;
        const light = random();
        ctx.fillStyle =
          light > 0.92 ? "#e5c496" : light > 0.73 ? "#7da6ba" : "#15284042";
        ctx.fillRect(x + 1.5, y + 1.5, 18.4, 11.7);
        ctx.fillStyle = "#d1edff36";
        ctx.fillRect(x + 1.5, y + 1.5, 18.4, 1);
        ctx.fillStyle = "#1b2b40";
        ctx.fillRect(x, y + 13.5, 21.4, 2.5);
      }
    }
    ctx.fillStyle = "#d4e3ec";
    for (const x of [1, 84, 170, 252]) ctx.fillRect(x, 0, 2, 512);
  });
}

function deckTexture() {
  return canvasTexture(1536, 2048, (ctx) => {
    const { width, height } = ctx.canvas;
    const px = (x: number) => (x / (2 * CITY_HALF_WIDTH) + 0.5) * width;
    const py = (z: number) => (0.5 - z / (2 * CITY_HALF_LENGTH)) * height;
    const rectangle = (
      x: number,
      z: number,
      w: number,
      d: number,
      color: string,
    ) => {
      ctx.fillStyle = color;
      ctx.fillRect(px(x - w / 2), py(z + d / 2), px(w) - px(0), py(0) - py(d));
    };

    ctx.fillStyle = "#43525b";
    ctx.fillRect(0, 0, width, height);
    const random = seededRandom(390);
    for (let y = 0; y < height; y += 20) {
      for (let x = 0; x < width; x += 21) {
        ctx.fillStyle = random() < 0.29 ? "#8795a025" : "#15232e26";
        ctx.fillRect(x + 1, y + 1, 19, 18);
      }
    }
    for (const z of [-0.98, -0.72, -0.45, -0.165, 0.12, 0.39, 0.66, 0.96]) {
      rectangle(0, z, 1.42, 0.038, "#222c34");
      for (let x = -0.66; x < 0.67; x += 0.038)
        rectangle(x, z, 0.015, 0.0015, "#a7aa99");
    }
    for (const x of [-0.66, -0.34, 0.34, 0.66]) {
      rectangle(x, 0, 0.042, 2.04, "#222e36");
      for (const offset of [-0.024, 0.024])
        rectangle(x + offset, 0, 0.002, 2.04, "#7797a4");
    }
    rectangle(0, 0, 0.11, 2.04, "#929797");
    rectangle(0, 0, 0.078, 2.04, "#777f81");
    rectangle(0, 0.79, 0.213, 0.26, "#8e9da2");
    rectangle(0, 0.79, 0.152, 0.222, "#697d89");
    for (const edge of [-0.045, 0.045])
      rectangle(edge, 0, 0.002, 2.01, "#a5d7d6");
    for (let z = -0.96; z < 1.01; z += 0.013)
      rectangle(0, z, 0.077, 0.00085, "#b3c2bd55");
  });
}

function makeDeck() {
  const columns = 96;
  const rows = 64;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const u = column / columns;
      const v = row / rows;
      const point = cityPoint(
        (u * 2 - 1) * CITY_HALF_WIDTH,
        (v * 2 - 1) * CITY_HALF_LENGTH,
      );
      positions.push(point.x, point.y, point.z);
      uvs.push(u, v);
      if (row === rows || column === columns) continue;
      const i = row * (columns + 1) + column;
      const next = i + columns + 1;
      indices.push(i, next, i + 1, next, next + 1, i + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const map = deckTexture();
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.81,
    emissiveMap: map,
    emissive: 0x8ba2b1,
    emissiveIntensity: 0.23,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
        vec2 tiles = vMapUv * vec2(710.0, 1020.0);
        vec2 edges = abs(fract(tiles - 0.5) - 0.5);
        vec2 footprint = fwidth(tiles);
        vec2 joints = 1.0 - smoothstep(vec2(0.015), vec2(0.015) + max(footprint, 0.005), edges);
        float detail = 1.0 - smoothstep(0.32, 0.95, max(footprint.x, footprint.y));
        float slab = fract(sin(dot(floor(tiles), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= 1.0 + detail * (slab * 0.10 - 0.05 - 0.24 * max(joints.x, joints.y));`,
    );
  };
  return new THREE.Mesh(geometry, material);
}

export function makeHabitatCity() {
  const group = new THREE.Group();
  const random = seededRandom(12901);
  const blockers: Footprint[] = [];
  const structure: Detail[] = [];
  const glass: Detail[] = [];
  const lights: Detail[] = [];
  const gardens: Detail[] = [];
  const box = new THREE.BoxGeometry();
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.46,
    metalness: 0.29,
    emissive: 0x202e3d,
    emissiveIntensity: 0.41,
  });
  const facade = facadeTexture();
  const glazing = new THREE.MeshStandardMaterial({
    map: facade,
    emissiveMap: facade,
    emissive: 0x87a9bd,
    emissiveIntensity: 0.4,
    roughness: 0.29,
    metalness: 0.35,
  });
  const glow = new THREE.MeshBasicMaterial({ toneMapped: false });
  const vegetation = new THREE.MeshStandardMaterial({
    roughness: 0.89,
    emissive: 0x2e4231,
    emissiveIntensity: 0.24,
  });

  function part(
    batch: Detail[],
    x: number,
    z: number,
    elevation: number,
    w: number,
    h: number,
    d: number,
    color: number,
  ) {
    batch.push({
      position: cityPoint(x, z, CITY_DECK + elevation + h / 2),
      rotation: rotationAt(x),
      scale: new THREE.Vector3(w, h, d),
      color: new THREE.Color(color),
    });
  }

  function buildTower({ x, z, width, depth, height, tier }: Tower) {
    const base = 0.007;
    blockers.push({ x, z, width: width * 1.09, depth: depth * 1.11 });
    part(structure, x, z, 0, width * 1.09, base, depth * 1.11, 0x738291);
    part(
      glass,
      x,
      z,
      base,
      width,
      height * 0.69,
      depth,
      tier === 0 ? 0xa6c3d1 : 0x90b2ca,
    );
    part(
      structure,
      x,
      z,
      base + height * 0.69,
      width * 1.03,
      0.0035,
      depth * 1.03,
      0xbac9ce,
    );
    part(
      glass,
      x,
      z - depth * 0.12,
      base + height * 0.69,
      width * 0.72,
      height * 0.31,
      depth * 0.72,
      0xa6c0d5,
    );
    part(
      structure,
      x,
      z - depth * 0.12,
      base + height,
      width * 0.79,
      0.0045,
      depth * 0.76,
      0xc3cbd2,
    );
    for (const direction of [-1, 1]) {
      part(
        structure,
        x + direction * width * 0.48,
        z,
        base,
        0.003,
        height * 0.69,
        depth * 1.03,
        0xb8c7d1,
      );
      part(
        lights,
        x + direction * width * 0.43,
        z + depth * 0.503,
        base + height * 0.1,
        0.0008,
        height * 0.55,
        0.0009,
        0x87c9e4,
      );
    }
    if (tier > 1) {
      part(
        structure,
        x,
        z - depth * 0.12,
        height + base,
        0.005,
        height * 0.24,
        0.006,
        0x8c9ead,
      );
      part(
        lights,
        x,
        z - depth * 0.12,
        height * 1.24 + base,
        0.004,
        0.003,
        0.004,
        0xffaa78,
      );
    }
  }

  for (const z of towerRows) {
    for (const x of towerColumns) {
      if (z >= 0.5 && Math.abs(x) < 0.29) continue;
      const tier = Math.abs(x) < 0.29 && z < 0.29 ? 2 : 1;
      buildTower({
        x: x + (random() - 0.5) * 0.025,
        z: z + (random() - 0.5) * 0.064,
        width: 0.05 + random() * 0.035,
        depth: 0.055 + random() * 0.055,
        height: 0.031 + random() * (tier === 2 ? 0.139 : 0.088),
        tier,
      });
    }
  }

  // The promenade stays clear for walking from the landing plaza.
  for (const x of [-0.064, 0.064]) {
    buildTower({
      x,
      z: 0.58,
      width: 0.038,
      depth: 0.048,
      height: 0.083,
      tier: 2,
    });
    part(structure, x, 0.7, 0, 0.023, 0.002, 0.064, 0xa1b2b3);
    for (const z of [0.682, 0.701, 0.72]) {
      part(gardens, x, z, 0.002, 0.016, 0.012, 0.015, 0x477966);
    }
  }

  for (const x of [-0.018, 0.018]) {
    for (let z = 0.52; z < 0.95; z += 0.019) {
      part(structure, x, z, 0, 0.0011, 0.0014, 0.0011, 0x374750);
      part(lights, x, z, 0.0014, 0.00095, 0.0004, 0.00095, 0xc7eaf8);
    }
  }
  for (const z of [0.26, -0.29, -0.59]) {
    part(structure, 0, z, 0.026, 0.21, 0.005, 0.026, 0x7e97aa);
    part(glass, 0, z, 0.031, 0.201, 0.009, 0.024, 0x7e9aaa);
    part(lights, 0, z + 0.013, 0.028, 0.203, 0.001, 0.001, 0xa1e4f8);
  }

  for (const x of [-0.011, 0.011]) {
    part(lights, x, 0.787, 0.00009, 0.00021, 0.00007, 0.17, 0x9ecbdb);
  }
  const arch = new THREE.TorusGeometry(
    0.032,
    0.0023,
    10,
    60,
    (Math.PI * 5) / 3,
  ).rotateZ((Math.PI * 5) / 3);
  const gateway = new THREE.Mesh(arch, shell);
  gateway.position.copy(cityPoint(0, 0.666, CITY_DECK + 0.028));
  gateway.quaternion.copy(rotationAt(0));
  group.add(gateway);
  const gatewayLight = new THREE.Mesh(
    new THREE.TorusGeometry(0.03, 0.00052, 6, 60, (Math.PI * 5) / 3).rotateZ(
      (Math.PI * 5) / 3,
    ),
    new THREE.MeshBasicMaterial({ color: 0xa9ddeb, toneMapped: false }),
  );
  gatewayLight.position.copy(gateway.position);
  gatewayLight.position.z += 0.0022;
  gatewayLight.quaternion.copy(gateway.quaternion);
  group.add(gatewayLight);

  const signMap = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = "#142839";
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = "#9ed2d8";
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = "#def1ed";
    ctx.font = "bold 43px monospace";
    ctx.fillText("COOPER CITY", 28, 56);
    ctx.fillStyle = "#9ac8cc";
    ctx.font = "23px monospace";
    ctx.fillText("ARRIVALS  /  PROMENADE", 30, 99);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.027, 0.00675),
    new THREE.MeshBasicMaterial({ map: signMap, side: THREE.DoubleSide }),
  );
  sign.position.copy(cityPoint(0, 0.666, CITY_DECK + 0.046));
  sign.position.z += 0.003;
  sign.quaternion.copy(rotationAt(0));
  group.add(sign);
  for (const x of [-0.016, 0.016]) {
    part(structure, x, 0.666, 0, 0.005, 0.004, 0.007, 0x8ea2ad);
    part(structure, x * 0.63, 0.668, 0.048, 0.0005, 0.012, 0.0005, 0x9babb4);
    blockers.push({ x, z: 0.666, width: 0.005, depth: 0.007 });
  }

  const domeGeometry = new THREE.SphereGeometry(
    1,
    40,
    18,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  const domeMaterial = new THREE.MeshPhysicalMaterial({
    color: 0x759aaf,
    emissive: 0x537f88,
    emissiveIntensity: 0.35,
    opacity: 0.58,
    transparent: true,
    depthWrite: false,
    metalness: 0.23,
    roughness: 0.27,
  });
  for (const x of [-0.185, 0.185]) {
    const z = 0.76;
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.scale.set(0.054, 0.035, 0.058);
    dome.position.copy(cityPoint(x, z, CITY_DECK + 0.002));
    dome.quaternion.copy(rotationAt(x));
    group.add(dome);
    blockers.push({ x, z, width: 0.112, depth: 0.12 });
    part(structure, x, z, 0, 0.112, 0.002, 0.12, 0x859baa);
    for (const offset of [-0.022, 0, 0.022]) {
      part(gardens, x + offset, z, 0.002, 0.015, 0.013, 0.065, 0x4c7960);
    }
  }

  const trainTracks = [-0.34, 0.34];
  const trains: THREE.Group[] = [];
  for (const x of trainTracks) {
    part(structure, x, 0, 0.024, 0.016, 0.003, 1.94, 0x607080);
    for (const offset of [-0.007, 0.007])
      part(lights, x + offset, 0, 0.0268, 0.0006, 0.0005, 1.94, 0x89bfcc);
    for (let z = -0.93; z <= 0.94; z += 0.092) {
      part(structure, x, z, 0, 0.0045, 0.024, 0.0045, 0x96a8b1);
      blockers.push({ x, z, width: 0.0045, depth: 0.0045 });
    }
    const train = new THREE.Group();
    const carriageGeometry = new THREE.CapsuleGeometry(0.0036, 0.035, 3, 10);
    carriageGeometry.rotateX(Math.PI / 2);
    const cabinGeometry = new THREE.BoxGeometry(0.0061, 0.0038, 0.033);
    const cabinMaterial = new THREE.MeshStandardMaterial({
      color: 0x36536c,
      emissive: 0x698899,
      emissiveIntensity: 0.5,
      roughness: 0.23,
    });
    for (const z of [-0.042, 0, 0.042]) {
      const carriage = new THREE.Mesh(carriageGeometry, shell);
      const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
      carriage.position.z = cabin.position.z = z;
      cabin.position.y = 0.002;
      train.add(carriage, cabin);
    }
    train.quaternion.copy(rotationAt(x));
    group.add(train);
    trains.push(train);
  }

  group.add(
    makeDeck(),
    instances(box, shell, structure),
    instances(box, glazing, glass),
    instances(box, glow, lights),
    instances(new THREE.IcosahedronGeometry(1, 1), vegetation, gardens),
  );

  function update(seconds: number) {
    trains.forEach((train, index) => {
      const phase = THREE.MathUtils.euclideanModulo(
        seconds * 0.036 + index * 1.58,
        3.4,
      );
      const z = 0.85 - Math.min(phase, 3.4 - phase);
      train.position.copy(cityPoint(trainTracks[index], z, CITY_DECK + 0.031));
    });
  }

  function canWalk(x: number, z: number) {
    const radius = 0.00045;
    return (
      Math.abs(x) < CITY_HALF_WIDTH - radius &&
      Math.abs(z) < CITY_HALF_LENGTH - radius &&
      !blockers.some(
        (block) =>
          Math.abs(block.x - x) < block.width / 2 + radius &&
          Math.abs(block.z - z) < block.depth / 2 + radius,
      )
    );
  }

  update(0);
  return { group, update, canWalk };
}
