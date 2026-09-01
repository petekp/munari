// Plume shaders — captured DOM ink carried away as smoke.
//
// The law: the source stays premultiplied from texture to framebuffer, and
// motion stays stateless — position is a function of age, seed, and home
// position only. Statelessness is what lets Restore, pause, reduced motion,
// and the gate's age sampling all land on the same pixels; a simulation
// buffer would make every one of those a different picture.
//
// Two faults are pinned here. The 2026-08-30 thread pass stretched grains
// 22–40 times along their path, so particle dimensions stay isotropic. The
// same review found the cloud reading as a spray of dots: independent
// per-grain scatter with a flat 96% tint gave no shared flow, no volume, and
// no colour of its own. Neighbouring grains now share one divergence-free
// flow field, each sprite is a shaded noise puff, and the base colour is the
// captured texel's own.
//
// The color-space fault was measured on the candidates bench, 2026-08-20:
// without colorspace_fragment, #f2f0e4 arrived as 226,222,198, a 30-count
// blue drop. Ownership: this file owns motion and light only. Unit time and
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
  uniform float uSpread;
  uniform float uDepth;
  uniform float uTurbulence;
  uniform float uBillow;
  uniform float uTurbulenceSpeed;
  uniform float uDraftStrength;
  uniform float uParticleSize;
  uniform float uSizeVariation;
  uniform float uParticleGrowth;
  uniform float uLifetimeVariation;
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
  varying float vDepthCue;

  // Substeps of the particle's own age. Five is where the folded billow
  // stopped changing shape between counts; more only costs transcendentals.
  const int STEPS = 5;
  // Eddy size in CSS px at 1x billow: 2*pi/0.0125 is about 500px across,
  // so one line of type sits inside a single turn of the field.
  const float EDDY = 0.0125;

  // The analytic curl of a sine vector potential. Divergence-free by
  // construction, which is what keeps a word rising as one body instead of
  // dispersing evenly. Frequency divides back out so both octaves arrive
  // at the same amplitude, and each partial reuses the six phases below.
  vec3 curlField(vec3 p, float t, float f) {
    vec3 first = vec3(p.y * f, p.z * f * 1.10, p.x * f * 0.90)
      + t * vec3(0.90, 0.78, 1.22);
    vec3 second = vec3(p.z * f * 0.80, p.x * f * 0.70, p.y * f * 1.20)
      + t * vec3(0.62, 1.05, 0.71);
    vec3 sf = sin(first);
    vec3 cf = cos(first);
    vec3 ss = sin(second);
    vec3 cs = cos(second);
    float dZdy = -sf.z * ss.z * 1.20;
    float dYdz = cf.y * cs.y * 1.10;
    float dXdz = -sf.x * ss.x * 0.80;
    float dZdx = cf.z * cs.z * 0.90;
    float dYdx = -sf.y * ss.y * 0.70;
    float dXdy = cf.x * cs.x;
    return vec3(dZdy - dYdz, dXdz - dZdx, dYdx - dXdy);
  }

  // Buoyancy: the column accelerates out of the page, then eases as it
  // cools. The quarter of linear travel keeps it from parking mid-flight.
  float riseCurve(float u) {
    return 0.75 * (u * u * (3.0 - 2.0 * u)) + 0.25 * u;
  }

  void main() {
    vUv = aUv;
    vQuad = aCorner;
    vSeed = aSeed;
    vElapsed = uTime - aRelease;

    // Even the largest stagger must finish within the unit's lifetime.
    // Otherwise React stops requesting frames before the last grain fades.
    float duration = max(uDuration, 0.001);
    float delay = aSeed.z * min(uStagger, duration * 0.85);
    float span = max(duration - delay, 0.001) * mix(1.0 - uLifetimeVariation, 1.0, aSeed.y);
    float age = clamp((vElapsed - delay) / span, 0.0, 1.0);
    vAge = age;

    float released = smoothstep(0.012, 0.16, age);
    float eased = 1.0 - pow(1.0 - age, 2.0);
    float lift = uRise * riseCurve(age) * mix(0.68, 1.32, aSeed.y);
    float reach = uSpread * uTurbulence * mix(0.75, 1.25, aSeed.x);
    vec2 draft = uDraft * uDraftOn * uDraftStrength * riseCurve(age) * vec2(0.42, 0.06);

    // Forward Euler along the grain's own path: sampling the field where the
    // grain has already arrived is what folds the sheet instead of pushing
    // every grain the same way. Fixed step count keeps cost bounded and the
    // result a pure function of age.
    vec3 flow = vec3(0.0);
    vec3 walk = position;
    float du = age / float(STEPS);
    for (int i = 0; i < STEPS; i++) {
      float u = (float(i) + 0.5) * du;
      // Displacement grows as age^0.6; this weight is that curve's slope,
      // so the cloud opens quickly and then coasts.
      float slow = 0.6 / pow(max(u, 0.03), 0.4);
      float air = u * span * uTurbulenceSpeed;
      vec3 field = curlField(walk, air, EDDY * uBillow);
      // The small octave arrives late, which is what tears the coherent
      // body into wisps rather than starting the life already shredded.
      field += curlField(walk + 41.7, air * 1.63, EDDY * uBillow * 2.7)
        * (0.6 * smoothstep(0.05, 0.7, u));
      flow += field * slow * du;
      walk = position + flow * reach + vec3(0.0, uRise * riseCurve(u), 0.0);
    }

    vec3 moved = position;
    moved.xy += (flow.xy * reach + vec2(0.0, lift)) * uWisps + draft;
    moved.z += flow.z * uDepth * uWisps;
    // Grain-scale jitter under the shared field: without it a 3px grid
    // stays legible as a grid inside the billow.
    moved.xy += (aSeed.xy - 0.5) * eased * 5.0 * uWisps;

    // With updraft off, only local drift and pointer wind remain. Reduced
    // motion removes all travel and leaves only the fragment dissolve.
    moved.xy += (aSeed.xy - 0.5) * eased * 18.0 * (1.0 - uWisps);
    moved = mix(moved, position, uReduced);
    vDepthCue = moved.z / max(uDepth, 1.0);

    // The captured footprint is exact at rest. Once released, equal X/Y
    // dimensions make every sprite round at any camera depth or flow angle.
    float diameter = uParticleSize * mix(1.0 - uSizeVariation, 1.0 + uSizeVariation, aSeed.z);
    diameter *= mix(1.0, uParticleGrowth, smoothstep(0.0, 0.5, age));
    // Smoke keeps expanding as it thins. The former late shrink snapped
    // every puff back to a dot just before it faded.
    diameter *= 1.0 + 0.6 * age;
    vec2 corner = aCorner * mix(uGrain, vec2(diameter), released * (1.0 - uReduced));

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
  uniform vec3 uPaper;
  uniform float uEmbers;
  uniform float uReduced;
  uniform float uSparkAmount;
  uniform float uParticleOpacity;
  uniform float uParticleSoftness;
  uniform float uBillow;
  uniform float uTint;
  uniform float uShading;
  uniform float uDepthFog;

  varying vec2 vUv;
  varying vec2 vQuad;
  varying vec3 vSeed;
  varying float vAge;
  varying float vElapsed;
  varying float vDepthCue;

  const vec2 LIGHT = vec2(-0.622, 0.783);

  float hash21(vec2 p) {
    vec3 q = fract(vec3(p.x, p.y, p.x) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }

  float noise2(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm2(vec2 p) {
    return noise2(p) * 0.62 + noise2(p * 2.31 + 7.3) * 0.38;
  }

  void main() {
    vec2 fullUv = vUv + vQuad * uPitchUv;
    // Full footprint at home reconstructs the source. Once loose, one sample
    // becomes one puff. Reduced motion keeps the full glyph footprint.
    float point = smoothstep(0.025, 0.12, vAge) * (1.0 - uReduced);
    vec4 c = texture2D(tMap, mix(fullUv, vUv, point));
    if (c.a < 0.012) discard;

    // Everything below works in straight colour and re-associates once, at
    // the end. Shading a premultiplied value is what used to lift a
    // thin-edge grain's channels above its own alpha.
    gl_FragColor = vec4(c.rgb / max(c.a, 1e-4), 1.0);
    #include <colorspace_fragment>
    vec3 base = gl_FragColor.rgb;
    vec3 smokeColor = linearToOutputTexel(vec4(uSmoke, 1.0)).rgb;
    vec3 emberColor = linearToOutputTexel(vec4(uEmber, 1.0)).rgb;
    vec3 paperColor = linearToOutputTexel(vec4(uPaper, 1.0)).rgb;

    // Every per-puff treatment is gated by this: at rest each quad still
    // holds a 3px slice of a glyph, and shading those slices would tile a
    // gradient across intact type.
    float loose = smoothstep(0.02, 0.18, vAge) * (1.0 - uReduced);
    float far = clamp(-vDepthCue, 0.0, 1.0) * uDepthFog;

    vec2 grain = vQuad * 3.6 * uBillow + vSeed.xy * 31.7 + vAge * 0.55;
    float density = fbm2(grain);
    vec2 slope = vec2(fbm2(grain + vec2(0.45, 0.0)), fbm2(grain + vec2(0.0, 0.45))) - density;
    // A dome term gives the whole puff a lit and a shaded side; the noise
    // gradient adds the curdled relief inside it.
    float form = clamp(dot(LIGHT, vQuad) * 1.9 - dot(LIGHT, slope) * 5.0, -1.0, 1.0);
    float contrast = uShading * loose * mix(1.0, 0.4, far);
    base = mix(base, smokeColor, uTint);
    base = mix(base, vec3(1.0), max(form, 0.0) * contrast * 0.72);
    base = mix(base, vec3(0.0), max(-form, 0.0) * contrast * 0.5);
    base = mix(base, paperColor, far * loose * 0.75);

    float disc = 1.0 - smoothstep(0.5 * (1.0 - uParticleSoftness), 0.5, length(vQuad));
    float puff = disc * (0.55 + 0.45 * density);
    float shape = mix(1.0, puff, loose);
    float handoff = smoothstep(0.0, mix(0.12, 0.055, uReduced), vElapsed);
    float fade = 1.0 - smoothstep(0.24, 1.0, vAge);

    // A few independent grains catch warm light as they enter the cloud.
    float emberStart = 1.0 - max(uSparkAmount, 0.0001);
    float emberEnd = min(1.0, emberStart + 0.06);
    float emberSeed = smoothstep(emberStart, emberEnd, vSeed.x) * step(0.0001, uSparkAmount);
    float emberLife = smoothstep(0.02, 0.16, vAge) * (1.0 - smoothstep(0.42, 0.78, vAge));
    base = mix(base, emberColor, emberSeed * emberLife * uEmbers * 0.95);

    float opacity = min(1.0, uParticleOpacity * mix(0.83, 1.17, vSeed.y));
    float body = mix(1.0, opacity, smoothstep(0.018, 0.28, vAge));
    float alpha = c.a * shape * handoff * fade * body * mix(1.0, 0.55, far * loose);
    gl_FragColor = vec4(clamp(base, 0.0, 1.0) * alpha, alpha);
  }
`
