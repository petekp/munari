// Home light — shadows from thin glyphs, selected type, raised controls,
// recessed wells and the moving postcard, under one finite light source.
//
// The law: the pass only darkens. It writes a multiplier the page is
// composited through (mix-blend-mode: multiply on the host), so a lit pixel
// of 1.0 means "leave the page alone" and the brightest thing on screen is
// still the page's own wash. The glow around the light is the fixture's
// job, not this pass's.
//
// Solid shadow casters made the page look extruded (Pete, 2026-09-07).
// Thin surfaces retain the printed appearance; their separation from each
// receiver sets shadow displacement and softness. Decision #50 pins the pixels.
//
// Ownership: this module owns the light and shadow math and the material.
// homeRelief.ts owns glyph and relief distance fields. homeLightLaw.ts owns
// the reference projection and standoffs. HomeMasthead.tsx owns the renderer, the light's
// position, and when the masks are rebuilt.

import * as THREE from 'three'
import { GLYPH_STANDOFF, LIGHT_HEIGHT, RAISED_STANDOFF, WELL_DEPTH } from './homeLightLaw'
import type { Mask } from './homeRelief'
import { SHADOW_DISTANCE_RANGE } from './homeShadowField'
import { PAPER_LIGHT_GLSL } from './homePaperShaders'

// Keep the lit receiver inside opaque ink. The native text edge and the
// CSS-resolution lighting filter otherwise expose a bright cutout fringe (#55).
const GLYPH_RECEIVER_INSET = 1.5

const VERTEX = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// Native outlines and selected height supply shadow casters and receivers (#50).
const HOME_GLYPH_GLSL = /* glsl */`
uniform vec4 uInkRect;
uniform sampler2D uInk;
uniform float uInkReady;
uniform float uGlyphScale;
uniform vec4 uSelection[8];
uniform int uSelectionCount;
uniform float uSelectionLift;
const float GLYPH_HEIGHT = ${GLYPH_STANDOFF.toFixed(1)};
const float FIELD_RANGE = ${SHADOW_DISTANCE_RANGE.toFixed(1)};
float unpackDistance(vec2 bytes) {
  return (dot(bytes,vec2(65280.0,255.0))/65535.0-0.5)*(2.0*FIELD_RANGE);
}
float outsideRect(vec2 p, vec4 rect) {
  return length(max(abs(p-rect.xy-rect.zw*0.5)-rect.zw*0.5,0.0));
}
float inkDistance(vec2 p) {
  vec2 uv=clamp((p-uInkRect.xy)/uInkRect.zw,0.0,1.0);
  return unpackDistance(texture2D(uInk,vec2(uv.x,1.0-uv.y)).rg)+outsideRect(p,uInkRect);
}
float selectionDistance(vec2 p) {
  float distance=FIELD_RANGE;
  for (int i=0;i<8;i++) {
    if (i>=uSelectionCount) break;
    vec2 d=abs(p-uSelection[i].xy-uSelection[i].zw*0.5)-uSelection[i].zw*0.5;
    distance=min(distance,min(max(d.x,d.y),0.0)+length(max(d,0.0)));
  }
  return distance;
}
float glyphHeight(vec2 p) {
  return GLYPH_HEIGHT*uGlyphScale + (selectionDistance(p)<0.0 ? uSelectionLift : 0.0);
}
`

const FRAGMENT = /* glsl */`
uniform vec2 uResolution;
uniform vec2 uLight;
uniform float uLightHeight;
uniform float uLightRadius;
${HOME_GLYPH_GLSL}
uniform vec4 uReliefRect;
uniform sampler2D uRelief;
uniform float uReliefReady;
uniform vec3 uFlyer[4];
uniform float uFlyerReady;
${PAPER_LIGHT_GLSL}
#ifdef PAPER_RECEIVER
centroid varying vec4 vPaperPosition;
centroid varying vec3 vPaperNormal;
#endif
varying vec2 vUv;

const float RAISED_HEIGHT = ${RAISED_STANDOFF.toFixed(1)};
const float WELL_DEPTH = ${WELL_DEPTH.toFixed(1)};
const float LIGHT_POWER = ${LIGHT_HEIGHT.toFixed(1)} * ${LIGHT_HEIGHT.toFixed(1)};
const float GLYPH_RECEIVER_INSET = ${GLYPH_RECEIVER_INSET.toFixed(1)};

vec2 fieldDistances(sampler2D field, vec4 rect, vec2 p) {
  vec2 uv = (p - rect.xy) / rect.zw;
  vec2 bounded = clamp(uv,0.0,1.0);
  vec4 value = texture2D(field, vec2(bounded.x, 1.0 - bounded.y));
  return vec2(unpackDistance(value.rg), unpackDistance(value.ba)) + outsideRect(p,rect);
}

vec3 flyerNormal() {
  return normalize(cross(uFlyer[1] - uFlyer[0], uFlyer[3] - uFlyer[0]));
}

// Coordinates in the projected card footprint, and its height at that pixel.
vec3 flyerSurface(vec2 p) {
  vec3 a = uFlyer[0];
  vec3 u = uFlyer[1] - a;
  vec3 v = uFlyer[3] - a;
  float det = u.x * v.y - u.y * v.x;
  if (abs(det) < 0.001) return vec3(-1.0);
  vec2 w = p - a.xy;
  vec2 uv = vec2(w.x * v.y - w.y * v.x, u.x * w.y - u.y * w.x) / det;
  return vec3(uv, a.z + uv.x * u.z + uv.y * v.z);
}

// Each native silhouette occupies one horizontal plane. Selected ink moves
// to its own plane rather than leaving a second caster underneath it.
float sheetOutline(vec2 p, int layer) {
  if (layer < 2) {
    float outline = inkDistance(p);
    if (uSelectionLift <= 0.01) return outline;
    float selected = selectionDistance(p);
    return max(outline, layer == 0 ? -selected : selected);
  }
  vec2 relief = fieldDistances(uRelief,uReliefRect,p);
  return layer == 2 ? relief.x : -relief.y;
}

float flyerRayVisibility(vec3 receiver, vec3 light) {
  vec3 normal = flyerNormal();
  vec3 ray = light-receiver;
  float denominator = dot(normal,ray);
  if (abs(denominator) < 0.001) return 1.0;
  float t = dot(normal,uFlyer[0]-receiver)/denominator;
  if (t <= 0.00001 || t >= 1.0) return 1.0;
  vec3 point = receiver+ray*t;
  vec2 uv = flyerSurface(point.xy).xy;
  vec2 edge = min(uv,1.0-uv)*vec2(length(uFlyer[1]-uFlyer[0]),length(uFlyer[3]-uFlyer[0]));
  return 1.0-smoothstep(-0.5,0.5,min(edge.x,edge.y));
}

float lightVisibility(vec3 receiver, vec3 light) {
  vec3 delta = light-receiver;
  float lightGap = delta.z;
  if (lightGap <= 0.0) return 1.0;
  mat3 basis = bulbBasis(delta);
  float cosineLimit = bulbCosine(delta);
  float radiusSquared = uLightRadius*uLightRadius;
  float projection = max(.001,lightGap*lightGap-radiusSquared);
  // Each footprint stores its height above the receiver and pixel coverage.
  // The spherical emitter projects to an ellipse, longer at grazing angles.
  vec2 footprint[4];
  bool partial[4];
  bool anyPartial = false;
  for (int layer=0;layer<4;layer++) {
    partial[layer] = false;
    footprint[layer] = vec2(0.0);
    bool enabled = layer < 2 ? uInkReady > 0.5 : uReliefReady > 0.5;
    if (layer == 1) enabled = enabled && uSelectionLift > 0.01;
    float elevation = layer < 2 ? GLYPH_HEIGHT*uGlyphScale : RAISED_HEIGHT;
    if (layer == 1) elevation += uSelectionLift;
    if (layer == 3) elevation = 0.0;
    float gap = elevation-receiver.z;
    if (!enabled || gap <= 0.01 || gap >= lightGap) continue;
    float t = gap/lightGap;
    vec2 point = receiver.xy+delta.xy*(gap*lightGap/projection);
    float radius = gap*uLightRadius*sqrt(max(.001,dot(delta,delta)-radiusSquared))/projection;
    float aa = max(0.05,0.5*(1.0-t));
    float outline = sheetOutline(point,layer);
    if (outline < -radius-aa) return 0.0;
    partial[layer] = outline < radius+aa;
    anyPartial = anyPartial || partial[layer];
    footprint[layer] = vec2(gap,aa);
  }
  bool flyer = uFlyerReady > 0.5 && uPaperReady < 0.5;
  if (!anyPartial && !flyer) return 1.0;
  float visible = 0.0;
  // Each sampled bulb ray tests every caster once. Elevation and the light's
  // angle both widen the footprint, without double-darkening overlaps (#50).
  for (int sampleIndex=0;sampleIndex<64;sampleIndex++) {
    vec3 ray = sampleBulbRay(basis,cosineLimit,LIGHT_TAPS[sampleIndex]);
    float rayVisibility = 1.0;
    for (int layer=0;layer<4;layer++) {
      if (!partial[layer]) continue;
      vec2 f = footprint[layer];
      vec2 point = receiver.xy+ray.xy*(f.x/max(ray.z,.0001));
      float outline = sheetOutline(point,layer);
      rayVisibility = min(rayVisibility,smoothstep(-f.y,f.y,outline));
    }
    if (flyer) rayVisibility = min(rayVisibility,flyerRayVisibility(receiver,receiver+ray*length(delta)));
    visible += rayVisibility;
  }
  return visible/64.0;
}

void main() {
#ifdef PAPER_RECEIVER
  vec2 p=vPaperPosition.xy/vPaperPosition.w-uFrameOrigin;
  vec3 normal=normalize(vPaperNormal);
  if(normal.z<0.0)normal=-normal;
  float height=vPaperPosition.z+.35;
  vec2 relief=vec2(FIELD_RANGE);
  bool onPaper=true;
#else
  vec2 p = vec2(vUv.x,1.0-vUv.y) * uResolution;
  float ink = uInkReady > 0.5 ? fieldDistances(uInk,uInkRect,p).x : FIELD_RANGE;
  vec2 relief = uReliefReady > 0.5 ? fieldDistances(uRelief,uReliefRect,p) : vec2(FIELD_RANGE);
  float height = relief.y < 0.0 ? -WELL_DEPTH : 0.0;
  if (relief.x < 0.0) height = max(height,RAISED_HEIGHT);
  if (ink < -GLYPH_RECEIVER_INSET) height = max(height,glyphHeight(p));
  vec3 normal = vec3(0.0,0.0,1.0);
  bool onPaper=false;
  // The curved receiver is drawn separately with geometry coverage at native
  // density. This analytic plane remains the no-float-target fallback (#53).
  if (uPaperReady < 0.5 && uFlyerReady > 0.5) {
    vec3 card = flyerSurface(p);
    if (all(greaterThanEqual(card.xy,vec2(0.0))) && all(lessThanEqual(card.xy,vec2(1.0)))) {
      height = card.z + 0.35;
      normal = flyerNormal();
      if (normal.z < 0.0) normal = -normal;
      onPaper=true;
    }
  }
#endif
  vec3 receiver = vec3(p,height);
  vec3 light = vec3(uLight,uLightHeight);
  // Page content sits behind the postcard in both presentations. Its shadows
  // must stay behind too; the paper's own occlusion is applied separately (#50).
  float visibility = onPaper ? 1.0 : lightVisibility(receiver,light);
  if(uPaperReady>.5)visibility=min(visibility,paperVisibility(receiver,normal,light));
  vec3 direction = normalize(light-receiver);
  float facing = clamp(dot(normal,direction)/max(direction.z,0.12),0.0,1.15);
  // Normalize unoccluded horizontal surfaces to the existing page wash.
  // The ambient/direct ratio still reduces shadow contrast far from the bulb.
  float direct = LIGHT_POWER / max(dot(light-receiver,light-receiver),1.0);
  float shade = (0.75 + direct*visibility*facing)/(0.75+direct);
  if(onPaper){
    // Matte stock leaves headroom for the soft sheen on a turning fold.
    // The same response shades native and scene presentations at rest (#51).
    float sheen=.06*pow(max(dot(normal,normalize(direction+vec3(0.0,0.0,1.0))),0.0),18.0)*visibility;
    shade=shade*.86+sheen;
  }
  // Only recessed wells touch a surrounding rim. Elevated sheets must not
  // leave a fixed dark outline behind when their cast shadow moves away.
  float contact = height < 0.0 ? 0.10*exp(min(0.0,relief.y)/3.0) : 0.0;
  // The page keeps a readable ambient floor while the lamp's pool moves.
  // Cool blocked light stays subtle on the chartreuse wash (decision #50).
  vec2 away = p-light.xy;
  float pool = 0.88 + 0.12*exp(-dot(away,away)/(4.0*uLightHeight*uLightHeight));
  vec3 tint = mix(vec3(0.96,0.985,1.0),vec3(1.0),visibility);
  gl_FragColor = vec4(clamp(vec3(shade*(1.0-contact)*pool)*tint,0.0,1.0),1.0);
}
`

export interface MaskFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export function createHomeLightMaterial() {
  const uniforms = {
    uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
    uLight: new THREE.Uniform(new THREE.Vector2(0, 0)),
    uLightHeight: new THREE.Uniform(LIGHT_HEIGHT),
    // A broad source softens separated shadows without blurring contact (#50).
    uLightRadius: new THREE.Uniform(30),
    uInkRect: new THREE.Uniform(new THREE.Vector4(0, 0, 1, 1)),
    uInk: new THREE.Uniform<THREE.Texture | null>(null),
    uInkReady: new THREE.Uniform(0),
    uGlyphScale: new THREE.Uniform(1),
    uReliefRect: new THREE.Uniform(new THREE.Vector4(0, 0, 1, 1)),
    uRelief: new THREE.Uniform<THREE.Texture | null>(null),
    uReliefReady: new THREE.Uniform(0),
    uFlyer: new THREE.Uniform([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]),
    uFlyerReady: new THREE.Uniform(0),
    uPaperShadow: new THREE.Uniform<THREE.Texture | null>(null),
    uPaperShadowMatrix: new THREE.Uniform(new THREE.Matrix4()),
    uPaperShadowRange: new THREE.Uniform(new THREE.Vector2(1,1)),
    uPaperReady: new THREE.Uniform(0),
    uFrameOrigin: new THREE.Uniform(new THREE.Vector2()),
    uSelection: new THREE.Uniform(Array.from({ length: 8 }, () => new THREE.Vector4())),
    uSelectionCount: new THREE.Uniform(0),
    uSelectionLift: new THREE.Uniform(0),
  }
  const material = new THREE.ShaderMaterial({
    name: 'home-light',
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms,
    depthTest: false,
    depthWrite: false,
  })
  return Object.assign(material, { uniforms })
}

export type HomeLightMaterial = ReturnType<typeof createHomeLightMaterial>

/** Shade the paper's actual triangles, sharing the page's light and depth map. */
export function createHomePaperMaterial(material:HomeLightMaterial){
  return new THREE.ShaderMaterial({
    name:'home-paper-light',defines:{PAPER_RECEIVER:1},uniforms:material.uniforms,
    vertexShader:/* glsl */`
      varying vec2 vUv;
      attribute float projectionW;
      centroid varying vec4 vPaperPosition;
      centroid varying vec3 vPaperNormal;
      void main(){
        vUv=uv;vPaperPosition=vec4(position.xy*projectionW,position.z,projectionW);vPaperNormal=normal;
        vec4 projected=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        // Keep the card camera's perspective interpolation and depth order;
        // the receiver's x/y coordinates have already been projected to pixels.
        gl_Position=vec4(projected.xy*projectionW,projectionW-2.0,projectionW);
      }
    `,
    fragmentShader:FRAGMENT,side:THREE.DoubleSide,toneMapped:false,
  })
}

export function setHomeLightFrame(material: HomeLightMaterial, width: number, height: number, lightX: number, lightY: number, lightHeight = LIGHT_HEIGHT) {
  material.uniforms.uLightHeight.value = lightHeight
  material.uniforms.uResolution.value.set(width, height)
  material.uniforms.uLight.value.set(lightX, lightY)
}

export function setHomeInkMask(material: HomeLightMaterial, texture: THREE.Texture | null, frame: MaskFrame | null, scale = 1) {
  material.uniforms.uGlyphScale.value = scale
  material.uniforms.uInk.value = texture
  material.uniforms.uInkReady.value = texture && frame ? 1 : 0
  if (!frame) return
  material.uniforms.uInkRect.value.set(frame.x, frame.y, frame.width, frame.height)
}

/** The flyer's corners (see homeFlyer.ts) moved into canvas px, or none. */
export function setHomeFlyerUniform(material: HomeLightMaterial, corners: Float32Array | null, originX: number, originY: number) {
  material.uniforms.uFlyerReady.value = corners ? 1 : 0
  if (!corners) return
  // Both publishers supply four xyz corners; each target consumes one triple.
  material.uniforms.uFlyer.value.forEach((target, index) => {
    target.set(corners[index * 3]! - originX, corners[index * 3 + 1]! - originY, corners[index * 3 + 2]!)
  })
}

export function setHomeReliefMask(material: HomeLightMaterial, texture: THREE.Texture | null, frame: MaskFrame | null) {
  material.uniforms.uRelief.value = texture
  material.uniforms.uReliefReady.value = texture && frame ? 1 : 0
  if (!frame) return
  material.uniforms.uReliefRect.value.set(frame.x, frame.y, frame.width, frame.height)
}

/** Uploads a mask's packed bytes as-is; no colour space, no premultiplying. */
export function maskTexture(mask: Mask): THREE.DataTexture {
  const texture = new THREE.DataTexture(mask.data, mask.width, mask.height, THREE.RGBAFormat, THREE.UnsignedByteType)
  texture.flipY = true
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}
