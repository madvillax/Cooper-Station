import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { canvasTexture, seededRandom } from "./environment";
import { RIM_RADIUS_METERS } from "./physics";

export const RADIUS = RIM_RADIUS_METERS / 1000;
export const HALF_LENGTH = 6.1;
export const TAU = Math.PI * 2;
const HULL_RADIUS = 3.53;
const ANGLE_OFFSET = -Math.PI * 1.5;

function riverCenter(v: number) {
  return 0.53 + Math.sin(v * 10 + 0.3) * 0.029 + Math.sin(v * 20 - 1.9) * 0.014;
}

export function terrainHeight(u: number, v: number) {
  const hills = (Math.sin(u * TAU * 3 + 1.2) * 0.5 + 0.5) ** 3;
  const rolling = Math.sin(v * 19 - u * TAU * 4) * Math.sin(v * 13 + u * TAU * 5);
  const bank = Math.min(Math.abs(u - riverCenter(v)) * 30, 1);
  return (
    (0.03 + hills * (0.29 + rolling * 0.17)) * bank + 0.022 * Math.sin(u * TAU * 14 + v * 29) * bank
  );
}

export function terrainPoint(u: number, v: number, height = 0) {
  const angle = u * TAU + ANGLE_OFFSET;
  const r = RADIUS - terrainHeight(u, v) - height;
  return new THREE.Vector3(Math.cos(angle) * r, Math.sin(angle) * r, (v * 2 - 1) * HALF_LENGTH);
}

function landTexture() {
  return canvasTexture(2048, 1536, (context) => {
    const { width, height } = context.canvas;
    const random = seededRandom(319);
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) {
      const v = 1 - y / height;
      const river = riverCenter(v);
      const width = 0.01 + 0.003 * Math.sin(v * 23);
      for (let x = 0; x < context.canvas.width; x++) {
        const u = x / context.canvas.width;
        const hill = terrainHeight(u, v);
        const shore = Math.abs(u - river);
        const gridU = (u + 0.011 * Math.sin(v * 12)) * 63;
        const gridV = (v + 0.006 * Math.sin(u * TAU * 5)) * 46;
        const parcel = Math.sin(Math.floor(gridU) * 54.59 + Math.floor(gridV) * 12.2);
        const rows = Math.sin((parcel > 0.4 ? gridU : gridV) * 63) * 3;
        const woodland = Math.sin(u * 49 + v * 21) * Math.sin(v * 28 - u * 61);
        const field = shore > width + 0.002 && hill + woodland * 0.09 < 0.18 + parcel * 0.075;
        const track = field && (gridU % 1 < 0.027 || gridV % 1 < 0.022);
        const noise = random() * 17 - 8;
        const lane = Math.abs(u - (0.467 + 0.012 * Math.sin(v * 10))) < 0.00135;
        const cross = Math.abs(v - 0.32) < 0.0025 || Math.abs(v - 0.72) < 0.0025;
        const variation = Math.sin(u * 170 + Math.sin(v * 55) * 5) * Math.cos(v * 182 - u * 104);
        const value = noise + (field ? parcel * 6 + rows : variation * 12);
        const shade = Math.cos(u * TAU * 3 + 1.2) * hill * 0.13;
        let red = field ? 109 + parcel * 35 : 49 + hill * 39;
        let green = field ? 116 + parcel * 15 : 74 + hill * 55;
        let blue = field ? 65 + parcel * 14 : 50 + hill * 41;
        if (track) {
          red += 22;
          green += 17;
          blue += 12;
        }
        if (shore < width) {
          red = 40 + (shore / width) ** 5 * 15;
          green = 90 + (shore / width) ** 5 * 18;
          blue = 104 + (shore / width) ** 5 * 9;
        } else if (shore < width + 0.0018) {
          red = 143;
          green = 132;
          blue = 91;
        }
        if (lane || (cross && u > 0.42 && u < 0.64)) {
          red = 153;
          green = 144;
          blue = 117;
        }
        const index = (y * context.canvas.width + x) * 4;
        const relief = shore > width ? shade * 240 : 0;
        image.data[index] = red + value + relief;
        image.data[index + 1] = green + value + relief;
        image.data[index + 2] = blue + value + relief;
        image.data[index + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  });
}

function makeTerrain() {
  const longitude = 240;
  const latitude = 160;
  const positions = [];
  const uvs = [];
  const indices = [];
  for (let j = 0; j <= latitude; j++) {
    const v = j / latitude;
    for (let i = 0; i <= longitude; i++) {
      const u = i / longitude;
      const point = terrainPoint(u, v);
      positions.push(point.x, point.y, point.z);
      uvs.push(u, v);
      const index = j * (longitude + 1) + i;
      if (i < longitude && j < latitude) {
        const next = index + longitude + 1;
        indices.push(index, next, index + 1, next, next + 1, index + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const texture = landTexture();
  texture.wrapS = THREE.RepeatWrapping;
  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.88,
      emissiveMap: texture,
      emissive: 0xbfc6a2,
      emissiveIntensity: 0.58,
    }),
  );
}

type Detail = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  color: THREE.Color;
};

function instances(geometry: THREE.BufferGeometry, material: THREE.Material, details: Detail[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, details.length);
  const matrix = new THREE.Matrix4();
  details.forEach((detail, index) => {
    matrix.compose(detail.position, detail.rotation, detail.scale);
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, detail.color);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

function landscapeDetails() {
  const random = seededRandom(12218);
  const group = new THREE.Group();
  const trees: Detail[] = [];
  const walls: Detail[] = [];
  const roofs: Detail[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const align = (u: number) => {
    const angle = u * TAU + ANGLE_OFFSET;
    return new THREE.Quaternion().setFromUnitVectors(
      up,
      new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), 0),
    );
  };

  for (let i = 0; i < 6600; i++) {
    const u = random();
    const v = random() * 0.99 + 0.005;
    const bank = Math.abs(u - riverCenter(v));
    if (bank < 0.016 || (terrainHeight(u, v) < 0.15 && random() > 0.17)) continue;
    const h = 0.012 + random() ** 2 * 0.041;
    const w = h * (0.48 + random() * 0.42);
    trees.push({
      position: terrainPoint(u, v, h * 0.44),
      rotation: align(u),
      scale: new THREE.Vector3(w, h, w),
      color: new THREE.Color().setHSL(
        0.22 + random() * 0.12,
        0.23 + random() * 0.27,
        0.21 + random() * 0.14,
      ),
    });
  }

  for (const [centerU, centerV, size] of [
    [0.47, 0.69, 9],
    [0.59, 0.33, 7],
    [0.435, 0.52, 6],
    [0.2, 0.59, 9],
    [0.82, 0.54, 8],
    [0.52, 0.87, 6],
  ]) {
    for (let row = -size; row <= size; row++) {
      for (let col = -size; col <= size; col++) {
        if (random() < 0.25 || row === 0 || col === 0) continue;
        const u = centerU + (col + random() * 0.45) * 0.002;
        const v = centerV + (row + random() * 0.45) * 0.0033;
        if (Math.abs(u - riverCenter(v)) < 0.014) continue;
        const scale = new THREE.Vector3(
          0.013 + random() * 0.021,
          0.012 + random() ** 3 * 0.063,
          0.015 + random() * 0.022,
        );
        const rotation = align(u);
        walls.push({
          position: terrainPoint(u, v, scale.y * 0.48),
          rotation,
          scale,
          color: new THREE.Color().setHSL(0.095 + random() * 0.1, 0.15, 0.49 + random() * 0.31),
        });
        roofs.push({
          position: terrainPoint(u, v, scale.y),
          rotation,
          scale: new THREE.Vector3(scale.x * 1.09, scale.x * 0.29, scale.z * 1.09),
          color: new THREE.Color().setHSL(
            0.025 + random() * 0.11,
            0.18 + random() * 0.22,
            0.27 + random() * 0.32,
          ),
        });
      }
    }
  }

  const treeGeometry = mergeGeometries([
    new THREE.CylinderGeometry(0.06, 0.095, 0.5, 5).translate(0, -0.23, 0),
    new THREE.ConeGeometry(0.52, 0.71, 6).translate(0, 0, 0),
    new THREE.ConeGeometry(0.38, 0.64, 6).rotateY(Math.PI / 6).translate(0, 0.22, 0),
  ]);
  const gable = new THREE.Shape()
    .moveTo(-0.5, -0.12)
    .lineTo(0, 0.82)
    .lineTo(0.5, -0.12)
    .closePath();
  const roofGeometry = new THREE.ExtrudeGeometry(gable, {
    depth: 1,
    bevelEnabled: false,
  }).translate(0, 0, -0.5);
  const facade = canvasTexture(128, 128, (context) => {
    context.fillStyle = "#f2e6d4";
    context.fillRect(0, 0, 128, 128);
    context.fillStyle = "#b9b0a3";
    context.fillRect(0, 0, 128, 8);
    context.fillRect(0, 118, 128, 10);
    context.fillStyle = "#536777";
    for (const y of [29, 72]) {
      for (const x of [20, 52, 84]) {
        context.fillRect(x, y, 19, 20);
      }
    }
    context.fillStyle = "#899ca4";
    for (const x of [21, 53, 85]) {
      context.fillRect(x, 30, 17, 4);
      context.fillRect(x, 73, 17, 4);
    }
  });
  group.add(
    instances(treeGeometry, new THREE.MeshStandardMaterial({ roughness: 0.95 }), trees),
    instances(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({
        roughness: 0.9,
        map: facade,
        emissive: 0x3d382a,
        emissiveIntensity: 0.32,
      }),
      walls,
    ),
    instances(roofGeometry, new THREE.MeshStandardMaterial({ roughness: 0.9 }), roofs),
  );
  return group;
}

function hullTexture() {
  return canvasTexture(768, 1536, (context) => {
    const random = seededRandom(943);
    context.fillStyle = "#646c73";
    context.fillRect(0, 0, 768, 1536);
    for (let row = 0; row < 30; row++) {
      for (let column = 0; column < 12; column++) {
        const x = column * 64;
        const y = row * 51.2;
        const value = Math.floor(100 + random() * 25 + (row % 6 === 0 ? 17 : 0));
        context.fillStyle = `rgb(${value - 4}, ${value}, ${value + 4})`;
        context.fillRect(x + 1, y + 1, 62, 49);
        context.fillStyle = "#c2c6c4";
        context.fillRect(x + 1, y + 1, 1, 47);
        context.fillRect(x + 1, y + 1, 61, 1);
        if (random() > 0.68) {
          context.fillStyle = "#384149";
          context.fillRect(x + 7, y + 7, 18 + random() * 26, 2);
          context.fillRect(x + 7, y + 11, 12, 2);
        }
        if (random() > 0.91) {
          context.fillStyle = "#ad835c";
          context.fillRect(x + 49, y + 10, 7, 24);
        }
      }
    }
    for (let i = 0; i < 15000; i++) {
      context.fillStyle = random() > 0.5 ? "#e2d6c51a" : "#20272b38";
      context.fillRect(random() * 768, random() * 1536, 1, 1 + random() * 3);
    }
  });
}

export function createStation() {
  const shell = new THREE.Group();
  const removablePanels: THREE.Group[] = [];
  const structure = new THREE.Group();
  const spin = new THREE.Group();
  const landscape = new THREE.Group();
  landscape.add(makeTerrain(), landscapeDetails());
  spin.add(shell, structure, landscape);
  const root = new THREE.Group();
  root.add(spin);
  root.rotation.set(-0.16, -0.73, -0.12);

  const panels = new THREE.MeshStandardMaterial({
    map: hullTexture(),
    roughness: 0.48,
    metalness: 0.3,
    emissive: 0x252f35,
    emissiveIntensity: 0.14,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x909b9d,
    roughness: 0.43,
    metalness: 0.43,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x394651,
    roughness: 0.53,
    metalness: 0.43,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xab7854,
    roughness: 0.48,
    metalness: 0.33,
    emissive: 0x493017,
    emissiveIntensity: 0.25,
  });
  const light = new THREE.MeshBasicMaterial({ color: 0xffc48c });

  const tube = (radius: number, thickness: number, material: THREE.Material, z: number) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, thickness, 8, 120), material);
    ring.position.z = z;
    structure.add(ring);
  };

  for (let i = 0; i < 12; i++) {
    const angle = (i * TAU) / 12;
    const wedge = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.CylinderGeometry(
        HULL_RADIUS,
        HULL_RADIUS,
        HALF_LENGTH * 2,
        12,
        1,
        true,
        angle,
        TAU / 12 - 0.005,
      ),
      panels,
    );
    hull.rotation.x = Math.PI / 2;
    wedge.add(hull);
    const theta = angle;
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.145, 0.12, 12.1),
      i % 3 === 0 ? brass : steel,
    );
    rib.position.set(HULL_RADIUS * Math.sin(angle), -HULL_RADIUS * Math.cos(angle), 0);
    rib.rotation.z = theta;
    wedge.add(rib);
    const lamps: Detail[] = [];
    for (let j = 0; j < 14; j++) {
      lamps.push({
        position: new THREE.Vector3(
          (HULL_RADIUS + 0.07) * Math.sin(angle + 0.012),
          -(HULL_RADIUS + 0.07) * Math.cos(angle + 0.012),
          (j - 6.5) * 0.8,
        ),
        rotation: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta),
        scale: new THREE.Vector3(0.026, 0.018, 0.064),
        color: new THREE.Color(0xffffff),
      });
    }
    wedge.add(instances(new THREE.BoxGeometry(1, 1, 1), light, lamps));
    shell.add(wedge);
    removablePanels.push(wedge);
  }

  for (const z of [-6.16, -5.88, -4.06, -2.03, 0, 2.03, 4.06, 5.88, 6.16]) {
    const rim = Math.abs(z) > 5.8;
    tube(rim ? 3.56 : 3.51, rim ? 0.104 : 0.042, rim ? steel : dark, z);
    if (rim) {
      tube(3.42, 0.038, brass, z + 0.022);
      tube(3.2, 0.028, steel, z + 0.049);
    }
  }

  const bulkhead = new THREE.MeshStandardMaterial({
    color: 0x67757a,
    map: panels.map,
    emissive: 0x607882,
    emissiveIntensity: 0.24,
    roughness: 0.76,
    metalness: 0.31,
    side: THREE.DoubleSide,
  });
  const braces: Detail[] = [];
  for (const radius of [0.82, 1.16, 1.58, 2.06, 2.57, 2.92]) {
    tube(radius, radius === 2.57 ? 0.062 : 0.026, radius === 1.16 ? brass : dark, -6.03);
  }
  const radial: Detail[] = [];
  const lamps: Detail[] = [];
  const axis = new THREE.Vector3(0, 0, 1);
  for (const end of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.RingGeometry(end > 0 ? 3.02 : 0.58, 3.54, 120), bulkhead);
    cap.position.z = end * 6.11;
    structure.add(cap);
    tube(end > 0 ? 3.04 : 0.62, 0.05, brass, end * 6.14);
    for (let i = 0; i < 72; i++) {
      const angle = (i * TAU) / 72;
      const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
      if (end < 0 && i % 6 === 0) {
        braces.push({
          position: new THREE.Vector3(Math.cos(angle) * 1.91, Math.sin(angle) * 1.91, -6.025),
          rotation,
          scale: new THREE.Vector3(2.22, 0.095, 0.13),
          color: new THREE.Color(i % 12 === 0 ? 0xb5ac9c : 0x849698),
        });
      }
      if (end < 0 && i % 2 === 0) {
        lamps.push({
          position: new THREE.Vector3(Math.cos(angle) * 2.54, Math.sin(angle) * 2.54, -5.98),
          rotation,
          scale: new THREE.Vector3(0.035, 0.068, 0.021),
          color: new THREE.Color(i % 6 === 0 ? 0xffbb87 : 0x8db7ca),
        });
      }
      const radius = i % 6 === 0 ? 3.39 : 3.51;
      radial.push({
        position: new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, end * 6.16),
        rotation,
        scale: new THREE.Vector3(i % 6 === 0 ? 0.48 : 0.18, i % 6 === 0 ? 0.105 : 0.035, 0.1),
        color: new THREE.Color(i % 6 === 0 ? 0xccbfab : 0x7d838b),
      });
      if (i % 3 === 0) {
        lamps.push({
          position: new THREE.Vector3(Math.cos(angle) * 3.15, Math.sin(angle) * 3.15, end * 6.19),
          rotation,
          scale: new THREE.Vector3(0.025, 0.071, 0.022),
          color: new THREE.Color(i % 2 === 0 ? 0xffba85 : 0xffe2b8),
        });
      }
    }
  }
  structure.add(
    instances(new THREE.BoxGeometry(1, 1, 1), steel, [...radial, ...braces]),
    instances(new THREE.BoxGeometry(1, 1, 1), light, lamps),
  );

  const sunline = new THREE.Mesh(
    new THREE.CylinderGeometry(0.036, 0.036, HALF_LENGTH * 1.92, 12),
    new THREE.MeshBasicMaterial({ color: 0xffebc6, toneMapped: false }),
  );
  sunline.rotation.x = Math.PI / 2;
  spin.add(sunline);
  const glowMap = canvasTexture(128, 128, (context) => {
    const glow = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    glow.addColorStop(0, "#ffe4b8");
    glow.addColorStop(0.08, "#ffbd766d");
    glow.addColorStop(0.3, "#ffa75732");
    glow.addColorStop(1, "#ffa75700");
    context.fillStyle = glow;
    context.fillRect(0, 0, 128, 128);
  });
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowMap,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    }),
  );
  glow.scale.setScalar(1.55);
  glow.position.z = -5.84;
  spin.add(glow);
  for (const z of [-4.9, -2.45, 0, 2.45, 4.9]) {
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.018, 6, 16), brass);
    collar.position.z = z;
    spin.add(collar);
  }

  return { root, spin, removablePanels, landscape };
}
