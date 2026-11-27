// WGSL aero bend + gloss shader for FlightSlice (ported from apps/lab/src/scenes/flight/flightNodes.ts).

import { SURFACE_WGSL_COMMON } from '../engine/webgpu'

export const FLIGHT_CARD_WGSL =
  SURFACE_WGSL_COMMON +
  /* wgsl */ `
struct FrameUniforms {
  mvp: mat4x4f,
  modelWorld: mat4x4f,
  size: vec2f,
  _pad: vec2f,
  radii: vec4f,
};

struct FlightUniforms {
  aero: vec4f,
  gloss: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
@group(1) @binding(0) var<uniform> custom: FlightUniforms;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) worldNormal: vec3f,
  @location(2) localNormal: vec3f,
};

@vertex
fn vsMain(@location(0) position: vec3f, @location(1) uv: vec2f) -> VsOut {
  let dir = custom.aero.xy;
  let amt = custom.aero.z;
  let reach = max(custom.aero.w, 1.0);
  let s = dot(position.xy, dir);
  let t = clamp(s / reach, -1.0, 1.0);
  let lead = max(t, 0.0);
  let bow = t * t + lead * 0.45 * lead;
  let dzds = amt * (t * 2.0 + lead * 0.9) / reach;
  let nl = normalize(vec3f(-dir * dzds, 1.0));
  let wn = normalize((frame.modelWorld * vec4f(nl, 0.0)).xyz);
  let p = vec3f(position.xy, position.z + amt * bow);

  var out: VsOut;
  out.pos = frame.mvp * vec4f(p, 1.0);
  out.uv = uv;
  out.worldNormal = wn;
  out.localNormal = nl;
  return out;
}

@fragment
fn fsMain(
  @location(0) uv: vec2f,
  @location(1) worldNormal: vec3f,
  @location(2) localNormal: vec3f,
) -> @location(0) vec4f {
  let c = sampleSurface(tex, samp, uv);
  let L = normalize(vec3f(-0.45, 0.62, 0.65));
  let baseBand = pow(L.z, 6.0);
  let sw = max(dot(normalize(worldNormal), L), 0.0);
  let band = pow(sw, 6.0) - baseBand;
  let glossed = c.rgb + custom.gloss * band * c.a;
  let sl = max(dot(normalize(localNormal), L), 0.0);
  let flexBand = pow(sl, 6.0) - baseBand;
  let flexed = glossed * min(1.0, 2.5 * flexBand + 1.0);
  let mask = surfaceRadiusMask(uv, frame.size, frame.radii);
  let outCol = vec4f(flexed * mask, c.a * mask);
  if (outCol.a < 0.004) {
    discard;
  }
  return outCol;
}
`
