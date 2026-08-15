// The matter palette: what a lifted letter is MADE of. Logo.tsx owns the
// springs and the crossing; logoLaw deals the substances; logoFields owns
// the blur pyramid; this file owns the GLSL (the flightShaders convention
// — a shader is data, and inlining it buries both files).
//
// The idea in one line: on the page every letter is INK; lifted, each
// letter becomes a different substance — balloon, foil, gummy, neon,
// chrome, pearl, velvet, holo, plasma, enamel — and the conductor
// re-deals substances the way it re-deals faces and colors, so in
// matter mode a beat TRANSMUTES a letter. A substance is a DECK ROW
// (MATTER_PARAMS), not a code path: every number that makes chrome
// chrome arrives as a uniform, and growing the set is adding a row.
//
//   · the surface — the glyph's own alpha is a height field, read from
//     TWO PRE-BLURRED COPIES of the letter's texture (logoFields: a
//     fine field at 1/4 resolution, a coarse field at 1/16). The fine
//     gradient is the edge shoulder; the coarse gradient is the pillow
//     — the inflation that makes a balloon a balloon. The fields are
//     genuinely band-limited, so their gradients are smooth by
//     construction. The first version instead point-sampled the RAW
//     mask on 8-tap rings at wide radii, and 8 taps do not blur — they
//     COPY: the neon "glow" was eight displaced letters (the
//     ghost-trail screenshot, 2026-08-14), the balloon's shading broke
//     along circular arcs (one arc per tap crossing the glyph edge),
//     and on low LOD tiers the tap gradients amplified the texel
//     lattice into flat-shaded rectangles. Field resolution is tied to
//     the CSS box, not the texture, so the look also survives every
//     tier swap.
//   · the body — the same height field that tilts the normal also
//     PUSHES the sheet (uRelief), and the letter's traced outline grows
//     side walls behind it (uSlab, built by logoSlab). Shading alone
//     always read as a picture of a dome; displacement and a real edge
//     are what make it a dome. Both ride the lift's progress, so both
//     are zero at a handoff and the letter lands as a flat sheet of its
//     own pixels.
//   · the light — Cook–Torrance GGX with Schlick Fresnel for the key,
//     plus an analytic STUDIO standing in for an HDRI: a graded room
//     and four softboxes — three working boxes behind the viewer, one
//     wide fill on the view axis — widened by roughness. A curved
//     surface sweeps its reflection across the boxes' soft edges,
//     which is the cue that reads as chrome instead of stripes. The
//     whole rig is on panel dials (uLight aims the key, five gains
//     scale the terms), all identity at the shipped look. The normal
//     is rotated into WORLD space per letter (uQuat), so the studio
//     stands still while the letters wobble under it.
//   · the exposure — lit color runs through an ACES fit before
//     compositing, so highlights roll off like film instead of
//     clipping into flat white bands.
//   · the motion — one shared description (MOTION_GLSL) on the same
//     contract as the height: the vertex displaces by it, the fragment
//     lights its exact slope (the earlier per-vertex slope banded
//     every glint into terraces). Three motions live there: the gel
//     WEAVE (two crossed traveling waves, on scale/speed/angle dials),
//     strike RINGS that radiate from a tap or a re-deal and ring down
//     per matter, and a travel STRETCH — area-conserving squash-and-
//     stretch along the velocity the prism already disperses on.
//   · prism fringe — the three channels sample at offsets along the
//     letter's velocity: dispersion belongs to motion.
//   · glow — an emissive channel, not a matter: the ink becomes the
//     tube (neon fully, plasma halfway), plus a halo of its own light
//     OUTSIDE the glyph. The halo is a two-lobe bloom — the coarse
//     field's excess coverage over the sharp alpha, under a skirt from
//     the pyramid's widest level — because one lobe alone dies at its
//     blur's support edge, and an edge on a glow is a sticker.
//   · sheen and iridescence — the other two pop channels: a grazing-
//     angle fabric rim (velvet), and a thin-film tint walking with the
//     view angle across the specular (pearl's glints, holo's mirror).
//
// Identity is guarded at the SWAP EDGES: the final color is
// mix(page texel, shaded, uFx), and uFx rides the cooling gate below —
// zero through the last stretch of every crossing — so at both
// handoffs the letter is exactly its own pixels. Mid-flight the
// interiors relight fully; that is the transmutation, and the
// ink-band clause's wide tails absorb it.
//
// Premultiplied rules (decisions.md #5): the texture arrives
// premultiplied, the blur pyramid keeps it premultiplied, and the
// shaded result multiplies by alpha before the mix. Albedo comes from
// the FINE FIELD un-premultiplied (blurred rgb over blurred alpha — a
// weighted neighborhood, so no divide-by-tiny-alpha at lone edge
// texels). And the raw-ShaderMaterial encode rule: the sampler hands
// back linear, the canvas is sRGB, so the fragment ends with
// <colorspace_fragment> or every AA midtone sinks (the texel-vs-screen
// bisect, 2026-08-02).

import { RIPPLE } from './logoLaw'

/** The cooling law: everything that makes a letter a SUBSTANCE — its
 *  light, its relief, its extruded thickness — rides one choreography
 *  window on the lift's progress. `lift.range(from, distance)` is zero
 *  before `from` and full past `from + distance`, while the motions a
 *  letter shares with the page (depth, jelly, prism) ride plain
 *  progress. So a letter lifts as ink, becomes matter in flight, and
 *  freezes back to ink before touchdown: the last stretch on either
 *  side of a swap is literally the page's own pixels.
 *
 *  That is first a perceptual choice (matter cooling as it lands) and
 *  second what keeps the crossing-flash carry clause honest. Its
 *  ink-mask centroid is only a POSITION while the mask is ink, and
 *  anything that swells the mask near a swap moves it without moving a
 *  letter. Light does this — measured 2026-08-14: a ~7px mask arc on the
 *  landing tail against shots steady to 0.1px.
 *
 *  Relief and thickness join it here on the argument, not on a
 *  measurement: a sheet pushed toward the camera grows by perspective,
 *  and walls that open near a swap add area, so both would swell the
 *  mask in exactly the way light was caught doing. Zeroing them at the
 *  handoff is also what the identity theorem asks for on its own — a
 *  lifted letter must ADD nothing at progress 0. The gate has not been
 *  measured to be NECESSARY for either; it is the cheap way to make
 *  both unable to matter. */
export const MATTER_GATE = { from: 0.25, distance: 0.35 }

/** One substance, whole: everything the shader needs to render it,
 *  shape and surface together, so a matter is a row of data rather
 *  than a branch of code. Rows align 1:1 with LOGO_MATTERS (logoLaw)
 *  — logoShaders.test.ts pins the alignment. */
export interface MatterSpec {
  /** LOGO_MATTERS name, repeated here so the alignment is checkable. */
  name: string
  /** Weight of the fine field's gradient — the edge bevel. */
  shoulder: number
  /** Weight of the coarse field's gradient — the interior inflation.
   *  The pair most decides what a substance IS: a balloon is nearly
   *  all pillow, an enamel nearly all shoulder. The field SCALES are
   *  fixed by the blur pyramid (logoFields); these are unitless. */
  pillow: number
  /** Scales the whole height gradient into the normal. */
  dome: number
  /** Scale on the shared jelly knob (a neon tube is rigid). */
  jelly: number
  /** Scale on the shared prism knob (only gummy disperses fully). */
  prism: number
  /** GGX roughness. These four lived in the fragment as a branch
   *  ladder; a ladder makes adding a substance a shader edit, and the
   *  panel's trims could never reach a hardcoded number. */
  rough: number
  /** 0 dielectric … 1 metal. */
  metal: number
  /** Subsurface: diffuse wrap + edge transmission (the candy glow). */
  sss: number
  /** Normal-noise amplitude — crumpled foil, carried around walls. */
  crinkle: number
  /** Grazing-angle fabric rim — velvet's whole identity. */
  sheen: number
  /** Thin-film tint on the specular — pearl's glints, holo's mirror. */
  irid: number
  /** How much the ink IS the light: emissive core plus the halo.
   *  A DIAL, not a flag — plasma glows at half and stays a surface. */
  glow: number
}

export const MATTER_PARAMS: MatterSpec[] = [
  // ink — the page's own look; the lit branch never opens on it.
  { name: 'ink', shoulder: 0, pillow: 0, dome: 0, jelly: 0, prism: 0,
    rough: 0, metal: 0, sss: 0, crinkle: 0, sheen: 0, irid: 0, glow: 0 },
  // balloon — matte latex, all pillow, a whisper of rim.
  { name: 'balloon', shoulder: 0.45, pillow: 1.0, dome: 1.5, jelly: 0.4, prism: 0,
    rough: 0.34, metal: 0, sss: 0.3, crinkle: 0, sheen: 0.15, irid: 0, glow: 0 },
  // foil — crumpled metal, the crinkle is the read.
  { name: 'foil', shoulder: 1.0, pillow: 0.5, dome: 1.1, jelly: 0.25, prism: 0.35,
    rough: 0.16, metal: 1, sss: 0, crinkle: 0.4, sheen: 0, irid: 0, glow: 0 },
  // gummy — gel candy: deep subsurface, full jelly, full prism.
  { name: 'gummy', shoulder: 1.1, pillow: 0.45, dome: 1.0, jelly: 1, prism: 1,
    rough: 0.14, metal: 0, sss: 0.85, crinkle: 0, sheen: 0, irid: 0, glow: 0 },
  // neon — the ink is the tube; the surface is only a glaze on it.
  { name: 'neon', shoulder: 0.7, pillow: 0.3, dome: 0.55, jelly: 0.1, prism: 0,
    rough: 0.4, metal: 0, sss: 0, crinkle: 0, sheen: 0, irid: 0, glow: 1 },
  // chrome — the mirror: the studio does all the work.
  { name: 'chrome', shoulder: 0.9, pillow: 0.55, dome: 1.05, jelly: 0.12, prism: 0,
    rough: 0.05, metal: 1, sss: 0, crinkle: 0, sheen: 0, irid: 0, glow: 0 },
  // pearl — soft nacre: subsurface under iridescent glints.
  { name: 'pearl', shoulder: 0.5, pillow: 0.9, dome: 1.35, jelly: 0.3, prism: 0.15,
    rough: 0.28, metal: 0.2, sss: 0.5, crinkle: 0, sheen: 0.35, irid: 0.6, glow: 0 },
  // velvet — plush matte, lit almost entirely by its rim.
  { name: 'velvet', shoulder: 0.3, pillow: 1.0, dome: 1.45, jelly: 0.5, prism: 0,
    rough: 0.85, metal: 0, sss: 0.18, crinkle: 0, sheen: 1, irid: 0, glow: 0 },
  // holo — holographic foil: a crumpled mirror wearing the rainbow.
  { name: 'holo', shoulder: 1.0, pillow: 0.45, dome: 1.0, jelly: 0.3, prism: 0.8,
    rough: 0.12, metal: 1, sss: 0, crinkle: 0.55, sheen: 0, irid: 1, glow: 0 },
  // plasma — half emissive, half gel: proof glow is a dial.
  { name: 'plasma', shoulder: 0.6, pillow: 0.5, dome: 1.0, jelly: 0.6, prism: 0.3,
    rough: 0.5, metal: 0, sss: 0.4, crinkle: 0, sheen: 0, irid: 0.3, glow: 0.55 },
  // enamel — hard glazed ceramic: tight gloss, no depth to the color.
  { name: 'enamel', shoulder: 1.05, pillow: 0.5, dome: 1.05, jelly: 0.1, prism: 0.1,
    rough: 0.07, metal: 0, sss: 0.08, crinkle: 0, sheen: 0, irid: 0, glow: 0 },
]

// ── the blur pyramid's blit pass (logoFields runs it) ───────────────────

/** Fullscreen pass-through: the blit quad ignores every matrix. */
export const BLIT_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

/** One 3×3 tent-filtered downsample hop. Two hops (texture → 1/4 →
 *  1/16) give the two height fields; `uSpread` widens the taps so a 4×
 *  stride leaves no source texel uncovered. Values stay premultiplied
 *  and linear — no colorspace include here: render targets are storage,
 *  not screen. */
export const DOWN_FRAG = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uSrcTexel;
  uniform float uSpread;
  varying vec2 vUv;
  void main() {
    vec2 o = uSrcTexel * uSpread;
    vec4 s = texture2D(tSrc, vUv) * 0.25;
    s += (texture2D(tSrc, vUv + vec2(o.x, 0.0)) + texture2D(tSrc, vUv - vec2(o.x, 0.0)) +
          texture2D(tSrc, vUv + vec2(0.0, o.y)) + texture2D(tSrc, vUv - vec2(0.0, o.y))) * 0.125;
    s += (texture2D(tSrc, vUv + o) + texture2D(tSrc, vUv - o) +
          texture2D(tSrc, vUv + vec2(o.x, -o.y)) + texture2D(tSrc, vUv + vec2(-o.x, o.y))) * 0.0625;
    gl_FragColor = s;
  }
`

// ── the letter ──────────────────────────────────────────────────────────

/**
 * The letter's surface, described ONCE and shared by both stages.
 *
 * This exists because the two used to disagree. The vertex stage pushed
 * the sheet by `uRelief × field`, and the fragment built its normal from
 * the same fields scaled by unrelated hand-tuned gains — two numbers
 * describing one surface, free to drift apart. They did: turning relief
 * up changed the letter's shape and left its lighting alone, so the
 * letter was lit as one dome and shaped as another. That mismatch is
 * exactly what the eye reads as "painted", which is the tell relief was
 * built to remove.
 *
 * So there is now one height field, in CSS px, and one slope derived
 * from the same coefficients. What the vertex stage carries is a
 * FRACTION of it (uMeshFrac); the fragment always lights the whole
 * thing. That split is the ordinary displacement-versus-bump one, and it
 * has a useful consequence: uMeshFrac changes what the letter IS without
 * changing how it is LIT. At 0 the letter is a flat card lit as a dome —
 * the look the sheet shipped with. At 1 the mesh carries every px of it.
 * Sliding between them buys real parallax and a real silhouette and
 * restyles nothing, so the dial can be judged on its own.
 *
 * RELIEF_REF and FIELD_H are pinned, not free: at uRelief = RELIEF_REF
 * the slope below is arithmetically the gain pair (2.4 fine, 3.2 coarse)
 * the bump-only letter was tuned on, so that amplitude reproduces the
 * shipped lighting exactly. Retuning the look means moving FIELD_H and
 * saying so; it does not mean nudging one stage.
 */
const HEIGHT_GLSL = /* glsl */ `
  // The blur pyramid the height is read from (logoFields): alpha at 1/4
  // of the CSS box, and again at 1/16. Both stages sample them — the
  // vertex for the height, the fragment for its slope — so the samplers
  // belong to the description, not to either stage.
  uniform sampler2D tFine;
  uniform sampler2D tCoarse;
  // px of height at full coverage, already multiplied by the lift's
  // progress on the way in — so it is exactly zero at every handoff,
  // where the sheet must be the flat plane the registration snap was
  // computed for.
  uniform float uRelief;
  // 0..1 — how much of that height the MESH carries. The rest stays a
  // bump, which is where the sub-vertex detail (the fine shoulder,
  // foil's crinkle) belongs anyway.
  uniform float uMeshFrac;
  // CSS px per texel of the two fields (logoFields' FIELD_DS), passed
  // rather than repeated: a slope is px of rise per px of run, and the
  // two fields measure their run in differently sized texels.
  uniform vec2 uFieldPx;
  // The matter's own shape (MATTER_PARAMS): how much of the height comes
  // from the fine shoulder and how much from the coarse pillow, and the
  // overall gain. A balloon inflates from the pillow, an enamel gummy
  // from the shoulder.
  uniform float uShoulder;
  uniform float uPillowW;
  uniform float uDome;

  const float RELIEF_REF = 22.0;
  const vec2 FIELD_H = vec2(9.6, 51.2);

  /** Height in CSS px at one point, from the two fields' alpha. */
  float letterHeight(float fineA, float coarseA) {
    return (uRelief * uDome / RELIEF_REF) *
      (uShoulder * FIELD_H.x * fineA + uPillowW * FIELD_H.y * coarseA);
  }

  /** The share of that height a VERTEX GRID can carry: the coarse
   *  pillow, and only it.
   *
   *  The fine shoulder varies at one FIELD_DS.fine texel — 4 CSS px —
   *  and the sheet steps a vertex every SHEET_STEP_PX, also 4. The mesh
   *  therefore samples the fine field exactly at Nyquist, so pushing it
   *  through the grid does not make a letter rounder; it makes the grid
   *  visible. At the knob's ceiling that is 29 px of alternating z on a
   *  4 px cell (foil and gummy, relief 60) and the sheet shatters into
   *  facets — the artifact this function exists to remove. The
   *  shoulder stays a bump, where sub-vertex detail belongs, and the
   *  fragment still lights the WHOLE height either way. */
  float letterMeshHeight(float coarseA) {
    return (uRelief * uDome / RELIEF_REF) * uPillowW * FIELD_H.y * coarseA;
  }

  /** The same surface's slope, px of rise per px of run, from the two
   *  fields' gradients. Same coefficients, so the lighting can only ever
   *  describe the height above. */
  vec2 letterSlope(vec2 gFine, vec2 gCoarse) {
    return (uRelief * uDome / RELIEF_REF) *
      (uShoulder * FIELD_H.x * gFine / uFieldPx.x +
       uPillowW * FIELD_H.y * gCoarse / uFieldPx.y);
  }
`

/**
 * The letter's MOTION, described once and shared by both stages — the
 * same contract as HEIGHT_GLSL, for the same reason: the gel weave
 * used to live twice (vertex displacement, fragment lighting slope),
 * and two hand-kept copies of one field are drift with a deadline the
 * moment dials land on them. The vertex displaces by motionDisp, the
 * fragment lights motionSlope, and they can only be the same surface.
 *
 * Three motions, each zero at a handoff through its own folded gate:
 *   · the WEAVE — one swell field the whole WORD shares: phases are
 *     continuous in the word's frame (q + uWaveOrigin), so a crest
 *     marches out of one letter and into the next instead of six
 *     letters churning on private phase salts — that churn read as
 *     erratic shaking, never a wave (2026-08-14). It is a trochoid
 *     ORBIT (Gerstner), not a height field: every point of the sheet
 *     rolls in a small circle, surge in the plane against heave out
 *     of it. That is what a face-on eye can actually see — height
 *     alone reaches it only through lighting, and two thirds of the
 *     deck is too matte to carry lighting, so the sea was invisible
 *     on most of the word. The surge rolls the INK itself, which
 *     every matter shows. Steady: excitation never pumps it. uJelly
 *     is the orbit radius in px; 0 pins the flat plane.
 *   · the RINGS — a strike (a tap on the letter) drops a wave packet
 *     into the slot buffer: a ring expanding at fixed front speed,
 *     Gaussian along its radius, ringing down on RIPPLE.tau, thinning
 *     as it spreads. The physics arrives in plane px via uRipK (the
 *     RIPPLE em constants × font px).
 *   · the STRETCH — travel squashes and stretches the plane along
 *     uVelDir, area-conserving, soft-saturated JS-side
 *     (stretchAmount); at uStretch 0 the remap is identity exactly.
 *
 * Stretch remaps FINAL vertex positions only. Everything else — the
 * height fields, the weave, the rings — reads the undeformed plane
 * point q, which is what the fragment rebuilds from uv. uv is glued to
 * its vertex, so no vertex remap can move it, and the two stages agree
 * under stretch by construction rather than by bookkeeping.
 */
const MOTION_GLSL = /* glsl */ `
  uniform float uTime;
  // The letter's center in the shared word frame, px. The weave reads
  // q + uWaveOrigin: ONE wave field crosses the whole word. The salt
  // that once staggered each letter's phase made six letters churn
  // independently — erratic shaking, never a wave (2026-08-14).
  uniform vec2 uWaveOrigin;
  // The weave's orbit radius in px — surge and heave both — as knob ×
  // matter gate × the matter's floored softness.
  uniform float uJelly;
  // The weave's wave numbers (rad/px, wavelengths set from the font
  // size), its angular speeds (rad/s — WEAVE.w × the speed dial), and
  // its frame from the angle dial: (cos a, sin a).
  uniform vec2 uWaveK;
  uniform vec2 uWaveW;
  uniform vec2 uWaveDir;
  // The strike buffer: xy = ring center in plane px, z = birth time on
  // uTime's clock, w = strike power. Dead slots idle far in the past,
  // where the ring-down term rounds them to zero.
  uniform vec4 uRipples[${RIPPLE.slots}];
  // Ring physics in plane px and seconds: x = wave number (rad/px),
  // y = front speed (px/s), z = packet half-width (px), w = ring-down
  // time (s). The RIPPLE constants (logoLaw) × the letter's font px.
  uniform vec4 uRipK;
  // px a full-power strike displaces: knob × progress × the matter's
  // softness blend. Zero at every handoff.
  uniform float uRipAmp;
  // Travel: the unit direction of screen motion (the prism disperses
  // along it too) and the folded squash-and-stretch amount.
  uniform vec2 uVelDir;
  uniform float uStretch;

  /** The weave's two phases at undeformed plane point q — crossed
   *  waves traveling in opposite senses along the dialed frame,
   *  phased in the WORD's coordinates so the field is continuous
   *  from letter to letter. */
  vec2 wavePhases(vec2 q) {
    vec2 qw = q + uWaveOrigin;
    vec2 w = vec2(dot(qw, uWaveDir), dot(qw, vec2(-uWaveDir.y, uWaveDir.x)));
    return vec2(
      w.x * uWaveK.x + uTime * uWaveW.x,
      w.y * uWaveK.y - uTime * uWaveW.y
    );
  }

  /** How the two waves share the orbit: the swell dominates hard —
   *  one wave clearly travels, the cross ripple only seasons it. One
   *  constant feeds BOTH motionDisp and motionSlope — the two must
   *  describe the same surface, so the mix may exist only once. */
  const vec2 WEAVE_MIX = vec2(0.85, 0.15);

  /** Displacement at q: xy = in-plane drift (the weave's surge and
   *  each ring's radial push), z = height. One slot loop serves both,
   *  so the vertex pays the strike buffer once. */
  vec3 motionDisp(vec2 q) {
    vec2 a = wavePhases(q);
    vec2 t = vec2(-uWaveDir.y, uWaveDir.x);
    // The trochoid orbit, radius orb per wave: surge -orb·sin along
    // the wave's own axis against heave +orb·cos out of the plane.
    // The quarter turn between them IS the circle, and its sense is
    // the physics — a point riding a crest travels WITH the wave, so
    // a passing swell carries the paint rather than shaking it.
    // Crests pinch and troughs broaden, the way water and cloth do.
    vec2 orb = uJelly * WEAVE_MIX;
    vec3 d = vec3(
      -orb.x * sin(a.x) * uWaveDir - orb.y * sin(a.y) * t,
      orb.x * cos(a.x) + orb.y * cos(a.y)
    );
    for (int i = 0; i < ${RIPPLE.slots}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      vec2 rv = q - rp.xy;
      float r = max(length(rv), 1e-3);
      float behind = r - uRipK.y * age;
      float ring = uRipAmp * rp.w * step(0.0, age) * exp(-age / uRipK.w) *
        exp(-behind * behind / (uRipK.z * uRipK.z)) / (1.0 + r / (4.0 * uRipK.z));
      d.z += ring * sin(uRipK.x * behind);
      d.xy += (rv / r) * ring * cos(uRipK.x * behind) * 0.35;
    }
    return d;
  }

  /** The height gradient of motionDisp in MATERIAL coordinates — the
   *  q a fragment rebuilds from its uv, which is the same q its vertex
   *  displaced from. All three radial ring factors are differentiated
   *  (carrier, packet, spread): exact is cheaper than the argument
   *  about what to drop.
   *
   *  The surge tilts the true surface by a further 1/(1 - steepness ·
   *  cos), dropped on purpose: it is a few percent of shading at the
   *  shipped steepness (~0.22), it costs a divide that blows up at
   *  the trochoid's cusp, and the surge is already doing its real
   *  work in the paint, where a face-on eye is looking. */
  vec2 motionSlope(vec2 q) {
    vec2 a = wavePhases(q);
    vec2 t = vec2(-uWaveDir.y, uWaveDir.x);
    vec2 orb = uJelly * WEAVE_MIX;
    vec2 sl = -orb.x * uWaveK.x * sin(a.x) * uWaveDir
      - orb.y * uWaveK.y * sin(a.y) * t;
    for (int i = 0; i < ${RIPPLE.slots}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      vec2 rv = q - rp.xy;
      float r = max(length(rv), 1e-3);
      float behind = r - uRipK.y * age;
      float w2 = uRipK.z * uRipK.z;
      float pack = exp(-behind * behind / w2);
      float spread = 1.0 / (1.0 + r / (4.0 * uRipK.z));
      float base = uRipAmp * rp.w * step(0.0, age) * exp(-age / uRipK.w);
      float dz = base * pack * spread *
        (uRipK.x * cos(uRipK.x * behind)
          - (2.0 * behind / w2) * sin(uRipK.x * behind)
          - spread / (4.0 * uRipK.z) * sin(uRipK.x * behind));
      sl += dz * (rv / r);
    }
    return sl;
  }

  /** Travel deformation of a FINAL vertex position: area-conserving
   *  squash-and-stretch about the letter's center — long by 1 + s
   *  along the motion, thin by 1 / (1 + s) across it. */
  vec2 motionStretch(vec2 q) {
    float along = 1.0 + uStretch;
    vec2 t = vec2(-uVelDir.y, uVelDir.x);
    return uVelDir * (dot(q, uVelDir) * along) + t * (dot(q, t) / along);
  }
`

export const LETTER_VERT = /* glsl */ `
  ${HEIGHT_GLSL}
  ${MOTION_GLSL}
  // px of extrusion, on the same progress-multiplied footing as uRelief
  // above: zero at every handoff, where a wall must have no area.
  uniform float uSlab;
  varying vec2 vUv;
  // Object-space normal, the fragment's one way to tell a wall from the
  // sheet: the sheet is +z, a wall is horizontal (logoSlab).
  varying vec3 vNrm;
  // How far DOWN a wall this fragment stands: 0 at the top ring, where
  // the wall meets the face, 1 at the back. The sheet is all 0. The
  // fragment needs it to fillet the joint and to shade the run of the
  // edge, and neither is expressible from the normal alone — every
  // fragment of one wall quad shares a normal.
  varying float vWall;

  void main() {
    vUv = uv;
    vNrm = normal;
    vec3 p = position;
    // z arrives as a UNIT: 0 on the sheet and on every wall's top ring,
    // -1 on the back face. Thickness is therefore a multiply — it
    // animates without rewriting a vertex buffer, and at uSlab 0 every
    // wall quad collapses to a line and rasterizes nothing.
    float onSheet = step(-0.5, p.z);
    vWall = 1.0 - onSheet;
    p.z *= uSlab;
    if (uRelief * uMeshFrac > 0.0) {
      // EVERY vertex takes the height, not just the ones on the sheet.
      //
      // This carried an onSheet factor, and that factor was the black
      // holes. Relief lifted the front of the slab and left its back
      // pinned flat, so the walls did not stay walls: they stretched
      // and leaned by however far the surface above them had risen —
      // up to 209 px at the knob's ceiling (balloon, relief 60), on a
      // letter 291 px tall. Two things follow, and both were on screen.
      // Their baked normals still said "vertical", so a leaning wall
      // shaded like a flat card. And the ones leaning inward turned
      // away from the camera, where single-sided rendering culls them —
      // leaving a hole straight through the letter to the plate.
      //
      // Taking the height everywhere makes the slab a rigid extrusion
      // of the displaced outline: constant thickness, walls still
      // square to the face, nothing inverted. Wall tops and the back
      // cap carry the SHEET's uv, so they read the same height and the
      // whole body moves as one.
      p.z += letterMeshHeight(texture2D(tCoarse, uv).a) * uMeshFrac;
    }
    // The letter's motion (MOTION_GLSL, one description with the
    // fragment): weave and rings displace, then the travel stretch
    // remaps the plane. Both read the UNDEFORMED position — the same
    // q the fragment rebuilds from uv — and a wall takes the same
    // displacement and remap as the sheet above it, so the slab stays
    // rigid through every motion.
    vec3 md = motionDisp(p.xy);
    p.z += md.z;
    p.xy = motionStretch(p.xy + md.xy);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

export const LETTER_FRAG = /* glsl */ `
  ${HEIGHT_GLSL}
  ${MOTION_GLSL}
  // The letter's live pixels, premultiplied…
  uniform sampler2D tMap;
  // …and the band-limited alpha its outline was traced from — the
  // committed readback (logoFields.readAlphaField) uploaded whole. The
  // walls stand on this field's 0.5 isoline, so a solid letter's face
  // and cap harden onto the SAME field: one outline for one body.
  uniform sampler2D tTrace;
  // The pyramid's widest level (1/32 of the CSS box, logoFields): the
  // halo's skirt. The coarse field's support ends ~2 of its texels out
  // — ~32 CSS px — and a glow that ends there ends VISIBLY.
  uniform sampler2D tHalo;
  // 1/texture px for each sampler: tMap's feeds the prism offsets, the
  // field texels set the gradient step so slopes are per-field-texel —
  // field resolution rides the CSS box, so the look survives LOD tiers.
  uniform vec2 uTexel;
  uniform vec2 uTexelF;
  uniform vec2 uTexelC;
  // Plane size in CSS px — rebuilds the vertex-local position for the
  // exact wave slope; uFont scales the crinkle to physical size.
  uniform vec2 uPlane;
  uniform float uFont;
  // gloss knob × cooling-gated amplitude (zero for ink): the mix weight
  // between the page's exact pixels and the shaded substance.
  uniform float uFx;
  // prism offset in texels (knob × amplitude × speed × matter factor);
  // it disperses along uVelDir, which lives with the motion above.
  uniform float uPrism;
  // 0..1 — how open the slab is, on the same footing as uSlab in the
  // vertex stage: zero at every handoff. It decides when the letter
  // stops being a picture with a painted outline and becomes a body
  // with a geometric one.
  uniform float uSolid;
  // 0 is ink, anything above is a substance — and WHICH one no longer
  // matters in here: the deck row itself arrives in the uniforms
  // below (Logo.tsx folds the panel's trims in on the way). One
  // program, six letters, no recompiles when the conductor re-deals.
  uniform float uMatter;
  // The surface response — what the branch ladder used to hardcode.
  uniform float uRough;
  uniform float uMetal;
  uniform float uSss;
  uniform float uCrinkle;
  // The pop channels: grazing fabric rim, thin-film specular tint,
  // and how much the ink IS the light (with its halo).
  uniform float uSheen;
  uniform float uIrid;
  uniform float uGlow;
  // Per-letter stagger for the glow's pulse — six neon tubes must not
  // breathe in unison. The weave no longer touches it: motion phases
  // in the shared word frame (uWaveOrigin, 2026-08-14).
  uniform float uPhase;
  // The letter's world rotation: normals are lifted into world space so
  // the studio stands still while the letter wobbles under it.
  uniform vec4 uQuat;
  // The key light's direction, in WORLD space — the panel's two
  // position dials, shared by the analytic key and its softbox twin in
  // the studio, so the glint and the shading can never point apart.
  uniform vec3 uLight;
  // The rig's gains, all 1 at the shipped look (the conformance sweep
  // measures the studio at exactly those defaults): key brightness,
  // key softbox size, the two working fills together, the room grade,
  // and the front fill that keeps a flat mirror from a void.
  uniform float uKey;
  uniform float uKeySoft;
  uniform float uFill;
  uniform float uRoom;
  uniform float uFront;
  varying vec2 vUv;
  // The sheet's normal is +z; an extruded wall's is horizontal. That is
  // the whole test — one varying tells the two apart, and they want
  // different colors, different normals, and different alpha.
  varying vec3 vNrm;
  varying float vWall;

  const float PI = 3.14159265;

  // ── how a wall meets the face it hangs from ──
  //
  // These three numbers exist because a slab whose edge is shaded by a
  // different recipe than its face is not a solid — it is a picture
  // with a rim glued on, and the glue line is visible.
  //
  // px INWARD from the outline the wall reads its material from. The
  // outline is traced at the 0.5-coverage isoline, so the letter's own
  // texel there is half air: sampled in place a wall comes out a
  // translucent smear of its letter, which is a color step at the
  // joint no amount of lighting can hide. A wall is a CUT through the
  // material behind it, so it samples the material behind it.
  const float WALL_INSET = 2.5;
  // Fraction of the wall's run over which its normal is bent back
  // toward the face's. A true 90° joint shades as a crease — one
  // fragment of dome, the next of horizontal edge — and the eye reads
  // that step as a seam whether or not the geometry has one. Every
  // real edge carries a radius; this is that radius, in shading.
  const float WALL_FILLET = 0.4;
  // What the light is down at the back of the wall. The run of an edge
  // is the one place a letter can shade itself, and an evenly lit wall
  // reads as a painted band rather than a face turning away.
  const float WALL_FLOOR = 0.42;

  vec3 qrot(vec4 q, vec3 v) {
    return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
  }

  float h21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),
      mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  // One softbox: a Gaussian lobe around a direction, widened by
  // roughness — the cheap stand-in for prefiltered-mip convolution.
  vec3 softbox(vec3 d, vec3 c, float sz, vec3 tint, float rg) {
    float s = sz + rg * 0.5;
    return tint * exp((dot(d, c) - 1.0) / max(s * s, 1e-4));
  }
  // The studio standing in for an HDRI: a graded room (lit floor,
  // bright ceiling), a warm key box that FOLLOWS uLight, a cool fill
  // right, a dim floor bounce — and a wide, dim FRONT fill on the view
  // axis. The working boxes stand behind the camera (+z hemisphere)
  // because that is the only place a curved surface can reflect them
  // from. The front box exists because a FLAT mirror reflects straight
  // back past the camera, where those three never reach: with nothing
  // there, a chrome letter at full gloss returned only the room's low
  // grade and tonemapped BELOW the page's own ink — a letter-shaped
  // hole (2026-08-14). Light on the view axis is what makes a mirror
  // read as a mirror.
  //
  // Every term wears a panel gain, all 1 at the shipped look. The
  // sweep clause (logoShaders.test.ts) rebuilds the studio from this
  // source at those defaults, so its floors pin the rig AS SHIPPED and
  // the dials stay the bench's own excursions.
  //
  // The room's low grade is a perceptual floor, not set dressing. The
  // crease where two bulged strokes meet, and the fillet of an
  // extruded arris, sweep their normals BETWEEN the boxes — and what
  // the bare room returns there is the only light those fragments
  // get: the key's N.L is zero, and metal has no diffuse to fall back
  // on. At the first grade (0.035, 0.04, 0.05) the darkest visible
  // direction of the room measured 0.041 at foil roughness, which
  // tonemaps to ~8/255 — a black crack drawn along every corner of
  // the extruded letters (2026-08-14). This grade holds that worst
  // direction at ~0.096, about the plate ink itself, so a joint
  // shades instead of splitting. logoShaders.test.ts sweeps the room
  // and pins both floors.
  vec3 studio(vec3 d, float rg) {
    vec3 col = mix(vec3(0.09, 0.095, 0.105), vec3(0.15, 0.16, 0.18), smoothstep(-0.8, 0.5, d.y)) * uRoom;
    col += vec3(0.3, 0.28, 0.25) * smoothstep(0.1, 1.0, d.y) * uRoom;
    col += softbox(d, uLight, 0.09 * uKeySoft, vec3(2.4, 2.3, 2.15) * uKey, rg);
    col += softbox(d, normalize(vec3(0.7, 0.1, 0.5)), 0.18, vec3(0.5, 0.55, 0.65) * uFill, rg);
    col += softbox(d, normalize(vec3(0.05, -0.75, 0.45)), 0.2, vec3(0.22, 0.2, 0.18) * uFill, rg);
    col += softbox(d, normalize(vec3(0.12, 0.16, 0.98)), 0.35, vec3(0.35, 0.36, 0.4) * uFront, rg);
    return col;
  }

  // ACES fit (Narkowicz): film-like rolloff instead of clipped bands.
  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  void main() {
    // The cap is a surface only while the slab is open. Shut, it lies
    // in the sheet's own plane and would fight it for depth.
    if (vNrm.z < -0.5 && uSolid < 0.06) discard;

    // ── prism: per-channel dispersion along the motion vector ──
    // At uPrism 0 all three taps coincide and c is the plain texel —
    // identity by construction, not by branch.
    vec2 o = uVelDir * uPrism * uTexel;
    vec4 cr = texture2D(tMap, vUv + o);
    vec4 cg = texture2D(tMap, vUv);
    vec4 cb = texture2D(tMap, vUv - o);
    vec4 c = vec4(cr.r, cg.g, cb.b, (cr.a + cg.a + cb.a) / 3.0);

    // ── the silhouette, once the slab is open ──
    //
    // A sheet's outline is PAINTED: the texture's alpha ramps across
    // the glyph's antialiased fringe and the letter ends wherever that
    // ramp does. A slab's outline is GEOMETRY: the walls stand on the
    // 0.5 isoline of the TRACED field. Those are two different curves.
    // The first hardening stepped the sharp alpha instead — but the
    // traced field is band-limited (the readback tent, logoFields) and
    // the sharp alpha is not, and a blur moves an isoline at every
    // curve: into the material on concave runs, out of it on convex
    // ones. The two outlines parted by a px or two wherever curvature
    // was high, and the gap showed the dark cap as a serrated ring
    // inside every counter — while the hard step itself, texture
    // rather than geometry, got no help from MSAA and drew colored
    // stair-teeth along the bows (2026-08-14).
    //
    // So the face and the cap harden onto tTrace — the same field the
    // walls stand on — inside the lit branch below, where the albedo
    // that colors the skirt is in hand. uSolid is zero at both
    // handoffs, where the letter must be the page's exact pixels, so
    // the identity is untouched.
    vec4 outC = c;

    // A wall exists only while the slab is open, and the slab is shut at
    // both handoffs — so a wall has no page pixels to be identical to,
    // and it shades whether or not the cooling gate has opened.
    float wall = 1.0 - step(0.5, abs(vNrm.z));
    // The back cap is the third face of the body: the sheet again, at
    // the back of the slab, pointing the other way (logoSlab).
    float back = step(vNrm.z, -0.5);

    // uSolid opens the branch too: a solid letter needs its geometric
    // silhouette cut even at zero gloss, and the cut needs the albedo
    // computed in here to color the edge skirt.
    if (uMatter > 0.5 && (uFx > 0.001 || wall > 0.5 || uSolid > 0.001)) {
      // ── the surface: gradients of two smooth height fields ──
      // Central differences at one field texel, on hardware bilinear —
      // band-limited data, so the slopes are smooth by construction.
      vec4 hF = texture2D(tFine, vUv);
      vec4 hC = texture2D(tCoarse, vUv);
      vec2 gF = vec2(
        texture2D(tFine, vUv + vec2(uTexelF.x, 0.0)).a -
          texture2D(tFine, vUv - vec2(uTexelF.x, 0.0)).a,
        texture2D(tFine, vUv + vec2(0.0, uTexelF.y)).a -
          texture2D(tFine, vUv - vec2(0.0, uTexelF.y)).a
      ) * 0.5;
      vec2 gC = vec2(
        texture2D(tCoarse, vUv + vec2(uTexelC.x, 0.0)).a -
          texture2D(tCoarse, vUv - vec2(uTexelC.x, 0.0)).a,
        texture2D(tCoarse, vUv + vec2(0.0, uTexelC.y)).a -
          texture2D(tCoarse, vUv - vec2(0.0, uTexelC.y)).a
      ) * 0.5;
      // The coarse field doubles as local coverage: the thickness proxy
      // for transmission, and the halo source for neon.
      float thick = hC.a;

      // Albedo: the fine field un-premultiplied covers the edges (a
      // blurred neighborhood — no lone-texel alpha to divide by), the
      // sharp texel takes over inside.
      vec3 albF = clamp(hF.rgb / max(hF.a, 1e-3), 0.0, 1.0);
      vec3 alb = mix(albF, c.rgb / max(c.a, 0.25), smoothstep(0.2, 0.7, c.a));
      // A wall's material, read from the face a few px inside the
      // outline (WALL_INSET) along the wall's own normal — vNrm points
      // OUT of the material, so stepping against it goes in. This
      // replaced a sample of the coarse field, which is a 1/16 blur: on
      // a letter's stroke that blur is mostly the plate around it, so
      // every wall came out washed and dark against the face it hung
      // from. The sharp texel a hair inside is what the wall is a cut
      // through, so face and wall now meet in the same color.
      vec2 inUv = vUv - vNrm.xy * (WALL_INSET / uPlane);
      vec4 cIn = texture2D(tMap, inUv);
      vec3 albIn = clamp(cIn.rgb / max(cIn.a, 1e-3), 0.0, 1.0);
      alb = mix(alb, albIn, wall);
      // Transmission wants the same honesty: at the outline the coarse
      // field reads half coverage, which would light every gummy edge
      // as if it were a thin span.
      thick = mix(thick, texture2D(tCoarse, inUv).a, wall);

      // ── one outline for the whole body ──
      // Coverage is tTrace's own 0.5 isoline — the curve the walls
      // stand on — resolved to one screen pixel by fwidth: a real
      // antialiased edge, which the sharp step could never get (a
      // texture step is invisible to MSAA). The skirt lands on the
      // wall top in the wall's own color, and alb has already blended
      // to the blurred-neighborhood albedo where the sharp texel has
      // thinned out.
      float cov = texture2D(tTrace, vUv).r;
      float cw = max(fwidth(cov), 1e-4);
      float hardA = clamp((cov - 0.5) / cw + 0.5, 0.0, 1.0);
      outC = mix(outC, vec4(alb * hardA, hardA), uSolid);

      // ── the matter's surface, read off its deck row ──
      // The roughness floor is numeric, not aesthetic: at exactly zero
      // the GGX numerator is zero and the specular VANISHES instead of
      // sharpening — polish at full mirror must land here, not there.
      float rough = max(uRough, 0.03);
      float metal = uMetal;
      float sss = uSss;
      float crinkle = uCrinkle;

      // The motion slope, exact at this fragment (MOTION_GLSL — the
      // same weave and rings the vertex stage displaced by).
      vec2 p = (vUv - 0.5) * uPlane;
      vec2 wslope = motionSlope(p);

      // The normal, from the SHARED slope (letterSlope) — the exact
      // surface the vertex stage displaced a uMeshFrac share of, whether
      // that share is all of it, none of it, or somewhere between. The
      // gel slope and foil's crinkle fold in on top: both are finer than
      // the vertex grid can carry, so they are bump by construction.
      //
      // The fine gradient is the painted shoulder: it is zero inside
      // the glyph and lives only in the few px where the alpha ramps
      // off — it is how a FLAT letter fakes a rounded edge. A solid
      // letter draws that edge with geometry (walls, fillet, cap), so
      // keeping the paint draws the edge twice: the second drawing is
      // a band of near-in-plane normals aimed at the room's darkest
      // quarter, a dark line scribed along every corner with a
      // specular flash beside it (2026-08-14). uSolid is the same
      // ramp that hardens the alpha onto the wall line, so the paint
      // hands the edge to the geometry in the one motion.
      // The motion slope folds in at FULL strength. A face-on plane
      // shows its z-motion almost only through lighting, so a mute
      // here mutes the wave itself — the ×0.6 that once sat on wslope
      // was half of why the weave read as a rumble (2026-08-14).
      // Amplitude belongs to the dials and the law (WEAVE), not to a
      // hidden factor in the normal.
      vec2 slope = letterSlope(gF * (1.0 - uSolid), gC);
      vec3 n = normalize(vec3(-slope - wslope, 1.0));
      vec2 wob = vec2(0.0);
      if (crinkle > 0.0) {
        vec2 np = p * (22.0 / uFont);
        wob =
          vec2(vnoise(np) - 0.5, vnoise(np + 19.7) - 0.5) +
          0.5 * vec2(vnoise(np * 2.7) - 0.5, vnoise(np * 2.7 + 7.3) - 0.5);
        n = normalize(vec3(n.xy + crinkle * wob, n.z));
      }
      // The wall's shape is its geometry, not the height field: it is a
      // real face standing off the sheet, and it wants the face's own
      // normal so it sweeps the studio as the letter turns.
      //
      // But only once it is clear of the joint. At vWall 0 the wall
      // takes the FACE's normal exactly, so the two sides of the top
      // ring are one continuous surface, and it turns to its own over
      // the first WALL_FILLET of its run.
      n = normalize(mix(n, vNrm, wall * smoothstep(0.0, WALL_FILLET, vWall)));
      // The cap is the face translated backward, so its outward normal
      // is the face's negated — including the dome's tilt, which it
      // carries because it was displaced by the same height.
      n = mix(n, -n, back);
      if (crinkle > 0.0) {
        // The same crinkle carried around the corner, in the wall's own
        // tangent plane (along the outline, and down the run). Foil
        // that smooths out the moment it turns the edge is foil printed
        // on plastic.
        vec3 wt = normalize(cross(vNrm, vec3(0.0, 0.0, 1.0)));
        n = normalize(n + wall * crinkle * (wob.x * wt + wob.y * vec3(0.0, 0.0, 1.0)));
      }
      n = qrot(uQuat, n);

      // ── Cook–Torrance key + studio IBL ──
      vec3 V = vec3(0.0, 0.0, 1.0);
      vec3 L = normalize(uLight);
      vec3 H = normalize(L + V);
      float NdV = max(dot(n, V), 1e-3);
      float NdL = max(dot(n, L), 0.0);
      float NdH = max(dot(n, H), 0.0);
      float VdH = max(dot(V, H), 0.0);
      vec3 F0 = mix(vec3(0.04), mix(alb, vec3(1.0), 0.25), metal);
      // Thin-film iridescence: a hue that walks with the view angle
      // AND the surface's own height, so the bands curve around the
      // dome instead of ruling flat stripes. It multiplies BOTH
      // specular paths and only them — a dielectric shows it in the
      // glints (pearl), full metal across the whole mirror (holo) —
      // so at uIrid 0 the tint is exactly 1 and nothing moved.
      vec3 iridT = mix(
        vec3(1.0),
        0.5 + 0.5 * cos(6.2832 * ((1.0 - NdV) * 1.6 + hF.a * 0.9 + vec3(0.0, 0.33, 0.67))),
        uIrid);
      float a2 = rough * rough;
      a2 *= a2;
      float D = a2 / (PI * pow(NdH * NdH * (a2 - 1.0) + 1.0, 2.0));
      float k = rough * rough * 0.5;
      float Vis = 0.25 / ((NdL * (1.0 - k) + k) * (NdV * (1.0 - k) + k) + 1e-4);
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - VdH, 5.0);
      vec3 KEY = vec3(2.6, 2.5, 2.3) * uKey;
      // Wrap lighting stands in for subsurface scattering on the
      // diffuse term: light bleeds past the terminator on soft matter.
      float wrap = sss * 0.5;
      float NdLw = clamp((dot(n, L) + wrap) / (1.0 + wrap), 0.0, 1.0);
      vec3 lit = (1.0 - metal) * (1.0 - F) * alb / PI * KEY * NdLw;
      lit += D * Vis * F * KEY * NdL * iridT;
      vec3 R = reflect(-V, n);
      lit += (1.0 - metal) * alb * studio(n, 1.0) * 0.55;
      vec3 Fibl = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - NdV, 5.0);
      lit += studio(R, rough) * Fibl * iridT;
      // Sheen: the retroreflective rim of a fibrous surface — velvet's
      // whole identity, pearl's softness. The energy is borrowed from
      // the wide studio so the rim dims with the room instead of
      // floating free of it.
      lit += uSheen * pow(1.0 - NdV, 3.0) * mix(alb, vec3(1.0), 0.4) * studio(n, 0.9) * 1.5;
      // Transmission: thin spans glow in their own color — the candy
      // edge light that makes gummy read as gel rather than plastic.
      lit += sss * alb * (1.0 - thick) * (0.5 + 0.5 * studio(-n, 1.0)) * 1.2;

      float pulse = 0.9 + 0.1 * sin(uTime * 9.0 + uPhase * 3.0);
      if (uGlow > 0.001) {
        // The ink IS the light, by uGlow's share: emissive core toward
        // white over the PBR pass held back to a glaze. Neon is 1 and
        // all tube; plasma is 0.55 and stays half a surface. Past 1
        // the trim OVERDRIVES the core rather than extrapolating the
        // mix off the end of its ramp.
        vec3 core = mix(alb, vec3(1.0), 0.6) * 2.6 * (1.0 + 0.5 * max(uGlow - 1.0, 0.0)) * pulse;
        lit = mix(lit, core + lit * 0.2, min(uGlow, 1.0));
      }

      // Down the run of the wall, into the page and away from the key —
      // and the cap, which is the far end of that same run.
      lit *= mix(1.0, WALL_FLOOR, max(wall * vWall, back));

      // One tail for both faces of the letter — this used to be an
      // early return, and an early return is a second shader. Whatever
      // the face gained, the edge did not.
      //
      // The only thing a wall needs said differently is what it stands
      // in for at zero gloss: the face has the page's own texel to be
      // identical to, and a wall has no page pixels at all — the slab
      // is shut at both handoffs. So it stands in its own material,
      // opaque, because it IS matter rather than a picture of matter.
      // Past this line the two are one surface.
      vec4 base = mix(outC, vec4(albIn, 1.0), wall);
      // Exposure, premultiply, and the identity mix: uFx is the cooled
      // gate — zero at every swap edge, so the mix lands on the page's
      // exact pixels there.
      outC.rgb = mix(base.rgb, aces(lit) * base.a, uFx);
      outC.a = base.a;

      // The halo belongs to the FRONT face only. On a wall it would
      // smear along the tube; on the back cap it re-projects as a
      // detached ring of glow floating behind the letter, offset by
      // however far the tilt has swung the slab.
      if (uGlow > 0.001 && wall + back < 0.5) {
        // Light OUTSIDE the glyph: each blur level's excess coverage
        // over the sharp alpha. ONE level is a sticker — the coarse
        // field's support ends ~32 CSS px out, and the old ×1.9 gain
        // saturated the inner half so the entire falloff happened in
        // the last few px of that support (the sudden edge,
        // 2026-08-14). Two lobes an octave apart, no gain, decay into
        // each other the way a bloom stack does: a bright core under a
        // skirt twice as wide, and the eye never meets a support edge.
        vec4 hW = texture2D(tHalo, vUv);
        float haloF = clamp(0.5 * max(thick - c.a, 0.0) + 0.62 * max(hW.a - c.a, 0.0), 0.0, 1.0);
        float haloA = clamp(uFx * uGlow * haloF * haloF * 1.1 * pulse, 0.0, 1.0);
        // The skirt must reach zero BEFORE the capture box does, or
        // the box guillotines it into a faint rectangle.
        vec2 vm = min(vUv, 1.0 - vUv);
        haloA *= smoothstep(0.0, 0.16, vm.x) * smoothstep(0.0, 0.16, vm.y);
        // Tinted by both lobes' own blurred color, held nearer the ink
        // than the old white wash — a neon halo is colored light.
        vec3 glowC = clamp((hC.rgb + hW.rgb) / max(hC.a + hW.a, 1e-3), 0.0, 1.0);
        outC.rgb += mix(glowC, vec3(1.0), 0.25) * haloA;
        outC.a += haloA * (1.0 - outC.a);
      }
    }

    if (outC.a < 0.004) discard;
    gl_FragColor = outC;
    // Linear in from the sampler, sRGB out to the canvas (flightShaders'
    // hard rule for any material sampling useSurfaceTexture).
    #include <colorspace_fragment>
  }
`
