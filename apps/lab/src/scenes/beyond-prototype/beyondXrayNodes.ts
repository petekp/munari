// Fluoroscopic X-Ray loupe TSL material (`BeyondXray`) — clips a subsurface PCB
// `<Surface>` to a movable circular optical instrument with cast housing shadow,
// recessed 8 mm milled-cavity inner shadow, machined knurled bezel, crystal rim
// dispersion, and etched vernier reticle hairlines.

import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import {
  abs,
  atan,
  clamp,
  dot,
  float,
  Fn,
  length,
  max,
  min,
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
import { premultipliedOutput, type SurfaceNodes } from '@petepetrash/munari'

export function createXrayUniforms() {
  return {
    panelSize: uniform(new THREE.Vector2(700, 428)),
    loupeCenterCss: uniform(new THREE.Vector2(510, 274)),
    loupeRadiusPx: uniform(122),
    phosphorTint: uniform(new THREE.Color('#18f2a6')),
    bezelColor: uniform(new THREE.Color('#20242b')),
    brassAccent: uniform(new THREE.Color('#d8ab5c')),
  }
}

export type XrayUniforms = ReturnType<typeof createXrayUniforms>

export function createXrayMaterial(
  surface: SurfaceNodes,
  u: XrayUniforms,
): MeshBasicNodeMaterial {
  const mat = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  })
  mat.premultipliedAlpha = true

  mat.outputNode = Fn(() => {
    const st = uv()
    const size = max(u.panelSize, vec2(1, 1))
    const posCss = vec2(st.x.mul(size.x), float(1).sub(st.y).mul(size.y))

    const delta = posCss.sub(u.loupeCenterCss)
    const dist = length(delta)
    const dir = delta.div(max(dist, float(0.0001)))

    const outerR = max(u.loupeRadiusPx, float(44))
    const bezelW = float(13)
    const glassR = outerR.sub(bezelW)

    // Soft cast shadow outside the bezel onto the anodized aluminum console
    const shadowDist = length(posCss.sub(u.loupeCenterCss.add(vec2(5, 10))))
    const shadowAlpha = float(1)
      .sub(smoothstep(outerR.sub(2), outerR.add(24), shadowDist))
      .mul(smoothstep(outerR.sub(1.2), outerR.add(0.8), dist))
      .mul(0.36)

    const inHousing = float(1).sub(smoothstep(outerR.sub(0.8), outerR.add(0.8), dist))
    const inGlass = float(1).sub(smoothstep(glassR.sub(0.8), glassR.add(0.8), dist))
    const inBezel = clamp(inHousing.sub(inGlass), float(0), float(1))

    // Distortion-free 1:1 optical core (`0..78%` of glassR) for exact DIP switch hits,
    // transitioning into an apochromatic crystal bevel on the outer 22%
    const glassNorm = clamp(dist.div(max(glassR, float(1))), float(0), float(1))
    const collarT = smoothstep(float(0.78), float(1.0), glassNorm)
    const bendPx = pow(max(collarT, float(0.0001)), float(1.7)).mul(9)
    const bendUv = vec2(dir.x.div(size.x), dir.y.negate().div(size.y)).mul(bendPx)

    const uvR = clamp(st.sub(bendUv.mul(0.76)), vec2(0.002), vec2(0.998))
    const uvG = clamp(st.sub(bendUv), vec2(0.002), vec2(0.998))
    const uvB = clamp(st.sub(bendUv.mul(1.26)), vec2(0.002), vec2(0.998))

    const pcbRgb = vec3(
      surface.map.sample(uvR).r,
      surface.map.sample(uvG).g,
      surface.map.sample(uvB).b,
    )

    // Recessed 8 mm milled-chassis inner wall shadow (`light from top-left`)
    const cavityDist = length(posCss.sub(u.loupeCenterCss.add(vec2(5.5, 8.5))))
    const cavityShade = smoothstep(glassR.sub(18), glassR.add(2), cavityDist)
    const depthMul = float(1).sub(cavityShade.mul(0.46))

    // Etched sapphire vernier cardinal ticks + subtle inner phosphor ring
    const onAxis = min(abs(delta.x), abs(delta.y))
    const cardinalBand = smoothstep(glassR.mul(0.78), glassR.mul(0.82), dist).mul(
      float(1).sub(smoothstep(glassR.mul(0.92), glassR.mul(0.95), dist)),
    )
    const vernierTick = float(1).sub(smoothstep(float(0), float(0.9), onAxis)).mul(cardinalBand).mul(0.22)
    const rimGlow = smoothstep(float(0.76), float(1.0), glassNorm).mul(0.15)

    const domeNormal = normalize(
      vec3(dir.x.mul(glassNorm.mul(0.6)), dir.y.negate().mul(glassNorm.mul(0.6)), float(1)),
    )
    const lightDir = normalize(vec3(-0.48, 0.62, 0.82))
    const halfVec = normalize(lightDir.add(vec3(0, 0, 1)))
    const glassSpec = pow(max(dot(domeNormal, halfVec), float(0.0001)), float(44)).mul(0.32)

    const litPcb = clamp(
      pcbRgb
        .mul(depthMul)
        .add(u.phosphorTint.mul(rimGlow.add(vernierTick)))
        .add(vec3(0.94, 1.0, 0.98).mul(glassSpec)),
      vec3(0),
      vec3(1),
    )

    // Machined anodized gunmetal + brass index-ring bezel with knurled radial ridges
    const bezelT = clamp(dist.sub(glassR).div(bezelW), float(0), float(1))
    const angle = atan(delta.y, delta.x)
    const knurl = sin(angle.mul(104)).mul(0.045)
    const bezelSlope = bezelT.sub(0.5).mul(2.1)
    const bezelN = normalize(vec3(dir.x.mul(bezelSlope), dir.y.negate().mul(bezelSlope), float(1)))
    const bezelSpec = pow(max(dot(bezelN, halfVec), float(0.0001)), float(24)).mul(0.44)
    const brassRing = float(1)
      .sub(smoothstep(float(0.0), float(0.16), abs(bezelT.sub(0.24))))
      .mul(0.88)
    const bezelRgb = clamp(
      mix(u.bezelColor.mul(float(1).add(knurl)), u.brassAccent, brassRing).add(
        vec3(1, 0.96, 0.88).mul(bezelSpec),
      ),
      vec3(0),
      vec3(1),
    )

    // `inGlass + inBezel = inHousing` already premultiplies coverage without double-squaring edges
    const housingPremul = litPcb.mul(inGlass).add(bezelRgb.mul(inBezel))
    const totalAlpha = clamp(inHousing.add(shadowAlpha), float(0), float(1))
    const shadowPremul = vec3(0.02, 0.03, 0.04).mul(shadowAlpha)
    const premulRgb = clamp(housingPremul.add(shadowPremul), vec3(0), vec3(1))

    return premultipliedOutput(vec4(premulRgb, totalAlpha))
  })()

  return mat
}
