import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canvasTexture, seededRandom } from "./environment";
import { HALF_LENGTH, RADIUS, TAU } from "./habitat-surface";

const SECTORS = 12;
const SECTOR_ARC = TAU / SECTORS;
const HULL_RADIUS = RADIUS + 0.23;
const SHOULDER = HALF_LENGTH - 0.28;
const WHEEL_RADIUS = RADIUS + 2.05;
const WHEEL_Z = HALF_LENGTH + 1.76;

type Profile = ReadonlyArray<readonly [radius: number, z: number]>;
type Batches = Map<THREE.Material, THREE.BufferGeometry[]>;

function at(radius: number, theta: number, z: number) {
  return new THREE.Vector3(
    radius * Math.sin(theta),
    -radius * Math.cos(theta),
    z,
  );
}

function lathe(profile: Profile, start = 0, span = TAU, segments = 96) {
  return new THREE.LatheGeometry(
    profile.map(([r, z]) => new THREE.Vector2(r, z)),
    segments,
    start,
    span,
  ).rotateX(Math.PI / 2);
}

function skin(
  radius: number,
  minZ: number,
  maxZ: number,
  start: number,
  span: number,
) {
  return lathe(
    [
      [radius, minZ],
      [radius, maxZ],
    ],
    start,
    span,
    12,
  );
}

function batch(
  batches: Batches,
  material: THREE.Material,
  geometry: THREE.BufferGeometry,
) {
  const geometries = batches.get(material);
  if (geometries) geometries.push(geometry);
  else batches.set(material, [geometry]);
}

function finishBatches(batches: Batches, group: THREE.Group) {
  for (const [material, geometries] of batches) {
    const geometry =
      geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    if (!geometry) throw new Error("Incompatible station geometry");
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow =
      material instanceof THREE.MeshStandardMaterial && !material.transparent;
    mesh.receiveShadow = material instanceof THREE.MeshStandardMaterial;
    group.add(mesh);
  }
}

const box = new THREE.BoxGeometry();
const rod = new THREE.CylinderGeometry(1, 1, 1, 8);
const vertical = new THREE.Vector3(0, 1, 0);

function tile(
  batches: Batches,
  material: THREE.Material,
  center: THREE.Vector3,
  [width, depth, length]: readonly [number, number, number],
  theta: number,
) {
  batch(
    batches,
    material,
    box
      .clone()
      .scale(width, depth, length)
      .rotateZ(theta)
      .translate(center.x, center.y, center.z),
  );
}

function pipe(
  batches: Batches,
  material: THREE.Material,
  from: THREE.Vector3,
  to: THREE.Vector3,
  radius: number,
) {
  const direction = to.clone().sub(from);
  const midpoint = from.clone().lerp(to, 0.5);
  const rotation = new THREE.Quaternion().setFromUnitVectors(
    vertical,
    direction.clone().normalize(),
  );
  batch(
    batches,
    material,
    rod
      .clone()
      .applyMatrix4(
        new THREE.Matrix4().compose(
          midpoint,
          rotation,
          new THREE.Vector3(radius, direction.length(), radius),
        ),
      ),
  );
}

function alloyTexture() {
  return canvasTexture(512, 1024, (ctx) => {
    const random = seededRandom(8445);
    ctx.fillStyle = "#5d6363";
    ctx.fillRect(0, 0, 512, 1024);
    for (let row = 0; row < 16; row++) {
      const stagger = row % 2 === 0 ? 0 : 64;
      for (let x = -stagger; x < 512; x += 128) {
        const y = row * 64;
        const tone = 163 + Math.floor(random() * 38);
        const panel = ctx.createLinearGradient(x, y, x + 100, y + 61);
        panel.addColorStop(0, `rgb(${tone + 12}, ${tone + 13}, ${tone + 8})`);
        panel.addColorStop(0.69, `rgb(${tone}, ${tone + 3}, ${tone + 1})`);
        panel.addColorStop(1, `rgb(${tone - 23}, ${tone - 18}, ${tone - 18})`);
        ctx.fillStyle = panel;
        ctx.fillRect(x + 1, y + 1, 126, 62);
        ctx.fillStyle = "#eeede66b";
        ctx.fillRect(x + 2, y + 2, 124, 1);
        ctx.fillRect(x + 2, y + 2, 1, 60);
        ctx.fillStyle = "#363e3f8f";
        ctx.fillRect(x + 3, y + 61, 122, 2);
        for (const dx of [7, 120]) {
          for (const dy of [7, 55]) {
            ctx.fillStyle = "#434b4d";
            ctx.fillRect(x + dx, y + dy, 2, 2);
            ctx.fillStyle = "#e5e6db7a";
            ctx.fillRect(x + dx, y + dy + 2, 2, 1);
          }
        }
        if (random() > 0.7) {
          ctx.fillStyle = "#555c5c9e";
          ctx.fillRect(x + 15, y + 12, 20 + random() * 30, 2);
          ctx.fillRect(x + 15, y + 16, 12, 1);
        }
      }
    }
    for (let i = 0; i < 6500; i++) {
      const x = random() * 512;
      const y = random() * 1024;
      ctx.fillStyle = i % 2 === 0 ? "#f7f0dc19" : "#333c4020";
      ctx.fillRect(x, y, 1, 1 + random() ** 3 * 18);
    }
  });
}

function vesselMark() {
  return canvasTexture(192, 1024, (ctx) => {
    ctx.translate(192, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = "#292e30";
    ctx.fillRect(30, 42, 12, 108);
    ctx.fillRect(50, 42, 5, 108);
    ctx.font = "700 82px sans-serif";
    ctx.fillText("COOPER STATION", 75, 106);
    ctx.font = "600 24px monospace";
    ctx.fillText("CS–01   /   HABITAT PRESSURE VESSEL", 79, 144);
  });
}

export function makeStationExterior() {
  const group = new THREE.Group();
  const removablePanels: THREE.Group[] = [];
  const alloy = alloyTexture();
  const panels = new THREE.MeshStandardMaterial({
    map: alloy,
    bumpMap: alloy,
    bumpScale: 0.027,
    roughness: 0.52,
    metalness: 0.42,
  });
  const ceramic = new THREE.MeshPhysicalMaterial({
    color: 0xd5d4c7,
    metalness: 0.24,
    roughness: 0.39,
    clearcoat: 0.22,
  });
  const titanium = new THREE.MeshStandardMaterial({
    color: 0x9dabae,
    metalness: 0.72,
    roughness: 0.34,
  });
  const graphite = new THREE.MeshStandardMaterial({
    color: 0x303b43,
    metalness: 0.62,
    roughness: 0.5,
  });
  const heatShield = new THREE.MeshStandardMaterial({
    color: 0x536573,
    metalness: 0.64,
    roughness: 0.29,
  });
  const ochre = new THREE.MeshStandardMaterial({
    color: 0xb58c54,
    roughness: 0.53,
    metalness: 0.35,
  });
  const runningLight = new THREE.MeshBasicMaterial({ color: 0xc3e8ef });
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff8c48 });
  const window = new THREE.MeshPhysicalMaterial({
    color: 0x789da5,
    metalness: 0.16,
    roughness: 0.19,
    clearcoat: 0.38,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
  });
  const marking = new THREE.MeshStandardMaterial({
    map: vesselMark(),
    roughness: 0.82,
    transparent: true,
    depthWrite: false,
  });

  const frontHead: Profile = [
    [HULL_RADIUS - 0.022, SHOULDER - 0.05],
    [HULL_RADIUS + 0.035, SHOULDER + 0.07],
    [HULL_RADIUS + 0.035, SHOULDER + 0.25],
    [HULL_RADIUS - 0.035, SHOULDER + 0.48],
    [3.18, SHOULDER + 0.71],
    [2.94, SHOULDER + 0.88],
    [2.65, SHOULDER + 0.99],
    [2.49, SHOULDER + 0.96],
    [2.45, SHOULDER + 0.85],
    [2.47, SHOULDER + 0.54],
    [2.54, SHOULDER + 0.28],
  ];
  const tailHead: Profile = [
    [0.46, -SHOULDER - 1.0],
    [0.85, -SHOULDER - 0.97],
    [1.85, -SHOULDER - 0.83],
    [2.73, -SHOULDER - 0.64],
    [3.21, -SHOULDER - 0.43],
    [HULL_RADIUS + 0.04, -SHOULDER - 0.18],
    [HULL_RADIUS, -SHOULDER + 0.02],
  ];
  const wheelProfile: Profile = [
    [WHEEL_RADIUS - 0.22, WHEEL_Z - 0.09],
    [WHEEL_RADIUS - 0.15, WHEEL_Z - 0.17],
    [WHEEL_RADIUS + 0.15, WHEEL_Z - 0.17],
    [WHEEL_RADIUS + 0.22, WHEEL_Z - 0.09],
    [WHEEL_RADIUS + 0.22, WHEEL_Z + 0.08],
    [WHEEL_RADIUS + 0.15, WHEEL_Z + 0.16],
    [WHEEL_RADIUS - 0.15, WHEEL_Z + 0.16],
    [WHEEL_RADIUS - 0.22, WHEEL_Z + 0.09],
    [WHEEL_RADIUS - 0.22, WHEEL_Z - 0.09],
  ];

  for (let sector = 0; sector < SECTORS; sector++) {
    const start = sector * SECTOR_ARC;
    const mid = start + SECTOR_ARC / 2;
    const wedge = new THREE.Group();
    const batches: Batches = new Map();
    const hasWindows = sector === 2 || sector === 3 || sector === 8;
    const edge = 0.052;
    if (hasWindows) {
      batch(
        batches,
        panels,
        skin(HULL_RADIUS, -SHOULDER, SHOULDER, start, edge),
      );
      batch(
        batches,
        panels,
        skin(HULL_RADIUS, -SHOULDER, SHOULDER, start + SECTOR_ARC - edge, edge),
      );
      batch(
        batches,
        window,
        skin(
          HULL_RADIUS - 0.008,
          -5.25,
          5.25,
          start + edge,
          SECTOR_ARC - 2 * edge,
        ),
      );
      for (const [min, max] of [
        [-SHOULDER, -5.25],
        [5.25, SHOULDER],
      ]) {
        batch(
          batches,
          panels,
          skin(HULL_RADIUS, min, max, start + edge, SECTOR_ARC - 2 * edge),
        );
      }
      for (const z of [-5.24, -3.46, -1.71, 0.04, 1.81, 3.54, 5.24]) {
        batch(
          batches,
          titanium,
          lathe(
            [
              [HULL_RADIUS - 0.029, z - 0.043],
              [HULL_RADIUS + 0.04, z - 0.038],
              [HULL_RADIUS + 0.047, z + 0.037],
              [HULL_RADIUS - 0.029, z + 0.043],
            ],
            start + 0.019,
            SECTOR_ARC - 0.038,
            12,
          ),
        );
      }
      for (const angle of [start + edge, start + SECTOR_ARC - edge]) {
        pipe(
          batches,
          graphite,
          at(HULL_RADIUS, angle, -5.25),
          at(HULL_RADIUS, angle, 5.25),
          0.051,
        );
        pipe(
          batches,
          titanium,
          at(HULL_RADIUS + 0.035, angle, -5.25),
          at(HULL_RADIUS + 0.035, angle, 5.25),
          0.022,
        );
      }
    } else {
      batch(
        batches,
        panels,
        skin(HULL_RADIUS, -SHOULDER, SHOULDER, start, SECTOR_ARC),
      );
      const serviceRow = sector % 2 === 0 ? mid + 0.15 : mid - 0.15;
      pipe(
        batches,
        graphite,
        at(HULL_RADIUS + 0.019, serviceRow, -5.74),
        at(HULL_RADIUS + 0.019, serviceRow, 5.7),
        0.043,
      );
      for (const z of [-4.65, -2.75, -0.84, 1.12, 3.22, 5.01]) {
        tile(
          batches,
          graphite,
          at(HULL_RADIUS + 0.019, serviceRow, z),
          [0.38, 0.11, 0.52],
          serviceRow,
        );
        tile(
          batches,
          ceramic,
          at(HULL_RADIUS + 0.079, serviceRow + 0.022, z),
          [0.19, 0.044, 0.44],
          serviceRow + 0.022,
        );
        for (let fin = 0; fin < 6; fin++) {
          tile(
            batches,
            heatShield,
            at(HULL_RADIUS + 0.071, serviceRow - 0.027, z + (fin - 2.5) * 0.07),
            [0.109, 0.028, 0.021],
            serviceRow,
          );
        }
      }
    }

    for (const z of [-5.73, -3.92, -1.94, 0.22, 2.36, 4.34, 5.71]) {
      if (hasWindows && Math.abs(z) < 5) continue;
      batch(
        batches,
        titanium,
        lathe(
          [
            [HULL_RADIUS, z - 0.047],
            [HULL_RADIUS + 0.058, z - 0.026],
            [HULL_RADIUS + 0.058, z + 0.024],
            [HULL_RADIUS, z + 0.046],
          ],
          start,
          SECTOR_ARC,
          12,
        ),
      );
    }
    batch(batches, panels, lathe(frontHead, start, SECTOR_ARC, 16));
    batch(batches, panels, lathe(tailHead, start, SECTOR_ARC, 16));
    const throat = SHOULDER + 0.89;
    batch(
      batches,
      titanium,
      lathe(
        [
          [2.61, throat + 0.043],
          [2.55, throat + 0.1],
          [2.48, throat + 0.13],
          [2.41, throat + 0.01],
          [2.43, throat - 0.16],
        ],
        start,
        SECTOR_ARC,
        12,
      ),
    );
    for (const angle of [start + 0.047, mid, start + SECTOR_ARC - 0.045]) {
      tile(
        batches,
        titanium,
        at(3.03, angle, SHOULDER + 0.866),
        [0.07, 0.15, 0.11],
        angle,
      );
      tile(
        batches,
        runningLight,
        at(2.5, angle, throat + 0.109),
        [0.023, 0.06, 0.014],
        angle,
      );
    }

    const arc = SECTOR_ARC / 2;
    batch(
      batches,
      graphite,
      lathe(
        [
          [WHEEL_RADIUS - 0.14, WHEEL_Z - 0.09],
          [WHEEL_RADIUS + 0.1, WHEEL_Z - 0.09],
          [WHEEL_RADIUS + 0.12, WHEEL_Z + 0.1],
          [WHEEL_RADIUS - 0.13, WHEEL_Z + 0.1],
          [WHEEL_RADIUS - 0.14, WHEEL_Z - 0.09],
        ],
        start,
        SECTOR_ARC,
        12,
      ),
    );
    for (let module = 0; module < 2; module++) {
      const angle = start + module * arc;
      const center = angle + arc / 2;
      batch(
        batches,
        ceramic,
        lathe(wheelProfile, angle + 0.016, arc - 0.032, 9),
      );
      batch(
        batches,
        module === sector % 2 ? graphite : heatShield,
        lathe(
          [
            [WHEEL_RADIUS + 0.126, WHEEL_Z + 0.165],
            [WHEEL_RADIUS - 0.111, WHEEL_Z + 0.165],
          ],
          angle + 0.038,
          arc - 0.077,
          9,
        ),
      );
      batch(
        batches,
        graphite,
        lathe(
          [
            [WHEEL_RADIUS + 0.221, WHEEL_Z - 0.056],
            [WHEEL_RADIUS + 0.221, WHEEL_Z + 0.052],
          ],
          angle + 0.043,
          arc - 0.087,
          9,
        ),
      );
      tile(
        batches,
        titanium,
        at(WHEEL_RADIUS, angle, WHEEL_Z + 0.094),
        [0.19, 0.3, 0.124],
        angle,
      );
      tile(
        batches,
        sector % 3 === 0 ? ochre : titanium,
        at(WHEEL_RADIUS + 0.142, center, WHEEL_Z + 0.167),
        [0.28, 0.025, 0.016],
        center,
      );
      tile(
        batches,
        sector % 4 === 0 ? beacon : runningLight,
        at(WHEEL_RADIUS - 0.159, angle + 0.043, WHEEL_Z + 0.159),
        [0.077, 0.022, 0.018],
        angle + 0.043,
      );
      for (const offset of [-0.071, 0.071]) {
        tile(
          batches,
          titanium,
          at(WHEEL_RADIUS + 0.055, center + offset, WHEEL_Z + 0.17),
          [0.038, 0.026, 0.016],
          center + offset,
        );
      }
    }

    if (sector % 4 === 0) {
      for (const offset of [-0.095, 0.095]) {
        pipe(
          batches,
          titanium,
          at(WHEEL_RADIUS - 0.19, mid + offset, WHEEL_Z - 0.12),
          at(2.8, mid + offset * 0.41, SHOULDER + 0.91),
          0.041,
        );
      }
      pipe(
        batches,
        ceramic,
        at(WHEEL_RADIUS - 0.2, mid, WHEEL_Z - 0.07),
        at(3.24, mid, SHOULDER + 0.57),
        0.078,
      );
      pipe(
        batches,
        titanium,
        at(WHEEL_RADIUS - 0.18, mid, WHEEL_Z + 0.031),
        at(0.47, mid, WHEEL_Z + 0.11),
        0.023,
      );
      tile(
        batches,
        graphite,
        at(WHEEL_RADIUS - 0.17, mid, WHEEL_Z - 0.06),
        [0.31, 0.26, 0.23],
        mid,
      );
      tile(
        batches,
        ochre,
        at(3.24, mid, SHOULDER + 0.58),
        [0.16, 0.24, 0.16],
        mid,
      );

      const radial = at(1, mid, 0);
      const tangent = new THREE.Vector3(Math.cos(mid), Math.sin(mid), 0);
      const shape = new THREE.Shape()
        .moveTo(3.44, -5.81)
        .lineTo(4.31, -5.72)
        .lineTo(4.78, -5.19)
        .lineTo(4.69, -3.88)
        .lineTo(3.49, -0.86)
        .closePath();
      const vane = new THREE.ExtrudeGeometry(shape, {
        depth: 0.083,
        bevelEnabled: true,
        bevelSize: 0.032,
        bevelThickness: 0.026,
        bevelSegments: 2,
      })
        .translate(0, 0, -0.0415)
        .applyMatrix4(
          new THREE.Matrix4().makeBasis(
            radial,
            new THREE.Vector3(0, 0, 1),
            tangent.negate(),
          ),
        );
      const radiator = new THREE.Mesh(vane, heatShield);
      radiator.castShadow = radiator.receiveShadow = true;
      wedge.add(radiator);
      pipe(batches, titanium, at(4.65, mid, -3.88), at(3.51, mid, -1), 0.044);
      pipe(
        batches,
        titanium,
        at(4.71, mid, -5.15),
        at(4.65, mid, -3.88),
        0.045,
      );
      pipe(batches, titanium, at(4.31, mid, -5.7), at(4.71, mid, -5.15), 0.044);
      for (let i = 0; i < 23; i++) {
        const z = -5.52 + i * 0.181;
        const end =
          z < -5.15
            ? 4.34 + (z + 5.52) * 0.88
            : Math.min(4.65, 3.55 + (-1.02 - z) * 0.378);
        for (const side of [-1, 1]) {
          const angle = mid + side * 0.017;
          pipe(
            batches,
            i % 5 === 0 ? titanium : graphite,
            at(3.55, angle, z),
            at(end, angle, z),
            i % 5 === 0 ? 0.025 : 0.017,
          );
        }
      }
    }

    if (sector === 4) {
      batch(
        batches,
        marking,
        skin(HULL_RADIUS + 0.013, -2.4, 2.6, mid - 0.12, 0.225),
      );
    }
    finishBatches(batches, wedge);
    group.add(wedge);
    removablePanels.push(wedge);
  }

  const hub = new THREE.Group();
  const assembly: Batches = new Map();
  batch(
    assembly,
    ceramic,
    lathe(
      [
        [0.21, 6.62],
        [0.23, 7.27],
        [0.52, 7.46],
        [0.56, 7.71],
        [0.55, 8.17],
        [0.46, 8.31],
        [0.33, 8.45],
        [0.32, 8.74],
        [0.2, 8.82],
        [0.18, 8.82],
      ],
      0,
      TAU,
      40,
    ),
  );
  for (const [z, r] of [
    [7.48, 0.53],
    [7.69, 0.59],
    [8.16, 0.57],
    [8.72, 0.34],
  ]) {
    batch(
      assembly,
      titanium,
      lathe(
        [
          [r - 0.04, z - 0.06],
          [r, z - 0.03],
          [r, z + 0.03],
          [r - 0.04, z + 0.06],
        ],
        0,
        TAU,
        40,
      ),
    );
  }
  for (let i = 0; i < 8; i++) {
    const theta = (i * TAU) / 8;
    tile(assembly, graphite, at(0.48, theta, 8.05), [0.16, 0.18, 0.34], theta);
    pipe(assembly, titanium, at(0.3, theta, 8.6), at(0.29, theta, 9.09), 0.022);
    tile(
      assembly,
      i % 2 === 0 ? runningLight : ochre,
      at(0.24, theta, 8.83),
      [0.034, 0.034, 0.02],
      theta,
    );
  }
  batch(
    assembly,
    graphite,
    lathe(
      [
        [0.22, -6.87],
        [0.69, -6.84],
        [0.91, -6.67],
        [0.86, -6.42],
      ],
      0,
      TAU,
      48,
    ),
  );
  for (let i = 0; i < 6; i++) {
    const theta = (i * TAU) / 6;
    pipe(
      assembly,
      graphite,
      at(1.21, theta, -6.56),
      at(1.21, theta, -7.05),
      0.205,
    );
    pipe(
      assembly,
      titanium,
      at(1.21, theta, -6.95),
      at(1.21, theta, -7.07),
      0.213,
    );
    pipe(
      assembly,
      heatShield,
      at(1.21, theta, -7.075),
      at(1.21, theta, -7.09),
      0.139,
    );
  }
  finishBatches(assembly, hub);
  group.add(hub);

  // This corridor passes between two of the rotating wheel's support cables.
  const lane = SECTOR_ARC * 2.5;
  const entryPath = {
    approach: at(1.38, lane, WHEEL_Z + 2.65),
    wheel: at(1.38, lane, WHEEL_Z - 0.19),
    interior: at(1.38, lane, SHOULDER - 0.54),
  };
  return { group, removablePanels, entryPath };
}
