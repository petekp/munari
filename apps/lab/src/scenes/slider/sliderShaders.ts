// The slider's lens shaders — fisheyeShaders.ts turned on its side.
//
// Same glass, same rules (light only, geometry never leaves z = 0 —
// the fisheye preamble says why): the one difference is the bulge's
// axis. This lens runs ALONG the track, so the fake normal tilts in x
// and the specular sweep stands vertically on the bulge's left flank.
//
// PREMULTIPLIED (decisions.md #5): light is added as `k * c.a`, fades
// multiply the whole vec4.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

/** Upper-left key light, shared with the fisheye scene's glass. */
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
    vec3 n = normalize(vec3(vSlope, 0.0, 1.0));
    vec3 L = normalize(uLightDir);

    float shade = mix(0.94, 1.0, max(dot(n, L), 0.0));
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 64.0);
    float rim = smoothstep(0.02, 0.14, vLens) * (1.0 - smoothstep(0.14, 0.5, vLens));

    c.rgb *= shade;
    c.rgb += (spec * 0.32 + rim * 0.10) * c.a;
    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
  }
`
