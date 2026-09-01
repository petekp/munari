// Rain shaders — one instanced disc for every live drop, one thin instanced
// streak for the background weather, one thin instanced column for water
// standing in the headline's glyph ink.
//
// The law: shape lives in local unit-circle (or unit-column) space, before
// the instance matrix's squash and translate reach it. A sitting bead's
// y-scale of 0.82 then reads as an ellipse for free — the fragment shader
// never needs to know it is squashed, only whether it is sitting, to draw
// the contact darkening beneath it. Real water on glass is mostly the page
// showing through: a body this shader keeps close to transparent, with the
// edge and one small highlight carrying almost all of the read, rather
// than a painted rim and a broad specular disc.
//
// Ownership: these strings own colour and coverage only. Position, radius
// and the sitting/rolling/falling split are rainLaw's; the instance matrix
// and per-instance attributes are rainField's.

export const RAIN_DROP_VERTEX = /* glsl */ `
attribute float aSit;
attribute float aFade;
varying vec2 vLocal;
varying float vSit;
varying float vFade;

void main() {
  vLocal = position.xy;
  vSit = aSit;
  vFade = aFade;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`

export const RAIN_DROP_FRAGMENT = /* glsl */ `
varying vec2 vLocal;
varying float vSit;
varying float vFade;

void main() {
  float dist = length(vLocal) * 2.0;
  if (dist > 1.0) discard;

  // The body is a cool tint a few steps darker than the page, not a
  // painted disc — the page still shows through it, but at an alpha a
  // real bead of water actually reaches (0.30 against #e9ecef reads as a
  // visible grey-blue bead; 0.14 read as nothing).
  vec3 body = vec3(0.56, 0.64, 0.72);
  vec3 edgeColor = vec3(0.14, 0.18, 0.24);
  // A soft meniscus band right at the silhouette (a hard rim reads as a
  // drawn outline; this is narrow enough to still look like refraction).
  float edge = smoothstep(0.72, 1.0, dist);
  vec3 color = mix(body, edgeColor, edge);

  // A faint gradient toward one side, as if catching an overhead source —
  // this alone does most of the "lit water" work; the highlight below only
  // adds the last, small punctuation.
  float wash = smoothstep(0.3, -0.7, vLocal.y * 2.0);
  color = mix(color, vec3(1.0), wash * 0.1);

  // A contact shadow hugging the lower silhouette, only under a bead that
  // is actually resting on a ledge — a falling drop has nothing beneath it
  // to darken.
  float below = smoothstep(0.05, 0.6, -vLocal.y * 2.0) * smoothstep(0.5, 1.0, dist);
  color = mix(color, vec3(0.0), vSit * below * 0.24);

  // One tight highlight — a fraction of the drop's own radius, the way a
  // pixel or two of glare reads on real water, not the near-half-drop disc
  // a bigger radius would blur into a painted dot.
  vec2 specOffset = vLocal * 2.0 - vec2(-0.34, 0.4);
  float spec = smoothstep(0.16, 0.0, length(specOffset));
  color = mix(color, vec3(1.0), spec * 0.9);

  float alpha = (0.30 + edge * 0.32 + spec * 0.35) * vFade;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`

// A streak needs no per-instance transform: its whole path is a function of
// its seed and the clock, so idle costs nothing and a resize never has to
// re-place one.
export const RAIN_STREAK_VERTEX = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec2 uViewport;
uniform float uAngle;
uniform float uLength;
uniform float uWidth;
varying float vFade;

void main() {
  float wrap = uViewport.y + uLength * 2.0;
  float speed = mix(16.0, 34.0, aSeed.z);
  float travel = mod(aSeed.y * wrap + uTime * speed, wrap) - uLength;
  float slope = tan(uAngle);
  float cx = aSeed.x * (uViewport.x + uLength * slope) + travel * slope;
  float cy = travel;

  float c = cos(uAngle);
  float s = sin(uAngle);
  vec2 local = position.xy * vec2(uWidth, uLength);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 world = vec2(cx, cy) + rotated;

  // Fades in from the top and out toward the bottom of its own run, so a
  // streak never pops at either end of the wrap.
  float alongUnit = (position.y + 0.5);
  float edge = smoothstep(0.0, 0.12, alongUnit) * smoothstep(1.0, 0.85, alongUnit);
  vFade = edge * mix(0.5, 1.0, aSeed.z);

  vec4 mv = modelViewMatrix * vec4(world, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}
`

export const RAIN_STREAK_FRAGMENT = /* glsl */ `
varying float vFade;

void main() {
  vec3 color = vec3(0.62, 0.67, 0.74);
  float alpha = vFade * 0.08;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`

// One quad per wet h1 column. rainField.tsx scales/positions the unit quad
// so local y=+0.5 always lands on that column's ink floor and y=-0.5 on
// its open water surface (see writeWaterInstances) — the fragment reads
// that one axis directly, no radius or per-instance uniform needed.
export const RAIN_WATER_VERTEX = /* glsl */ `
varying vec2 vLocal;

void main() {
  vLocal = position.xy;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`

export const RAIN_WATER_FRAGMENT = /* glsl */ `
varying vec2 vLocal;

void main() {
  vec3 body = vec3(0.55, 0.64, 0.74);
  vec3 floorColor = vec3(0.16, 0.21, 0.27);
  // Darkens toward the ink floor (vLocal.y > 0) — a pooled column reads as
  // deepest right where it touches the glyph, same as the drop's own
  // contact shadow.
  float contact = smoothstep(0.0, 0.5, vLocal.y);
  vec3 color = mix(body, floorColor, contact * 0.6);

  // The meniscus at the open surface (vLocal.y approaching -0.5) is a DARK
  // tension rim, not a white line — most of the column floats over the
  // #e8ebee page, where a white meniscus and a 0.30-alpha body both
  // disappeared (2026-09-01 capture: filled bowls read as faint smudges).
  float surfaceLine = 1.0 - smoothstep(0.0, 0.12, vLocal.y + 0.5);
  color = mix(color, vec3(0.24, 0.32, 0.42), surfaceLine * 0.85);

  // A narrow bright band just under the rim — the one sliver of gathered
  // light that says liquid instead of tinted glass.
  float glare = smoothstep(0.12, 0.20, vLocal.y + 0.5) * (1.0 - smoothstep(0.20, 0.34, vLocal.y + 0.5));
  color = mix(color, vec3(0.97), glare * 0.4);

  float alpha = 0.52 + contact * 0.22 + surfaceLine * 0.25;
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`
