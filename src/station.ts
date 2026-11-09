import * as THREE from "three";
import { canvasTexture, instances, type Detail } from "./environment";
import { makeHabitatCity } from "./habitat-city";
import { makeHabitatLandscape } from "./habitat-landscape";
import { HALF_LENGTH, RADIUS, TAU } from "./habitat-surface";
import { makeStationExterior } from "./station-exterior";

function makeHabitatInfrastructure() {
  const group = new THREE.Group();
  const trim = new THREE.MeshStandardMaterial({
    color: 0x80918e,
    roughness: 0.51,
    metalness: 0.48,
  });
  const charcoal = new THREE.MeshStandardMaterial({
    color: 0x3f5055,
    roughness: 0.67,
    metalness: 0.36,
  });
  const light = new THREE.MeshBasicMaterial({
    color: 0xffedcc,
    toneMapped: false,
  });
  const shell = canvasTexture(768, 768, (ctx) => {
    const center = 384;
    const gradient = ctx.createRadialGradient(
      center,
      center,
      70,
      center,
      center,
      440,
    );
    gradient.addColorStop(0, "#4e5a5b");
    gradient.addColorStop(0.36, "#828c87");
    gradient.addColorStop(0.79, "#9ba09a");
    gradient.addColorStop(1, "#737f79");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 768, 768);
    for (let ring = 74; ring < 440; ring += 32) {
      ctx.strokeStyle = ring % 3 === 0 ? "#46565b" : "#586867";
      ctx.lineWidth = ring % 3 === 0 ? 2.8 : 1.3;
      ctx.beginPath();
      ctx.arc(center, center, ring, 0, TAU);
      ctx.stroke();
      for (let part = 0; part < 36; part++) {
        const theta = ((part + (ring % 3) * 0.33) * TAU) / 36;
        const x = Math.cos(theta);
        const y = Math.sin(theta);
        ctx.strokeStyle = "#536364";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(center + x * ring, center + y * ring);
        ctx.lineTo(center + x * (ring + 31), center + y * (ring + 31));
        ctx.stroke();
      }
    }
  });
  const bulkhead = new THREE.Mesh(
    new THREE.RingGeometry(0.45, RADIUS + 0.045, 160, 2),
    new THREE.MeshStandardMaterial({
      map: shell,
      bumpMap: shell,
      bumpScale: 0.024,
      roughness: 0.77,
      metalness: 0.27,
    }),
  );
  bulkhead.position.z = -HALF_LENGTH - 0.025;
  group.add(bulkhead);
  for (const [radius, depth] of [
    [0.51, 0.043],
    [1.08, 0.023],
    [1.84, 0.019],
    [2.64, 0.032],
    [3.14, 0.053],
  ]) {
    const rib = new THREE.Mesh(
      new THREE.TorusGeometry(radius, depth, 6, 144),
      trim,
    );
    rib.position.z = bulkhead.position.z + 0.034;
    group.add(rib);
  }

  const supports: Detail[] = [];
  const fixtures: Detail[] = [];
  const axis = new THREE.Vector3(0, 0, 1);
  for (let i = 0; i < 24; i++) {
    const angle = ((i + 0.5) * TAU) / 24;
    const radial = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const rotation = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    const rib = i % 2 === 0;
    supports.push({
      position: radial
        .clone()
        .multiplyScalar(rib ? 1.8 : 2.82)
        .setZ(bulkhead.position.z + 0.043),
      rotation,
      scale: new THREE.Vector3(rib ? 2.57 : 0.55, rib ? 0.064 : 0.047, 0.08),
      color: new THREE.Color(rib ? 0xc8d0c7 : 0x85989a),
    });
    for (const radius of [1.06, 2.66, 3.115]) {
      fixtures.push({
        position: radial
          .clone()
          .multiplyScalar(radius)
          .setZ(bulkhead.position.z + 0.086),
        rotation,
        scale: new THREE.Vector3(0.033, 0.066, 0.018),
        color: new THREE.Color(i % 4 === 0 ? 0xffc58d : 0xb8d3d9),
      });
    }
  }
  group.add(
    instances(new THREE.BoxGeometry(), trim, supports),
    instances(new THREE.BoxGeometry(), light, fixtures),
  );

  const litSection = 1.78;
  const diffuser = new THREE.CylinderGeometry(
    0.046,
    0.046,
    litSection,
    14,
  ).rotateX(Math.PI / 2);
  const collar = new THREE.TorusGeometry(0.059, 0.017, 6, 20);
  const paleSleeve = new THREE.MeshStandardMaterial({
    color: 0xb5a694,
    roughness: 0.52,
    metalness: 0.42,
  });
  for (const z of [-4.6, -2.76, -0.92, 0.92, 2.76, 4.6]) {
    const bar = new THREE.Mesh(diffuser, light);
    bar.position.z = z;
    const end = new THREE.Mesh(collar, paleSleeve);
    end.position.z = z + 0.916;
    group.add(bar, end);
  }
  const conduit = new THREE.CylinderGeometry(0.013, 0.013, 11.22, 8).rotateX(
    Math.PI / 2,
  );
  for (const x of [-0.067, 0.067]) {
    const rail = new THREE.Mesh(conduit, charcoal);
    rail.position.x = x;
    group.add(rail);
  }
  const terminal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.26, 0.57, 24).rotateX(Math.PI / 2),
    trim,
  );
  terminal.position.z = -5.81;
  group.add(terminal);
  const port = new THREE.Mesh(
    new THREE.CircleGeometry(0.46, 48),
    new THREE.MeshStandardMaterial({
      color: 0x202a2b,
      roughness: 0.41,
      metalness: 0.56,
    }),
  );
  port.position.z = bulkhead.position.z - 0.035;
  group.add(port);

  const diffusion = canvasTexture(128, 128, (ctx) => {
    const glow = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);
    glow.addColorStop(0, "#fff7ddaf");
    glow.addColorStop(0.18, "#fff0cb39");
    glow.addColorStop(0.48, "#eedfbe11");
    glow.addColorStop(1, "#eedfbe00");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);
  });
  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: diffusion,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  halo.scale.setScalar(0.98);
  halo.position.z = -5.47;
  group.add(halo);
  return group;
}

export function createStation() {
  const exterior = makeStationExterior();
  const city = makeHabitatCity();
  const landscape = makeHabitatLandscape();
  landscape.add(city.group);

  const spin = new THREE.Group();
  spin.add(exterior.group, landscape, makeHabitatInfrastructure());
  const root = new THREE.Group();
  root.rotation.set(-0.16, -0.73, -0.12);
  root.add(spin);
  return {
    root,
    spin,
    removablePanels: exterior.removablePanels,
    entryPath: exterior.entryPath,
    landscape,
    city,
  };
}
