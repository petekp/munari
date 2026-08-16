// The glass is a distance field, not a mesh. Every glass panel builds on
// this file.
//
// The mesh spike gave every panel an extruded rounded-rect wearing drei's
// MeshTransmissionMaterial, and paid for it with one full scene render PER
// PANEL: MTM refracts by sampling a screen-space buffer, so each panel needs
// its own buffer with itself (and everything in front of it) hidden. Three
// panels, three scene renders, and the bookkeeping to keep them ordered.
//
// This is the other way round. Render the scene ONCE, then composite each
// panel as a full-screen pass that:
//
//   1. rebuilds the eye ray for the pixel and intersects it with the panel's
//      own plane — so the panel keeps an arbitrary 3D pose; the SDF is
//      evaluated in PANEL-LOCAL 2D, not in screen space,
//   2. evaluates a rounded-rect SDF there. That is the whole shape: no
//      geometry, no curveSegments, no MSAA — coverage comes out of the
//      distance with an exact analytic antialias,
//   3. builds a bezel normal from the SDF's gradient and an analytic height
//      profile, refracts the eye ray through it, and samples the ACCUMULATED
//      image behind it,
//   4. lays the panel's own DOM texture on top, unrefracted, clipped by the
//      same coverage that drew the glass.
//
// Because the passes ping-pong far→near, a panel samples the composite of
// everything already laid down behind it — glass, ink and world. Multi-level
// refraction is not a feature here, it's the shape of the loop; the mesh
// path's cumulative-hide ordering rule is deleted rather than
// reimplemented.
//
// Everything below runs in linear light: the scene FBO is HalfFloat, three
// forces NoToneMapping and a linear working space for any render into a
// target (WebGLPrograms.js:176 — the spike's manual toneMapping save/restore
// was belt-and-braces), and BLIT_FRAGMENT is the one place tone mapping and
// the sRGB transfer happen, once, on the way to the screen.

/** Shared by both passes: a full-screen quad that ignores the camera. */
export const QUAD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

/**
 * One glass panel, composited over `tSrc`.
 *
 * `SAMPLES` is a define (8 is the tuned default): each sample walks one step
 * along a spectral ramp, so a single loop buys BOTH dispersion (the step
 * indexes an ior between ior±chroma) and frost (it also jitters the sample
 * point). Weighting the taps by a spectral response and normalising means
 * chroma=0 degrades to a plain blur instead of a tinted one.
 *
 * `MAX_BLOBS` and `MAX_RECTS` are the others: the panel may carry up to that
 * many coplanar satellites — circles and rounded rects — smooth-min-unioned
 * into its field. That union is the reason the shape had to stop being a mesh
 * — two meshes can only overlap, but two distances can merge, and the neck
 * between them is three lines of arithmetic rather than a remesh.
 *
 * A panel therefore need not be one card. It can be a LAYOUT: a rail and a
 * pane that started life as the same rounded rect, a column of message
 * bubbles that fuse where they crowd. One pass, one bezel, one refraction,
 * and the boundaries between the parts are decided by a blend radius rather
 * than by a scene graph.
 */
export const GLASS_FRAGMENT = /* glsl */ `
precision highp float;

varying vec2 vUv;

uniform sampler2D tSrc;      // everything composited so far (linear)
uniform sampler2D tDepth;    // scene depth, for occlusion
uniform sampler2D tInk;      // the panel's live DOM (premultiplied, sRGB tex)
uniform bool  uHasInk;
uniform float uInkOpacity;
// The DOM's own frame in panel-local units: xy = centre, zw = half extents.
// Decoupled from the field on purpose. The ink is a property of the PANEL,
// not of whatever the field currently happens to be — so a shell can melt
// from one rounded rect into two without dragging its texture along, and a
// column of bubbles can share a single DOM that spans all of them.
uniform vec4  uInkRect;

// camera
uniform vec3  uCamPos;
uniform mat4  uInvProjView;  // clip -> world
uniform mat4  uProjView;     // world -> clip
uniform mat4  uView;         // world -> view
uniform float uNear;
uniform float uFar;

// panel frame
uniform mat4  uPanelInv;     // world -> panel local
uniform mat3  uPanelRot;     // panel local -> world (rotation)
uniform vec2  uHalf;         // half extents, world units
uniform float uRadius;       // corner radius, world units
// ...and whether that rect is in the field at all. A panel whose shape is
// entirely satellites (a chat rail that is only its rows) turns it off; the
// rect then survives solely as the ink's default frame and the raycast quad.
uniform bool  uHasBase;

// satellites: shapes COPLANAR with the panel (same local z = 0), unioned
// into its field with a smooth minimum. They carry no DOM of their own —
// they are shape, not surface; the panel's one texture spans all of them.
//   uBlobs: xy = centre, z = radius (a circle, three ops)
//   uRects: xy = centre, zw = half extents; uRectR = corner radius
uniform vec3  uBlobs[MAX_BLOBS];
uniform int   uBlobCount;
uniform vec4  uRects[MAX_RECTS];
uniform float uRectR[MAX_RECTS];
uniform int   uRectCount;
uniform float uSmooth;       // blend radius: how far out a neck forms

// ripples: expanding wave packets on the panel's surface, emitted where a
// satellite makes or breaks contact. xy = origin (panel-local), z = age in
// seconds, w = signed amplitude (negative for a release, so the surface
// recoils instead of swelling).
uniform vec4  uRipples[MAX_RIPPLES];
// The velocity of whatever MADE each ripple, panel-local world units per
// second. This is what stops a ripple being a circle: see the Doppler note
// down in the wave loop. A ripple uploaded with zero velocity reproduces the
// stationary law exactly, so this is a strict extension of it.
uniform vec2  uRippleVel[MAX_RIPPLES];
uniform float uRippleWaveSpeed;  // reference c, for v/c
uniform int   uRippleCount;
uniform float uRippleK;      // phase constant, 4/(27 sigma/rho) — sets scale
uniform float uRippleNu;     // viscosity: how fast short waves are eaten
// Source RADIUS, PER RIPPLE — a contact is not a delta, and crucially not
// every contact is the same size. This is the knob that separates an impact
// from a release: see the note at the source term in the wave loop.
uniform float uRippleSrcR[MAX_RIPPLES];
uniform float uRippleDecay;  // bulk loss, seconds
uniform float uRippleInk;    // 0 = the DOM stays flat and crisp (see below)

// glows: light struck INTO the glass where a pointer landed. Same array
// contract as the ripples — xy = origin (panel-local), z = age in seconds,
// w = amplitude — but a ripple bends the surface and a glow does not touch
// it at all. This is emission: the panel stops being purely a lens for one
// beat and becomes a source, which is why it is added after the refraction
// loop and before the ink. The label keeps its own pixels and the light
// comes out from underneath it.
uniform vec4  uGlows[MAX_GLOWS];
uniform int   uGlowCount;
uniform vec3  uGlowColor;
uniform float uGlowReach;    // how far the bloom opens, world units
uniform float uGlowLife;     // seconds from strike to dark

// glass
uniform float uBezel;        // width of the lensing rim, world units
uniform float uThickness;    // height of the bezel bulge, world units
uniform float uSpread;       // how far the refracted ray travels before we
                             // re-project it — the strength of the bend
uniform float uIor;
uniform float uChroma;
uniform float uRough;        // frost
uniform vec3  uTint;
uniform float uTintAmount;
uniform float uEdgeLight;    // gain on the light piped out at the rim
uniform float uEdgeReflect;  // how much environment the grazing bezel mirrors
uniform float uEdgeWarp;     // peak displacement of the living boundary
uniform float uEdgeWarpSpeed;
// The one genuine clock in this shader. Everything else here takes an AGE the
// compositor already differenced, because an event knows how old it is and not
// what time it is. A standing oscillation is the exception that proves it: it
// is not an event, it has no birth to be measured from, so it needs the wall
// clock itself.
uniform float uTime;
uniform float uSpecular;
uniform vec3  uLightDir;

// A rounded rect as a signed distance. Negative inside, and — unlike a
// coverage mask — it keeps meaning outside the shape, which is what the
// bezel profile below is a function of.
float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 d = abs(p) - b + r;
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - r;
}

// Its gradient — the outward direction, unit length everywhere the field is
// a true distance. This is the "which way does the rim face" that a mesh
// would have had to store as vertex normals.
vec2 sdRoundRectGrad(vec2 p, vec2 b, float r) {
  vec2 s = sign(p);
  vec2 d = abs(p) - b + r;
  if (d.x > 0.0 && d.y > 0.0) return s * normalize(d);
  return (d.x > d.y) ? vec2(s.x, 0.0) : vec2(0.0, s.y);
}

// Polynomial smooth minimum (iq). A plain min() unions two shapes with a
// crease; this one trades a band of width k around the seam for a tangent
// join — which is the entire liquid effect. Nothing about it is a special
// case: the union of a card and a circle IS one shape, so it gets one
// coverage, one bezel, one refraction, and a rim that flows around the neck.
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

// The panel's whole field. A circle needs no new primitive — but it does
// need its own cheap one, because sdRoundRect with b = vec2(r) would be an
// exact circle and three times the arithmetic.
//
// EMPTY is the identity of smin, not a special case: h clamps to 0 against
// anything finite, so smin(EMPTY, x, k) is exactly x. A panel with no base
// rect and no satellites therefore reports a huge positive distance, which
// the coverage test below rejects on its own. Nothing has to check for it.
const float EMPTY = 1e5;

// A body held together by surface tension does not have an OUTLINE, it has a
// boundary that is still being negotiated — and a rounded rect that holds
// perfectly still announces that it was authored rather than formed. This
// perturbs the distance itself, which is why the effect is structural rather
// than decorative: the bezel, the normal, the coverage test and the ripples'
// rim absorption all read the same field, so they all follow the new edge
// without knowing anything about it.
//
// Three angular harmonics at rates that share no small integer factor, drifting
// at speeds that likewise don't, so the boundary never repeats within any span
// a viewer will sit through. Weighted to sum to 1 so the amplitude means what
// it says: peak displacement in world units.
//
// Kept SMALL on purpose. This is a distance field, and adding an angle-varying
// term to one costs it the property that its gradient has unit length; a few
// percent of the panel is invisible to everything downstream, a large warp
// would make the bezel width drift around the outline.
float edgeWarp(vec2 p) {
  if (uEdgeWarp <= 0.0) return 0.0;
  float a = atan(p.y, p.x);
  float s = uTime * uEdgeWarpSpeed;
  return uEdgeWarp * (
      sin(3.0 * a + s * 0.53)
    + 0.60 * sin(5.0 * a - s * 0.37)
    + 0.35 * sin(8.0 * a + s * 0.71)
  ) * 0.5128;
}

float fieldAt(vec2 p) {
  float d = uHasBase ? sdRoundRect(p, uHalf, uRadius) : EMPTY;
  for (int i = 0; i < MAX_RECTS; i++) {
    if (i >= uRectCount) break;
    d = smin(d, sdRoundRect(p - uRects[i].xy, uRects[i].zw, uRectR[i]), uSmooth);
  }
  for (int i = 0; i < MAX_BLOBS; i++) {
    if (i >= uBlobCount) break;
    d = smin(d, length(p - uBlobs[i].xy) - uBlobs[i].z, uSmooth);
  }
  // After the union, so the warp travels around the MERGED silhouette — an
  // orb halfway into the card gets the same living edge as the card does,
  // and the neck between them breathes instead of sitting still.
  return d - edgeWarp(p);
}

float viewZFromDepth(float depth, float near, float far) {
  float z = depth * 2.0 - 1.0;
  return (2.0 * near * far) / (far + near - z * (far - near)) * -1.0;
}

vec2 projectToUv(vec3 world) {
  vec4 clip = uProjView * vec4(world, 1.0);
  return clip.xy / clip.w * 0.5 + 0.5;
}

// Golden-angle spiral: cheap, isotropic, and no texture lookup.
vec2 spiralTap(int i, int n) {
  float f = (float(i) + 0.5) / float(n);
  float a = float(i) * 2.39996323;
  return vec2(cos(a), sin(a)) * sqrt(f);
}

vec3 spectralWeight(float f) {
  return max(vec3(
    smoothstep(0.62, 0.0, f),
    1.0 - abs(f - 0.5) * 2.0,
    smoothstep(0.38, 1.0, f)
  ), vec3(0.0));
}

void main() {
  vec3 base = texture2D(tSrc, vUv).rgb;

  // --- the eye ray, rebuilt from the pixel ------------------------------
  vec4 farClip = uInvProjView * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 rd = normalize(farClip.xyz / farClip.w - uCamPos);

  // --- intersect the panel's own plane (local z = 0) --------------------
  vec3 lo = (uPanelInv * vec4(uCamPos, 1.0)).xyz;
  vec3 ld = (uPanelInv * vec4(rd, 0.0)).xyz;
  if (abs(ld.z) < 1e-6) { gl_FragColor = vec4(base, 1.0); return; }
  float t = -lo.z / ld.z;
  if (t <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
  vec2 q = (lo + ld * t).xy;

  // --- coverage: the shape IS the distance ------------------------------
  float d = fieldAt(q);
  float aa = max(fwidth(d), 1e-6);
  float cov = 1.0 - smoothstep(-aa, aa, d);
  if (cov <= 0.002) { gl_FragColor = vec4(base, 1.0); return; }

  // --- occlusion against the one scene render ---------------------------
  // View-space z is negative ahead of the camera, so "nearer" is greater.
  // Background pixels sit at depth 1 → -far → never in front of anything.
  vec3 hit = uCamPos + rd * t;
  float panelZ = (uView * vec4(hit, 1.0)).z;
  float sceneZ = viewZFromDepth(texture2D(tDepth, vUv).x, uNear, uFar);
  if (sceneZ > panelZ + 1e-4) { gl_FragColor = vec4(base, 1.0); return; }

  // --- the bezel, as a height field over the distance -------------------
  // h(d) rises from 0 at the outline to uThickness over uBezel, on a
  // quarter-circle profile, then goes flat. The normal is what that slope
  // does to the gradient direction — a lens rim with no vertices in it.
  float e = clamp(-d / uBezel, 0.0, 1.0);
  float k = 1.0 - e;
  float prof = sqrt(max(1.0 - k * k, 0.0));
  float slope = (e >= 1.0) ? 0.0 : -uThickness * (k / max(prof, 0.02)) / uBezel;
  // With satellites in the field the analytic gradient is wrong — it only
  // knows the rect. A central difference on the UNIONED field is what makes
  // the rim follow the merged outline: through the neck the normal turns
  // continuously from card to blob, so the lens does too, and the two read as
  // one body of glass rather than two overlapping ones. Four extra field
  // evaluations, and only on covered pixels (the early-outs are above).
  vec2 g;
  // The warp disqualifies the analytic path for the same reason satellites do:
  // sdRoundRectGrad only knows the rect, so it would return the gradient of a
  // boundary that is no longer the one being drawn, and the rim would light a
  // silhouette the coverage test disagrees with.
  if (uBlobCount == 0 && uRectCount == 0 && uHasBase && uEdgeWarp <= 0.0) {
    g = sdRoundRectGrad(q, uHalf, uRadius);
  } else {
    float eps = max(aa, 0.0015);
    vec2 gr = vec2(
      fieldAt(q + vec2(eps, 0.0)) - fieldAt(q - vec2(eps, 0.0)),
      fieldAt(q + vec2(0.0, eps)) - fieldAt(q - vec2(0.0, eps))
    );
    g = dot(gr, gr) > 1e-12 ? normalize(gr) : vec2(0.0, 1.0);
  }

  // --- ripples: a capillary impulse, not a scrolled texture -------------
  // The bezel is already h(d) and the normal is already what h's slope does
  // to a direction, so a ripple needs no new machinery — it contributes a
  // second slope, along its own radial direction, and the two add.
  //
  // What it does need is to disperse. A rigid packet translated outward at a
  // fixed speed reads as a decal being scrolled; a real impact ring STRETCHES,
  // because different wavelengths travel at different speeds. At this scale
  // the regime is capillary (surface tension, not gravity): w = C k^(3/2), so
  // the group velocity is (3/2) C sqrt(k) and SHORT waves lead. Feeding the
  // stationary-phase condition r = v_group * t back into the phase collapses
  // the whole train to one expression:
  //
  //   theta(r,t) = K r^3 / t^2,        K = 4 / (27 C^2)
  //   k(r,t)     = d(theta)/dr = 3 K r^2 / t^2
  //
  // (Those two are consistent by construction — the derivative of the phase
  // IS the stationary wavenumber. Verified numerically before it was written.)
  // The pattern therefore gets finer outward and self-similar along
  // r ~ t^(2/3), which is what a fixed-wavelength packet cannot fake.
  vec2 tilt = -slope * g;
  vec2 rippleTilt = vec2(0.0);
  for (int i = 0; i < MAX_RIPPLES; i++) {
    if (i >= uRippleCount) break;
    vec4 rp = uRipples[i];
    vec2 dv = q - rp.xy;
    float r = max(length(dv), 1e-4);
    float t = max(rp.z, 0.02);

    // --- the wake leans the way the bead went ---------------------------
    // Everything else in this loop is a function of r alone, and a radially
    // symmetric function sampled at a radius is geometrically a texture
    // lookup no matter how good its radial profile is. That is what makes a
    // physically correct ripple still read as dead. Real impact rings are
    // not circles, and the reason is not noise — the thing that made them
    // was MOVING.
    //
    // A source travelling through a dispersive medium lays crests it emits
    // forward into ground it is closing on, so they bunch, and crests behind
    // into ground it is leaving, so they stretch. To first order that is the
    // classical Doppler factor, and it enters in exactly ONE place: the age
    // that sets the phase. A smaller age means a larger local wavenumber, so
    // the pattern compresses ahead and opens behind.
    //
    // Deliberately only tw — viscosity, bulk decay and the source spectrum
    // below all read the TRUE age t, because those are about how long the
    // wave has really been running and losing energy, not about the geometry
    // of where its crests landed.
    vec2 vel = uRippleVel[i];
    float sp = length(vel);
    float dopp = 1.0;
    if (sp > 1e-6) {
      float mach = min(sp / max(uRippleWaveSpeed, 1e-6), 0.65);
      dopp = 1.0 - mach * dot(vel / sp, dv / r);
    }
    float tw = t * dopp;

    float th = uRippleK * r * r * r / (tw * tw);
    float kk = 3.0 * uRippleK * r * r / (tw * tw);

    // Amplitude, three physical terms and no fudge:
    //   inversesqrt(r) — a circular front spreads its energy over a growing
    //     circumference, so the wave MUST weaken as it travels. Its absence
    //     was the loudest thing wrong with the first version.
    //   exp(-nu k^2 t) — viscosity eats short waves quadratically. This is
    //     also what gives the train a soft leading edge instead of the hard
    //     drawn ring a gaussian window produces.
    //   exp(-t/decay) — bulk loss, so the sheet eventually goes still.
    // A finite SOURCE. Modelling the contact as a delta impulse makes the
    // first frames sixteen times more violent than the last — the wave
    // arrives as a crack and then behaves. But a bead is not a point: it
    // cannot radiate wavelengths shorter than itself, and suppressing those
    // (a gaussian source spectrum) flattens the whole run to a smooth decay
    // without a single artificial ramp.
    // The source radius is PER RIPPLE, and that is what makes an impact and a
    // release different events rather than the same event at two volumes.
    //
    // A body striking a sheet loads it over its whole contact patch, so the
    // source is bead-sized and cannot radiate anything shorter than itself:
    // a broad, low-frequency, long-lived ring.
    //
    // A body LEAVING is a different phenomenon. The sheet does not let go
    // when the body does — capillary adhesion drags a liquid bridge out
    // behind it, the bridge necks under the Rayleigh–Plateau instability, and
    // the wave is launched at PINCH-OFF, from the neck. The neck is far
    // smaller than the body, so the source is small and the radiated spectrum
    // runs correspondingly finer. The energy is different in kind too: an
    // impact spends bulk kinetic energy, a pinch-off releases surface energy,
    // which is the smaller budget by a wide margin.
    //
    // So a release is not a quieter impact. It is a finer, tighter, faster-
    // fading disturbance, and it comes out of this one term — the shorter
    // waves a small source is free to radiate are also the ones viscosity
    // (exp(-nu k^2 t), just above) eats first.
    float srcR = uRippleSrcR[i];
    float src = exp(-0.5 * kk * kk * srcR * srcR);

    float amp = rp.w
      * inversesqrt(1.0 + r / 0.25)
      * exp(-uRippleNu * kk * kk * t)
      * src
      * exp(-t / uRippleDecay)
      // The same factor, once more: crests that bunch ahead of the source
      // have to put the energy they gain somewhere, and the ones stretching
      // behind have to give it up. One number driving both the spacing and
      // the brightness is why the wake looks like one phenomenon rather than
      // two effects tuned to agree.
      / dopp;

    // Nothing may oscillate faster than the pixel grid can carry. This is the
    // antialias, but it is not only cosmetic: those are exactly the waves
    // viscosity has already taken. aa is the panel's world units per pixel.
    amp *= 1.0 - smoothstep(1.0, 2.4, kk * aa);

    // h = amp cos(theta)  ->  dh/dr = -amp k sin(theta). The d(amp)/dr term
    // is dropped as slowly varying next to k.
    rippleTilt += (-amp * kk * sin(th)) * (dv / r);
  }
  // Waves break. Past a certain steepness a real surface stops being a
  // graph over the plane at all, so a soft saturation is nearer the truth
  // than letting an early frame fold the lens inside out.
  float steep = length(rippleTilt);
  if (steep > 1e-5) rippleTilt *= (1.0 / (1.0 + steep / 1.1));
  // The rim is a thick edge, not a membrane. Letting the wave die into it
  // keeps the one hairline that has to stay crisp from wobbling — and a
  // boundary that absorbs is closer to the truth than one that ignores.
  // (e is 1 on the flat glass, 0 at the outline.)
  rippleTilt *= e;
  tilt += rippleTilt;

  vec3 nLocal = normalize(vec3(tilt, 1.0));
  if (ld.z > 0.0) nLocal = -nLocal;   // seen from behind: the far face
  vec3 n = normalize(uPanelRot * nLocal);

  // --- refraction: dispersion and frost in one loop ---------------------
  // Frost is a property of the FLAT glass, and the rim is where the lens
  // does its work — blurring there (the first thing this shader did) turns
  // the bezel into a soft white halo and throws away the one detail the
  // whole approach buys: a crisp, strongly displaced edge. So the profile
  // runs the other way, easing OFF as the bezel takes over.
  float blur = uRough * 0.05 * (0.35 + 0.65 * e);
  vec3 acc = vec3(0.0);
  vec3 wsum = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++) {
    float f = (float(i) + 0.5) / float(SAMPLES);
    float ior = uIor + (f - 0.5) * 2.0 * uChroma;
    vec3 r = refract(rd, n, 1.0 / max(ior, 1.0001));
    if (dot(r, r) < 1e-6) r = reflect(rd, n);       // total internal reflection
    vec2 uv = projectToUv(hit + r * uSpread) + spiralTap(i, SAMPLES) * blur;
    vec3 w = spectralWeight(f);
    acc += texture2D(tSrc, clamp(uv, 0.001, 0.999)).rgb * w;
    wsum += w;
  }
  vec3 glass = acc / max(wsum, vec3(1e-4));

  // --- the surface's own light ------------------------------------------
  glass = mix(glass, uTint, uTintAmount);

  float fres = pow(1.0 - abs(dot(rd, n)), 5.0);
  vec3 lightDir = normalize(uLightDir);
  vec3 hv = normalize(lightDir - rd);   // "half" is a reserved word in GLSL
  float spec = pow(max(dot(n, hv), 0.0), 180.0) * uSpecular;

  // --- the edge, and why it is not an outline ---------------------------
  // This used to ADD a white hairline scaled by how close the pixel was to
  // the outline. That is a sticker, not an edge: a constant colour, blind to
  // everything the panel is standing in front of. Against a neon wall the
  // glass wore a cool white border belonging to no light in the scene, and
  // the eye reads that as a drawn stroke — the halo that looked tacked on.
  //
  // A real edge is never emitted. It is BORROWED, twice over:
  //
  //   reflection — the bezel curves away from the eye, so near the outline
  //     the view ray grazes it and the surface turns into a mirror. Fresnel
  //     is exactly how much. On an orange wall the edge reflects orange.
  //
  //   piped light — a ray travelling inside the sheet meets the curved edge
  //     past the critical angle and leaves there instead of continuing, so
  //     the outermost sliver carries a concentrated dose of what the glass
  //     is ALREADY transmitting.
  //
  // Both take their colour and their brightness from the scene, which is the
  // whole difference. It also means the edge now tracks the panel: darken the
  // content and the edge darkens with it, because there is less light inside
  // the sheet to leave at the rim. An additive constant could never do that.
  vec3 rr = reflect(rd, n);
  vec3 envRefl = texture2D(tSrc, clamp(projectToUv(hit + rr * uSpread), 0.001, 0.999)).rgb;
  glass = mix(glass, envRefl, clamp(fres * uEdgeReflect, 0.0, 1.0));
  // The hairline is a HAIRLINE: the outermost eighth of the bezel, where the
  // rim has turned far enough to pipe light out. A GAIN on what is there, not
  // a wash over it — widen it and the panel grows a chunky border instead of
  // an edge.
  float bezelBand = 1.0 - smoothstep(0.0, 0.14, e);
  glass *= 1.0 + bezelBand * uEdgeLight * (0.35 + fres);
  glass += spec;

  // --- the strike: light let into the glass where a pointer landed -------
  // Two terms, and the second is why a click reads as an event rather than a
  // lamp being switched on. The CORE is where the energy went in. The SHELL
  // is the front it left on: it opens as sqrt(age), the deceleration any
  // disturbance spreading into a resisting medium has, so the bloom lunges
  // and then eases instead of travelling at a constant speed like a decal
  // being scaled. Brightness falls twice over — once because the strike is
  // dying, once because what is left is spread across a growing disc.
  //
  // The white-hot heart is a POWER of the core, not a second gaussian: it
  // costs nothing extra and it guarantees the hot centre always sits exactly
  // inside the coloured falloff, which two independently tuned radii would
  // eventually let drift apart.
  for (int i = 0; i < MAX_GLOWS; i++) {
    if (i >= uGlowCount) break;
    vec4 gw = uGlows[i];
    float life = clamp(gw.z / uGlowLife, 0.0, 1.0);
    float s = 0.035 + uGlowReach * sqrt(life);
    float fade = (1.0 - life) * (1.0 - life);
    float rr = length(q - gw.xy) / s;
    float core = exp(-rr * rr * 0.5);
    // The front is a fixed FRACTION of the current radius wide, so it thins
    // in proportion as it opens rather than staying a drawn ring.
    float front = (length(q - gw.xy) - s) / (0.42 * s);
    float shell = exp(-front * front);
    // The heart is the SIXTH power of the core, not the third. Cubed, the
    // white ran most of the way to the falloff and the strike read as a pale
    // wash; at six it collapses to a hot centre with the colour doing all the
    // spreading, which is what a light source in a coloured medium actually
    // looks like.
    vec3 lit = uGlowColor * (core * 0.95 + shell * 0.6) + pow(core, 6.0) * 0.85;
    glass += lit * gw.w * fade;
  }

  // --- the ink, on top, in the panel's own UV ---------------------------
  // Clipped to the INK RECT, not to the coverage: the DOM is a property of
  // the panel, and a satellite the field has swallowed is glass with nothing
  // written on it. Without the clip the sampler's clamp-to-edge would smear
  // the texture's border row out across every blob.
  //
  // Note the other half of that: where the ink rect extends BEYOND the field
  // — the gaps between a column of message bubbles — the final mix() is
  // weighted by cov, which is zero there. So one DOM can span many separate
  // pieces of glass and simply not be drawn in between them. The layout is
  // the union; the texture is along for the ride.
  if (uHasInk) {
    vec2 iq = q - uInkRect.xy;
    float outside = max(abs(iq.x) - uInkRect.z, abs(iq.y) - uInkRect.w);
    float m = 1.0 - smoothstep(-aa, aa, outside);
    if (m > 0.0) {
      // The ink rides the wave only if asked to. It is laid on unrefracted
      // BY DESIGN — the world bends through the glass, the DOM sits on it
      // and stays crisp — so warping its UV trades the thesis for the
      // effect. Default 0; __glass.set('rippleInk', 0.4) to see the other
      // reading. (No backticks in here — they end the template literal.)
      vec2 iuv = (iq + rippleTilt * uRippleInk) / (2.0 * uInkRect.zw) + 0.5;
      vec4 ink = texture2D(tInk, iuv) * (uInkOpacity * m);   // premultiplied
      glass = glass * (1.0 - ink.a) + ink.rgb;
    }
  }

  gl_FragColor = vec4(mix(base, glass, cov), 1.0);
}
`

/** The only place the pipeline leaves linear light. */
export const BLIT_FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D tSrc;
void main() {
  gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
