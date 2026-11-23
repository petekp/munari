// Wordmark geometry — repairs, pairs and extrudes the baked font outlines; coordinates use the 224-pixel raster grid, with y pointing down.
// Consumers own each returned geometry and must dispose it after replacement.
import {
  Shape,
  Path,
  ShapeUtils,
  Vector2,
  ExtrudeGeometry,
  BufferGeometry,
  Float32BufferAttribute,
} from "three";
import polygonClipping, {
  type Polygon,
  type MultiPolygon,
} from "polygon-clipping";

export type Point = [number, number];
export interface GlyphRing {
  points: Point[];
  area: number;
  parent: number;
  depth: number;
}
export interface CurvePair {
  left: Point[];
  right: Point[];
}
export interface ContourPair extends CurvePair {
  parent: number;
  depth: number;
}
export interface ContourMorph {
  pairs: ContourPair[];
  from: GlyphRing[];
  to: GlyphRing[];
  preserveDot: boolean;
}
export interface WordmarkGlyph {
  character: string;
  font: string;
  rings: GlyphRing[];
  advance: number;
}

export const GRID = 224;

function squaredDistanceToSegment(point: Point, a: Point, b: Point) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) /
        (dx * dx + dy * dy || 1),
    ),
  );
  return (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
}

function ringArea(ring: Point[]) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

function contains(ring: Point[], point: Point) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function dottedIParts(rings: GlyphRing[]) {
  const parts = rings
    .map((ring, index) => ({ ring, index }))
    .filter((part) => part.ring.depth % 2 === 0);
  if (parts.length !== 2) return null;
  const bounds = (points: Point[]) => ({
    top: Math.min(...points.map((p) => p[1])),
    bottom: Math.max(...points.map((p) => p[1])),
  });
  const sorted = parts
    .map((part) => ({ ...part, ...bounds(part.ring.points) }))
    .sort((a, b) => a.top - b.top);
  const [dot, stem] = sorted;
  const gap = stem.top - dot.bottom;
  if (gap <= 0) return null;
  return { stem, dot, gap };
}

function largestPolygon(polygons: MultiPolygon) {
  return polygons.reduce<Polygon | null>(
    (largest, polygon) =>
      !largest ||
      Math.abs(ringArea(polygon[0])) > Math.abs(ringArea(largest[0]))
        ? polygon
        : largest,
    null,
  );
}

function fitHole(hole: Point[], outer: Polygon): Polygon | null {
  const requested = largestPolygon(polygonClipping.union([hole]));
  if (!requested) return null;
  const points = requested[0].slice(0, -1);
  if (!polygonClipping.difference(requested, outer).length) return requested;
  let anchor = center(points);
  const boundary = outer[0].slice(0, -1);
  if (!contains(boundary, anchor)) {
    const triangles = ShapeUtils.triangulateShape(
      boundary.map(([x, y]) => new Vector2(x, y)),
      [],
    );
    const candidates = triangles.map((triangle) =>
      center(triangle.map((index) => boundary[index])),
    );
    candidates.sort(
      (a, b) =>
        (a[0] - anchor[0]) ** 2 +
        (a[1] - anchor[1]) ** 2 -
        (b[0] - anchor[0]) ** 2 -
        (b[1] - anchor[1]) ** 2,
    );
    anchor = candidates[0];
  }
  if (!anchor) return null;
  const at = (scale: number): Polygon => [
    points.map((p) => [
      anchor[0] + (p[0] - anchor[0]) * scale,
      anchor[1] + (p[1] - anchor[1]) * scale,
    ]),
  ];
  let low = 0,
    high = 1;
  for (let i = 0; i < 16; i++) {
    const middle = (low + high) / 2;
    if (polygonClipping.difference(at(middle), outer).length) high = middle;
    else low = middle;
  }
  const fitted = at(low * 0.98);
  const contained = polygonClipping.difference(fitted, outer).length
    ? at(low)
    : fitted;
  return Math.abs(ringArea(contained[0])) >= 0.04 ? contained : null;
}

function filledContours(rings: GlyphRing[], constrain = false): GlyphRing[] {
  const polygons: MultiPolygon = rings.flatMap((ring, index) => {
    if (ring.depth % 2 !== 0 || Math.abs(ringArea(ring.points)) < 0.04)
      return [];
    const holes = rings.filter(
      (hole) =>
        hole.parent === index &&
        hole.depth % 2 === 1 &&
        Math.abs(ringArea(hole.points)) >= 0.04,
    );
    if (constrain) {
      const outer = largestPolygon(polygonClipping.union([ring.points]));
      if (!outer) return [];
      const fitted = holes
        .map((hole) => fitHole(hole.points, outer))
        .filter((hole): hole is Polygon => hole !== null);
      return fitted.length
        ? polygonClipping.difference(outer, ...fitted)
        : [outer];
    }
    return [[ring.points, ...holes.map((hole) => hole.points)]];
  });
  if (!polygons.length) throw new Error("The letter has no filled outline");
  const filled = polygonClipping.union(polygons);
  const result: GlyphRing[] = [];
  for (const polygon of filled) {
    const parent = result.length;
    polygon.forEach((closed, index) => {
      const points = closed.slice(0, -1);
      result.push({
        points,
        area: Math.abs(ringArea(points)),
        parent: index ? parent : -1,
        depth: index ? 1 : 0,
      });
    });
  }
  return result;
}

function bevelForOutline(rings: GlyphRing[], wanted: number) {
  const edges = rings.flatMap((ring, ringIndex) =>
    ring.points.map((a, index) => ({
      a,
      b: ring.points[(index + 1) % ring.points.length],
      ringIndex,
      index,
      count: ring.points.length,
    })),
  );
  let clearanceSquared = Infinity;
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    clearanceSquared = Math.min(
      clearanceSquared,
      (a.a[0] - a.b[0]) ** 2 + (a.a[1] - a.b[1]) ** 2,
    );
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j];
      const adjacent =
        a.ringIndex === b.ringIndex &&
        (Math.abs(a.index - b.index) === 1 ||
          Math.abs(a.index - b.index) === a.count - 1);
      if (adjacent) continue;
      clearanceSquared = Math.min(
        clearanceSquared,
        squaredDistanceToSegment(a.a, b.a, b.b),
        squaredDistanceToSegment(a.b, b.a, b.b),
        squaredDistanceToSegment(b.a, a.a, a.b),
        squaredDistanceToSegment(b.b, a.a, a.b),
      );
    }
  }
  const maximumMiter = Math.SQRT2;
  const worldPerPixel = 2 / (GRID - 1);
  return Math.min(
    wanted,
    (Math.sqrt(clearanceSquared) * worldPerPixel * 0.45) / maximumMiter,
  );
}

export function meshFromRings(rings: GlyphRing[], depth = 0.25, bevel = 0.035) {
  bevel = bevelForOutline(rings, bevel);
  const shapes = new Map<number, Shape>();
  const write = (path: Path, points: Point[]) => {
    points.forEach(([x, y], i) =>
      path[i === 0 ? "moveTo" : "lineTo"](
        (x / (GRID - 1) - 0.5) * 2,
        (0.5 - y / (GRID - 1)) * 2,
      ),
    );
    path.closePath();
  };
  rings.forEach((ring, i) => {
    if (Math.abs(ringArea(ring.points)) < 0.04) return;
    if (ring.depth % 2 === 0) {
      const shape = new Shape();
      write(shape, ring.points);
      shapes.set(i, shape);
    } else {
      const hole = new Path();
      write(hole, ring.points);
      shapes.get(ring.parent)?.holes.push(hole);
    }
  });
  if (!shapes.size) {
    const empty = new BufferGeometry();
    empty.setAttribute("position", new Float32BufferAttribute([], 3));
    return { geometry: empty, components: 0, holes: 0, rings };
  }
  const geometry = new ExtrudeGeometry([...shapes.values()], {
    depth,
    bevelEnabled: bevel > 1e-6,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    steps: 1,
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeBoundingBox();
  return {
    geometry,
    components: shapes.size,
    holes: rings.filter(
      (r) => r.depth % 2 === 1 && Math.abs(ringArea(r.points)) >= 0.04,
    ).length,
    rings,
    bevel,
  };
}

function perimeter(points: Point[]) {
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    length += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return length;
}

function resample(points: Point[], count: number): Point[] {
  const length = perimeter(points),
    result: Point[] = [];
  let segment = 0,
    start = 0;
  for (let i = 0; i < count; i++) {
    const distance = (i * length) / count;
    let a = points[segment],
      b = points[(segment + 1) % points.length],
      edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (start + edge < distance && segment < points.length - 1) {
      start += edge;
      segment++;
      a = points[segment];
      b = points[(segment + 1) % points.length];
      edge = Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const t = edge ? (distance - start) / edge : 0;
    result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return result;
}

function center(points: Point[]): Point {
  return [
    points.reduce((s, p) => s + p[0], 0) / points.length,
    points.reduce((s, p) => s + p[1], 0) / points.length,
  ];
}

function matchCurve(a: Point[] | undefined, b: Point[] | undefined): CurvePair {
  const reference = a ?? b;
  if (!reference) throw new Error("A contour morph needs an outline");
  const count = Math.min(
    512,
    Math.max(
      64,
      Math.ceil(Math.max(a ? perimeter(a) : 0, b ? perimeter(b) : 0) / 1.6),
    ),
  );
  const collapsed = center(reference);
  const left = a
    ? resample(a, count)
    : Array.from({ length: count }, (): Point => [collapsed[0], collapsed[1]]);
  const right = b
    ? resample(a && ringArea(a) * ringArea(b) < 0 ? [...b].reverse() : b, count)
    : Array.from({ length: count }, (): Point => [collapsed[0], collapsed[1]]);
  let best = 0,
    score = Infinity;
  for (let shift = 0; shift < count; shift++) {
    let sum = 0;
    for (let i = 0; i < count; i++) {
      const p = left[i],
        q = right[(i + shift) % count];
      sum += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    }
    if (sum < score) {
      score = sum;
      best = shift;
    }
  }
  return { left, right: right.map((_, i) => right[(i + best) % count]) };
}

function minimumCurveArea(pair: CurvePair) {
  const at = (t: number) =>
    ringArea(
      pair.left.map<Point>((p, i) => [
        p[0] + (pair.right[i][0] - p[0]) * t,
        p[1] + (pair.right[i][1] - p[1]) * t,
      ]),
    );
  const sign = Math.sign(at(0)),
    start = at(0) * sign,
    end = at(1) * sign,
    middle = at(0.5) * sign;
  const quadratic = 2 * (end + start - 2 * middle),
    linear = end - start - quadratic;
  const vertex = quadratic !== 0 ? -linear / (2 * quadratic) : -1;
  const inside = vertex > 0 && vertex < 1;
  return Math.min(
    start,
    end,
    inside ? quadratic * vertex * vertex + linear * vertex + start : Infinity,
  );
}

export function prepareContourMorph(
  from: GlyphRing[],
  to: GlyphRing[],
  preserveDot = false,
): ContourMorph {
  const outers = (rings: GlyphRing[]) =>
    rings
      .map((ring, index) => ({ ring, index }))
      .filter((r) => r.ring.depth % 2 === 0)
      .sort((a, b) => b.ring.area - a.ring.area);
  const fromParts = preserveDot ? dottedIParts(from) : null,
    toParts = preserveDot ? dottedIParts(to) : null;
  if (preserveDot && (!fromParts || !toParts))
    throw new Error("The i needs a separate dot at both ends of its morph");
  const a = fromParts ? [fromParts.stem, fromParts.dot] : outers(from);
  const b = toParts ? [toParts.stem, toParts.dot] : outers(to),
    pairs: ContourPair[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i],
      right = b[i],
      parent = pairs.length;
    const curve = matchCurve(left?.ring.points, right?.ring.points);
    if (preserveDot && i === 1 && minimumCurveArea(curve) < 0.5)
      throw new Error("This i transition would shrink its dot too far");
    pairs.push({ ...curve, parent: -1, depth: 0 });
    const holes = (
      rings: GlyphRing[],
      outer: { ring: GlyphRing; index: number } | undefined,
    ) =>
      outer
        ? rings
            .filter((r) => r.parent === outer.index && r.depth % 2 === 1)
            .sort((x, y) => y.area - x.area)
        : [];
    const ah = holes(from, left),
      bh = holes(to, right);
    for (let j = 0; j < Math.max(ah.length, bh.length); j++)
      pairs.push({
        ...matchCurve(ah[j]?.points, bh[j]?.points),
        parent,
        depth: 1,
      });
  }
  return {
    pairs,
    from: filledContours(from),
    to: filledContours(to),
    preserveDot,
  };
}

export function interpolateContours(
  morph: ContourMorph,
  t: number,
): GlyphRing[] {
  if (t <= 0) return morph.from;
  if (t >= 1) return morph.to;
  const rings = morph.pairs.map(({ left, right, parent, depth }) => {
    const points = left.map<Point>((p, i) => [
      p[0] + (right[i][0] - p[0]) * t,
      p[1] + (right[i][1] - p[1]) * t,
    ]);
    return { points, area: Math.abs(ringArea(points)), parent, depth };
  });
  const filled = filledContours(rings, true);
  if (morph.preserveDot && !dottedIParts(filled))
    throw new Error("This font morph would merge or remove the i dot");
  return filled;
}
