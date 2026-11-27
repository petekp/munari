// WGSL lens shader for FisheyeSlice (ported from apps/lab/src/scenes/fisheye/fisheyeNodes.ts).

import { SURFACE_WGSL_COMMON } from '../engine/webgpu'

export const FISHEYE_WGSL =
  SURFACE_WGSL_COMMON +
  /* wgsl */ `
struct FrameUniforms {
  mvp: mat4x4f,
  modelWorld: mat4x4f,
  size: vec2f,
  _pad: vec2f,
  radii: vec4f,
};

@group(0) @binding(0) var<uniform> frame: FrameUniforms;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) slope: f32,
  @location(2) lens: f32,
};

@vertex
fn vsMain(
  @location(0) position: vec3f,
  @location(1) uv: vec2f,
  @location(2) aSlope: f32,
  @location(3) aLens: f32,
) -> VsOut {
  var out: VsOut;
  out.pos = frame.mvp * vec4f(position, 1.0);
  out.uv = uv;
  out.slope = aSlope;
  out.lens = aLens;
  return out;
}

@fragment
fn fsMain(@location(0) uv: vec2f, @location(1) slope: f32, @location(2) lens: f32) -> @location(0) vec4f {
  let c = sampleSurface(tex, samp, uv);
  let n = normalize(vec3f(0.0, slope, 1.0));
  let L = normalize(vec3f(-0.3, 0.42, 0.86));
  let shade = mix(0.94, 1.0, max(dot(n, L), 0.0));
  let H = normalize(L + vec3f(0.0, 0.0, 1.0));
  let spec = pow(max(dot(n, H), 0.0), 64.0);
  let rim = smoothstep(0.02, 0.14, lens) * (1.0 - smoothstep(0.14, 0.5, lens));

  let lit = c.rgb * shade + (spec * 0.32 + rim * 0.1) * c.a;
  let mask = surfaceRadiusMask(uv, frame.size, frame.radii);
  let outCol = vec4f(lit * mask, c.a * mask);
  if (outCol.a < 0.004) {
    discard;
  }
  return outCol;
}
`
