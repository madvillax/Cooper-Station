import * as THREE from "three";

export function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function canvasTexture(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D is unavailable");
  paint(context);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createSpace() {
  const space = new THREE.Group();
  const random = seededRandom(1836);
  const stars = new THREE.BufferGeometry();
  const positions = [];
  const sizes = [];
  const colors = [];
  const starColor = new THREE.Color();
  for (let i = 0; i < 4600; i++) {
    const z = random() * 2 - 1;
    const a = random() * Math.PI * 2;
    const side = Math.sqrt(1 - z * z);
    const radius = 180 + random() * 30;
    positions.push(radius * side * Math.cos(a), radius * z, radius * side * Math.sin(a));
    const brightness = 0.1 + random() ** 4 * 0.67;
    sizes.push((0.75 + brightness * 1.85) * Math.min(window.devicePixelRatio, 1.7));
    starColor.setHSL(0.04 + random() * 0.6, 0.22, brightness);
    colors.push(starColor.r, starColor.g, starColor.b);
  }
  stars.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  stars.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  stars.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      attribute float size;
      attribute vec3 color;
      varying vec3 tint;
      void main() {
        tint = color;
        gl_PointSize = size;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 tint;
      void main() {
        float glow = max(1.0 - length(gl_PointCoord - 0.5) * 2.0, 0.0);
        gl_FragColor = vec4(tint, glow * glow);
        #include <colorspace_fragment>
      }
    `,
  });
  space.add(new THREE.Points(stars, starMaterial));

  const saturn = new THREE.Group();
  saturn.position.set(25, 12.5, -64);
  saturn.rotation.set(0.13, 0, -0.25);
  space.add(saturn);
  const radius = 17;
  const sun = new THREE.Vector3(-0.74, 0.34, 0.22).normalize();
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 80, 48),
    new THREE.ShaderMaterial({
      uniforms: { sun: { value: sun } },
      vertexShader: `
        varying vec3 sphereNormal;
        varying vec3 normalView;
        varying vec3 positionView;
        void main() {
          sphereNormal = normal;
          normalView = normalize(normalMatrix * normal);
          vec4 eye = modelViewMatrix * vec4(position, 1.0);
          positionView = eye.xyz;
          gl_Position = projectionMatrix * eye;
        }
      `,
      fragmentShader: `
        uniform vec3 sun;
        varying vec3 sphereNormal;
        varying vec3 normalView;
        varying vec3 positionView;
        void main() {
          vec3 n = normalize(sphereNormal);
          float lat = asin(n.y);
          float drift = sin(n.z * 14.0 + lat * 33.0) * 0.014;
          float bands = sin((lat + drift) * 33.0) * 0.07
            + sin(lat * 98.0 + sin(lat * 40.0)) * 0.027
            + sin(lat * 220.0 + n.z * 2.0) * 0.013;
          vec3 cool = vec3(0.27, 0.32, 0.37);
          vec3 sand = vec3(0.56, 0.47, 0.34);
          vec3 gas = mix(cool, sand, 0.65 + sin(lat * 4.0) * 0.21 + bands);
          float light = smoothstep(-0.12, 0.96, dot(n, sun));
          float edge = pow(1.0 - max(dot(normalize(normalView), normalize(-positionView)), 0.0), 4.1);
          float shadow = 1.0 - 0.46 * (1.0 - smoothstep(0.01, 0.048, abs(n.y + n.x * 0.115 + 0.17)));
          vec3 color = gas * (0.012 + light * shadow * 0.76) + vec3(0.23, 0.40, 0.50) * edge * (0.03 + light * 0.31);
          gl_FragColor = vec4(color, 1.0);
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  saturn.add(planet);
  const rings = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.23, radius * 2.35, 160),
    new THREE.ShaderMaterial({
      uniforms: { radius: { value: radius }, sun: { value: sun } },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      vertexShader: `
        varying vec2 ringPosition;
        varying vec3 relativePosition;
        void main() {
          ringPosition = position.xy;
          relativePosition = mat3(modelMatrix) * position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float radius;
        uniform vec3 sun;
        varying vec2 ringPosition;
        varying vec3 relativePosition;
        void main() {
          float r = length(ringPosition) / radius;
          float bands = 0.65 + sin(r * 122.0) * 0.075 + sin(r * 481.0) * 0.06
            + sin(r * 976.0) * 0.06 + sin(r * 21.0 + sin(r * 34.0)) * 0.21;
          float division = smoothstep(0.028, 0.053, abs(r - 1.91)) * smoothstep(0.008, 0.019, abs(r - 2.19));
          float bounds = smoothstep(1.23, 1.55, r) * (1.0 - smoothstep(2.24, 2.35, r));
          float dark = dot(relativePosition, sun) < 0.0
            ? smoothstep(0.95, 1.08, length(cross(relativePosition, sun)) / radius) : 1.0;
          vec3 tint = mix(vec3(0.48, 0.39, 0.30), vec3(0.22, 0.28, 0.32), smoothstep(1.6, 2.35, r));
          gl_FragColor = vec4(tint * (0.09 + dark * 0.62), bounds * division * bands * (0.42 + dark * 0.48));
          #include <colorspace_fragment>
        }
      `,
    }),
  );
  rings.rotation.set(-1.19, 0.23, 0);
  saturn.add(rings);
  return space;
}
