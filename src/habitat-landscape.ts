import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  canvasTexture,
  instances,
  seededRandom,
  type Detail,
} from "./environment";
import {
  cityCoordinates,
  citySurface,
  CITY_HALF_LENGTH,
  CITY_HALF_WIDTH,
  HALF_LENGTH,
  RADIUS,
  TAU,
  terrainPoint,
  terrainHeight,
  surfaceAngle,
  riverCenter,
  riverWidth,
  WATER_LEVEL,
} from "./habitat-surface";

function noiseField(columns: number, rows: number, seed: number) {
  const random = seededRandom(seed);
  const values = Float32Array.from({ length: columns * (rows + 1) }, random);
  return (u: number, v: number) => {
    const x = u * columns;
    const y = v * rows;
    const column = Math.floor(x) % columns;
    const row = Math.min(Math.floor(y), rows - 1);
    const nextColumn = (column + 1) % columns;
    const fx = x - Math.floor(x);
    const fy = y - row;
    const tx = fx * fx * (3 - 2 * fx);
    const ty = fy * fy * (3 - 2 * fy);
    const top = THREE.MathUtils.lerp(
      values[row * columns + column],
      values[row * columns + nextColumn],
      tx,
    );
    const bottom = THREE.MathUtils.lerp(
      values[(row + 1) * columns + column],
      values[(row + 1) * columns + nextColumn],
      tx,
    );
    return THREE.MathUtils.lerp(top, bottom, ty);
  };
}

const woodland = noiseField(31, 21, 522);
const erosion = noiseField(107, 75, 233);

function forestCover(woodlandNoise: number, height: number) {
  return THREE.MathUtils.smoothstep(woodlandNoise + height * 1.37, 0.68, 1.18);
}

function landTexture() {
  return canvasTexture(2048, 1536, (context) => {
    const { width, height } = context.canvas;
    const random = seededRandom(319);
    const cityAxis = citySurface(0, 0).u;
    const image = context.createImageData(width, height);
    const columns = Array.from({ length: width }, (_, x) => {
      const u = x / width;
      return {
        u,
        cropBend: 0.007 * Math.sin(u * TAU * 6),
        crossingV: 0.379 + 0.011 * Math.sin(u * 32),
      };
    });
    const fieldColors = [
      [105, 116, 60],
      [111, 129, 66],
      [129, 125, 77],
      [142, 131, 80],
      [122, 113, 74],
      [85, 113, 66],
      [114, 127, 82],
      [153, 141, 91],
    ];

    for (let y = 0; y < height; y++) {
      const v = 1 - y / (height - 1);
      const river = riverCenter(v);
      const widthAtBank = riverWidth(v);
      const cropBend = 0.012 * Math.sin(v * 18);
      const laneU = 0.412 + 0.009 * Math.sin(v * 13);
      for (let x = 0; x < width; x++) {
        const column = columns[x];
        const { u } = column;
        const elevation = terrainHeight(u, v);
        const bank = Math.abs(u - river) / widthAtBank;
        const wood = woodland(u, v);
        const cover = forestCover(wood, elevation);
        const grain = erosion(u, v);
        const warp = wood - 0.5;
        const fieldX = (u + cropBend + warp * 0.009) * 108;
        const fieldY = (v + column.cropBend + warp * 0.014) * 62;
        const col = Math.floor(fieldX);
        const row = Math.floor(fieldY);
        const parcel =
          (Math.imul(col, 73856093) ^ Math.imul(row, 19349663)) >>> 0;
        const edge = Math.min(
          fieldX - col,
          col + 1 - fieldX,
          fieldY - row,
          row + 1 - fieldY,
        );
        const farm =
          elevation < 0.15 + warp * 0.12 && bank > 1.5 && cover < 0.52;
        const crops = fieldColors[(parcel >>> 3) % fieldColors.length];
        const furrows = farm
          ? Math.cos((parcel % 3 === 0 ? fieldX : fieldY) * TAU * 12) * 1.9
          : 0;
        const blend = farm
          ? 0.87 * THREE.MathUtils.smoothstep(edge, 0.01, 0.071)
          : 0;
        const grainLight = (grain - 0.44) * (cover > 0.4 ? 22 : 13);
        const mottling = grainLight + (random() - 0.5) * 10;
        let red =
          THREE.MathUtils.lerp(89 - cover * 48, crops[0] + furrows, blend) +
          mottling;
        let green =
          THREE.MathUtils.lerp(109 - cover * 42, crops[1] + furrows, blend) +
          mottling;
        let blue =
          THREE.MathUtils.lerp(67 - cover * 27, crops[2] + furrows, blend) +
          mottling;
        if (bank < 1.63) {
          const silt = 1 - THREE.MathUtils.smoothstep(bank, 1.04, 1.63);
          red = THREE.MathUtils.lerp(red, 118 + grainLight, silt);
          green = THREE.MathUtils.lerp(green, 111 + grainLight, silt);
          blue = THREE.MathUtils.lerp(blue, 80 + grainLight, silt);
        }
        const lane = Math.abs(u - laneU) < 0.00085;
        const cityApproach = Math.abs(u - cityAxis) < 0.0025 && v > 0.59;
        const crossing = Math.abs(v - column.crossingV) < 0.0011;
        if (lane || cityApproach || (crossing && u > 0.39 && u < 0.68)) {
          red = 113 + mottling;
          green = 109 + mottling;
          blue = 96 + mottling;
        }
        const i = (y * width + x) * 4;
        image.data[i] = red;
        image.data[i + 1] = green;
        image.data[i + 2] = blue;
        image.data[i + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  });
}

function makeTerrain() {
  const longitude = 288;
  const latitude = 192;
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
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const texture = landTexture();
  texture.wrapS = THREE.RepeatWrapping;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.93,
    emissiveMap: texture,
    emissive: 0xc0d4c2,
    emissiveIntensity: 0.17,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec2 grainUV = vMapUv * vec2(4100.0, 3200.0);
      float footprint = max(fwidth(grainUV.x), fwidth(grainUV.y));
      float micro = sin(grainUV.x + sin(grainUV.y * 0.78) * 3.0)
        * cos(grainUV.y * 1.91 - grainUV.x * 0.37);
      diffuseColor.rgb *= 1.0 + micro * 0.14 * (1.0 - smoothstep(0.36, 1.3, footprint));`,
    );
  };
  return new THREE.Mesh(geometry, material);
}

function makeRiver() {
  const along = 220;
  const across = 14;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= along; row++) {
    const v = row / along;
    const center = riverCenter(v);
    const width = riverWidth(v) * 1.38;
    for (let column = 0; column <= across; column++) {
      const s = column / across;
      const angle = surfaceAngle(center + (s * 2 - 1) * width);
      const radius = RADIUS - WATER_LEVEL;
      positions.push(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        (v * 2 - 1) * HALF_LENGTH,
      );
      uvs.push(s, v);
      if (column === across || row === along) continue;
      const i = row * (across + 1) + column;
      const next = i + across + 1;
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
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x31595b,
    metalness: 0.14,
    roughness: 0.27,
    clearcoat: 0.72,
    clearcoatRoughness: 0.24,
    emissive: 0x243e3d,
    emissiveIntensity: 0.28,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `varying vec2 waterUv;\n${shader.vertexShader}`.replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nwaterUv = uv;",
      );
    shader.fragmentShader = `varying vec2 waterUv;\n${shader.fragmentShader}`
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 ripples = waterUv * vec2(33.0, 1710.0);
        float rippleFade = 1.0 - smoothstep(0.32, 1.9, max(fwidth(ripples.x), fwidth(ripples.y)));
        float wave = sin(ripples.y + ripples.x * 2.0 + 3.1 * sin(ripples.x * 0.39 + ripples.y * 0.031));
        float chop = sin(ripples.y * 1.4 - ripples.x * 1.7) * cos(ripples.x + ripples.y * 0.17);
        float shore = smoothstep(0.48, 0.76, abs(waterUv.x * 2.0 - 1.0) + 0.029 * sin(waterUv.y * 346.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.21, 0.19), shore * 0.82);
        diffuseColor.rgb *= 1.0 + rippleFade * (0.13 * wave + 0.08 * chop);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec3 waterRight = normalize(dFdx(vViewPosition));
        vec3 waterUp = normalize(dFdy(vViewPosition));
        normal = normalize(normal + rippleFade * (waterRight * wave + waterUp * chop) * 0.11);`,
      );
  };
  return new THREE.Mesh(geometry, material);
}

function landscapeDetails() {
  const random = seededRandom(12218);
  const group = new THREE.Group();
  const sectors = 8;
  const sections = 3;
  const groves = Array.from({ length: sectors * sections }, () => ({
    trees: new Array<Detail>(),
    trunks: new Array<Detail>(),
  }));
  const walls: Detail[] = [];
  const roofs: Detail[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const align = (u: number) => {
    const angle = surfaceAngle(u);
    return new THREE.Quaternion().setFromUnitVectors(
      up,
      new THREE.Vector3(-Math.cos(angle), -Math.sin(angle), 0),
    );
  };

  for (let i = 0; i < 12100; i++) {
    const nearCity = i < 1300;
    const u = nearCity ? 0.35 + random() * 0.23 : random();
    const v = nearCity ? 0.49 + random() * 0.495 : random() * 0.99 + 0.005;
    const { x, z } = cityCoordinates(u, v);
    if (Math.abs(x) < CITY_HALF_WIDTH && Math.abs(z) < CITY_HALF_LENGTH)
      continue;
    if (Math.abs(x) < 0.061 && v > 0.57) continue;
    const cover = forestCover(woodland(u, v), terrainHeight(u, v));
    if (
      Math.abs(u - riverCenter(v)) < riverWidth(v) * 1.3 ||
      random() > 0.048 + cover ** 1.32 * 0.9
    )
      continue;
    const h = 0.009 + random() ** 1.6 * 0.029;
    const w = h * (0.48 + random() * 0.54);
    const rotation = align(u);
    const { trees, trunks } =
      groves[Math.floor(v * sections) * sectors + Math.floor(u * sectors)];
    trunks.push({
      position: terrainPoint(u, v, h * 0.32),
      rotation,
      scale: new THREE.Vector3(h * 0.049, h * 0.65, h * 0.047),
      color: new THREE.Color(0x555144),
    });
    trees.push({
      position: terrainPoint(u, v, h * 0.71),
      rotation: rotation
        .clone()
        .multiply(new THREE.Quaternion().setFromAxisAngle(up, random() * TAU)),
      scale: new THREE.Vector3(w, h, w),
      color: new THREE.Color().setHSL(
        0.195 + random() * 0.11,
        0.24 + random() * 0.22,
        0.094 + random() * 0.09,
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
        const { x, z } = cityCoordinates(u, v);
        if (Math.abs(x) < CITY_HALF_WIDTH && Math.abs(z) < CITY_HALF_LENGTH)
          continue;
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
          color: new THREE.Color().setHSL(
            0.095 + random() * 0.1,
            0.15,
            0.49 + random() * 0.31,
          ),
        });
        roofs.push({
          position: terrainPoint(u, v, scale.y),
          rotation,
          scale: new THREE.Vector3(
            scale.x * 1.09,
            scale.x * 0.29,
            scale.z * 1.09,
          ),
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
    new THREE.SphereGeometry(0.45, 6, 3)
      .scale(0.95, 0.8, 0.9)
      .translate(-0.12, -0.08, 0.08),
    new THREE.SphereGeometry(0.39, 6, 3)
      .scale(0.96, 0.86, 1)
      .translate(0.21, 0.025, 0.02),
    new THREE.SphereGeometry(0.37, 6, 3)
      .scale(0.94, 0.93, 1)
      .translate(0.05, 0.16, -0.15),
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
  const trunkGeometry = new THREE.CylinderGeometry(0.53, 1, 1, 5);
  const trunkMaterial = new THREE.MeshStandardMaterial({ roughness: 0.91 });
  const canopyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.95 });
  const distantCanopy = new THREE.IcosahedronGeometry(0.59, 0).scale(
    1,
    0.83,
    0.95,
  );
  for (const [index, { trees, trunks }] of groves.entries()) {
    if (!trees.length) continue;
    const grove = new THREE.LOD();
    grove.position.copy(
      terrainPoint(
        ((index % sectors) + 0.5) / sectors,
        (Math.floor(index / sectors) + 0.5) / sections,
      ),
    );
    const close = new THREE.Group();
    close.position.copy(grove.position).negate();
    close.add(
      instances(treeGeometry, canopyMaterial, trees),
      instances(trunkGeometry, trunkMaterial, trunks),
    );
    const distant = instances(distantCanopy, canopyMaterial, trees);
    distant.position.copy(close.position);
    grove.addLevel(close, 0);
    grove.addLevel(distant, 2.7, 0.1);
    group.add(grove);
  }
  group.add(
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
    instances(
      roofGeometry,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }),
      roofs,
    ),
  );
  return group;
}

export function makeHabitatLandscape() {
  const landscape = new THREE.Group();
  landscape.add(makeTerrain(), landscapeDetails(), makeRiver());
  return landscape;
}
