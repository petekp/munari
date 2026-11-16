// Font contours — coordinates use the 224-pixel raster grid, with y pointing down.
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
export interface GlyphFont {
  family: string;
  weight: number;
  style?: string;
  label?: string;
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
let cachedContext: CanvasRenderingContext2D | null = null;

function glyphContext() {
  if (cachedContext) return cachedContext;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = GRID;
  cachedContext = canvas.getContext("2d", { willReadFrequently: true });
  if (!cachedContext) throw new Error("Canvas text rendering is unavailable");
  return cachedContext;
}

export async function rasterGlyph(character: string, font: GlyphFont) {
  const context = glyphContext();
  const specification = `${font.style ?? "normal"} ${font.weight} 100px "${font.family}"`;
  const loaded = await document.fonts.load(specification, character);
  if (!loaded.length) throw new Error(`Typeface did not load: ${font.family}`);
  context.font = specification;
  let size =
    (100 * (GRID * 0.43)) /
    Math.max(context.measureText("x").actualBoundingBoxAscent, 1);
  context.font = `${font.style ?? "normal"} ${font.weight} ${size}px "${font.family}"`;
  const first = context.measureText(character);
  const baseline = GRID * 0.77;
  const padding = 12;
  const inkWidth = first.actualBoundingBoxLeft + first.actualBoundingBoxRight;
  const fitting = Math.min(
    1,
    (GRID - padding * 2) / Math.max(inkWidth, 1),
    (baseline - padding) / Math.max(first.actualBoundingBoxAscent, 1),
    (GRID - baseline - padding) / Math.max(first.actualBoundingBoxDescent, 1),
  );
  size *= fitting;
  context.font = `${font.style ?? "normal"} ${font.weight} ${size}px "${font.family}"`;
  const metrics = context.measureText(character);
  context.clearRect(0, 0, GRID, GRID);
  context.fillStyle = "#fff";
  context.textBaseline = "alphabetic";
  const x =
    (GRID + metrics.actualBoundingBoxLeft - metrics.actualBoundingBoxRight) / 2;
  context.fillText(character, x, baseline);
  const pixels = context.getImageData(0, 0, GRID, GRID).data;
  const field = new Float32Array(GRID * GRID);
  let ink = 0;
  for (let i = 0; i < field.length; i++) {
    const alpha = pixels[i * 4 + 3] / 255;
    field[i] = 0.5 - alpha;
    ink += alpha;
  }
  return {
    field,
    advance: (metrics.width * 2) / GRID,
    em: (size * 2) / GRID,
    ink,
    font: font.label ?? font.family,
  };
}

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

function simplify(points: Point[]): Point[] {
  if (points.length < 4) return points;
  let greatest = 0.16,
    split = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = squaredDistanceToSegment(
      points[i],
      points[0],
      points[points.length - 1],
    );
    if (d > greatest) {
      greatest = d;
      split = i;
    }
  }
  if (!split) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, split + 1)).slice(0, -1),
    ...simplify(points.slice(split)),
  ];
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

function contourEdges(field: Float32Array) {
  const vertices = new Map<number, Point>(),
    neighbors = new Map<number, number[]>();
  const link = (a: number, b: number) => {
    if (!neighbors.has(a)) neighbors.set(a, []);
    if (!neighbors.has(b)) neighbors.set(b, []);
    neighbors.get(a)?.push(b);
    neighbors.get(b)?.push(a);
  };
  const edge = (x: number, y: number, axis: number) => {
    const id = (y * GRID + x) * 2 + axis;
    if (!vertices.has(id)) {
      const next = y * GRID + x + (axis ? GRID : 1);
      const a = field[y * GRID + x],
        b = field[next];
      const t = a / (a - b);
      vertices.set(id, [x + (axis ? 0 : t), y + (axis ? t : 0)]);
    }
    return id;
  };
  for (let y = 0; y < GRID - 1; y++)
    for (let x = 0; x < GRID - 1; x++) {
      const offset = y * GRID + x;
      const values = [
        field[offset],
        field[offset + 1],
        field[offset + GRID + 1],
        field[offset + GRID],
      ];
      const code = values.reduce(
        (bits, value, i) => bits | (value < 0 ? 1 << i : 0),
        0,
      );
      if (code === 0 || code === 15) continue;
      const edges = [];
      if (values[0] < 0 !== values[1] < 0) edges.push(edge(x, y, 0));
      if (values[1] < 0 !== values[2] < 0) edges.push(edge(x + 1, y, 1));
      if (values[3] < 0 !== values[2] < 0) edges.push(edge(x, y + 1, 0));
      if (values[0] < 0 !== values[3] < 0) edges.push(edge(x, y, 1));
      if (edges.length === 2) link(edges[0], edges[1]);
      else {
        const centerInside = values.reduce((a, b) => a + b, 0) < 0;
        if ((code === 5) === centerInside) {
          link(edges[0], edges[1]);
          link(edges[2], edges[3]);
        } else {
          link(edges[0], edges[3]);
          link(edges[1], edges[2]);
        }
      }
    }
  return { vertices, neighbors };
}

export function contours(field: Float32Array) {
  const { vertices, neighbors } = contourEdges(field);
  const visited = new Set<number>(),
    rings: GlyphRing[] = [];
  for (const start of neighbors.keys()) {
    if (visited.has(start)) continue;
    const ring: Point[] = [];
    let current = start,
      previous = -1;
    do {
      if (visited.has(current)) break;
      visited.add(current);
      const point = vertices.get(current);
      if (!point) throw new Error("Missing contour point");
      ring.push(point);
      const adjacent = neighbors.get(current);
      if (!adjacent || adjacent.length !== 2)
        throw new Error("An open glyph contour reached the raster boundary");
      const next = adjacent[0] === previous ? adjacent[1] : adjacent[0];
      previous = current;
      current = next;
    } while (current !== start);
    if (ring.length < 4 || Math.abs(ringArea(ring)) < 0.5) continue;
    let opposite = 1,
      farthest = 0;
    for (let i = 1; i < ring.length; i++) {
      const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
      if (d > farthest) {
        farthest = d;
        opposite = i;
      }
    }
    const reduced = [
      ...simplify(ring.slice(0, opposite + 1)).slice(0, -1),
      ...simplify([...ring.slice(opposite), ring[0]]).slice(0, -1),
    ];
    if (reduced.length >= 3)
      rings.push({
        points: reduced,
        area: Math.abs(ringArea(reduced)),
        parent: -1,
        depth: 0,
      });
  }
  rings.sort((a, b) => b.area - a.area);
  for (let i = 0; i < rings.length; i++)
    for (let j = i - 1; j >= 0; j--) {
      if (contains(rings[j].points, rings[i].points[0])) {
        rings[i].parent = j;
        rings[i].depth = rings[j].depth + 1;
        break;
      }
    }
  return rings;
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
