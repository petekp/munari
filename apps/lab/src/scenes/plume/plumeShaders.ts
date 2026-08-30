// Plume shaders — intact DOM ink advected into soft, threaded air.
//
// The law: the source stays premultiplied from texture to framebuffer. At
// rest, neighbouring quads tile the exact capture; in flight, each quad
// collapses to its ink sample and stretches only along its velocity.
//
// The color-space fault was measured on the candidates bench, 2026-08-20:
// without colorspace_fragment, #f2f0e4 arrived as 226,222,198, a 30-count
// blue drop. Ownership: this file owns motion and light only. Word time and
// anchor placement remain JS laws.

export const PLUME_VERT = /* glsl */ `
  attribute vec2 aCorner;
  attribute vec2 aUv;
  attribute vec3 aSeed;
  attribute float aRelease;

  uniform float uTime;
  uniform float uDuration;
  uniform float uStagger;
  uniform float uRise;
  uniform float uCurl;
  uniform float uDepth;
  uniform float uWisps;
  uniform float uDraftOn;
  uniform float uReduced;
  uniform vec2 uDraft;
  uniform vec2 uGrain;

  varying vec2 vUv;
  varying vec2 vQuad;
  varying vec3 vSeed;
  varying float vAge;
  varying float vElapsed;

  const float TAU = 6.283185307179586;

  void main() {
    vUv = aUv;
    vQuad = aCorner;
    vSeed = aSeed;
    vElapsed = uTime - aRelease;

    float delay = aSeed.z * uStagger;
    float span = max(uDuration - delay, 0.05);
    float age = clamp((vElapsed - delay) / span, 0.0, 1.0);
    vAge = age;

    float eased = age * age * (3.0 - 2.0 * age);
    float lift = pow(age, 1.18) * uRise * (0.62 + aSeed.y * 0.78);
    // Neighbouring grains read one smooth field. Independent seed phases
    // made the first browser frame a swarm of gnats rather than one plume.
    float flowA = position.x * 0.018 + position.y * 0.006 + age * 6.2;
    float flowB = position.x * 0.008 - position.y * 0.014 - age * 3.8;
    float waveA = sin(flowA);
    float waveB = sin(flowB);
    float curl = (waveA * 0.7 + waveB * 0.3) * uCurl * sin(age * 3.14159265);
    float loose = (aSeed.x - 0.5) * uCurl * 0.13 * eased;
    vec2 draft = uDraft * uDraftOn * lift * vec2(0.42, 0.06);

    vec3 moved = position;
    moved.x += (curl + loose) * uWisps + draft.x;
    moved.y += (lift + draft.y) * uWisps;
    moved.z += sin(age * 5.2 + aSeed.x * TAU) * uDepth * eased * uWisps;

    // With wisps off, ink loosens into a quiet dust in place. Reduced
    // motion removes both paths and leaves only the fragment dissolve.
    moved.xy += (aSeed.xy - 0.5) * eased * 18.0 * (1.0 - uWisps);
    moved = mix(moved, position, uReduced);

    vec2 tangent = normalize(vec2(0.46 * cos(flowA) + 0.16 * cos(flowB), 1.0));
    vec2 normal = vec2(-tangent.y, tangent.x);
    // Hold the glyph together for the first beat. Stretching with sqrt(age)
    // made new smoke read as dense marker hatching before it had risen far
    // enough to become air (browser film, 2026-08-30).
    float threadAge = smoothstep(0.06, 0.72, age);
    float thread = mix(
      1.0,
      22.0 + aSeed.y * 18.0,
      pow(threadAge, 1.25) * uWisps * (1.0 - uReduced)
    );
    float narrow = mix(
      1.0,
      0.24 + aSeed.x * 0.16,
      smoothstep(0.08, 0.72, age) * uWisps
    );
    vec2 corner = normal * (aCorner.x * uGrain.x * narrow)
      + tangent * (aCorner.y * uGrain.y * thread);

    vec4 mv = modelViewMatrix * vec4(moved, 1.0);
    mv.xy += corner;
    gl_Position = projectionMatrix * mv;
  }
`

export const PLUME_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uPitchUv;
  uniform vec3 uSmoke;
  uniform vec3 uEmber;
  uniform float uEmbers;
  uniform float uReduced;

  varying vec2 vUv;
  varying vec2 vQuad;
  varying vec3 vSeed;
  varying float vAge;
  varying float vElapsed;

  void main() {
    vec2 fullUv = vUv + vQuad * uPitchUv;
    // Full footprint at home reconstructs the source. Once loose, one sample
    // becomes one grain instead of stretching a letter fragment into a bar.
    float point = smoothstep(0.025, 0.12, vAge);
    vec4 c = texture2D(tMap, mix(fullUv, vUv, point));
    if (c.a < 0.012) discard;

    float ellipse = 1.0 - smoothstep(0.08, 0.51, length(vec2(vQuad.x * 1.35, vQuad.y * 0.46)));
    float shape = mix(1.0, ellipse, smoothstep(0.02, 0.16, vAge));
    float handoff = smoothstep(0.0, mix(0.12, 0.055, uReduced), vElapsed);
    float fade = 1.0 - smoothstep(0.3, 1.0, vAge);

    // Ink cools toward the blue-grey of carbon dust. It stays scaled by its
    // own alpha, as every library material must under premultiplied alpha.
    float smoke = smoothstep(0.012, 0.34, vAge);
    c.rgb = mix(c.rgb, uSmoke * c.a, smoke * 0.96);

    // Sparse warm fibres, concentrated at the young edge of the plume.
    float emberSeed = smoothstep(0.972, 0.998, vSeed.x);
    float emberLife = smoothstep(0.02, 0.16, vAge) * (1.0 - smoothstep(0.42, 0.78, vAge));
    c.rgb += uEmber * c.a * emberSeed * emberLife * uEmbers * 0.82;

    gl_FragColor = c;
    #include <colorspace_fragment>
    // Device-space fade follows the encode. Doing this before the transfer
    // curve lifts fractional premultiplied RGB into a pale halo.
    float body = mix(1.0, 0.26, smoothstep(0.018, 0.28, vAge));
    gl_FragColor *= shape * handoff * fade * body;
  }
`
