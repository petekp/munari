// The crystal's pixels — a solid of glass ray-traced over a live page, and
// the shadow and the focused light it throws down onto it.
//
// One program, one shape, three jobs. It draws the page. It walks the LIGHT
// back to the solid to decide what is in shadow, and forwards through it to
// decide where the light it let through piles up. Then it marches the EYE's
// ray to the surface it is looking at, refracts in through a crown facet,
// bounces it between the inside faces until its light runs out, and reads
// the page along everything that escaped downward.
//
// The law: OUTSIDE the crystal's silhouette this pair is the identity plus
// a shadow. The page program adds nothing where no light ray reaches the
// solid, and the crystal program writes nothing where its march misses, so
// every pixel the crystal is not standing on or shading is the DOM's own
// rasterisation. That is what lets the pointer relay stay correct
// everywhere the crystal is not.
//
// `sdCrystal` and the chain below are `crystalLaw.ts` transcribed. Not
// resembling it — the same arithmetic in the same order, down to the
// central difference's epsilon, the march's tolerance and the order of the
// two rotations (which is why the rotation arrives as a matrix and is not
// rebuilt here). The CPU copy is what a click is corrected by and this copy
// is what the eye sees, so a difference between them is a click landing
// where nobody looked. `crystalLaw.test.ts` pins the two against each other.
//
// The light is FIXED IN THE SHEET, not attached to the crystal. A highlight
// that travelled with the object would be a decal and would read as one; a
// fixed light means the streak sweeps across the glass and the shadow swings
// as the hand moves it, which is the strongest cue that the thing has a
// surface and a height at all.
//
// The FAULT the shading answers: the first solid lit the whole top face with
// one broad specular lobe. Measured 2026-08-25 with that lobe zeroed, the
// interior read (16,16,9) — exactly the page colour beneath it — so 100% of
// what was visible was the wash, and it looked like grey plastic. What
// replaced it is Fresnel choosing between the refracted page and a reflected
// sky, plus Beer's law over the path length. Nothing is painted on.
//
// PREMULTIPLIED (decisions.md #5): the page arrives premultiplied and the
// glass writes alpha 1 over it, so `glassAt` works in straight colour and
// `main` composites with the over operator written out.

import { SURFACE_RADIUS_GLSL } from '@petepetrash/munari'

// Both meshes are full-viewport planes on the page plane, so one vertex
// shader serves them: the fragment's own sheet position is all either needs.
export const CRYSTAL_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// ── the shape, shared by both programs ─────────────────────────────────

// The arrow, vertex for vertex from ARROW in crystalLaw.ts. Both lists are
// read by the test, which walks a grid through both fields and requires the
// same distance from each.
const SOLID_GLSL = /* glsl */ `
  uniform vec3 uTip;             // the hotspot, sheet px, floating at .z
  uniform mat3 uRot;             // local -> sheet, built once in crystalLaw.ts
  uniform vec2 uSheet;           // the sheet's size in CSS px
  uniform vec3 uEye;             // the camera, sheet px
  uniform float uScalePx;        // CSS px per polygon unit
  uniform float uRoundPx;        // how far the outline is pushed out
  uniform float uChamferPx;      // how far up the axis the point is ground off
  uniform float uGirdlePx;       // how far past sdInner2's zero the girdle is
  uniform float uGirdleThickPx;  // the vertical band at the girdle
  uniform float uCrownDeg;       // the crown facets' angle off the page
  uniform float uCrownPx;        // girdle up to the flat table
  uniform float uPavilionDeg;    // the pavilion facets' angle off the page
  uniform float uPavilionPx;     // the keel up to the girdle

  const vec2 A0 = vec2(0.0, 0.0);
  const vec2 A1 = vec2(0.0, 24.0);
  const vec2 A2 = vec2(5.5, 18.5);
  const vec2 A3 = vec2(9.0, 26.5);
  const vec2 A4 = vec2(12.5, 25.0);
  const vec2 A5 = vec2(9.0, 17.0);
  const vec2 A6 = vec2(16.0, 17.0);

  // One edge of the winding test: nearest-point distance, and the crossing
  // flip. \`a\` is the previous vertex and \`b\` the current one, which is the
  // order the TS loop visits them in.
  void arrowEdge(vec2 p, vec2 a, vec2 b, inout float d, inout float s) {
    vec2 e = a - b;
    vec2 w = p - b;
    float t = clamp(dot(w, e) / dot(e, e), 0.0, 1.0);
    vec2 q = w - e * t;
    d = min(d, dot(q, q));
    bvec3 c = bvec3(p.y >= b.y, p.y < a.y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }

  // Unrolled rather than looped over an array. GLSL ES 1.00 restricts what
  // may index an array, and seven named calls cost nothing and cannot
  // silently skip an edge.
  float sdArrowPolygon(vec2 p) {
    float d = dot(p - A0, p - A0);
    float s = 1.0;
    arrowEdge(p, A6, A0, d, s);
    arrowEdge(p, A0, A1, d, s);
    arrowEdge(p, A1, A2, d, s);
    arrowEdge(p, A2, A3, d, s);
    arrowEdge(p, A3, A4, d, s);
    arrowEdge(p, A4, A5, d, s);
    arrowEdge(p, A5, A6, d, s);
    return s * sqrt(d);
  }

  // The arrow's rest axis, derived from the same seven vertices rather than
  // written down again — a transcribed constant is one more thing that can
  // disagree with crystalLaw.ts, and this cannot.
  vec2 arrowAxis() {
    return normalize(A0 + A1 + A2 + A3 + A4 + A5 + A6);
  }

  float sdInner2(vec2 q) {
    float poly = sdArrowPolygon(q / uScalePx) * uScalePx;
    // The chamfer: a flat face square across the arrow's axis, so the
    // hotspot at the point sits under a half-plane instead of under a
    // vertex. crystalLaw.ts carries the measurement that made it necessary.
    float cut = uChamferPx - dot(q, arrowAxis());
    return max(poly, cut) - uRoundPx;
  }

   // sdCrystal in crystalLaw.ts: a brilliant cut swept along the arrow's
  // outline — keel, pavilion, girdle band, crown, table. Every term is a
  // half-space in the (sdInner2, z) plane, each Lipschitz-1, and \`max\` of
  // Lipschitz-1 under-estimators is one too, so the marches below stay safe
  // across the facet edges without a step-size fudge.
  // hotspotDrop in crystalLaw.ts: the shift that puts local z = 0 on the
  // stone's underside at the arrow's own point, which is where the frame
  // anchors the hotspot and where the view ray is built to pass through.
  float hotDrop() {
    return max(uPavilionPx + (uChamferPx - uRoundPx - uGirdlePx)
      * tan(radians(uPavilionDeg)), 0.0);
  }

  float sdCrystal(vec3 q) {
    float d2 = sdInner2(q.xy) - uGirdlePx;
    float drop = hotDrop();
    float zg0 = uPavilionPx - drop;
    float zg1 = zg0 + uGirdleThickPx;
    float ac = radians(uCrownDeg);
    float ap = radians(uPavilionDeg);
    float crown = d2 * sin(ac) + (q.z - zg1) * cos(ac);
    float pavilion = d2 * sin(ap) - (q.z - zg0) * cos(ap);
    float table = q.z - (zg1 + uCrownPx);
    return max(max(d2, -drop - q.z), max(max(crown, pavilion), table));
  }

  // GRAD_EPS in crystalLaw.ts. Analytic would be exact but jumps direction
  // across the medial axis between two edges, and the two copies agreeing
  // matters more here than either one being exact.
  vec3 normalAt(vec3 q) {
    float e = 0.5;
    vec3 n = vec3(
      sdCrystal(q + vec3(e, 0.0, 0.0)) - sdCrystal(q - vec3(e, 0.0, 0.0)),
      sdCrystal(q + vec3(0.0, e, 0.0)) - sdCrystal(q - vec3(0.0, e, 0.0)),
      sdCrystal(q + vec3(0.0, 0.0, e)) - sdCrystal(q - vec3(0.0, 0.0, e)));
    return n / max(length(n), 1e-9);
  }

  // uRot is orthonormal, so \`v * m\` is the inverse rotation. Spelled this
  // way round in both directions so neither is a transpose written by hand.
  vec3 toLocal(vec3 p) { return (p - uTip) * uRot; }
  vec3 toLocalDir(vec3 d) { return d * uRot; }
  vec3 toSheetDir(vec3 d) { return uRot * d; }
  vec3 toSheet(vec3 q) { return uRot * q + uTip; }

  // The height of the girdle, the one plane where the solid's silhouette is
  // exactly \`sdInner2 = uGirdlePx\`. The shadow is thrown from here rather
  // than from mid-height: this cut has no straight prism anywhere, and the
  // girdle is both the widest section and the one with a closed form.
  float girdleZ() { return uPavilionPx + uGirdleThickPx * 0.5 - hotDrop(); }

  vec3 boundsCentre() {
    float halfZ = (uPavilionPx + uGirdleThickPx + uCrownPx) * 0.5;
    return vec3(8.0 * uScalePx, 13.25 * uScalePx, halfZ - hotDrop());
  }
  float boundsRadius() {
    float pad = uRoundPx + uGirdlePx;
    float halfZ = (uPavilionPx + uGirdleThickPx + uCrownPx) * 0.5;
    return length(vec3(8.0 * uScalePx + pad, 13.25 * uScalePx + pad, halfZ));
  }

  // Distance to the near intersection with that sphere, or -1 for a miss.
  float sphereEntry(vec3 o, vec3 d, vec3 c, float r) {
    vec3 m = o - c;
    float b = dot(m, d);
    float cc = dot(m, m) - r * r;
    float h = b * b - cc;
    if (h < 0.0) return -1.0;
    float s = sqrt(h);
    if (-b + s < 0.0) return -1.0;
    return max(-b - s, 0.0);
  }

  // refract() with its total-internal-reflection case reported rather than
  // returned as a zero vector, which is indistinguishable from a ray that
  // happens to be zero. Same arithmetic as crystalLaw.ts's copy.
  bool refractAt(vec3 i, vec3 n, float eta, out vec3 o) {
    float ndi = dot(i, n);
    float k = 1.0 - eta * eta * (1.0 - ndi * ndi);
    if (k < 0.0) { o = vec3(0.0); return false; }
    o = eta * i - (eta * ndi + sqrt(k)) * n;
    return true;
  }

  // The two surfaces, analytically: a crown facet sloping down to the girdle
  // clipped by the table, and a pavilion facet sloping down to the keel
  // clipped by the culet plane. The marches below do not need these, but the
  // LIGHT's chain does, and two closed forms are far cheaper there than two
  // more marches.
  float topAt(float d2) {
    float zg1 = uPavilionPx + uGirdleThickPx - hotDrop();
    return min(zg1 - (d2 - uGirdlePx) * tan(radians(uCrownDeg)), zg1 + uCrownPx);
  }
  float bottomAt(float d2) {
    return max(uPavilionPx + (d2 - uGirdlePx) * tan(radians(uPavilionDeg)), 0.0)
      - hotDrop();
  }

  // The outline's own 2D gradient, unit — which way is downhill out of the
  // stone. Both facet normals are this vector tipped over by their angle.
  vec2 outlineGrad(vec2 xy) {
    float e = 0.5;
    vec2 g = vec2(
      sdInner2(xy + vec2(e, 0.0)) - sdInner2(xy - vec2(e, 0.0)),
      sdInner2(xy + vec2(0.0, e)) - sdInner2(xy - vec2(0.0, e)));
    return g / max(length(g), 1e-9);
  }

  // Straight up on the table, \`crownDeg\` off vertical on a crown facet.
  vec3 topNormal(vec2 xy, float d2) {
    float zg1 = uPavilionPx + uGirdleThickPx - hotDrop();
    if (zg1 - (d2 - uGirdlePx) * tan(radians(uCrownDeg)) >= zg1 + uCrownPx) {
      return vec3(0.0, 0.0, 1.0);
    }
    float a = radians(uCrownDeg);
    return normalize(vec3(outlineGrad(xy) * sin(a), cos(a)));
  }

  // Straight down on the culet plane, \`pavilionDeg\` off vertical on a
  // pavilion facet. Outward, so it points away from the stone.
  vec3 bottomNormal(vec2 xy, float d2) {
    if (uPavilionPx + (d2 - uGirdlePx) * tan(radians(uPavilionDeg)) <= 0.0) {
      return vec3(0.0, 0.0, -1.0);
    }
    float a = radians(uPavilionDeg);
    return normalize(vec3(outlineGrad(xy) * sin(a), -cos(a)));
  }
`

// ── one pass: the page, its shadow, and the glass standing on it ───────

export const CRYSTAL_FRAG = /* glsl */ `
  uniform sampler2D tMap;        // the page, the Surface's own capture
  uniform vec3 uLightDir;        // the way the light TRAVELS, sheet space
  uniform float uIor;
  uniform float uMaxBendPx;      // the cap on displacement, both copies
  uniform float uDispersion;
  uniform float uEdgeLight;      // how much of the sky the glass shows
  uniform float uSkyHigh;
  uniform float uSkyLow;
  uniform float uSpecular;       // the sun in that sky, and how tight
  uniform float uSpecularPow;
  uniform float uAbsorbPer100;   // Beer's law, per 100px of path
  uniform float uShadow;
  uniform float uShadowSoftPx;
  uniform float uCaustic;
  uniform float uCausticWidthPx;
  ${SURFACE_RADIUS_GLSL}
  varying vec2 vUv;

  ${SOLID_GLSL}

  // What a ray leaving the glass sees, given where it left and where it is
  // going. Sheet space, where +z is out of the page toward the eye.
  //
  // Downward, it sees the PAGE — extended to z = 0 and sampled. That is a
  // real screen-space reflection and it costs one tap: the environment this
  // object stands in is lying right underneath it, and inventing a grey for
  // it instead is most of what made the first version read as plastic.
  //
  // Upward there is nothing to sample, so it gets two greys and a sun:
  // bright overhead, dark below the horizon, one tight lobe at the light.
  vec3 environment(vec3 from, vec3 d) {
    if (d.z < -1e-6) {
      vec2 q = from.xy + d.xy * (from.z / -d.z);
      return texture2D(tMap, clamp(vec2(q.x, uSheet.y - q.y) / uSheet, 0.0, 1.0)).rgb;
    }
    float up = clamp(d.z * 0.5 + 0.5, 0.0, 1.0);
    float sun = pow(max(dot(d, -uLightDir), 0.0), uSpecularPow) * uSpecular;
    return vec3(mix(uSkyLow, uSkyHigh, up * up) + sun);
  }

  // The page as seen along one exit ray: displaced, capped, and split by
  // wavelength. \`flat_\` is where this pixel's ray would have landed with no
  // glass in the way, so the cap lands on the displacement and not on a
  // position — the same clamp crystalLaw.ts applies to the click.
  //
  // One chain at the middle index, with red read a little short of it and
  // blue a little long. Tracing all three separately would be three times
  // the marches for a fringe a few pixels wide.
  vec3 pageAt(vec3 from, vec3 d, vec2 flat_) {
    vec2 bend = (from.xy + d.xy * (from.z / -d.z)) - flat_;
    float m = length(bend);
    if (m > uMaxBendPx) bend *= uMaxBendPx / m;
    vec2 uvAt = vec2(flat_.x + bend.x, uSheet.y - flat_.y - bend.y) / uSheet;
    vec2 duv = vec2(bend.x, -bend.y) / uSheet;
    float g = texture2D(tMap, clamp(uvAt, 0.0, 1.0)).g;
    float r = texture2D(tMap, clamp(uvAt + duv * uDispersion, 0.0, 1.0)).r;
    float b = texture2D(tMap, clamp(uvAt - duv * uDispersion, 0.0, 1.0)).b;
    return vec3(r, g, b);
  }

  // One view ray through the solid, following the ZIGZAG: in through a crown
  // facet, then bouncing between the inside faces until its light runs out.
  //
  // At every face the ray meets from inside, Snell either lets a share
  // through — which is a place this pixel could have come from, and gets
  // added — or, past the critical angle, hands the whole thing back. Either
  // way the remainder reflects and carries on. Four segments, which is the
  // brilliant's own signature path: crown in, pavilion, pavilion, crown out.
  //
  // The old version of this function refracted ONCE and dropped whatever
  // total-internal-reflected, which meant the pixels a gem is brightest at
  // were the pixels it drew as nothing. What is added back is not a
  // highlight: it is the page, seen from somewhere else entirely, several
  // copies of it superimposed. That superposition is the thing the eye reads
  // as a cut stone rather than a lens.
  //
  // Straight (not premultiplied) colour, false wherever the ray misses.
  bool glassAt(vec2 p, out vec3 rgb) {
    rgb = vec3(0.0);
    vec3 dir = normalize(vec3(p, 0.0) - uEye);
    vec3 o = toLocal(uEye);
    vec3 d = toLocalDir(dir);
    vec3 bc = boundsCentre();
    float br = boundsRadius();

    float s = sphereEntry(o, d, bc, br);
    if (s < 0.0) return false;

    // In from outside: the field is positive out here, so a step of its own
    // value can never pass through the surface it is measuring.
    bool hit = false;
    float limit = 2.0 * br + length(o - bc);
    for (int i = 0; i < 96; i++) {
      float sd = sdCrystal(o + d * s);
      if (sd < 0.15) { hit = true; break; }
      s += sd;
      if (s > limit) break;
    }
    if (!hit) return false;

    vec3 p0 = o + d * s;
    vec3 n0 = normalAt(p0);
    vec3 ray;
    if (!refractAt(d, n0, 1.0 / max(uIor, 1.0), ray)) return false;

    float f0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
    vec2 flat_ = uEye.xy + dir.xy * (uEye.z / -dir.z);
    vec3 acc = vec3(0.0);
    vec3 tint = vec3(1.0);
    vec3 pos = p0;

    for (int b = 0; b < 4; b++) {
      // Out from inside: the field is negative in here, so the step is its
      // magnitude. Started clear of the face it just left, or the first step
      // is zero and the march never moves.
      float u = 0.15 * 4.0;
      bool out_ = false;
      for (int i = 0; i < 96; i++) {
        float sd = sdCrystal(pos + ray * u);
        if (sd > -0.15) { out_ = true; break; }
        u -= sd;
        if (u > 4.0 * br) break;
      }
      if (!out_) break;

      vec3 p1 = pos + ray * u;

      // Beer's law over the segment just crossed, tinted so red goes first —
      // the green cast every thick edge of real glass has. This is the cue
      // that says the thing has a volume and not just a surface, and with
      // bounces it also says WHICH exit the eye is looking at: a ray that has
      // crossed the stone three times arrives visibly darker than one that
      // went straight through.
      tint *= exp(-vec3(1.15, 0.85, 1.0) * (uAbsorbPer100 * 0.01) * u);

      vec3 n1 = normalAt(p1);
      vec3 leaving;
      float back = 1.0;
      if (refractAt(ray, -n1, max(uIor, 1.0), leaving)) {
        // Schlick on the OUTGOING angle, which is the form that holds going
        // from dense to rare: the approximation is written around the angle
        // in the rarer medium, and using the internal one reports a mirror as
        // a window right where the mirror matters most.
        back = f0 + (1.0 - f0) * pow(1.0 - clamp(dot(leaving, n1), 0.0, 1.0), 5.0);
        vec3 E = toSheet(p1);
        vec3 A = toSheetDir(leaving);
        vec3 seen = A.z < -1e-6 ? pageAt(E, A, flat_) : environment(E, A) * uEdgeLight;
        acc += tint * (1.0 - back) * seen;
      }

      tint *= back;
      if (max(tint.r, max(tint.g, tint.b)) < 0.02) break;
      ray = reflect(ray, n1);
      pos = p1;
    }

    // The entry face's own reflection, on top of everything the inside sent
    // back. Glass is a window head on and a mirror at grazing incidence, and
    // letting that one number choose between the inside and the environment
    // is what makes the rim, the facet breaks and the highlight all fall out
    // of the same geometry.
    vec3 nSheet = toSheetDir(n0);
    float fin = f0 + (1.0 - f0)
      * pow(1.0 - clamp(dot(-dir, nSheet), 0.0, 1.0), 5.0);
    vec3 mirror = environment(toSheet(p0), reflect(dir, nSheet)) * uEdgeLight;
    rgb = mix(acc, mirror, clamp(fin, 0.0, 1.0));
    return true;
  }

  void main() {
    // Sheet pixels with y DOWN, which is the frame crystalLaw.ts, a bounding
    // rect and a pointermove all already speak. uv's v runs the other way, so
    // this flip is the only conversion in the file.
    vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSheet;
    vec4 c = texture2D(tMap, vUv);

    // ── what the crystal throws down ───────────────────────────────────
    //
    // Everything here is confined to the patch of page the solid can reach,
    // and the test is one length against one radius. Without it the whole
    // viewport would pay for a shadow the size of a playing card.
    // \`uTip.z + girdleZ()\` is the height the shadow is thrown from; the
    // light's own displacement is not capped the way the eye's is, but it is
    // the same glass, so the eye's cap bounds how far it can carry.
    float lift = uTip.z + girdleZ();
    vec2 centre = uTip.xy + uLightDir.xy * (lift / -uLightDir.z);
    float reach = boundsRadius() + uShadowSoftPx * 2.0;
    if (dot(p - centre, p - centre) < reach * reach) {
      // The shadow: walk the light BACKWARDS to the girdle plane and ask the
      // silhouette there. The stone tapers above and below it, so this is the
      // widest section rather than the average one — a shadow a little larger
      // than the true one, cast by the outline the eye reads as the object's.
      vec3 ol = toLocal(vec3(p, 0.0));
      vec3 dl = toLocalDir(uLightDir);
      float occ = 0.0;
      float band = 0.0;
      float inner = 0.0;
      if (abs(dl.z) > 1e-6) {
        vec2 q = (ol + dl * ((girdleZ() - ol.z) / dl.z)).xy;
        float sdS = sdInner2(q) - uGirdlePx;
        occ = 1.0 - smoothstep(-uShadowSoftPx, uShadowSoftPx, sdS);

        // The caustic. The stone gathers light hardest at the rim, where the
        // facet slope is steepest, and drops it just inside the shadow's
        // down-light edge — so the band rides the same silhouette distance
        // the shadow does, weighted to the side facing away from the light.
        // The interior it gathers FROM is left lighter than a flat occluder
        // would leave it.
        //
        // Inverting the light map is what this did until 2026-08-27, and it
        // drew nothing at all: the map's image is a sliver of page mostly
        // hidden under the stone, so a single Newton step from a pixel
        // outside that sliver lands where no ray enters, the guard on the
        // Jacobian never opened, and the gain stayed zero for every pixel on
        // screen. Inverting it properly is not a tuning fix — at a fold the
        // map is many-to-one and the iteration has no fixed point to find.
        // Light that lands in more than one place at once has to be
        // SCATTERED, which is a second pass, not a fragment.
        // Centred just OUTSIDE the silhouette, not inside it like the bead
        // in the selection scene: the light here comes down at 75 degrees
        // over a solid 187px across, so only about 29px of shadow ever
        // clears the stone and a band drawn inside the outline is a band
        // drawn underneath the thing casting it.
        float cw = max(uCausticWidthPx, 0.5);
        float away = clamp(
          0.5 + 0.5 * dot(outlineGrad(q), normalize(dl.xy + vec2(1e-5))), 0.0, 1.0);
        float qb = (sdS - cw * 0.4) / cw;
        band = exp(-qb * qb) * away * away;
        inner = smoothstep(0.0, max(uShadowSoftPx, 1.0) * 2.5, -sdS);
      }

      // Shadow first, focused light on top of it: the light the glass bent
      // had to pass through the glass, so it lands inside the glass's own
      // shadow and nowhere else.
      float carve = clamp(1.0 - 1.5 * uCaustic * band, 0.0, 1.0);
      c.rgb *= 1.0 - occ * uShadow * (1.0 - 0.35 * uCaustic * inner) * carve;
      // Squared before the encode below, which lifts small linear values
      // about 5x — additive blew out at the lowest knob settings without it.
      float gleam = 0.75 * uCaustic * band;
      c.rgb += vec3(1.0, 0.97, 0.88) * gleam * gleam * c.a;
    }

    // ── the glass ──────────────────────────────────────────────────────
    //
    // Four rays on a rotated grid, always — the silhouette is a marched
    // surface with no derivative for the hardware to filter, and the facet
    // breaks inside it are step edges too. The whole solid covers a few per
    // cent of the viewport, so the cost lands only where the aliasing is.
    //
    // Measured 2026-08-25, headless Chrome at 1280x860, 30 renders per sync:
    // 3.7 ms a frame with the median batch and 1.5 with the fastest. Shrink
    // the solid to nothing and the same scene costs 1.1 / 0.8, so the glass
    // — four rays, each up to four bounces — is about 2.5 ms of it.
    vec3 acc = vec3(0.0);
    float cov = 0.0;
    vec3 g;
    if (glassAt(p + vec2(-0.375, -0.125), g)) { acc += g; cov += 1.0; }
    if (glassAt(p + vec2(-0.125, 0.375), g)) { acc += g; cov += 1.0; }
    if (glassAt(p + vec2(0.125, -0.375), g)) { acc += g; cov += 1.0; }
    if (glassAt(p + vec2(0.375, 0.125), g)) { acc += g; cov += 1.0; }
    // \`acc\` is already premultiplied: each sample carries alpha 1, so the
    // sum over four is the coverage-weighted colour and \`cov * 0.25\` is its
    // alpha. This is the over operator, spelled out.
    c = vec4(acc * 0.25, cov * 0.25) + c * (1.0 - cov * 0.25);

    c *= munariRadiusMask(vUv);
    gl_FragColor = c;
    #include <colorspace_fragment>
  }
`
