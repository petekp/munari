// The fisheye lens shaders — glass drawn entirely with light.
//
// The law moves vertices in x and y only; z stays flat so the pixels
// the eye sees are exactly the pixels the 2D law (and the gate's
// arithmetic) places. Depth is faked in shading: the warp loop writes
// each vertex the surface normal a real bulge WOULD have (aSlope, the
// normal's y component) plus its lens weight (aLens, 0 flat → 1 at
// the focus), and the fragment stage spends them on one specular
// sweep, a soft flank shade, and a rim line. Moving z for real would
// re-magnify the content through the perspective camera and shift
// every screen point off the law's prediction.
//
// PREMULTIPLIED (decisions.md #5): the capture arrives with rgb
// already scaled by alpha, so light is added as `k * c.a` and fades
// multiply the whole vec4.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

/** Upper-left key light; the sweep lands on the bulge's upper flank. */
export const LENS_LIGHT: readonly [number, number, number] = [-0.3, 0.42, 0.86]

export const LENS_VERT = /* glsl */ `
  attribute float aSlope;
  attribute float aLens;
  varying vec2 vUv;
  varying float vSlope;
  varying float vLens;

  void main() {
    vUv = uv;
    vSlope = aSlope;
    vLens = aLens;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const LENS_FRAG = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec3 uLightDir;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;
  varying float vSlope;
  varying float vLens;

  void main() {
    vec4 c = texture2D(tMap, vUv);
    vec3 n = normalize(vec3(0.0, vSlope, 1.0));
    vec3 L = normalize(uLightDir);

    // Flanks turn from the light and dim a touch; the band where the
    // normal meets the half-vector catches the sweep. The exponents
    // keep both effects off the flat sheet, where n is (0,0,1).
    float shade = mix(0.94, 1.0, max(dot(n, L), 0.0));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 64.0);

    // The rim: a thin bright line where the glass meets the page,
    // riding the lens weight so it appears and fades with the lens.
    float rim = smoothstep(0.02, 0.14, vLens) * (1.0 - smoothstep(0.14, 0.5, vLens));

    c.rgb *= shade;
    c.rgb += (spec * 0.32 + rim * 0.10) * c.a;
    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
  }
`
