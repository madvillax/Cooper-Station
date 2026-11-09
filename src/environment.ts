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

export function makeStarField() {
  const random = seededRandom(618);
  const positions = [];
  const brightness = [];
  for (let i = 0; i < 5800; i++) {
    const y = random() * 2 - 1;
    const azimuth = random() * Math.PI * 2;
    const plane = Math.sqrt(1 - y * y);
    positions.push(
      Math.cos(azimuth) * plane * 320,
      y * 320,
      Math.sin(azimuth) * plane * 320,
    );
    brightness.push(0.22 + random() ** 5 * 0.76);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute(
    "brightness",
    new THREE.Float32BufferAttribute(brightness, 1),
  );
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { density: { value: 1 } },
    vertexShader: `
      attribute float brightness;
      varying float energy;
      uniform float density;
      void main() {
        energy = brightness;
        gl_PointSize = (1.15 + 1.7 * brightness) * density;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float energy;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        float point = exp(-r * r * 5.0) * (1.0 - smoothstep(0.7, 1.0, r));
        gl_FragColor = vec4(mix(vec3(0.60, 0.71, 1.0), vec3(1.0, 0.88, 0.68), energy), energy * point);
      }
    `,
  });
  const mesh = new THREE.Points(geometry, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    setDensity(ratio: number) {
      material.uniforms.density.value = ratio;
    },
  };
}

export function makeSolarCorona() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      varying vec2 field;
      void main() {
        field = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      varying vec2 field;

      float hash(vec2 p) {
        vec3 v = fract(vec3(p.xyx) * 0.1031);
        v += dot(v, v.yzx + 33.33);
        return fract((v.x + v.y) * v.z);
      }

      float noise(vec2 p) {
        vec2 cell = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
          mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      float prominence(vec2 radial, float height, float angle, float width, float rise) {
        vec2 anchor = vec2(cos(angle), sin(angle));
        if (dot(radial, anchor) < 0.92) return 0.0;
        float across = dot(radial, vec2(-anchor.y, anchor.x)) / width;
        float arc = rise * sqrt(max(0.0, 1.0 - across * across));
        float distance = abs(height - arc);
        return (exp(-distance * 190.0) + 0.32 * exp(-distance * 58.0))
          * (1.0 - smoothstep(0.84, 1.0, abs(across)));
      }

      void main() {
        float radius = length(field);
        float pixel = fwidth(radius);
        if (radius < 1.0 - pixel || radius > 1.47) discard;
        vec2 radial = field / radius;
        vec2 tangent = vec2(-radial.y, radial.x);
        float altitude = max(radius - 1.0, 0.0);
        float drift = time * 0.12;
        float activity = smoothstep(0.15, 0.85, noise(radial * 8.0 + vec2(13.4, -5.0)));
        float bend = noise(radial * 15.0 + vec2(altitude * 17.0 - drift, drift * 0.5));
        vec2 flow = radial * (39.0 + altitude * 17.0)
          + tangent * altitude * (25.0 * bend - 12.0);
        float structure = noise(flow + vec2(drift, -drift * 0.46));
        float scaleHeight = 0.021 + 0.092 * activity;
        float glow = (0.08 + activity * 0.11) * exp(-altitude * 15.0);
        float wisps = pow(structure, 2.4) * (0.34 + activity * 0.52)
          * exp(-altitude / scaleHeight);
        float lifted = altitude + (bend - 0.5) * 0.008;
        float loops = prominence(radial, lifted, 5.62, 0.13, 0.142)
          + 0.74 * prominence(radial, lifted, 3.91, 0.091, 0.087)
          + 0.50 * prominence(radial, lifted, 1.09, 0.071, 0.072);
        float rim = exp(-altitude * 170.0) * (0.45 + structure * 0.12);
        float edge = smoothstep(-pixel, pixel, radius - 1.0);
        float fade = 1.0 - smoothstep(1.22, 1.46, radius);
        vec3 tint = mix(vec3(1.0, 0.012, 0.001), vec3(1.0, 0.37, 0.017), exp(-altitude * 35.0));
        gl_FragColor = vec4(tint, (rim + glow + wisps + loops * 0.26) * edge * fade);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.96, 2.96), material);
  mesh.renderOrder = 1;
  return {
    mesh,
    update(camera: THREE.Camera, time: number, center: THREE.Vector3, radius: number) {
      const distance = Math.max(
        1.05,
        camera.position.distanceTo(center) / radius,
      );
      // At close range, the apparent limb is wider than the sphere's equator.
      mesh.scale.setScalar(distance / Math.sqrt(distance * distance - 1));
      mesh.lookAt(camera.position);
      material.uniforms.time.value = time;
    },
  };
}

export function makeSkyDome(invalidate: () => void) {
  const orientation = new THREE.Matrix3().setFromMatrix4(
    new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0.48, -1.55, 0.22),
    ),
  );
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      panorama: { value: null },
      orientation: { value: orientation },
      exposure: { value: 0.6 },
    },
    vertexShader: `
      varying vec3 direction;
      void main() {
        direction = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: `
      uniform sampler2D panorama;
      uniform mat3 orientation;
      uniform float exposure;
      varying vec3 direction;
      void main() {
        vec3 ray = normalize(orientation * direction);
        vec2 uv = vec2(atan(ray.z, ray.x) * 0.15915494 + 0.5, asin(clamp(ray.y, -1.0, 1.0)) * 0.31830989 + 0.5);
        vec2 horizontal = dFdx(uv);
        vec2 vertical = dFdy(uv);
        horizontal.x -= floor(horizontal.x + 0.5);
        vertical.x -= floor(vertical.x + 0.5);
        vec3 sky = textureGrad(panorama, uv, horizontal, vertical).rgb;
        gl_FragColor = vec4(pow(max(sky, vec3(0.0)), vec3(1.52)) * exposure, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.visible = false;
  new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}space/deep-sky.webp`,
    (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      material.uniforms.panorama.value = texture;
      mesh.visible = true;
      invalidate();
    },
  );
  return {
    mesh,
    setExposure(exposure: number) {
      material.uniforms.exposure.value = exposure;
    },
  };
}

export type Detail = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
  scale: THREE.Vector3;
  color: THREE.Color;
};

export function instances(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  details: Detail[],
) {
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
