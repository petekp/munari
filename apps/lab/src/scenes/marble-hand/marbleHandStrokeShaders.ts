// Hand stroke shaders — a CSS-pixel border around the rendered silhouette.
//
// The law: expand the screen mask, not the model. World-space shell width
// changes with camera distance; split wrist normals also open shell seams.
// The 2026-08-30 visibility request needs one continuous outer contour.
//
// Ownership: the stroke pass supplies a hand-only alpha mask and CSS pixel
// size. These shaders supply coverage and color; no page pixels enter here.

export const MARBLE_HAND_STROKE_VERTEX = /* glsl */`
uniform vec4 uBounds;
varying vec2 vScreenUv;

void main() {
  vScreenUv = mix(uBounds.xy, uBounds.zw, uv);
  gl_Position = vec4(vScreenUv * 2.0 - 1.0, 0.0, 1.0);
}
`

export const MARBLE_HAND_STROKE_FRAGMENT = /* glsl */`
uniform sampler2D uMask;
uniform vec2 uCssPixel;
uniform float uWidth;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vScreenUv;

float handAlpha(vec2 sampleUv) {
  if (any(lessThan(sampleUv, vec2(0.0))) || any(greaterThan(sampleUv, vec2(1.0)))) return 0.0;
  return texture2D(uMask, sampleUv).a;
}

void main() {
  float center = handAlpha(vScreenUv);
  if (center >= 1.0) discard;
  float expanded = center;
  // Thirty-two directions keep a 12px circle's angular error below 0.06px.
  // Inner rings keep thin fingertips inside a wide stroke. Small strokes
  // need only the outer ring, with mask filtering supplying edge coverage.
  for (int ring = 1; ring <= 4; ring++) {
    if (ring < 4 && uWidth <= 2.0) continue;
    float radius = uWidth * float(ring) * 0.25;
    for (int direction = 0; direction < 32; direction++) {
      float angle = float(direction) * 6.28318530718 / 32.0;
      vec2 offset = vec2(cos(angle), sin(angle)) * uCssPixel * radius;
      expanded = max(expanded, handAlpha(vScreenUv + offset));
    }
  }
  float alpha = max(0.0, expanded - center) * uOpacity;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(uColor, alpha);
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}
`
