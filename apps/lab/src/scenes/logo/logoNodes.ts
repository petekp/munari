// Logo materials — parameter rows and node materials for scene-rendered
// letters. logoLaw selects each material; logoScene supplies motion and
// uniforms; logoFields supplies the blur pyramid used for relief and lighting.
//
// Page presentation keeps the source's ink. Scene presentation can use
// balloon, foil, gummy, neon, chrome, pearl, velvet, holo, plasma or enamel.
// MATERIAL_PARAMS carries their values; adding a material adds a row rather
// than a shader branch.
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
//     PUSHES the sheet (relief), and the letter's traced outline grows
//     side walls behind it (slab, built by logoSlab). Shading alone
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
//     whole rig is on panel dials (light aims the key, five gains
//     scale the terms), all identity at the shipped look. The normal
//     is rotated into WORLD space per letter (quat), so the studio
//     stands still while the letters wobble under it.
//   · the exposure — lit color runs through an ACES fit before
//     compositing, so highlights roll off like film instead of
//     clipping into flat white bands.
//   · the motion — one shared description (motionDisp / motionSlope) on
//     the same contract as the height: the vertex displaces by it, the
//     fragment lights its exact slope (the earlier per-vertex slope banded
//     every glint into terraces). Three motions live there: the gel
//     WEAVE (two crossed traveling waves, on scale/speed/angle dials),
//     strike RINGS that radiate from a tap or a re-deal and ring down
//     per material, and a travel STRETCH — area-conserving squash-and-
//     stretch along the velocity the prism already disperses on.
//   · prism fringe — the three channels sample at offsets along the
//     letter's velocity: dispersion belongs to motion.
//   · glow — an emissive channel shared by materials: the ink becomes the
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
// mix(page texel, shaded, fx), and fx rides the cooling gate below —
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
// texels). And the encode rule: the sampler hands back linear and the
// canvas is sRGB, so the output must reach the canvas encoded or every
// AA midtone sinks (the texel-vs-screen bisect, 2026-08-02). The letter
// returns its premultiplied linear color through premultipliedOutput,
// which lands as that per-fragment encode did.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node, type TextureNode, type UniformArrayNode, type UniformNode } from 'three/webgpu'
import {
  Discard,
  Fn,
  If,
  Loop,
  abs,
  clamp,
  cos,
  cross,
  dot,
  exp,
  float,
  floor,
  fract,
  length,
  max,
  min,
  mix,
  normalGeometry,
  normalize,
  positionGeometry,
  pow,
  reflect,
  sin,
  smoothstep,
  step,
  uniform,
  uniformArray,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'
import { passMaterial } from '@petepetrash/munari/advanced'
import { RIPPLE } from './logoLaw'


/** Scene lighting, relief and extrusion share this progress window.
 *  The normalized range `(progress - from) / distance` is clamped to zero
 *  before `from` and full past `from + distance`. A letter starts with
 *  its page appearance, takes on its scene material in flight, and
 *  freezes back to ink before touchdown: the last stretch on either
 *  side of a swap is literally the page's own pixels.
 *
 *  That is first a perceptual choice (material cooling as it lands) and
 *  second what kept the crossing-flash carry clause honest. That
 *  clause's ink-mask centroid is only a POSITION while the mask is ink, and
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
 *  both preserve the page geometry at the handoff. */
export const MATERIAL_GATE = { from: 0.25, distance: 0.35 }

/** Shape and surface parameters for one material. Rows align with
 *  LOGO_MATERIALS; logoNodes.test.ts pins their order and values. */
export interface LogoMaterialSpec {
  /** LOGO_MATERIALS name, repeated here so the alignment is checkable. */
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

export const MATERIAL_PARAMS: LogoMaterialSpec[] = [
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

// SAFETY: a texture sample is a vec4; Three's types return a bare Node.
const sample = (map: TextureNode, at: Node<'vec2'>) => map.sample(at) as Node<'vec4'>

/** The blit pass's material and the values each hop writes. */
export interface DownPass {
  readonly material: MeshBasicNodeMaterial
  readonly src: TextureNode
  readonly srcTexel: UniformNode<'vec2', THREE.Vector2>
  readonly spread: UniformNode<'float', number>
}

/** One 3×3 tent-filtered downsample hop. Two hops (texture → 1/4 →
 *  1/16) give the two height fields; `spread` widens the taps so a 4×
 *  stride leaves no source texel uncovered. Values stay premultiplied
 *  and linear: the renderer applies no output transform to a render
 *  target, and these targets are storage, not screen. */
export function createDownPass(src: TextureNode): DownPass {
  const srcTexel = uniform(new THREE.Vector2(1e-3, 1e-3))
  const spread = uniform(2)
  const material = passMaterial({ blending: THREE.NoBlending })
  const at = uv()
  const o = srcTexel.mul(spread)
  material.outputNode = sample(src, at)
    .mul(0.25)
    .add(
      sample(src, at.add(vec2(o.x, 0)))
        .add(sample(src, at.sub(vec2(o.x, 0))))
        .add(sample(src, at.add(vec2(0, o.y))))
        .add(sample(src, at.sub(vec2(0, o.y))))
        .mul(0.125),
    )
    .add(
      sample(src, at.add(o))
        .add(sample(src, at.sub(o)))
        .add(sample(src, at.add(vec2(o.x, o.y.negate()))))
        .add(sample(src, at.add(vec2(o.x.negate(), o.y))))
        .mul(0.0625),
    )
  return { material, src, srcTexel, spread }
}

// ── the letter ──────────────────────────────────────────────────────────

/** The letter material's live values, written by logoScene's frame loop. */
export interface LetterUniforms {
  // 1/texture px for each sampler: map's feeds the prism offsets, the
  // field texels set the gradient step so slopes are per-field-texel —
  // field resolution rides the CSS box, so the look survives LOD tiers.
  readonly texel: UniformNode<'vec2', THREE.Vector2>
  readonly texelF: UniformNode<'vec2', THREE.Vector2>
  readonly texelC: UniformNode<'vec2', THREE.Vector2>
  // Plane size in CSS px — rebuilds the vertex-local position for the
  // exact wave slope; font scales the crinkle to physical size.
  readonly plane: UniformNode<'vec2', THREE.Vector2>
  readonly font: UniformNode<'float', number>
  // px of height at full coverage, already multiplied by the lift's
  // progress on the way in — so it is exactly zero at every handoff,
  // where the sheet must be the flat plane the registration snap was
  // computed for.
  readonly relief: UniformNode<'float', number>
  // 0..1 — how much of that height the MESH carries. The rest stays a
  // bump, which is where the sub-vertex detail (the fine shoulder,
  // foil's crinkle) belongs anyway.
  readonly meshFrac: UniformNode<'float', number>
  // CSS px per texel of the two fields (logoFields' FIELD_DS), passed
  // rather than repeated: a slope is px of rise per px of run, and the
  // two fields measure their run in differently sized texels.
  readonly fieldPx: UniformNode<'vec2', THREE.Vector2>
  // The material's own shape (MATERIAL_PARAMS): how much of the height comes
  // from the fine shoulder and how much from the coarse pillow, and the
  // overall gain. A balloon inflates from the pillow, an enamel gummy
  // from the shoulder.
  readonly shoulder: UniformNode<'float', number>
  readonly pillowW: UniformNode<'float', number>
  readonly dome: UniformNode<'float', number>
  // px of extrusion, on the same progress-multiplied footing as relief
  // above: zero at every handoff, where a wall must have no area.
  readonly slab: UniformNode<'float', number>
  // 0..1 — how open the slab is, on the same footing as slab in the
  // vertex stage: zero at every handoff. It decides when the letter
  // stops being a picture with a painted outline and becomes a body
  // with a geometric one.
  readonly solid: UniformNode<'float', number>
  // gloss knob × cooling-gated amplitude (zero for ink): the mix weight
  // between the page's exact pixels and the shaded substance.
  readonly fx: UniformNode<'float', number>
  // prism offset in texels (knob × amplitude × speed × material factor);
  // it disperses along velDir, which lives with the motion below.
  readonly prism: UniformNode<'float', number>
  // 0 is ink, anything above is a substance — and WHICH one no longer
  // materials in here: the deck row itself arrives in the uniforms
  // below (Logo.tsx folds the panel's trims in on the way). One
  // program, six letters, no recompiles when the conductor re-deals.
  readonly materialIndex: UniformNode<'float', number>
  // The surface response — what the branch ladder used to hardcode.
  readonly rough: UniformNode<'float', number>
  readonly metal: UniformNode<'float', number>
  readonly sss: UniformNode<'float', number>
  readonly crinkle: UniformNode<'float', number>
  // The pop channels: grazing fabric rim, thin-film specular tint,
  // and how much the ink IS the light (with its halo).
  readonly sheen: UniformNode<'float', number>
  readonly irid: UniformNode<'float', number>
  readonly glow: UniformNode<'float', number>
  // Per-letter stagger for the glow's pulse — six neon tubes must not
  // breathe in unison. The weave no longer touches it: motion phases
  // in the shared word frame (waveOrigin, 2026-08-14).
  readonly phase: UniformNode<'float', number>
  // The letter's world rotation: normals are lifted into world space so
  // the studio stands still while the letter wobbles under it.
  readonly quat: UniformNode<'vec4', THREE.Vector4>
  // The key light's direction, in WORLD space — the panel's two
  // position dials, shared by the analytic key and its softbox twin in
  // the studio, so the glint and the shading can never point apart.
  readonly light: UniformNode<'vec3', THREE.Vector3>
  // The rig's gains, all 1 at the shipped look (the conformance sweep
  // measures the studio at exactly those defaults): key brightness,
  // key softbox size, the two working fills together, the room grade,
  // and the front fill that keeps a flat mirror from a void.
  readonly key: UniformNode<'float', number>
  readonly keySoft: UniformNode<'float', number>
  readonly fill: UniformNode<'float', number>
  readonly room: UniformNode<'float', number>
  readonly front: UniformNode<'float', number>
  readonly time: UniformNode<'float', number>
  // The letter's center in the shared word frame, px. The weave reads
  // q + waveOrigin: ONE wave field crosses the whole word. The salt
  // that once staggered each letter's phase made six letters churn
  // independently — erratic shaking, never a wave (2026-08-14).
  readonly waveOrigin: UniformNode<'vec2', THREE.Vector2>
  // The weave's orbit radius in px — surge and heave both — as knob ×
  // material gate × the material's floored softness.
  readonly jelly: UniformNode<'float', number>
  // The weave's wave numbers (rad/px, wavelengths set from the font
  // size), its angular speeds (rad/s — WEAVE.w × the speed dial), and
  // its frame from the angle dial: (cos a, sin a).
  readonly waveK: UniformNode<'vec2', THREE.Vector2>
  readonly waveW: UniformNode<'vec2', THREE.Vector2>
  readonly waveDir: UniformNode<'vec2', THREE.Vector2>
  // The strike buffer: xy = ring center in plane px, z = birth time on
  // time's clock, w = strike power. Dead slots idle far in the past,
  // where the ring-down term rounds them to zero. RIPPLE.slots long.
  readonly ripples: UniformArrayNode<'vec4'>
  // The vectors `ripples` uploads every render: write these.
  readonly rippleSlots: readonly THREE.Vector4[]
  // Ring physics in plane px and seconds: x = wave number (rad/px),
  // y = front speed (px/s), z = packet half-width (px), w = ring-down
  // time (s). The RIPPLE constants (logoLaw) × the letter's font px.
  readonly ripK: UniformNode<'vec4', THREE.Vector4>
  // px a full-power strike displaces: knob × progress × the material's
  // softness blend. Zero at every handoff.
  readonly ripAmp: UniformNode<'float', number>
  // Travel: the unit direction of screen motion (the prism disperses
  // along it too) and the folded squash-and-stretch amount.
  readonly velDir: UniformNode<'vec2', THREE.Vector2>
  readonly stretch: UniformNode<'float', number>
}

/** The letter's samplers. Every node keeps its identity for the
 *  material's life; the frame loop writes their `value`. */
export interface LetterTextures {
  // The letter's live pixels, premultiplied…
  readonly map: TextureNode
  // …and the band-limited alpha its outline was traced from — the
  // committed readback (logoFields.readAlphaField) uploaded whole. The
  // walls stand on this field's 0.5 isoline, so a solid letter's face
  // and cap harden onto the SAME field: one outline for one body.
  readonly trace: TextureNode
  // The blur pyramid the height is read from (logoFields): alpha at 1/4
  // of the CSS box, and again at 1/16. Both stages sample them — the
  // vertex for the height, the fragment for its slope — so the samplers
  // belong to the description, not to either stage.
  readonly fine: TextureNode
  readonly coarse: TextureNode
  // The pyramid's widest level (1/32 of the CSS box, logoFields): the
  // halo's skirt. The coarse field's support ends ~2 of its texels out
  // — ~32 CSS px — and a glow that ends there ends VISIBLY.
  readonly halo: TextureNode
}

/** The strike buffer, every slot idle. */
export function createLetterRipples(): Pick<LetterUniforms, 'ripples' | 'rippleSlots'> {
  const rippleSlots = Array.from({ length: RIPPLE.slots }, () => new THREE.Vector4(0, 0, -1e3, 0))
  return { ripples: uniformArray(rippleSlots, 'vec4'), rippleSlots }
}

/**
 * The letter's surface, described ONCE and shared by both stages.
 *
 * This exists because the two used to disagree. The vertex stage pushed
 * the sheet by `relief × field`, and the fragment built its normal from
 * the same fields scaled by unrelated hand-tuned gains — two numbers
 * describing one surface, free to drift apart. They did: turning relief
 * up changed the letter's shape and left its lighting alone, so the
 * letter was lit as one dome and shaped as another. That mismatch is
 * exactly what the eye reads as "painted", which is the tell relief was
 * built to remove.
 *
 * So there is now one height field, in CSS px, and one slope derived
 * from the same coefficients. What the vertex stage carries is a
 * FRACTION of it (meshFrac); the fragment always lights the whole
 * thing. That split is the ordinary displacement-versus-bump one, and it
 * has a useful consequence: meshFrac changes what the letter IS without
 * changing how it is LIT. At 0 the letter is a flat card lit as a dome —
 * the look the sheet shipped with. At 1 the mesh carries every px of it.
 * Sliding between them buys real parallax and a real silhouette and
 * restyles nothing, so the dial can be judged on its own.
 *
 * RELIEF_REF and FIELD_H are pinned, not free: at relief = RELIEF_REF
 * the slope below is arithmetically the gain pair (2.4 fine, 3.2 coarse)
 * the bump-only letter was tuned on, so that amplitude reproduces the
 * shipped lighting exactly. Retuning the look means moving FIELD_H and
 * saying so; it does not mean nudging one stage.
 */
const RELIEF_REF = 22.0
const FIELD_H = [9.6, 51.2] as const

/** The share of the height a VERTEX GRID can carry: the coarse
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
function letterMeshHeight(u: LetterUniforms, coarseA: Node<'float'>): Node<'float'> {
  return u.relief.mul(u.dome).div(RELIEF_REF).mul(u.pillowW).mul(FIELD_H[1]).mul(coarseA)
}

/** The same surface's slope, px of rise per px of run, from the two
 *  fields' gradients. Same coefficients, so the lighting can only ever
 *  describe the height above. */
function letterSlope(u: LetterUniforms, gFine: Node<'vec2'>, gCoarse: Node<'vec2'>): Node<'vec2'> {
  return u.relief
    .mul(u.dome)
    .div(RELIEF_REF)
    .mul(
      u.shoulder
        .mul(FIELD_H[0])
        .mul(gFine)
        .div(u.fieldPx.x)
        .add(u.pillowW.mul(FIELD_H[1]).mul(gCoarse).div(u.fieldPx.y)),
    )
}

/*
 * The letter's MOTION, described once and shared by both stages — the
 * same contract as the height, for the same reason: the gel weave
 * used to live twice (vertex displacement, fragment lighting slope),
 * and two hand-kept copies of one field are drift with a deadline the
 * moment dials land on them. The vertex displaces by motionDisp, the
 * fragment lights motionSlope, and they can only be the same surface.
 *
 * Three motions, each zero at a handoff through its own folded gate:
 *   · the WEAVE — one swell field the whole WORD shares: phases are
 *     continuous in the word's frame (q + waveOrigin), so a crest
 *     marches out of one letter and into the next instead of six
 *     letters churning on private phase salts — that churn read as
 *     erratic shaking, never a wave (2026-08-14). It is a trochoid
 *     ORBIT (Gerstner), not a height field: every point of the sheet
 *     rolls in a small circle, surge in the plane against heave out
 *     of it. That is what a face-on eye can actually see — height
 *     alone reaches it only through lighting, and two thirds of the
 *     deck is too matte to carry lighting, so the sea was invisible
 *     on most of the word. The surge rolls the INK itself, which
 *     every material shows. Steady: excitation never pumps it. jelly
 *     is the orbit radius in px; 0 pins the flat plane.
 *   · the RINGS — a strike (a tap on the letter) drops a wave packet
 *     into the slot buffer: a ring expanding at fixed front speed,
 *     Gaussian along its radius, ringing down on RIPPLE.tau, thinning
 *     as it spreads. The physics arrives in plane px via ripK (the
 *     RIPPLE em constants × font px).
 *   · the STRETCH — travel squashes and stretches the plane along
 *     velDir, area-conserving, soft-saturated JS-side
 *     (stretchAmount); at stretch 0 the remap is identity exactly.
 *
 * Stretch remaps FINAL vertex positions only. Everything else — the
 * height fields, the weave, the rings — reads the undeformed plane
 * point q, which is what the fragment rebuilds from uv. uv is glued to
 * its vertex, so no vertex remap can move it, and the two stages agree
 * under stretch by construction rather than by bookkeeping.
 */

/** The weave's two phases at undeformed plane point q — crossed
 *  waves traveling in opposite senses along the dialed frame,
 *  phased in the WORD's coordinates so the field is continuous
 *  from letter to letter. */
function wavePhases(u: LetterUniforms, q: Node<'vec2'>): Node<'vec2'> {
  const qw = q.add(u.waveOrigin)
  const w = vec2(dot(qw, u.waveDir), dot(qw, vec2(u.waveDir.y.negate(), u.waveDir.x)))
  return vec2(w.x.mul(u.waveK.x).add(u.time.mul(u.waveW.x)), w.y.mul(u.waveK.y).sub(u.time.mul(u.waveW.y)))
}

/** How the two waves share the orbit: the swell dominates hard —
 *  one wave clearly travels, the cross ripple only seasons it. One
 *  constant feeds BOTH motionDisp and motionSlope — the two must
 *  describe the same surface, so the mix may exist only once. */
const WEAVE_MIX = [0.85, 0.15] as const

/** Displacement at q: xy = in-plane drift (the weave's surge and
 *  each ring's radial push), z = height. One slot loop serves both,
 *  so the vertex pays the strike buffer once. Call inside a Fn. */
function motionDisp(u: LetterUniforms, q: Node<'vec2'>): Node<'vec3'> {
  const a = wavePhases(u, q)
  const t = vec2(u.waveDir.y.negate(), u.waveDir.x)
  // The trochoid orbit, radius orb per wave: surge -orb·sin along
  // the wave's own axis against heave +orb·cos out of the plane.
  // The quarter turn between them IS the circle, and its sense is
  // the physics — a point riding a crest travels WITH the wave, so
  // a passing swell carries the paint rather than shaking it.
  // Crests pinch and troughs broaden, the way water and cloth do.
  const orb = u.jelly.mul(vec2(WEAVE_MIX[0], WEAVE_MIX[1]))
  const d = vec3(
    orb.x.negate().mul(sin(a.x)).mul(u.waveDir).sub(orb.y.mul(sin(a.y)).mul(t)),
    orb.x.mul(cos(a.x)).add(orb.y.mul(cos(a.y))),
  ).toVar()
  Loop(RIPPLE.slots, ({ i }) => {
    const rp = u.ripples.element(i)
    const age = u.time.sub(rp.z)
    const rv = q.sub(rp.xy)
    const r = max(length(rv), 1e-3)
    const behind = r.sub(u.ripK.y.mul(age))
    const ring = u.ripAmp
      .mul(rp.w)
      .mul(step(0, age))
      .mul(exp(age.negate().div(u.ripK.w)))
      .mul(exp(behind.negate().mul(behind).div(u.ripK.z.mul(u.ripK.z))))
      .div(float(1).add(r.div(u.ripK.z.mul(4))))
    d.z.addAssign(ring.mul(sin(u.ripK.x.mul(behind))))
    d.xy.addAssign(rv.div(r).mul(ring).mul(cos(u.ripK.x.mul(behind))).mul(0.35))
  })
  return d
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
 *  work in the paint, where a face-on eye is looking. Call inside a Fn. */
function motionSlope(u: LetterUniforms, q: Node<'vec2'>): Node<'vec2'> {
  const a = wavePhases(u, q)
  const t = vec2(u.waveDir.y.negate(), u.waveDir.x)
  const orb = u.jelly.mul(vec2(WEAVE_MIX[0], WEAVE_MIX[1]))
  const sl = orb.x
    .negate()
    .mul(u.waveK.x)
    .mul(sin(a.x))
    .mul(u.waveDir)
    .sub(orb.y.mul(u.waveK.y).mul(sin(a.y)).mul(t))
    .toVar()
  Loop(RIPPLE.slots, ({ i }) => {
    const rp = u.ripples.element(i)
    const age = u.time.sub(rp.z)
    const rv = q.sub(rp.xy)
    const r = max(length(rv), 1e-3)
    const behind = r.sub(u.ripK.y.mul(age))
    const w2 = u.ripK.z.mul(u.ripK.z)
    const pack = exp(behind.negate().mul(behind).div(w2))
    const spread = float(1).div(float(1).add(r.div(u.ripK.z.mul(4))))
    const base = u.ripAmp.mul(rp.w).mul(step(0, age)).mul(exp(age.negate().div(u.ripK.w)))
    const dz = base
      .mul(pack)
      .mul(spread)
      .mul(
        u.ripK.x
          .mul(cos(u.ripK.x.mul(behind)))
          .sub(behind.mul(2).div(w2).mul(sin(u.ripK.x.mul(behind))))
          .sub(spread.div(u.ripK.z.mul(4)).mul(sin(u.ripK.x.mul(behind)))),
      )
    sl.addAssign(dz.mul(rv.div(r)))
  })
  return sl
}

/** Travel deformation of a FINAL vertex position: area-conserving
 *  squash-and-stretch about the letter's center — long by 1 + s
 *  along the motion, thin by 1 / (1 + s) across it. */
function motionStretch(u: LetterUniforms, q: Node<'vec2'>): Node<'vec2'> {
  const along = float(1).add(u.stretch)
  const t = vec2(u.velDir.y.negate(), u.velDir.x)
  return u.velDir.mul(dot(q, u.velDir).mul(along)).add(t.mul(dot(q, t).div(along)))
}

const PI = 3.14159265

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
const WALL_INSET = 2.5
// Fraction of the wall's run over which its normal is bent back
// toward the face's. A true 90° joint shades as a crease — one
// fragment of dome, the next of horizontal edge — and the eye reads
// that step as a seam whether or not the geometry has one. Every
// real edge carries a radius; this is that radius, in shading.
const WALL_FILLET = 0.4
// What the light is down at the back of the wall. The run of an edge
// is the one place a letter can shade itself, and an evenly lit wall
// reads as a painted band rather than a face turning away.
const WALL_FLOOR = 0.42

function qrot(q: Node<'vec4'>, v: Node<'vec3'>): Node<'vec3'> {
  return v.add(cross(q.xyz, cross(q.xyz, v).add(q.w.mul(v))).mul(2))
}

function h21(p0: Node<'vec2'>): Node<'float'> {
  const p1 = fract(p0.mul(vec2(123.34, 456.21)))
  const p = p1.add(dot(p1, p1.add(45.32)))
  return fract(p.x.mul(p.y))
}

function vnoise(p: Node<'vec2'>): Node<'float'> {
  const i = floor(p)
  const f0 = fract(p)
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)))
  return mix(
    mix(h21(i), h21(i.add(vec2(1, 0))), f.x),
    mix(h21(i.add(vec2(0, 1))), h21(i.add(vec2(1, 1))), f.x),
    f.y,
  )
}

// One softbox: a Gaussian lobe around a direction, widened by
// roughness — the cheap stand-in for prefiltered-mip convolution.
function softbox(
  d: Node<'vec3'>,
  c: Node<'vec3'>,
  sz: Node<'float'>,
  tint: Node<'vec3'>,
  rg: Node<'float'>,
): Node<'vec3'> {
  const s = sz.add(rg.mul(0.5))
  return tint.mul(exp(dot(d, c).sub(1).div(max(s.mul(s), 1e-4))))
}

// The studio standing in for an HDRI: a graded room (lit floor,
// bright ceiling), a warm key box that FOLLOWS light, a cool fill
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
// sweep clause (logoNodes.test.ts) rebuilds the studio from this
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
// shades instead of splitting. logoNodes.test.ts sweeps the room
// and pins both floors.
function studio(u: LetterUniforms, d: Node<'vec3'>, rg: Node<'float'>): Node<'vec3'> {
  return mix(vec3(0.09, 0.095, 0.105), vec3(0.15, 0.16, 0.18), smoothstep(-0.8, 0.5, d.y))
    .mul(u.room)
    .add(vec3(0.3, 0.28, 0.25).mul(smoothstep(0.1, 1.0, d.y)).mul(u.room))
    .add(softbox(d, u.light, float(0.09).mul(u.keySoft), vec3(2.4, 2.3, 2.15).mul(u.key), rg))
    .add(softbox(d, normalize(vec3(0.7, 0.1, 0.5)), float(0.18), vec3(0.5, 0.55, 0.65).mul(u.fill), rg))
    .add(softbox(d, normalize(vec3(0.05, -0.75, 0.45)), float(0.2), vec3(0.22, 0.2, 0.18).mul(u.fill), rg))
    .add(softbox(d, normalize(vec3(0.12, 0.16, 0.98)), float(0.35), vec3(0.35, 0.36, 0.4).mul(u.front), rg))
}

// ACES fit (Narkowicz): film-like rolloff instead of clipped bands.
function aces(x: Node<'vec3'>): Node<'vec3'> {
  return clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1)
}

/**
 * The letter's material. Premultiplied in, premultiplied blend
 * (decisions.md #5); the letters are paint over the page, so no tone
 * mapping — same stance as the standard-material path it replaced.
 * logoScene sets depthWrite from the slab switch.
 */
export function createLetterMaterial(t: LetterTextures, u: LetterUniforms): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    premultipliedAlpha: true,
    toneMapped: false,
  })

  // ── the vertex stage ──

  // Object-space normal, the fragment's one way to tell a wall from the
  // sheet: the sheet is +z, a wall is horizontal (logoSlab).
  const nrm = varying(normalGeometry)
  // How far DOWN a wall this fragment stands: 0 at the top ring, where
  // the wall meets the face, 1 at the back. The sheet is all 0. The
  // fragment needs it to fillet the joint and to shade the run of the
  // edge, and neither is expressible from the normal alone — every
  // fragment of one wall quad shares a normal.
  //
  // z arrives as a UNIT: 0 on the sheet and on every wall's top ring,
  // -1 on the back face.
  const wallDepth = varying(float(1).sub(step(-0.5, positionGeometry.z)))

  material.positionNode = Fn(() => {
    const p = positionGeometry.toVar()
    // Thickness is a multiply — it animates without rewriting a vertex
    // buffer, and at slab 0 every wall quad collapses to a line and
    // rasterizes nothing.
    p.z.mulAssign(u.slab)
    If(u.relief.mul(u.meshFrac).greaterThan(0), () => {
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
      p.z.addAssign(letterMeshHeight(u, sample(t.coarse, uv()).a).mul(u.meshFrac))
    })
    // The letter's motion (one description with the fragment): weave
    // and rings displace, then the travel stretch remaps the plane. Both
    // read the UNDEFORMED position — the same q the fragment rebuilds
    // from uv — and a wall takes the same displacement and remap as the
    // sheet above it, so the slab stays rigid through every motion.
    const q = p.xy.toVar()
    const md = motionDisp(u, q)
    p.z.addAssign(md.z)
    p.xy.assign(motionStretch(u, q.add(md.xy)))
    return p
  })()

  // ── the fragment stage ──

  material.outputNode = Fn(() => {
    // The cap is a surface only while the slab is open. Shut, it lies
    // in the sheet's own plane and would fight it for depth.
    Discard(nrm.z.lessThan(-0.5).and(u.solid.lessThan(0.06)))

    const at = uv()
    // ── prism: per-channel dispersion along the motion vector ──
    // At prism 0 all three taps coincide and c is the plain texel —
    // identity by construction, not by branch.
    const o = u.velDir.mul(u.prism).mul(u.texel)
    const cr = sample(t.map, at.add(o))
    const cg = sample(t.map, at)
    const cb = sample(t.map, at.sub(o))
    const c = vec4(cr.r, cg.g, cb.b, cr.a.add(cg.a).add(cb.a).div(3)).toVar()

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
    // So the face and the cap harden onto trace — the same field the
    // walls stand on — inside the lit branch below, where the albedo
    // that colors the skirt is in hand. solid is zero at both
    // handoffs, where the letter must be the page's exact pixels, so
    // the identity is untouched.
    const outC = vec4(c).toVar()

    // A wall exists only while the slab is open, and the slab is shut at
    // both handoffs — so a wall has no page pixels to be identical to,
    // and it shades whether or not the cooling gate has opened.
    const wall = float(1).sub(step(0.5, abs(nrm.z))).toVar()
    // The back cap is the third face of the body: the sheet again, at
    // the back of the slab, pointing the other way (logoSlab).
    const back = step(nrm.z, -0.5).toVar()

    // solid opens the branch too: a solid letter needs its geometric
    // silhouette cut even at zero gloss, and the cut needs the albedo
    // computed in here to color the edge skirt.
    If(
      u.materialIndex
        .greaterThan(0.5)
        .and(u.fx.greaterThan(0.001).or(wall.greaterThan(0.5)).or(u.solid.greaterThan(0.001))),
      () => {
        // ── the surface: gradients of two smooth height fields ──
        // Central differences at one field texel, on hardware bilinear —
        // band-limited data, so the slopes are smooth by construction.
        const hF = sample(t.fine, at).toVar()
        const hC = sample(t.coarse, at).toVar()
        const gF = vec2(
          sample(t.fine, at.add(vec2(u.texelF.x, 0))).a.sub(sample(t.fine, at.sub(vec2(u.texelF.x, 0))).a),
          sample(t.fine, at.add(vec2(0, u.texelF.y))).a.sub(sample(t.fine, at.sub(vec2(0, u.texelF.y))).a),
        ).mul(0.5)
        const gC = vec2(
          sample(t.coarse, at.add(vec2(u.texelC.x, 0))).a.sub(sample(t.coarse, at.sub(vec2(u.texelC.x, 0))).a),
          sample(t.coarse, at.add(vec2(0, u.texelC.y))).a.sub(sample(t.coarse, at.sub(vec2(0, u.texelC.y))).a),
        ).mul(0.5)
        // The coarse field doubles as local coverage: the thickness proxy
        // for transmission, and the halo source for neon.
        const thick = hC.a.toVar()

        // Albedo: the fine field un-premultiplied covers the edges (a
        // blurred neighborhood — no lone-texel alpha to divide by), the
        // sharp texel takes over inside.
        const albF = clamp(hF.rgb.div(max(hF.a, 1e-3)), 0, 1)
        const alb = mix(albF, c.rgb.div(max(c.a, 0.25)), smoothstep(0.2, 0.7, c.a)).toVar()
        // A wall's material, read from the face a few px inside the
        // outline (WALL_INSET) along the wall's own normal — nrm points
        // OUT of the material, so stepping against it goes in. This
        // replaced a sample of the coarse field, which is a 1/16 blur: on
        // a letter's stroke that blur is mostly the plate around it, so
        // every wall came out washed and dark against the face it hung
        // from. The sharp texel a hair inside is what the wall is a cut
        // through, so face and wall now meet in the same color.
        const inUv = at.sub(nrm.xy.mul(vec2(WALL_INSET).div(u.plane)))
        const cIn = sample(t.map, inUv)
        const albIn = clamp(cIn.rgb.div(max(cIn.a, 1e-3)), 0, 1).toVar()
        alb.assign(mix(alb, albIn, wall))
        // Transmission wants the same honesty: at the outline the coarse
        // field reads half coverage, which would light every gummy edge
        // as if it were a thin span.
        thick.assign(mix(thick, sample(t.coarse, inUv).a, wall))

        // ── one outline for the whole body ──
        // Coverage is trace's own 0.5 isoline — the curve the walls
        // stand on — resolved to one screen pixel by fwidth: a real
        // antialiased edge, which the sharp step could never get (a
        // texture step is invisible to MSAA). The skirt lands on the
        // wall top in the wall's own color, and alb has already blended
        // to the blurred-neighborhood albedo where the sharp texel has
        // thinned out.
        const cov = sample(t.trace, at).r.toVar()
        const cw = max(cov.fwidth(), 1e-4)
        const hardA = clamp(cov.sub(0.5).div(cw).add(0.5), 0, 1)
        outC.assign(mix(outC, vec4(alb.mul(hardA), hardA), u.solid))

        // ── the material's surface, read off its deck row ──
        // The roughness floor is numeric, not aesthetic: at exactly zero
        // the GGX numerator is zero and the specular VANISHES instead of
        // sharpening — polish at full mirror must land here, not there.
        const rough = max(u.rough, 0.03)
        const metal = u.metal
        const sss = u.sss
        const crinkle = u.crinkle

        // The motion slope, exact at this fragment (motionSlope — the
        // same weave and rings the vertex stage displaced by).
        const p = at.sub(0.5).mul(u.plane).toVar()
        const wslope = motionSlope(u, p)

        // The normal, from the SHARED slope (letterSlope) — the exact
        // surface the vertex stage displaced a meshFrac share of, whether
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
        // specular flash beside it (2026-08-14). solid is the same
        // ramp that hardens the alpha onto the wall line, so the paint
        // hands the edge to the geometry in the one motion.
        // The motion slope folds in at FULL strength. A face-on plane
        // shows its z-motion almost only through lighting, so a mute
        // here mutes the wave itself — the ×0.6 that once sat on wslope
        // was half of why the weave read as a rumble (2026-08-14).
        // Amplitude belongs to the dials and the law (WEAVE), not to a
        // hidden factor in the normal.
        const slope = letterSlope(u, gF.mul(float(1).sub(u.solid)), gC)
        const n = normalize(vec3(slope.negate().sub(wslope), 1)).toVar()
        const wob = vec2(0).toVar()
        If(crinkle.greaterThan(0), () => {
          const np = p.mul(float(22).div(u.font)).toVar()
          wob.assign(
            vec2(vnoise(np).sub(0.5), vnoise(np.add(19.7)).sub(0.5)).add(
              vec2(vnoise(np.mul(2.7)).sub(0.5), vnoise(np.mul(2.7).add(7.3)).sub(0.5)).mul(0.5),
            ),
          )
          n.assign(normalize(vec3(n.xy.add(crinkle.mul(wob)), n.z)))
        })
        // The wall's shape is its geometry, not the height field: it is a
        // real face standing off the sheet, and it wants the face's own
        // normal so it sweeps the studio as the letter turns.
        //
        // But only once it is clear of the joint. At wallDepth 0 the wall
        // takes the FACE's normal exactly, so the two sides of the top
        // ring are one continuous surface, and it turns to its own over
        // the first WALL_FILLET of its run.
        n.assign(normalize(mix(n, nrm, wall.mul(smoothstep(0, WALL_FILLET, wallDepth)))))
        // The cap is the face translated backward, so its outward normal
        // is the face's negated — including the dome's tilt, which it
        // carries because it was displaced by the same height.
        n.assign(mix(n, n.negate(), back))
        If(crinkle.greaterThan(0), () => {
          // The same crinkle carried around the corner, in the wall's own
          // tangent plane (along the outline, and down the run). Foil
          // that smooths out the moment it turns the edge is foil printed
          // on plastic.
          const wt = normalize(cross(nrm, vec3(0, 0, 1)))
          n.assign(normalize(n.add(wall.mul(crinkle).mul(wt.mul(wob.x).add(vec3(0, 0, 1).mul(wob.y))))))
        })
        n.assign(qrot(u.quat, n))

        // ── Cook–Torrance key + studio IBL ──
        const V = vec3(0, 0, 1)
        const L = normalize(u.light)
        const H = normalize(L.add(V))
        const NdV = max(dot(n, V), 1e-3).toVar()
        const NdL = max(dot(n, L), 0)
        const NdH = max(dot(n, H), 0)
        const VdH = max(dot(V, H), 0)
        const F0 = mix(vec3(0.04), mix(alb, vec3(1), 0.25), metal).toVar()
        // Thin-film iridescence: a hue that walks with the view angle
        // AND the surface's own height, so the bands curve around the
        // dome instead of ruling flat stripes. It multiplies BOTH
        // specular paths and only them — a dielectric shows it in the
        // glints (pearl), full metal across the whole mirror (holo) —
        // so at irid 0 the tint is exactly 1 and nothing moved.
        const iridT = mix(
          vec3(1),
          cos(vec3(0, 0.33, 0.67).add(float(1).sub(NdV).mul(1.6).add(hF.a.mul(0.9))).mul(6.2832))
            .mul(0.5)
            .add(0.5),
          u.irid,
        ).toVar()
        const r2 = rough.mul(rough)
        const a2 = r2.mul(r2)
        const D = a2.div(float(PI).mul(pow(NdH.mul(NdH).mul(a2.sub(1)).add(1), 2)))
        const k = rough.mul(rough).mul(0.5)
        const Vis = float(0.25).div(
          NdL.mul(float(1).sub(k)).add(k).mul(NdV.mul(float(1).sub(k)).add(k)).add(1e-4),
        )
        const F = F0.add(vec3(1).sub(F0).mul(pow(float(1).sub(VdH), 5)))
        const KEY = vec3(2.6, 2.5, 2.3).mul(u.key)
        // Wrap lighting stands in for subsurface scattering on the
        // diffuse term: light bleeds past the terminator on soft material.
        const wrap = sss.mul(0.5)
        const NdLw = clamp(dot(n, L).add(wrap).div(float(1).add(wrap)), 0, 1)
        const lit = vec3(1).sub(F).mul(float(1).sub(metal)).mul(alb).div(PI).mul(KEY).mul(NdLw).toVar()
        lit.addAssign(F.mul(D.mul(Vis)).mul(KEY).mul(NdL).mul(iridT))
        const R = reflect(V.negate(), n)
        lit.addAssign(alb.mul(float(1).sub(metal)).mul(studio(u, n, float(1))).mul(0.55))
        const Fibl = F0.add(max(vec3(float(1).sub(rough)), F0).sub(F0).mul(pow(float(1).sub(NdV), 5)))
        lit.addAssign(studio(u, R, rough).mul(Fibl).mul(iridT))
        // Sheen: the retroreflective rim of a fibrous surface — velvet's
        // whole identity, pearl's softness. The energy is borrowed from
        // the wide studio so the rim dims with the room instead of
        // floating free of it.
        lit.addAssign(
          mix(alb, vec3(1), 0.4)
            .mul(u.sheen.mul(pow(float(1).sub(NdV), 3)))
            .mul(studio(u, n, float(0.9)))
            .mul(1.5),
        )
        // Transmission: thin spans glow in their own color — the candy
        // edge light that makes gummy read as gel rather than plastic.
        lit.addAssign(
          alb
            .mul(sss)
            .mul(float(1).sub(thick))
            .mul(studio(u, n.negate(), float(1)).mul(0.5).add(0.5))
            .mul(1.2),
        )

        const pulse = float(0.9).add(sin(u.time.mul(9).add(u.phase.mul(3))).mul(0.1)).toVar()
        If(u.glow.greaterThan(0.001), () => {
          // The ink IS the light, by glow's share: emissive core toward
          // white over the PBR pass held back to a glaze. Neon is 1 and
          // all tube; plasma is 0.55 and stays half a surface. Past 1
          // the trim OVERDRIVES the core rather than extrapolating the
          // mix off the end of its ramp.
          const core = mix(alb, vec3(1), 0.6)
            .mul(2.6)
            .mul(float(1).add(max(u.glow.sub(1), 0).mul(0.5)))
            .mul(pulse)
          lit.assign(mix(lit, core.add(lit.mul(0.2)), min(u.glow, 1)))
        })

        // Down the run of the wall, into the page and away from the key —
        // and the cap, which is the far end of that same run.
        lit.mulAssign(mix(float(1), float(WALL_FLOOR), max(wall.mul(wallDepth), back)))

        // One tail for both faces of the letter — this used to be an
        // early return, and an early return is a second shader. Whatever
        // the face gained, the edge did not.
        //
        // The only thing a wall needs said differently is what it stands
        // in for at zero gloss: the face has the page's own texel to be
        // identical to, and a wall has no page pixels at all — the slab
        // is shut at both handoffs. So it stands in its own material,
        // opaque, because it IS material rather than a picture of material.
        // Past this line the two are one surface.
        const base = mix(outC, vec4(albIn, 1), wall).toVar()
        // Exposure, premultiply, and the identity mix: fx is the cooled
        // gate — zero at every swap edge, so the mix lands on the page's
        // exact pixels there.
        outC.assign(vec4(mix(base.rgb, aces(lit).mul(base.a), u.fx), base.a))

        // The halo belongs to the FRONT face only. On a wall it would
        // smear along the tube; on the back cap it re-projects as a
        // detached ring of glow floating behind the letter, offset by
        // however far the tilt has swung the slab.
        If(u.glow.greaterThan(0.001).and(wall.add(back).lessThan(0.5)), () => {
          // Light OUTSIDE the glyph: each blur level's excess coverage
          // over the sharp alpha. ONE level is a sticker — the coarse
          // field's support ends ~32 CSS px out, and the old ×1.9 gain
          // saturated the inner half so the entire falloff happened in
          // the last few px of that support (the sudden edge,
          // 2026-08-14). Two lobes an octave apart, no gain, decay into
          // each other the way a bloom stack does: a bright core under a
          // skirt twice as wide, and the eye never meets a support edge.
          const hW = sample(t.halo, at).toVar()
          const haloF = clamp(
            max(thick.sub(c.a), 0).mul(0.5).add(max(hW.a.sub(c.a), 0).mul(0.62)),
            0,
            1,
          )
          const haloA = clamp(u.fx.mul(u.glow).mul(haloF).mul(haloF).mul(1.1).mul(pulse), 0, 1).toVar()
          // The skirt must reach zero BEFORE the capture box does, or
          // the box guillotines it into a faint rectangle.
          const vm = min(at, vec2(1).sub(at))
          haloA.mulAssign(smoothstep(0, 0.16, vm.x).mul(smoothstep(0, 0.16, vm.y)))
          // Tinted by both lobes' own blurred color, held nearer the ink
          // than the old white wash — a neon halo is colored light.
          const glowC = clamp(hC.rgb.add(hW.rgb).div(max(hC.a.add(hW.a), 1e-3)), 0, 1)
          outC.assign(
            vec4(outC.rgb.add(mix(glowC, vec3(1), 0.25).mul(haloA)), outC.a.add(haloA.mul(float(1).sub(outC.a)))),
          )
        })
      },
    )

    Discard(outC.a.lessThan(0.004))
    // Linear in from the sampler, sRGB out to the canvas (flightNodes'
    // rule for any material sampling a Surface capture).
    return premultipliedOutput(outC)
  })()
  return material
}
