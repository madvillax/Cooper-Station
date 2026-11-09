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
  cityRotation,
  type CityFootprint,
} from "./habitat-surface";
import { makePromenade } from "./habitat-promenade";

type Tower = CityFootprint & { height: number; tier: number };
const towerRows = [-0.85, -0.59, -0.31, -0.02, 0.26, 0.51, 0.81];
const towerColumns = [-0.57, -0.44, -0.23, -0.12, 0.12, 0.23, 0.44, 0.57];

function facadeTexture(residential: boolean) {
  return canvasTexture(256, 512, (ctx) => {
    const random = seededRandom(residential ? 8831 : 4528);
    const curtain = ctx.createLinearGradient(0, 0, 256, 512);
    curtain.addColorStop(0, residential ? "#9da5a0" : "#78888c");
    curtain.addColorStop(0.54, residential ? "#767f79" : "#435b60");
    curtain.addColorStop(1, residential ? "#565f5a" : "#263a40");
    ctx.fillStyle = curtain;
    ctx.fillRect(0, 0, 256, 512);
    const levels = residential ? 17 : 28;
    const columns = residential ? 9 : 13;
    const story = 512 / levels;
    const bay = 256 / columns;
    for (let row = 0; row < levels; row++) {
      for (let col = 0; col < columns; col++) {
        const x = col * bay;
        const y = row * story;
        const shade = random();
        ctx.fillStyle =
          shade > 0.93 ? "#b9a47b" : shade > 0.74 ? "#8b9d9c" : "#1e353a85";
        ctx.fillRect(x + 2, y + 2, bay - 4, story * 0.72);
        ctx.fillStyle = "#c5d3cc38";
        ctx.fillRect(x + 2, y + 3, bay - 4, 1);
        ctx.fillStyle = "#16282c91";
        ctx.fillRect(x + 2, y + story * 0.72, bay - 4, 2);
        if (shade > 0.79) {
          ctx.fillStyle = "#d9d8c350";
          ctx.fillRect(x + 3, y + 4, bay * 0.35, story * 0.5);
        }
      }
      ctx.fillStyle = residential ? "#90978c" : "#33484b";
      ctx.fillRect(
        0,
        (row + 1) * story - (residential ? 3 : 2),
        256,
        residential ? 3 : 2,
      );
    }
    ctx.fillStyle = residential ? "#a8aaa0" : "#a0aeaa";
    for (const x of [0, 84, 169, 254]) ctx.fillRect(x, 0, 2, 512);
  });
}

function deckTexture() {
  return canvasTexture(2048, 2560, (ctx) => {
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

    ctx.fillStyle = "#817e70";
    ctx.fillRect(0, 0, width, height);
    const random = seededRandom(390);
    for (let y = 0; y < height; y += 31) {
      for (let x = 0; x < width; x += 30) {
        ctx.fillStyle = random() < 0.39 ? "#ada89920" : "#555c5026";
        ctx.fillRect(x + 1, y + 1, 29, 30);
      }
    }
    for (const z of [-0.98, -0.72, -0.45, -0.165, 0.12, 0.39, 0.66, 0.96]) {
      rectangle(0, z, 1.42, 0.048, "#a4a090");
      rectangle(0, z, 1.42, 0.037, "#3d4240");
      for (let x = -0.66; x < 0.67; x += 0.038)
        rectangle(x, z, 0.015, 0.0013, "#a49c7d");
    }
    for (const x of [-0.66, -0.34, 0.34, 0.66]) {
      rectangle(x, 0, 0.053, 2.04, "#a4a090");
      rectangle(x, 0, 0.037, 2.04, "#3d4240");
      for (let z = -0.96; z < 1; z += 0.022)
        rectangle(x, z, 0.0012, 0.009, "#979274");
    }
    rectangle(0, 0.16, 0.071, 1.72, "#a09e8f");
    rectangle(0, CITY_LANDING.z, 0.216, 0.224, "#a09e8f");
    for (const side of [-1, 1]) {
      rectangle(side * 0.0157, 0.155, 0.0054, 1.72, "#626d64");
      rectangle(side * 0.013, 0.155, 0.00072, 1.72, "#bbb7a6");
      rectangle(side * 0.026, 0.152, 0.0065, 1.71, "#777b6c");
      for (const z of [0.41, 0.23, 0.049, -0.28, -0.55]) {
        rectangle(side * 0.068, z, 0.042, 0.058, "#536b4d");
        rectangle(side * 0.068, z, 0.004, 0.056, "#a7a48c");
      }
    }
    for (let i = 0; i < 34000; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#e2d7bc16" : "#1e2b281c";
      ctx.fillRect(
        random() * width,
        random() * height,
        0.55 + random() * 2.6,
        0.7 + random() * 1.8,
      );
    }
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
    roughness: 0.86,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
        vec2 tiles = vMapUv * vec2(1270.0, 1280.0);
        tiles.x += mod(floor(tiles.y), 2.0) * 0.5;
        vec2 edges = abs(fract(tiles - 0.5) - 0.5);
        vec2 footprint = fwidth(tiles);
        vec2 joints = 1.0 - smoothstep(vec2(0.007), vec2(0.007) + max(footprint, 0.005), edges);
        float detail = 1.0 - smoothstep(0.22, 0.79, max(footprint.x, footprint.y));
        float slab = fract(sin(dot(floor(tiles), vec2(12.9898, 78.233))) * 43758.5453);
        float mottling = sin(vMapUv.x * 7610.0 - cos(vMapUv.y * 6320.0))
          * cos(vMapUv.y * 12600.0 + vMapUv.x * 3180.0);
        vec2 grit = vMapUv * vec2(87000.0, 126000.0);
        float gritFade = 1.0 - smoothstep(0.2, 1.65, max(fwidth(grit.x), fwidth(grit.y)));
        float aggregate = fract(sin(dot(floor(grit), vec2(13.43, 79.55))) * 47386.563);
        diffuseColor.rgb *= 1.0 + detail * (slab * 0.13 - 0.065 + mottling * 0.08
          - 0.24 * max(joints.x, joints.y)) + gritFade * (aggregate - 0.5) * 0.17;`,
    );
  };
  const deck = new THREE.Mesh(geometry, material);
  deck.receiveShadow = true;
  return deck;
}

export function makeHabitatCity() {
  const group = new THREE.Group();
  const random = seededRandom(12901);
  const promenade = makePromenade();
  const blockers = promenade.blockers;
  const structure: Detail[] = [];
  const glass: Detail[] = [];
  const residential: Detail[] = [];
  const lights: Detail[] = [];
  const gardens: Detail[] = [];
  const box = new THREE.BoxGeometry();
  const shell = new THREE.MeshStandardMaterial({
    roughness: 0.56,
    metalness: 0.25,
  });
  const glazing = new THREE.MeshStandardMaterial({
    map: facadeTexture(false),
    emissive: 0x253535,
    emissiveIntensity: 0.26,
    roughness: 0.29,
    metalness: 0.37,
  });
  const masonry = new THREE.MeshStandardMaterial({
    map: facadeTexture(true),
    roughness: 0.67,
    metalness: 0.08,
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
      rotation: cityRotation(x),
      scale: new THREE.Vector3(w, h, d),
      color: new THREE.Color(color),
    });
  }

  function buildTower({ x, z, width, depth, height, tier }: Tower) {
    const apartments = random() < 0.46;
    const setback = tier === 2 || (!apartments && random() > 0.53);
    const base = 0.008 + random() * 0.007;
    const wall = apartments ? residential : glass;
    const trim = apartments ? 0xa39b88 : 0x82918e;
    const podium = apartments ? 0x969184 : 0x6f7a75;
    blockers.push({ x, z, width: width * 1.14, depth: depth * 1.14 });
    part(structure, x, z, 0, width * 1.14, base, depth * 1.14, podium);
    part(
      wall,
      x,
      z,
      base * 0.28,
      width * 1.02,
      base * 0.57,
      depth * 1.15,
      0xa6aea4,
    );

    const main = height * (setback ? 0.69 : 1);
    part(
      wall,
      x,
      z,
      base,
      width,
      main,
      depth,
      apartments ? 0xb4aa96 : 0xa1b6ba,
    );
    part(
      structure,
      x,
      z,
      base + main,
      width * 1.015,
      0.0027,
      depth * 1.028,
      trim,
    );
    if (setback) {
      const inset = apartments ? 0.78 : 0.69;
      part(
        wall,
        x,
        z - depth * 0.065,
        base + main,
        width * inset,
        height - main,
        depth * 0.76,
        apartments ? 0xada596 : 0x9caeb0,
      );
      part(
        structure,
        x,
        z - depth * 0.065,
        base + height,
        width * (inset + 0.045),
        0.0029,
        depth * 0.8,
        trim,
      );
    }
    for (const side of [-1, 1]) {
      part(
        structure,
        x + side * width * 0.47,
        z,
        base,
        apartments ? 0.0032 : 0.0019,
        main,
        depth * 1.013,
        trim,
      );
      part(
        structure,
        x + side * width * 0.158,
        z - depth * 0.104,
        base + height + 0.002,
        width * 0.155,
        0.004 + random() * 0.003,
        depth * 0.26,
        podium,
      );
      if (apartments) {
        for (const level of [0.24, 0.53, 0.77]) {
          part(
            structure,
            x,
            z + side * depth * 0.49,
            base + main * level,
            width * 0.89,
            0.00125,
            depth * 0.13,
            0xa6a293,
          );
        }
      }
    }
    if (tier === 2 && height > 0.11) {
      part(
        structure,
        x,
        z,
        base + height + 0.004,
        0.0032,
        height * 0.13,
        0.0035,
        0x84938c,
      );
      part(
        lights,
        x,
        z,
        base + height * 1.13 + 0.004,
        0.002,
        0.0016,
        0.002,
        0xe39368,
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
        width: 0.034 + random() * 0.066,
        depth: 0.038 + random() * 0.079,
        height: 0.019 + random() ** 1.55 * (tier === 2 ? 0.154 : 0.105),
        tier,
      });
    }
  }

  buildTower({
    x: -0.058,
    z: 0.575,
    width: 0.038,
    depth: 0.072,
    height: 0.076,
    tier: 2,
  });
  buildTower({
    x: 0.069,
    z: 0.54,
    width: 0.055,
    depth: 0.061,
    height: 0.112,
    tier: 2,
  });
  for (const z of [0.26, -0.29, -0.59]) {
    part(structure, 0, z, 0.026, 0.214, 0.004, 0.024, 0x8c9187);
    part(glass, 0, z, 0.029, 0.206, 0.008, 0.023, 0x879997);
    part(structure, 0, z, 0.037, 0.212, 0.0011, 0.0246, 0x909d96);
  }
  for (const x of [-0.068, 0.068]) {
    for (const z of [0.41, 0.23, 0.049, -0.28, -0.55]) {
      for (let tree = 0; tree < 9; tree++) {
        const tx = x + (random() - 0.5) * 0.032;
        const tz = z + (random() - 0.5) * 0.047;
        const h = 0.003 + random() * 0.005;
        part(gardens, tx, tz, 0.0018, h * 0.63, h, h * 0.57, 0x416544);
      }
    }
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
    color: 0x90a6a0,
    opacity: 0.46,
    transparent: true,
    depthWrite: false,
    metalness: 0.23,
    roughness: 0.27,
    clearcoat: 0.44,
  });
  const roofRib = new THREE.TorusGeometry(1, 0.012, 6, 32, Math.PI);
  for (const x of [-0.185, 0.185]) {
    const z = 0.76;
    const dome = new THREE.Mesh(domeGeometry, domeMaterial);
    dome.scale.set(0.054, 0.035, 0.058);
    dome.position.copy(cityPoint(x, z, CITY_DECK + 0.002));
    dome.quaternion.copy(cityRotation(x));
    group.add(dome);
    for (let i = 0; i < 8; i++) {
      const rib = new THREE.Mesh(roofRib, shell);
      rib.scale.set(0.0546, 0.0353, 0.058);
      rib.position.copy(dome.position);
      rib.quaternion
        .copy(dome.quaternion)
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            (i * Math.PI) / 8,
          ),
        );
      group.add(rib);
    }
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
    train.quaternion.copy(cityRotation(x));
    trains.push(train);
  }

  group.add(
    promenade.group,
    instances(box, shell, structure),
    instances(box, glazing, glass),
    instances(box, masonry, residential),
    instances(box, glow, lights),
    instances(new THREE.IcosahedronGeometry(1, 1), vegetation, gardens),
  );
  const shadowCasters: THREE.Mesh[] = [];
  group.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      !(object.material instanceof THREE.MeshStandardMaterial)
    )
      return;
    if (!object.material.transparent) shadowCasters.push(object);
    object.receiveShadow = true;
  });
  group.add(makeDeck(), ...trains);

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
  return {
    group,
    update,
    canWalk,
    setShadowCasting(enabled: boolean) {
      for (const mesh of shadowCasters) mesh.castShadow = enabled;
    },
  };
}
