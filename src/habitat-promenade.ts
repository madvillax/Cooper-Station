import * as THREE from "three";
import {
  canvasTexture,
  instances,
  seededRandom,
  type Detail,
} from "./environment";
import {
  CITY_DECK,
  CITY_LANDING,
  cityPoint,
  cityRotation,
  type CityFootprint,
} from "./habitat-surface";

type Batch = {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  details: Detail[];
};

function leafSpray(leaves = 114) {
  const random = seededRandom(6272);
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const center = new THREE.Vector3();
  const stem = new THREE.Vector3();
  const side = new THREE.Vector3();
  const curl = new THREE.Vector3();
  const tip = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  for (let leaf = 0; leaf < leaves; leaf++) {
    center
      .set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1)
      .normalize()
      .multiplyScalar(Math.cbrt(random()) * 0.92);
    const length = 0.13 + random() * 0.19;
    stem
      .set(
        center.x + random() - 0.5,
        random() * 0.8 - 0.2,
        center.z + random() - 0.5,
      )
      .normalize()
      .multiplyScalar(length);
    side
      .crossVectors(stem, up)
      .normalize()
      .multiplyScalar(length * (0.25 + random() * 0.16));
    curl
      .crossVectors(side, stem)
      .normalize()
      .multiplyScalar(length * 0.115);
    tip.copy(center).addScaledVector(stem, 0.5);
    const points = [
      center,
      tip.clone().add(side),
      center.clone().add(stem),
      tip.clone().sub(side),
      tip.clone().add(curl),
    ];
    const start = positions.length / 3;
    const tint = 0.55 + random() * 0.45;
    for (const point of points) {
      positions.push(point.x, point.y, point.z);
      colors.push(
        tint,
        tint * (0.91 + random() * 0.085),
        tint * (0.77 + random() * 0.2),
      );
    }
    indices.push(
      start,
      start + 1,
      start + 4,
      start + 1,
      start + 2,
      start + 4,
      start + 2,
      start + 3,
      start + 4,
      start + 3,
      start,
      start + 4,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function makePromenade() {
  const group = new THREE.Group();
  const blockers: CityFootprint[] = [];
  const random = seededRandom(42568);
  const box = new THREE.BoxGeometry();
  const cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  const surface = new THREE.MeshStandardMaterial({ roughness: 0.81 });
  const metal = new THREE.MeshStandardMaterial({
    roughness: 0.47,
    metalness: 0.56,
  });
  const wood = new THREE.MeshStandardMaterial({ roughness: 0.86 });
  const bark = canvasTexture(96, 128, (ctx) => {
    const grain = seededRandom(1746);
    ctx.fillStyle = "#aea498";
    ctx.fillRect(0, 0, 96, 128);
    for (let i = 0; i < 360; i++) {
      ctx.fillStyle = i % 3 === 0 ? "#594c4266" : "#6c685c38";
      ctx.fillRect(
        grain() * 96,
        grain() * 128,
        0.5 + grain() * 2,
        4 + grain() * 27,
      );
    }
  });
  const barkMaterial = new THREE.MeshStandardMaterial({
    map: bark,
    bumpMap: bark,
    bumpScale: 0.004,
    roughness: 0.92,
  });
  const foliage = new THREE.MeshStandardMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.79,
    emissive: 0x20391b,
    emissiveIntensity: 0.19,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.2,
    metalness: 0.22,
    clearcoat: 0.5,
  });
  const lamps = new THREE.MeshBasicMaterial({ toneMapped: false });
  const contact = canvasTexture(64, 64, (ctx) => {
    const shade = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
    shade.addColorStop(0, "#141c19b3");
    shade.addColorStop(0.5, "#141c1966");
    shade.addColorStop(1, "#141c1900");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 64, 64);
  });
  const batches: Record<string, Batch> = {
    walls: { geometry: box, material: surface, details: [] },
    ironwork: { geometry: box, material: metal, details: [] },
    timber: { geometry: box, material: wood, details: [] },
    poles: { geometry: cylinder, material: metal, details: [] },
    trunks: {
      geometry: new THREE.CylinderGeometry(0.29, 0.55, 1, 8),
      material: barkMaterial,
      details: [],
    },
    crowns: { geometry: leafSpray(), material: foliage, details: [] },
    panes: { geometry: box, material: glass, details: [] },
    light: { geometry: box, material: lamps, details: [] },
    shade: {
      geometry: new THREE.PlaneGeometry().rotateX(-Math.PI / 2),
      material: new THREE.MeshBasicMaterial({
        map: contact,
        transparent: true,
        depthWrite: false,
      }),
      details: [],
    },
  };
  const up = new THREE.Vector3(0, 1, 0);
  const yawRotation = new THREE.Quaternion();
  const distantTrees: Detail[] = [];

  function part(
    batch: Batch,
    x: number,
    z: number,
    bottom: number,
    [w, h, d]: readonly [number, number, number],
    color: number | THREE.Color,
    yaw = 0,
  ) {
    batch.details.push({
      position: cityPoint(x, z, CITY_DECK + bottom + h / 2),
      rotation: cityRotation(x).multiply(yawRotation.setFromAxisAngle(up, yaw)),
      scale: new THREE.Vector3(w, h, d),
      color: new THREE.Color(color),
    });
  }

  function tree(x: number, z: number, scale: number) {
    part(
      batches.shade,
      x,
      z,
      0.000045,
      [scale * 0.78, 1e-6, scale * 0.74],
      0xffffff,
    );
    part(
      batches.trunks,
      x,
      z,
      0.0003,
      [scale * 0.077, scale * 0.67, scale * 0.072],
      0x716253,
    );
    distantTrees.push({
      position: cityPoint(x, z, CITY_DECK + scale * 0.64),
      rotation: cityRotation(x),
      scale: new THREE.Vector3(scale * 0.42, scale * 0.37, scale * 0.36),
      color: new THREE.Color(0x5a7747),
    });
    const branch = new THREE.Vector3();
    const turn = random() * Math.PI * 2;
    for (let i = 0; i < 19; i++) {
      const angle = turn + i * 2.4;
      const level = 0.46 + i * 0.026;
      const offset =
        Math.sin((level - 0.24) * Math.PI) * (0.18 + random() * 0.19);
      const cx = x + Math.cos(angle) * scale * offset;
      const cz = z + Math.sin(angle) * scale * offset;
      const width = (0.14 + random() * 0.081) * scale;
      const crown = cityPoint(cx, cz, CITY_DECK + scale * level);
      if (i % 2 === 0) {
        const from = cityPoint(x, z, CITY_DECK + scale * (level - 0.24));
        branch.copy(crown).sub(from);
        batches.trunks.details.push({
          position: from.lerp(crown, 0.5),
          rotation: new THREE.Quaternion().setFromUnitVectors(
            up,
            branch.clone().normalize(),
          ),
          scale: new THREE.Vector3(
            scale * 0.034,
            branch.length(),
            scale * 0.031,
          ),
          color: new THREE.Color(0x716656),
        });
      }
      part(
        batches.crowns,
        cx,
        cz,
        scale * (level - 0.077),
        [width, scale * 0.154, width * 0.91],
        new THREE.Color().setHSL(
          0.19 + random() * 0.102,
          0.34 + random() * 0.25,
          0.14 + random() * 0.12,
        ),
        angle,
      );
    }
  }

  function planter(x: number, z: number, index: number) {
    const width = 0.00365;
    const depth = 0.0066;
    blockers.push({ x, z, width, depth });
    part(
      batches.shade,
      x,
      z,
      0.00005,
      [width * 1.4, 1e-6, depth * 1.17],
      0xffffff,
    );
    part(batches.walls, x, z, 0, [width, 0.00046, depth], 0x77766c);
    part(
      batches.walls,
      x,
      z,
      0.00043,
      [width - 0.0004, 0.00007, depth - 0.00042],
      0x4b4536,
    );
    const size = 0.0046 + random() * 0.0019;
    tree(x, z - 0.00045, size);
    for (let tuft = 0; tuft < 11; tuft++) {
      const grassX = x + (random() - 0.5) * (width - 0.00062);
      const grassZ = z + (random() - 0.5) * (depth - 0.00064);
      part(
        batches.crowns,
        grassX,
        grassZ,
        0.00054,
        [
          0.00021 + random() * 0.00024,
          0.00015 + random() * 0.00019,
          0.0002 + random() * 0.00023,
        ],
        new THREE.Color().setHSL(
          0.135 + random() * 0.15,
          0.3 + random() * 0.27,
          0.16 + random() * 0.1,
        ),
        random() * 6,
      );
    }
    if (index % 2 !== 0) return;
    const benchX = x - Math.sign(x) * 0.00225;
    blockers.push({ x: benchX, z, width: 0.00055, depth: 0.00215 });
    for (const dz of [-0.00077, 0.00077])
      part(
        batches.ironwork,
        benchX,
        z + dz,
        0.00003,
        [0.00045, 0.00041, 0.00008],
        0x343d3d,
      );
    for (let slat = 0; slat < 5; slat++) {
      const offset = (slat - 2) * 0.000087;
      part(
        batches.timber,
        benchX + offset,
        z,
        0.00044,
        [0.000077, 0.000046, 0.00212],
        slat % 2 === 0 ? 0x997457 : 0x8b674c,
      );
    }
  }

  for (const side of [-1, 1]) {
    const x = side * 0.00525;
    for (let i = 0; i < 14; i++) {
      part(
        batches.walls,
        x,
        CITY_LANDING.z + 0.007 - i * 0.0055,
        0.00002,
        [0.000095, 0.000025, 0.0038],
        i % 2 === 0 ? 0x79776a : 0x848175,
      );
    }
    for (let i = 0; i < 16; i++) {
      const z = CITY_LANDING.z - 0.012 - i * 0.016 - (side > 0 ? 0.004 : 0);
      const x = side * (0.009 + random() * 0.0005);
      planter(x, z, i);
      if (i % 2 === 0) {
        const lightZ = z + 0.0046;
        part(batches.poles, x, lightZ, 0, [0.00026, 0.0044, 0.00026], 0x3c4747);
        part(
          batches.ironwork,
          x - side * 0.00048,
          lightZ,
          0.00434,
          [0.00126, 0.00015, 0.00031],
          0x56615d,
        );
        part(
          batches.light,
          x - side * 0.00076,
          lightZ,
          0.00429,
          [0.00064, 0.000055, 0.00021],
          0xffdfad,
        );
        blockers.push({ x, z: lightZ, width: 0.00026, depth: 0.00026 });
      }
    }
    for (const z of [0.784, 0.777, 0.758]) {
      const x = side * 0.0058;
      part(batches.poles, x, z, 0, [0.00031, 0.00101, 0.00031], 0x333c3e);
      part(batches.poles, x, z, 0.00075, [0.00032, 0.0001, 0.00032], 0xbf9a60);
      blockers.push({ x, z, width: 0.00031, depth: 0.00031 });
    }
  }

  const gateZ = 0.738;
  const gateWidth = 0.0162;
  for (const x of [-0.00655, 0.00655]) {
    blockers.push({ x, z: gateZ, width: 0.00063, depth: 0.0041 });
    for (const offset of [-0.00174, 0.00174]) {
      part(
        batches.walls,
        x,
        gateZ + offset,
        0,
        [0.00076, 0.00024, 0.00082],
        0xa8a496,
      );
      part(
        batches.ironwork,
        x,
        gateZ + offset,
        0.0002,
        [0.00038, 0.0051, 0.00044],
        0x454e4e,
      );
    }
    part(
      batches.ironwork,
      x,
      gateZ,
      0.00489,
      [0.00034, 0.00022, 0.00535],
      0x4c5654,
    );
  }
  for (let panel = 0; panel < 9; panel++) {
    const x = (panel - 4) * 0.00168;
    part(
      batches.panes,
      x,
      gateZ,
      0.00517,
      [0.00158, 0.00006, 0.00497],
      0x96aeb4,
    );
    part(
      batches.ironwork,
      x - 0.00083,
      gateZ,
      0.00505,
      [0.0001, 0.0002, 0.0053],
      0x515c58,
    );
  }
  for (const z of [gateZ - 0.0026, gateZ + 0.0026]) {
    part(
      batches.ironwork,
      0,
      z,
      0.00494,
      [gateWidth, 0.00031, 0.00023],
      0x414a47,
    );
    part(batches.light, 0, z, 0.00488, [0.0147, 0.00006, 0.000086], 0xffdeaa);
  }
  part(batches.shade, 0, gateZ, 0.000055, [0.018, 1e-6, 0.0096], 0xffffff);
  part(
    batches.ironwork,
    0,
    gateZ + 0.00272,
    0.00411,
    [0.00745, 0.00091, 0.000135],
    0x293535,
  );

  const signMap = canvasTexture(768, 96, (ctx) => {
    ctx.fillStyle = "#273435";
    ctx.fillRect(0, 0, 768, 96);
    ctx.fillStyle = "#d9af72";
    ctx.fillRect(21, 15, 4, 67);
    ctx.fillStyle = "#f3eada";
    ctx.font = "600 48px sans-serif";
    ctx.fillText("Cooper City", 43, 63);
    ctx.font = "600 20px sans-serif";
    ctx.fillText("HABITAT TERMINAL", 446, 44);
    ctx.fillStyle = "#b4c2bb";
    ctx.font = "500 17px sans-serif";
    ctx.fillText("ARRIVALS    /    TRANSIT", 446, 67);
  });
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.0074, 0.000925),
    new THREE.MeshStandardMaterial({
      map: signMap,
      roughness: 0.79,
      emissiveMap: signMap,
      emissive: 0xd9d1b8,
      emissiveIntensity: 0.32,
    }),
  );
  sign.position.copy(cityPoint(0, gateZ + 0.0028, CITY_DECK + 0.004555));
  sign.quaternion.copy(cityRotation(0));
  group.add(sign);

  for (const x of [-0.0208, 0.0208]) {
    const z = 0.752;
    blockers.push({ x, z, width: 0.0059, depth: 0.0139 });
    part(batches.walls, x, z, 0, [0.0064, 0.00016, 0.0145], 0x9c9888);
    part(batches.ironwork, x, z, 0.00321, [0.0064, 0.00034, 0.0144], 0x64716f);
    part(
      batches.light,
      x - Math.sign(x) * 0.00286,
      z,
      0.00316,
      [0.000082, 0.000069, 0.0136],
      0xffe1ae,
    );
    for (const dx of [-0.0026, 0.0026]) {
      for (let bay = 0; bay < 5; bay++) {
        const facadeZ = z + (bay - 2) * 0.0027;
        part(
          batches.ironwork,
          x + dx,
          facadeZ - 0.00135,
          0.00016,
          [0.00017, 0.0031, 0.00016],
          0x414c4c,
        );
        if (bay !== 2 || Math.sign(dx) === Math.sign(x)) {
          part(
            batches.panes,
            x + dx,
            facadeZ,
            0.00024,
            [0.000065, 0.00293, 0.00255],
            0x95adb0,
          );
          part(
            batches.ironwork,
            x + dx,
            facadeZ,
            0.0012,
            [0.000086, 0.00007, 0.00259],
            0x677774,
          );
        }
      }
    }
    for (const edge of [-0.0068, 0.0068]) {
      part(
        batches.walls,
        x,
        z + edge,
        0.00016,
        [0.00527, 0.0031, 0.00017],
        0x817b6e,
      );
      part(
        batches.ironwork,
        x,
        z + edge,
        0.00283,
        [0.0048, 0.00027, 0.0002],
        0x445557,
      );
    }
    part(
      batches.timber,
      x + Math.sign(x) * 0.0019,
      z,
      0.00055,
      [0.00055, 0.00011, 0.0097],
      0x9e7b56,
    );
  }

  const { trunks, crowns, ...fixtures } = batches;
  for (const { geometry, material, details } of Object.values(fixtures)) {
    group.add(instances(geometry, material, details));
  }
  const sparseLeaves = leafSpray(36);
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const canopyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.91 });
  const arrival = cityPoint(0, CITY_LANDING.z);
  const rowLength = 0.048;
  for (let start = arrival.z; start > arrival.z - 0.27; start -= rowLength) {
    const end = start - rowLength;
    const inRow = ({ position }: Detail) =>
      position.z <= start && position.z > end;
    const rowTrees = distantTrees.filter(inRow);
    if (!rowTrees.length) continue;
    const foliageLod = new THREE.LOD();
    foliageLod.position.copy(arrival);
    foliageLod.position.z = (start + end) / 2;
    const offset = foliageLod.position.clone().negate();
    const rowTrunks = trunks.details.filter(inRow);
    const rowLeaves = crowns.details.filter(inRow);
    for (const { geometry, distance } of [
      { geometry: crowns.geometry, distance: 0 },
      { geometry: sparseLeaves, distance: 0.068 },
    ]) {
      const grove = new THREE.Group();
      grove.position.copy(offset);
      grove.add(
        instances(trunks.geometry, trunks.material, rowTrunks),
        instances(geometry, crowns.material, rowLeaves),
      );
      foliageLod.addLevel(grove, distance, 0.08);
    }
    const distant = instances(canopy, canopyMaterial, rowTrees);
    distant.position.copy(offset);
    foliageLod.addLevel(distant, 0.22, 0.08);
    group.add(foliageLod);
  }
  return { group, blockers };
}
