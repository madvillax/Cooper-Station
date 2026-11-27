import * as THREE from "three";

const BLOOM_LEVELS = 5;
const BLOOM_THRESHOLD = 1.0;
const BLOOM_KNEE = 0.5;
const BLOOM_STRENGTH = 0.085;

const screenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: screenVertex,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
}

/**
 * The picture pipeline for the HDR quality tiers.
 *
 * The scene is drawn into a floating-point buffer where a value above 1.0
 * simply means "brighter than white". Bloom is then taken only from those
 * values, so things glow because they are bright (the Sun, the accretion disk,
 * lamps), never because glow was painted on. One last pass maps the range back
 * to the screen and adds the lens character: vignette, grain and the warp
 * streak used when jumping between regions.
 *
 * Bloom is a dual-filter chain: the bright part of the image is repeatedly
 * halved, then added back up through the same sizes. That costs a handful of
 * small passes instead of the wide blurs a Gaussian bloom needs.
 */
export function createPost(renderer: THREE.WebGLRenderer) {
  // The packed float format below is only renderable with the full float
  // extension; the half-float one alone would give a black screen.
  const supported = renderer.extensions.has("EXT_color_buffer_float");
  // Packed 11/11/10-bit floats: HDR range in four bytes a pixel instead of
  // eight. With four samples each, that halves what every frame has to resolve.
  const hdrFormat = {
    type: THREE.UnsignedInt101111Type,
    format: THREE.RGBFormat,
  } as const;
  const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
    ...hdrFormat,
    samples: 4,
    depthBuffer: true,
  });
  const levels = Array.from(
    { length: BLOOM_LEVELS },
    () => new THREE.WebGLRenderTarget(1, 1, { ...hdrFormat, depthBuffer: false }),
  );

  const source = { value: null as THREE.Texture | null };
  const texel = { value: new THREE.Vector2() };
  const prefilter = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 color = 0.25 * (
          texture2D(source, vUv + texel * vec2(-0.5, -0.5)).rgb +
          texture2D(source, vUv + texel * vec2(0.5, -0.5)).rgb +
          texture2D(source, vUv + texel * vec2(-0.5, 0.5)).rgb +
          texture2D(source, vUv + texel * vec2(0.5, 0.5)).rgb);
        // One blown-out pixel must not flare across the whole frame.
        color = min(color, vec3(40.0));
        float brightness = max(color.r, max(color.g, color.b));
        float soft = clamp(brightness - ${BLOOM_THRESHOLD.toFixed(2)} + ${BLOOM_KNEE.toFixed(2)}, 0.0, ${(BLOOM_KNEE * 2).toFixed(2)});
        soft = soft * soft / ${(BLOOM_KNEE * 4).toFixed(2)};
        float kept = max(soft, brightness - ${BLOOM_THRESHOLD.toFixed(2)}) / max(brightness, 0.0001);
        gl_FragColor = vec4(color * kept, 1.0);
      }
    `,
    { source, texel },
  );
  const downsample = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(source, vUv).rgb * 4.0;
        color += texture2D(source, vUv + texel * vec2(-1.0, -1.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(1.0, -1.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(-1.0, 1.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(1.0, 1.0)).rgb;
        gl_FragColor = vec4(color / 8.0, 1.0);
      }
    `,
    { source, texel },
  );
  const upsample = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        vec3 color = texture2D(source, vUv + texel * vec2(-2.0, 0.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(2.0, 0.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(0.0, -2.0)).rgb;
        color += texture2D(source, vUv + texel * vec2(0.0, 2.0)).rgb;
        color += 2.0 * texture2D(source, vUv + texel * vec2(-1.0, 1.0)).rgb;
        color += 2.0 * texture2D(source, vUv + texel * vec2(1.0, 1.0)).rgb;
        color += 2.0 * texture2D(source, vUv + texel * vec2(-1.0, -1.0)).rgb;
        color += 2.0 * texture2D(source, vUv + texel * vec2(1.0, -1.0)).rgb;
        gl_FragColor = vec4(color / 12.0, 1.0);
      }
    `,
    { source, texel },
  );
  upsample.blending = THREE.AdditiveBlending;
  upsample.transparent = true;

  const output = pass(
    /* glsl */ `
      uniform sampler2D source;
      uniform sampler2D bloom;
      uniform float bloomStrength;
      uniform float warp;
      uniform float seconds;
      varying vec2 vUv;

      vec3 lit(vec2 uv) {
        return texture2D(source, uv).rgb + texture2D(bloom, uv).rgb * bloomStrength;
      }

      float hash(vec2 p) {
        vec3 v = fract(vec3(p.xyx) * 0.1031);
        v += dot(v, v.yzx + 33.33);
        return fract((v.x + v.y) * v.z);
      }

      void main() {
        vec2 centered = vUv - 0.5;
        vec3 color;
        if (warp > 0.001) {
          // Jump streak: smear each pixel toward the centre of view.
          color = vec3(0.0);
          float total = 0.0;
          for (int i = 0; i < 8; i++) {
            float along = float(i) / 7.0;
            float weight = 1.0 - along * 0.55;
            color += lit(0.5 + centered * (1.0 - warp * 0.42 * along)) * weight;
            total += weight;
          }
          color = color / total * (1.0 + warp * 0.9);
        } else {
          color = lit(vUv);
        }
        float edge = dot(centered, centered) * 2.0;
        color *= 1.0 - 0.28 * smoothstep(0.18, 1.0, edge);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // Grain goes on last, in display space, so it is even across tones.
        float grain = hash(gl_FragCoord.xy + fract(seconds) * 61.0) - 0.5;
        gl_FragColor.rgb += grain * 0.024;
      }
    `,
    {
      source: { value: sceneTarget.texture },
      bloom: { value: levels[0].texture },
      bloomStrength: { value: BLOOM_STRENGTH },
      warp: { value: 0 },
      seconds: { value: 0 },
    },
  );

  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
  );
  triangle.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
  const quad = new THREE.Mesh(triangle, output);
  quad.frustumCulled = false;
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let hdr = supported;
  let bloom = true;

  function draw(
    material: THREE.ShaderMaterial,
    from: THREE.WebGLRenderTarget | null,
    to: THREE.WebGLRenderTarget | null,
  ) {
    if (from) {
      source.value = from.texture;
      texel.value.set(1 / from.width, 1 / from.height);
    }
    quad.material = material;
    renderer.setRenderTarget(to);
    renderer.render(quad, flat);
  }

  return {
    /** True when this device can render the HDR tiers at all. */
    supported,
    get hdr() {
      return hdr;
    },
    /**
     * The buffer scene materials are drawn into on the HDR tiers. Shaders
     * compile differently for it than for the screen, so warm-up binds it.
     */
    sceneTarget,
    setTier(settings: { hdr: boolean; bloom: boolean }) {
      hdr = supported && settings.hdr;
      bloom = settings.bloom;
    },
    setWarp(amount: number) {
      output.uniforms.warp.value = amount;
    },
    setSize(width: number, height: number, ratio: number) {
      let w = Math.max(1, Math.floor(width * ratio));
      let h = Math.max(1, Math.floor(height * ratio));
      sceneTarget.setSize(w, h);
      for (const level of levels) {
        w = Math.max(1, w >> 1);
        h = Math.max(1, h >> 1);
        level.setSize(w, h);
      }
    },
    render(scene: THREE.Scene, camera: THREE.Camera, seconds: number) {
      if (!hdr) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
        return;
      }
      renderer.setRenderTarget(sceneTarget);
      renderer.render(scene, camera);

      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      output.uniforms.bloomStrength.value = bloom ? BLOOM_STRENGTH : 0;
      if (bloom) {
        draw(prefilter, sceneTarget, levels[0]);
        for (let i = 1; i < levels.length; i++) {
          draw(downsample, levels[i - 1], levels[i]);
        }
        // Each size receives the blurred sum of everything smaller.
        for (let i = levels.length - 2; i >= 0; i--) {
          draw(upsample, levels[i + 1], levels[i]);
        }
      }
      output.uniforms.seconds.value = seconds;
      draw(output, null, null);
      renderer.autoClear = autoClear;
    },
    dispose() {
      sceneTarget.dispose();
      for (const level of levels) level.dispose();
      for (const material of [prefilter, downsample, upsample, output]) {
        material.dispose();
      }
      triangle.dispose();
    },
  };
}
