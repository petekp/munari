// The GLSL half of the corner mask. The JS half — `surfaceRadiusSd`, the
// measurement pipeline, and the radii it enforces — lives in @munari/core;
// this string stays in the binding because a shader chunk belongs beside the
// material that splices it, and the kernel is renderer-free on purpose.
// The two are twins BY CONTRACT: the conformance suite pins the JS SDF, and
// this chunk must compute the same distance so a ray and a fragment agree
// about where a corner ends.

/**
 * For a custom material (`material="none"`) that wants its Surface cut to
 * the element's corners. Prepend to the fragment shader, declare the two
 * uniforms, and multiply your alpha by `munariRadiusMask(vUv)` (feed it
 * the UNMIRRORED uv you sample with). `Surface` injects this same chunk
 * into its own standard material — custom shaders opt in because only they
 * know their varyings.
 */
export const SURFACE_RADIUS_GLSL = /* glsl */ `
  uniform vec4 uMunariRadii; // tl, tr, br, bl — CSS px of the source
  uniform vec2 uMunariSize;  // source CSS px
  float munariRadiusSd(vec2 uv) {
    vec2 p = (uv - 0.5) * uMunariSize; // +y = content top (flipY texture)
    float r = p.x < 0.0
      ? (p.y > 0.0 ? uMunariRadii.x : uMunariRadii.w)
      : (p.y > 0.0 ? uMunariRadii.y : uMunariRadii.z);
    vec2 d = abs(p) - uMunariSize * 0.5 + vec2(r);
    return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
  }
  // Antialiased coverage: 1 inside, 0 outside, one fragment-width of edge.
  // Analytic, so the corner stays crisp at every LOD tier — the texture's
  // own corner texels are opaquely painted app background and cannot help.
  float munariRadiusMask(vec2 uv) {
    float sd = munariRadiusSd(uv);
    float aa = max(fwidth(sd), 1e-4);
    return 1.0 - smoothstep(-aa, aa, sd);
  }
`
