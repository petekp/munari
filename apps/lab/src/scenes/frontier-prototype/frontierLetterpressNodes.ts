// Letterpress & hot-stamped foil TSL material — two-scale Sobel heightfield
// (1.2 px die wall + 4.5 px cotton-rag pillow indentation) with separate foil-zone
// detection (`cCenter.r > cCenter.b`) so display headlines and rules take 24k gold
// or holographic foil while body copy stays dense carbon letterpress ink.
//
// Substrate alpha stays ~0.05..0.36 over empty paper so native browser `::selection`
// highlights shine cleanly around solid (`alpha = 1`) embossed glyphs.

import * as THREE from 'three'
import { MeshBasicNodeMaterial, type TextureNode } from 'three/webgpu'
import {
  clamp,
  cos,
  dot,
  float,
  Fn,
  fract,
  length,
  max,
  mix,
  normalize,
  pow,
  sin,
  smoothstep,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
} from 'three/tsl'
import { premultipliedOutput } from '@petepetrash/munari'

export type PressFinishId = 'gold-foil' | 'cotton-letterpress' | 'holo-diffraction' | 'titanium-etch'

export function finishIndex(finish: PressFinishId): number {
  if (finish === 'cotton-letterpress') return 1
  if (finish === 'holo-diffraction') return 2
  if (finish === 'titanium-etch') return 3
  return 0
}

export function createLetterpressUniforms() {
  return {
    sheetSize: uniform(new THREE.Vector2(780, 420)),
    lightPosCss: uniform(new THREE.Vector3(210, 95, 155)),
    finishMode: uniform(0),
    biteDepth: uniform(2.6),
  }
}

export type LetterpressUniforms = ReturnType<typeof createLetterpressUniforms>

export function createLetterpressMaterial(
  glyphMap: TextureNode,
  u: LetterpressUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(u.sheetSize, vec2(1, 1))
    const px = vec2(st.x.mul(size.x), float(1).sub(st.y).mul(size.y))

    const cCenter = glyphMap.sample(st)
    const ink = cCenter.a
    // Warm crimson source color marks headline/rules/seal as the foil-stamped zone;
    // neutral dark body copy stays dense carbon letterpress ink for high legibility.
    const foilZone = smoothstep(float(0.05), float(0.20), cCenter.r.sub(cCenter.b))

    // Scale 1: crisp 1.15 px die-wall edge
    const d1 = vec2(float(1.15).div(size.x), float(1.15).div(size.y))
    const aL = glyphMap.sample(clamp(st.sub(vec2(d1.x, 0)), vec2(0.001), vec2(0.999))).a
    const aR = glyphMap.sample(clamp(st.add(vec2(d1.x, 0)), vec2(0.001), vec2(0.999))).a
    const aD = glyphMap.sample(clamp(st.sub(vec2(0, d1.y)), vec2(0.001), vec2(0.999))).a
    const aU = glyphMap.sample(clamp(st.add(vec2(0, d1.y)), vec2(0.001), vec2(0.999))).a

    // Scale 2: broad 4.5 px cotton-rag fiber pillow indentation around strokes
    const d2 = vec2(float(4.5).div(size.x), float(4.5).div(size.y))
    const pL = glyphMap.sample(clamp(st.sub(vec2(d2.x, 0)), vec2(0.001), vec2(0.999))).a
    const pR = glyphMap.sample(clamp(st.add(vec2(d2.x, 0)), vec2(0.001), vec2(0.999))).a
    const pD = glyphMap.sample(clamp(st.sub(vec2(0, d2.y)), vec2(0.001), vec2(0.999))).a
    const pU = glyphMap.sample(clamp(st.add(vec2(0, d2.y)), vec2(0.001), vec2(0.999))).a
    const pillowRing = pL.add(pR).add(pD).add(pU).mul(0.25)

    // Procedural micro-grain / brushed metal normal
    const hashA = fract(sin(dot(px, vec2(12.9898, 78.233))).mul(43758.5453))
    const brush = sin(px.y.mul(2.4).add(hashA.mul(1.6)))
    const isTitanium = u.finishMode.greaterThan(2.5)
    const microNx = isTitanium.select(brush.mul(0.04), hashA.sub(0.5).mul(0.09))
    const microNy = isTitanium.select(brush.mul(0.22), sin(px.x.mul(0.5).add(px.y.mul(0.4))).mul(0.06))

    const dieNx = aL.sub(aR).mul(u.biteDepth)
    const dieNy = aD.sub(aU).mul(u.biteDepth)
    const pillowNx = pL.sub(pR).mul(u.biteDepth.mul(0.55))
    const pillowNy = pD.sub(pU).mul(u.biteDepth.mul(0.55))

    const normal = normalize(vec3(dieNx.add(pillowNx).add(microNx), dieNy.add(pillowNy).add(microNy), float(1)))

    // Grazing studio lamp in CSS pixel space
    const toLight = vec3(
      u.lightPosCss.x.sub(px.x),
      px.y.sub(u.lightPosCss.y),
      max(u.lightPosCss.z, float(80)),
    )
    const distToLight = length(vec2(u.lightPosCss.x.sub(px.x), u.lightPosCss.y.sub(px.y)))
    const lightDir = normalize(toLight)
    const halfVec = normalize(lightDir.add(vec3(0, 0, 1)))
    const ndotl = clamp(dot(normal, lightDir), float(0), float(1))

    // Spatially localized metallic sheen band (prevents uniform flat-interior white blowout!)
    const lampFalloff = float(1).sub(smoothstep(float(40), float(520), distToLight))
    const bevelMag = clamp(length(vec2(dieNx, dieNy)).mul(0.45), float(0), float(1))
    const edgeGlint = pow(max(dot(normal, halfVec), float(0.0001)), float(26)).mul(bevelMag.add(0.18))
    const sheenSweep = pow(max(lampFalloff, float(0.0001)), float(1.6)).mul(
      float(0.65).add(sin(px.x.mul(0.014).sub(px.y.mul(0.011)).add(lightDir.x.mul(3.2))).mul(0.35)),
    )

    // Dense pressed carbon ink (body copy + letterpress mode)
    const carbonInk = vec3(0.022, 0.025, 0.034).add(vec3(0.16, 0.16, 0.18).mul(edgeGlint.mul(0.45)))

    // Mode 0: 24k Burnished Gold Foil (rich antique gold shadow -> warm 24k sheen -> bright bevel catchlight)
    const goldShadow = vec3(0.34, 0.18, 0.025)
    const goldMid = vec3(0.78, 0.54, 0.11)
    const goldRgb = mix(goldShadow, goldMid, clamp(sheenSweep.mul(0.85).add(ndotl.mul(0.35)), float(0), float(1)))
      .add(vec3(1.0, 0.93, 0.68).mul(edgeGlint.mul(0.85)))

    // Mode 1: Vermilion & Prussian Letterpress Ink
    const vermilionInk = vec3(0.46, 0.045, 0.032)
      .mul(float(0.75).add(ndotl.mul(0.4)))
      .add(vec3(0.35, 0.22, 0.18).mul(edgeGlint.mul(0.45)))

    // Mode 2: Holographic Security Foil
    const phase = st.x.mul(5.8).add(st.y.mul(3.6)).add(lightDir.x.mul(2.8)).add(lightDir.y.mul(2.1)).add(dieNx.mul(0.12))
    const spectrum = vec3(0.52).add(vec3(0.46).mul(cos(float(6.28318).mul(phase.add(vec3(0.0, 0.33, 0.67))))))
    const holoRgb = mix(vec3(0.32, 0.36, 0.44), spectrum, clamp(sheenSweep.mul(0.78).add(0.28), float(0), float(1)))
      .add(vec3(1).mul(edgeGlint.mul(0.75)))

    // Mode 3: Brushed Titanium Laser-Etch
    const tiFoil = vec3(0.09, 0.12, 0.18).add(vec3(0.55, 0.66, 0.82).mul(edgeGlint.mul(0.8).add(sheenSweep.mul(0.22))))

    const isLetterpress = u.finishMode.greaterThan(0.5).and(u.finishMode.lessThan(1.5))
    const isHolo = u.finishMode.greaterThan(1.5).and(u.finishMode.lessThan(2.5))
    const activeFoil = isLetterpress.select(
      vermilionInk,
      isHolo.select(holoRgb, isTitanium.select(tiFoil, goldRgb)),
    )

    // Foil zone uses activeFoil; body copy stays crisp carbon letterpress ink!
    const glyphRgb = mix(carbonInk, activeFoil, foilZone)

    // Paper pillow lip highlight & shadow around strokes (transparent flat paper preserves native ::selection!)
    const baselineNdotl = lightDir.z
    const deltaShade = ndotl.sub(baselineNdotl)
    const lipBright = clamp(deltaShade.mul(2.4), float(0), float(0.42)).mul(pillowRing)
    const grooveDark = clamp(deltaShade.negate().mul(2.2), float(0), float(0.36)).mul(pillowRing)

    const grainDelta = hashA.sub(0.5).mul(0.04)
    const paperAlpha = clamp(float(0.05).add(lipBright).add(grooveDark), float(0.03), float(0.42))
    const paperRgb = mix(
      vec3(0.04, 0.035, 0.03),
      vec3(1, 0.99, 0.96),
      lipBright.div(max(lipBright.add(grooveDark), float(0.001))),
    ).add(vec3(grainDelta))

    const glyphMask = smoothstep(float(0.08), float(0.72), ink)
    const outAlpha = mix(paperAlpha, float(1), glyphMask)
    const outPremul = mix(
      clamp(paperRgb, vec3(0), vec3(1)).mul(paperAlpha),
      clamp(glyphRgb, vec3(0), vec3(1)),
      glyphMask,
    )

    return premultipliedOutput(vec4(outPremul, outAlpha))
  })()

  return mat
}
