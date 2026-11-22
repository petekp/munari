// Coupled dual-reality HTML layers for Variant 02 (`BeyondXray`):
// 1. `BeyondXrayOuterConsole`: Native in-place Braun/TE industrial billing & telemetry unit
// 2. `BeyondXrayPcbLayer`: Subsurface FR-4 gold-trace circuit board (`<Surface.HTML>`)
//    carrying live signal traces and a compact 172 px DIP switch bank that fits 100%
//    inside the distortion-free optical core of the X-Ray loupe.

import { useId } from 'react'

export type XrayTierId = 'starter' | 'studio' | 'lab'

export interface XrayTierSpec {
  readonly id: XrayTierId
  readonly label: string
  readonly unitRate: number
  readonly busLineY: number
}

export const XRAY_TIERS: readonly XrayTierSpec[] = [
  { id: 'starter', label: 'Starter', unitRate: 48, busLineY: 196 },
  { id: 'studio', label: 'Studio', unitRate: 128, busLineY: 236 },
  { id: 'lab', label: 'Lab Pro', unitRate: 290, busLineY: 276 },
]

export interface XrayDipState {
  readonly staffHalfOff: boolean
  readonly turboClock: boolean
  readonly waiveBusFee: boolean
  readonly rawHexMode: boolean
}

export type XrayDipKey = keyof XrayDipState

interface DipMeta {
  readonly key: XrayDipKey
  readonly code: string
  readonly label: string
}

const DIP_SWITCHES: readonly DipMeta[] = [
  { key: 'staffHalfOff', code: 'SW1', label: 'Staff -50%' },
  { key: 'turboClock', code: 'SW2', label: '2.4G Turbo' },
  { key: 'waiveBusFee', code: 'SW3', label: '$0 Bus Fee' },
  { key: 'rawHexMode', code: 'SW4', label: 'Hex Regs' },
]

export function computeXrayTotal(
  tier: XrayTierSpec,
  channels: number,
  dips: XrayDipState,
): number {
  const subtotal = tier.unitRate * channels
  const discounted = dips.staffHalfOff ? Math.round(subtotal * 0.5) : subtotal
  const busFee = dips.waiveBusFee ? 0 : 16
  return discounted + busFee
}

export function BeyondXrayOuterConsole({
  tier,
  channels,
  operator,
  commits,
  dips,
  onSelectTier,
  onStepChannels,
  onChangeOperator,
  onCommit,
}: {
  readonly tier: XrayTierSpec
  readonly channels: number
  readonly operator: string
  readonly commits: number
  readonly dips: XrayDipState
  readonly onSelectTier: (id: XrayTierId) => void
  readonly onStepChannels: (delta: -1 | 1) => void
  readonly onChangeOperator: (next: string) => void
  readonly onCommit: () => void
}) {
  const opInputId = useId()
  const total = computeXrayTotal(tier, channels, dips)
  const hexDump = `0x${total.toString(16).toUpperCase().padStart(4, '0')} · CH0${channels} · ${
    dips.turboClock ? '0x960M' : '0x4B0M'
  } · ACK#${commits}`

  return (
    <div className="bx-console">
      <header className="bx-oled" data-xray-anchor="oled">
        <div className="bx-oled-top">
          <span className="bx-oled-model">TX-09 TELEMETRY &amp; BILLING DESK</span>
          <span className={dips.turboClock ? 'bx-oled-clock bx-oled-clock--turbo' : 'bx-oled-clock'}>
            {dips.turboClock ? '2.40 GHz OVERCLOCK' : '1.20 GHz NOMINAL'}
          </span>
        </div>

        <div className="bx-oled-main">
          {dips.rawHexMode ? (
            <div className="bx-oled-hex">{hexDump}</div>
          ) : (
            <div className="bx-oled-rate">
              <strong>${total}</strong>
              <span>/ mo · {channels} ch {tier.label}</span>
            </div>
          )}

          <div className="bx-oled-flags">
            {dips.staffHalfOff && <span className="bx-flag">SW1 STAFF -50%</span>}
            {dips.waiveBusFee && <span className="bx-flag">SW3 $0 FEE</span>}
            {!dips.staffHalfOff && !dips.waiveBusFee && (
              <span className="bx-flag bx-flag--dim">+$16 BUS FEE</span>
            )}
          </div>
        </div>
      </header>

      <div className="bx-console-body">
        <div className="bx-controls-col" data-xray-anchor="asic">
          <div className="bx-field-group">
            <span className="bx-field-label">BUS TIER (NATIVE HTML)</span>
            <div className="bx-tier-row" role="group" aria-label="Select billing tier">
              {XRAY_TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="bx-tier-btn"
                  aria-pressed={t.id === tier.id}
                  onClick={() => onSelectTier(t.id)}
                >
                  <span>{t.label}</span>
                  <b>${t.unitRate}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="bx-split-row">
            <div className="bx-field-group">
              <span className="bx-field-label">CHANNELS</span>
              <div className="bx-stepper">
                <button
                  type="button"
                  className="bx-step-btn"
                  aria-label="Decrease channels"
                  onClick={() => onStepChannels(-1)}
                >
                  −
                </button>
                <span className="bx-step-val">{channels} ch</span>
                <button
                  type="button"
                  className="bx-step-btn"
                  aria-label="Increase channels"
                  onClick={() => onStepChannels(1)}
                >
                  +
                </button>
              </div>
            </div>

            <div className="bx-field-group bx-field-group--grow">
              <label htmlFor={opInputId} className="bx-field-label">
                OPERATOR CALLSIGN
              </label>
              <input
                id={opInputId}
                type="text"
                className="bx-op-input"
                maxLength={18}
                value={operator}
                onChange={(e) => onChangeOperator(e.target.value)}
              />
            </div>
          </div>

          <button type="button" className="bx-commit-btn" onClick={onCommit}>
            Authorize Dispatch · #{1040 + commits}
          </button>
        </div>

        {/* Sealed right-hand aluminum calibration grille — X-Ray loupe reveals DIP bank beneath */}
        <div className="bx-sealed-bay" data-xray-anchor="dip" aria-hidden="true">
          <div className="bx-bay-head">
            <span>CALIBRATION BAY · SEALED</span>
            <span className="bx-screw" />
          </div>
          <div className="bx-vent-grille">
            {Array.from({ length: 8 }, (_, i) => (
              <span key={i} className="bx-vent-slot" />
            ))}
          </div>
          <div className="bx-bay-foot">X-RAY APERTURE EXPOSES DIP SWITCHES</div>
        </div>
      </div>
    </div>
  )
}

export function BeyondXrayPcbLayer({
  supported,
  size,
  tier,
  channels,
  commits,
  dips,
  onToggleDip,
  onFocusDip,
}: {
  readonly supported: boolean
  readonly size: readonly [number, number]
  readonly tier: XrayTierSpec
  readonly channels: number
  readonly commits: number
  readonly dips: XrayDipState
  readonly onToggleDip: (key: XrayDipKey) => void
  readonly onFocusDip: () => void
}) {
  const total = computeXrayTotal(tier, channels, dips)

  return (
    <div
      className={`bx-pcb-root${!supported ? ' bx-pcb-root--fallback' : ''}`}
      style={{ width: `${size[0]}px`, height: `${size[1]}px` }}
    >
      <svg
        className="bx-pcb-svg"
        viewBox="0 0 700 428"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <path
          d="M 36 182 H 150 L 182 214 H 460 M 36 236 H 460 M 36 290 H 150 L 182 258 H 460 M 220 156 V 96 H 610 M 498 158 V 96"
          fill="none"
          stroke="#24634f"
          strokeWidth="2.2"
        />
        <path
          d="M 110 356 H 330 L 368 318 H 620 M 84 128 H 390"
          fill="none"
          stroke="#1d5241"
          strokeWidth="1.8"
        />
        {/* Energized active bus trace in gold & emerald */}
        <path
          d={`M 42 ${tier.busLineY} H 164 L 196 236 H 468`}
          fill="none"
          stroke="#ffca52"
          strokeWidth="4"
          strokeLinecap="round"
        />
        <circle cx="196" cy="236" r="5.5" fill="#18f2a6" />
        <circle cx="352" cy="236" r="4.5" fill="#ffca52" />
        <circle cx="468" cy="236" r="5.5" fill="#18f2a6" />
      </svg>

      {/* Top OLED SPI ribbon & voltage rail header */}
      <div className="bx-pcb-ribbon">
        <span>J1 · SPI-OLED BUS · 3V3_OK</span>
        <span>REG 0x{total.toString(16).toUpperCase().padStart(4, '0')} · IRQ #{commits}</span>
      </div>

      <div className="bx-pcb-grid">
        {/* Centered ASIC die inside left column so `Inspect ASIC bus` frames it cleanly */}
        <div className="bx-asic-zone">
          <div className="bx-asic-package">
            <span className="bx-silk-code">U1 · MUNARI-M7</span>
            <strong>{tier.id.toUpperCase()} BUS</strong>
            <span className="bx-asic-sub">
              {channels}× DMA · {dips.turboClock ? '2400 MHz' : '1200 MHz'}
            </span>
          </div>
          <div className="bx-smd-row">
            <span className="bx-smd-led bx-smd-led--on" />
            <span>3V3 LOCKED · ENIG GOLD</span>
          </div>
        </div>

        {/* Compact 174 px DIP switch block centered inside right bay so all 4 rockers fit inside lens */}
        <div className="bx-dip-zone">
          <div className="bx-dip-bank">
            <div className="bx-dip-header">
              <span>J9 DIP BANK</span>
              <span className="bx-dip-gold-pad" />
            </div>
            <div className="bx-dip-list">
              {DIP_SWITCHES.map((sw) => {
                const on = dips[sw.key]
                return (
                  <button
                    key={sw.key}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    className="bx-dip-btn"
                    onFocus={onFocusDip}
                    onClick={() => onToggleDip(sw.key)}
                  >
                    <span className="bx-dip-meta">
                      <b>{sw.code}</b> {sw.label}
                    </span>
                    <span className={on ? 'bx-dip-rocker bx-dip-rocker--on' : 'bx-dip-rocker'}>
                      <span className="bx-dip-thumb" />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
