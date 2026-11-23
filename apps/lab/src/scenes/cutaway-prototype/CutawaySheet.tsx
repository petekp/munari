// Cutaway sheet — the spec sheet that stands inside the camera, as plain HTML.
//
// The law: each section carries the depth of the part it describes, in
// `data-depth`. The scene measures where each section sits in the scroller
// and turns that into the plane's stations, so moving a paragraph in this
// markup moves where its part arrives.
//
// Ownership: this module owns the words and the layout of the sheet. The
// figure marks (optical axis, sensor outline) are drawn at the model's own
// coordinates so the lens's image lands inside the sensor outline.

import type { Ref } from 'react'
import {
  CAVITY,
  FILTER,
  MAIN_BOARD,
  OPTICAL_AXIS,
  SENSOR_SIZE,
  SENSOR_Z,
  SHEET,
  SHEET_BACK_Z,
  SHEET_FRONT_Z,
  SHEET_PX,
  SHEET_PX_PER_MM,
} from './cutawayModel'

export interface SheetSection {
  readonly id: string
  /** The part this section is about, as the readout names it. */
  readonly part: string
  /** The plane's depth when this section's heading reaches the reading line. */
  readonly depth: number
  readonly title: string
  readonly body: string
  readonly specs: readonly (readonly [string, string])[]
}

export const SHEET_SECTIONS: readonly SheetSection[] = [
  {
    id: 'optics',
    part: 'Lens',
    depth: SHEET_FRONT_Z,
    title: '26 mm f/2',
    body: 'Seven elements in six groups, two of them aspherical. The whole lens travels 4.2 mm on a helicoid to focus from infinity to 0.30 m. A leaf shutter between the groups syncs flash at every speed.',
    specs: [['Equivalent', '39 mm'], ['Aperture', 'f/2 – f/16, 6 blades'], ['Shutter', '1/2000 s, leaf']],
  },
  {
    id: 'rear-group',
    part: 'Rear group',
    depth: 10,
    title: 'Rear group',
    body: 'The last element ends 8.5 mm in front of the sensor. Its back face is aspherical, which keeps the corners sharp at full aperture without a longer lens.',
    specs: [['Back focus', '8.5 mm'], ['Aspherical faces', '2']],
  },
  {
    id: 'filter',
    part: 'IR-cut filter',
    depth: FILTER.z - FILTER.thickness / 2 - 0.15,
    title: 'IR-cut filter',
    body: 'Blue absorptive glass, 0.8 mm thick. It passes 400 to 650 nm and stops the near-infrared that would turn foliage and skin pink.',
    specs: [['Passband', '400 – 650 nm'], ['Thickness', '0.8 mm']],
  },
  {
    id: 'sensor',
    part: 'Image sensor',
    depth: SENSOR_Z + 0.1,
    title: 'Image sensor',
    body: '24.3 megapixels on 23.5 × 15.6 mm, 3.92 µm apart. The lens is focused on this plane. Here, and only here, the window opposite the camera is sharp on this page.',
    specs: [['Pixels', '6048 × 4024'], ['Pitch', '3.92 µm'], ['Readout', '14-bit']],
  },
  {
    id: 'processor',
    part: 'Image processor',
    depth: MAIN_BOARD.z - MAIN_BOARD.thickness / 2 - 0.3,
    title: 'Image processor',
    body: 'The board behind the sensor carries a four-core processor, 2 GB of memory and the card slot. It writes 14-bit RAW and JPEG at 11 frames per second.',
    specs: [['Burst', '11 fps'], ['Buffer', '48 RAW'], ['Card', 'SD UHS-II']],
  },
  {
    id: 'display',
    part: 'Rear display',
    depth: SHEET_BACK_Z,
    title: 'Rear display',
    body: '3.0 in, 1.62 million dots. The body is 112 × 66 × 36 mm and weighs 398 g with its 7.2 V, 1260 mAh battery, good for about 380 frames.',
    specs: [['Display', '3.0 in, 3:2'], ['Weight', '398 g'], ['Battery', '380 frames']],
  },
]

const px = (mm: number) => mm * SHEET_PX_PER_MM
const AXIS_LEFT = px(OPTICAL_AXIS.x - SHEET.minX)
const AXIS_TOP = px(SHEET.maxY - OPTICAL_AXIS.y)
/** The caption sits above the sensor outline, where neither the lens nor its shadow reaches. */
const FIGURE_CAPTION_LEFT = 392
const FIGURE_CAPTION_TOP = AXIS_TOP - px(SENSOR_SIZE[1] / 2) - 64

/** The depth rule's span: the cavity, front wall to rear wall. */
const RULE_TOP_Z = CAVITY.halfDepth
const RULE_BOTTOM_Z = -CAVITY.halfDepth
const RULE_TICKS = Array.from({ length: Math.round(RULE_TOP_Z - RULE_BOTTOM_Z) + 1 }, (_, i) => Math.round(RULE_TOP_Z - 0.5) - i + 0.5)

/** Position along the depth rule, as a percentage from its top. */
function rulePercent(z: number): string {
  return `${((RULE_TOP_Z - z) / (RULE_TOP_Z - RULE_BOTTOM_Z)) * 100}%`
}

/**
 * A ruler of the cavity's depth down the sheet's left edge, with each part's
 * station and the plane's own position marked on it.
 */
function DepthRule({ depth }: { readonly depth: number }) {
  return (
    <div className="cw-rule" aria-hidden="true">
      <div className="cw-rule-track">
        {RULE_TICKS.map((z) => (
          <span key={z} className="cw-rule-tick" data-major={Math.round(z - 0.5) % 5 === 0 || undefined} style={{ top: rulePercent(z - 0.5) }} />
        ))}
        {SHEET_SECTIONS.map((section, i) => (
          <span key={section.id} className="cw-rule-station" data-passed={depth <= section.depth + 1e-6 || undefined} style={{ top: rulePercent(section.depth) }}>
            {String(i + 1).padStart(2, '0')}
          </span>
        ))}
        <span className="cw-rule-plane" style={{ top: rulePercent(depth) }}>
          <span>{formatDepth(depth)}</span>
        </span>
      </div>
    </div>
  )
}

function formatDepth(depth: number): string {
  const sign = depth >= 0 ? '+' : '−'
  return `${sign}${Math.abs(depth).toFixed(1)}`
}

export function CutawaySheet({
  scrollerRef,
  depth,
  onScroll,
}: {
  readonly scrollerRef: Ref<HTMLDivElement>
  readonly depth: number
  readonly onScroll: () => void
}) {
  const [sw, sh] = SENSOR_SIZE
  return (
    <div className="cw-sheet" style={{ width: SHEET_PX[0], height: SHEET_PX[1] }}>
      <div className="cw-sheet-grid" aria-hidden="true" />
      <div className="cw-axis cw-axis-h" style={{ top: AXIS_TOP }} aria-hidden="true" />
      <div className="cw-axis cw-axis-v" style={{ left: AXIS_LEFT }} aria-hidden="true" />
      <div
        className="cw-sensor-outline"
        aria-hidden="true"
        style={{ left: AXIS_LEFT - px(sw / 2), top: AXIS_TOP - px(sh / 2), width: px(sw), height: px(sh) }}
      >
        <span>Sensor {sw} × {sh}</span>
      </div>
      <p className="cw-figure-caption" style={{ left: FIGURE_CAPTION_LEFT, top: FIGURE_CAPTION_TOP }}>
        <span>Fig. 1</span> The window opposite, drawn by the lens upside down. Sharp at z {formatDepth(SENSOR_Z)} only.
      </p>
      <header className="cw-sheet-head">
        <span>Model 35/2 · Specification</span>
        <span className="cw-sheet-section">Section z {formatDepth(depth)} mm</span>
      </header>
      <DepthRule depth={depth} />
      <div ref={scrollerRef} className="cw-scroller" tabIndex={0} aria-label="Specification" onScroll={onScroll}>
        {SHEET_SECTIONS.map((section, i) => (
          <section key={section.id} className="cw-section" data-depth={section.depth}>
            <p className="cw-section-kicker">
              <span>{String(i + 1).padStart(2, '0')} · {section.part}</span>
              <span>z {formatDepth(section.depth)}</span>
            </p>
            <h2 className="cw-section-title">{section.title}</h2>
            <p className="cw-section-body">{section.body}</p>
            <dl className="cw-specs">
              {section.specs.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <div className="cw-scroller-end" aria-hidden="true" />
      </div>
    </div>
  )
}

export { formatDepth }
