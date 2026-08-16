// The page half of the FrameSurface browser gate. It goes through the public
// package barrel so the gate covers Surface dispatch, exports, and its default
// unlit material.
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  Surface,
  createCanvasFrameSource,
  type CanvasFrameSource,
  type FrameDrawReceipt,
  type PresentationReceipt,
  type PresentationRequirement,
  useSurfaceTexture,
} from '@petepetrash/munari'

type RGB = readonly [number, number, number]

const SURFACE_NAME = 'frame-surface-gate'

const FIRST_0: readonly RGB[] = [
  [32, 64, 96],
  [128, 96, 64],
  [200, 150, 100],
  [16, 200, 240],
]
const FIRST_1: readonly RGB[] = [
  [40, 40, 40],
  [80, 80, 80],
  [120, 120, 120],
  [160, 160, 160],
]
const FIRST_2: readonly RGB[] = [
  [240, 30, 90],
  [60, 180, 110],
  [130, 70, 220],
  [210, 210, 40],
]
const SECOND_0: readonly RGB[] = [
  [18, 118, 218],
  [224, 88, 44],
  [72, 212, 152],
  [186, 52, 196],
]
const SECOND_1: readonly RGB[] = [
  [35, 55, 75],
  [95, 115, 135],
  [155, 175, 195],
  [215, 225, 235],
]
const SECOND_2: readonly RGB[] = [
  [12, 232, 122],
  [242, 112, 32],
  [92, 42, 232],
  [202, 182, 62],
]
const SECOND_3: readonly RGB[] = [
  [31, 61, 91],
  [121, 151, 181],
  [211, 41, 71],
  [101, 221, 141],
]
const SECOND_4: readonly RGB[] = [
  [250, 80, 20],
  [20, 210, 160],
  [150, 40, 240],
  [70, 130, 220],
]
const SECOND_5: readonly RGB[] = [
  [47, 77, 107],
  [137, 167, 197],
  [227, 57, 87],
  [117, 237, 157],
]
const SECOND_6: readonly RGB[] = [
  [24, 144, 224],
  [234, 94, 54],
  [84, 224, 164],
  [194, 64, 204],
]
const SECOND_7: readonly RGB[] = [
  [53, 83, 113],
  [143, 173, 203],
  [233, 63, 93],
  [123, 243, 163],
]
const SECOND_8: readonly RGB[] = [
  [226, 36, 126],
  [46, 196, 116],
  [136, 76, 226],
  [216, 206, 46],
]

interface TestSource {
  source: CanvasFrameSource
  paint(colors: readonly RGB[]): void
}

function makeSource(initial: readonly RGB[]): TestSource {
  const canvas = document.createElement('canvas')
  canvas.width = 64
  canvas.height = 16
  const context = canvas.getContext('2d', { alpha: false })!
  const paint = (colors: readonly RGB[]) => {
    colors.forEach(([r, g, b], index) => {
      context.fillStyle = `rgb(${r} ${g} ${b})`
      const stripeWidth = canvas.width / colors.length
      context.fillRect(index * stripeWidth, 0, stripeWidth, canvas.height)
    })
  }
  paint(initial)
  return {
    source: createCanvasFrameSource(canvas, { premultiplyAlpha: false }),
    paint,
  }
}

const first = makeSource(FIRST_0)
const second = makeSource(SECOND_0)
const firstSourceId = first.source.currentFrame().sourceId
const secondSourceId = second.source.currentFrame().sourceId

const PRESENTATION_COLORS: readonly RGB[] = [
  [26, 86, 146],
  [206, 76, 46],
  [66, 196, 126],
  [176, 56, 216],
]
const presentationSource = makeSource(PRESENTATION_COLORS)
const resizeSource = makeSource(FIRST_0)
const PRESENTATION_REQUIREMENT: PresentationRequirement = {
  transferId: 91,
  frame: presentationSource.source.currentFrame(),
  presentationRevision: 6,
}

const ACQUISITIONS = [
  {
    cycle: 1,
    intermediateColors: SECOND_3,
    finalColors: SECOND_4,
    expectedGeneration: 4,
  },
  {
    cycle: 2,
    intermediateColors: SECOND_5,
    finalColors: SECOND_6,
    expectedGeneration: 6,
  },
  {
    cycle: 3,
    intermediateColors: SECOND_7,
    finalColors: SECOND_8,
    expectedGeneration: 8,
  },
] as const

const EXPECTED_RECEIPTS = [
  { sourceId: firstSourceId, generation: 0, colors: FIRST_0 },
  { sourceId: firstSourceId, generation: 2, colors: FIRST_2 },
  { sourceId: secondSourceId, generation: 0, colors: SECOND_0 },
  { sourceId: secondSourceId, generation: 2, colors: SECOND_2 },
  { sourceId: secondSourceId, generation: 4, colors: SECOND_4 },
  { sourceId: secondSourceId, generation: 6, colors: SECOND_6 },
  { sourceId: secondSourceId, generation: 8, colors: SECOND_8 },
] as const

export interface FrameSurfaceGateReceipt {
  receipt: FrameDrawReceipt
  sampledRgb: RGB[]
  maxChannelError: number
  meshId: number
  geometryId: number
  materialId: number
  materialType: string
  toneMapped: boolean
  canvasTexture: boolean
  textureColorSpace: string | null
  textureCanvasMatchesSource: boolean
}

export interface RenderSample {
  render: number
  sampledRgb: RGB[]
  clearOnly: boolean
  maxChannelError: number
}

export interface AcquisitionRenderSample extends RenderSample {
  cycle: number
}

export interface ReleasePublication {
  cycle: number
  surfaceAbsent: boolean
  publishedGenerations: [number, number]
}

export interface AcquisitionEvidence {
  cycle: number
  expectedGeneration: number
  receiptGeneration: number | null
  surfaceEpoch: number | null
  releasedSurfaceAbsent: boolean
  publishedGenerations: number[]
  renderSamples: number
  clearFrames: number
  mismatchedFrames: number
  receiptRgbError: number | null
  meshId: number | null
  geometryId: number | null
  materialId: number | null
}

export interface FrameSurfaceGateResult {
  generations: number[]
  receiptSourceIds: number[]
  sourceIds: number[]
  receiptSurfaceEpochs: number[]
  surfaceEpochs: number[]
  receipts: FrameSurfaceGateReceipt[]
  staleReceipts: number
  staleOldSourceReceipts: number
  replacementRenderSamples: RenderSample[]
  replacementClearFrames: number
  releasePublications: ReleasePublication[]
  acquisitionRenderSamples: AcquisitionRenderSample[]
  acquisitionEvidence: AcquisitionEvidence[]
  acquisitionClearFrames: number
  acquisitionMismatchedFrames: number
  liveReplacementIdentityPreserved: boolean
  reacquisitionObjectsFresh: boolean
  defaultUnlitVerified: boolean
  freshSurfaceEpochPerHandoff: boolean
  presentationFence: PresentationFenceEvidence
  backingStoreResize: BackingStoreResizeEvidence
  worstRgbError: number
  passed: boolean
}

export interface PresentationFenceEvidence {
  frameReceipts: FrameDrawReceipt[]
  presentationReceipts: PresentationReceipt[]
  disabledDefaultClear: boolean
  offscreenHadPixels: boolean
  offscreenRgbError: number
  visibleRgbError: number
  offscreenPresentationReceipts: number
  passed: boolean
}

export interface BackingStoreResizeEvidence {
  generations: number[]
  rgbErrors: number[]
  finalWidth: number
  finalHeight: number
  sameTexture: boolean
  passed: boolean
}

let resolveDone!: (value: FrameSurfaceGateResult) => void
let rejectDone!: (error: Error) => void
const done = new Promise<FrameSurfaceGateResult>((resolve, reject) => {
  resolveDone = resolve
  rejectDone = reject
})

const receipts: FrameSurfaceGateReceipt[] = []
const replacementRenderSamples: RenderSample[] = []
const acquisitionRenderSamples: AcquisitionRenderSample[] = []
const releasePublications: ReleasePublication[] = []
/** Anything in the render graph the gate wants a stable id for, so two
 *  receipts can be compared for "same object" without holding references. */
type RenderNode = THREE.Object3D | THREE.BufferGeometry | THREE.Material

const objectIds = new WeakMap<RenderNode, number>()
let nextObjectId = 1
let renderCount = 0
let replacementRequested = false
let replacementComplete = false
let activeAcquisitionCycle: number | null = null
let pendingReleaseCycle: number | null = null
let firstBurstStarted = false
let secondBurstStarted = false
let resultScheduled = false
let settled = false
let mainGateComplete = false
let presentationFence: PresentationFenceEvidence | null = null
let backingStoreResize: BackingStoreResizeEvidence | null = null
let presentationFencePhase: PresentationFencePhase = 'disabled'

function objectId(node: RenderNode): number {
  const known = objectIds.get(node)
  if (known !== undefined) return known
  const id = nextObjectId++
  objectIds.set(node, id)
  return id
}

/** Whatever the platform threw, as an Error. A catch is a boundary: the
 *  gate reports failures with a message and a stack, so the normalizing
 *  happens once, here. */
function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause))
}

function fail(error: Error): void {
  if (settled) return
  settled = true
  rejectDone(error)
}

function sampleStripes(renderer: THREE.WebGLRenderer): RGB[] {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const gl = renderer.getContext()
  const sampled: RGB[] = []
  for (let index = 0; index < 4; index += 1) {
    const pixel = new Uint8Array(4)
    const x = Math.floor(((index + 0.5) * size.x) / 4)
    const y = Math.floor(size.y / 2)
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
    sampled.push([pixel[0]!, pixel[1]!, pixel[2]!])
  }
  return sampled
}

function sampleTargetStripes(
  renderer: THREE.WebGLRenderer,
  target: THREE.WebGLRenderTarget,
): RGB[] {
  const sampled: RGB[] = []
  for (let index = 0; index < 4; index += 1) {
    const pixel = new Uint8Array(4)
    renderer.readRenderTargetPixels(
      target,
      Math.floor(((index + 0.5) * target.width) / 4),
      Math.floor(target.height / 2),
      1,
      1,
      pixel,
    )
    sampled.push([pixel[0]!, pixel[1]!, pixel[2]!])
  }
  return sampled
}

function maxError(actual: readonly RGB[], expected: readonly RGB[]): number {
  let maximum = 0
  for (let stripe = 0; stripe < expected.length; stripe += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      maximum = Math.max(
        maximum,
        Math.abs(actual[stripe]![channel]! - expected[stripe]![channel]!),
      )
    }
  }
  return maximum
}

function isClearOnly(sampled: readonly RGB[]): boolean {
  return sampled.every((rgb) => rgb.every((channel) => channel <= 1))
}

function expectedSourceCanvas(sourceId: number): HTMLCanvasElement {
  if (sourceId === firstSourceId) return first.source.canvas
  if (sourceId === secondSourceId) return second.source.canvas
  throw new Error(`unknown source ${sourceId}`)
}

function inspectSurface(
  scene: THREE.Scene,
  sourceId: number,
): Omit<FrameSurfaceGateReceipt, 'receipt' | 'sampledRgb' | 'maxChannelError'> {
  const object = scene.getObjectByName(SURFACE_NAME)
  if (!(object instanceof THREE.Mesh)) {
    throw new Error(`Surface mesh ${SURFACE_NAME} was not in the rendered scene`)
  }
  if (Array.isArray(object.material)) {
    throw new Error('frame Surface unexpectedly used a material array')
  }
  const material = object.material
  const map = material instanceof THREE.MeshBasicMaterial ? material.map : null
  return {
    meshId: objectId(object),
    geometryId: objectId(object.geometry),
    materialId: objectId(material),
    materialType: material.type,
    toneMapped: material.toneMapped,
    canvasTexture: map instanceof THREE.CanvasTexture,
    textureColorSpace: map?.colorSpace ?? null,
    textureCanvasMatchesSource: map?.image === expectedSourceCanvas(sourceId),
  }
}

function acquisitionForCycle(cycle: number) {
  const acquisition = ACQUISITIONS[cycle - 1]
  if (!acquisition || acquisition.cycle !== cycle) {
    throw new Error(`unknown acquisition cycle ${cycle}`)
  }
  return acquisition
}

/** Capture every completed render; a draw receipt cannot reveal an earlier gap. */
function RenderMonitor() {
  const renderer = useThree((state) => state.gl)
  useLayoutEffect(() => {
    const original = renderer.render
    const wrapped: typeof renderer.render = (scene, camera) => {
      const replacementWasActive = replacementRequested && !replacementComplete
      const acquisitionCycleAtStart = activeAcquisitionCycle
      original.call(renderer, scene, camera)
      renderCount += 1

      if (replacementWasActive) {
        const sampledRgb = sampleStripes(renderer)
        replacementRenderSamples.push({
          render: renderCount,
          sampledRgb,
          clearOnly: isClearOnly(sampledRgb),
          maxChannelError: maxError(sampledRgb, SECOND_0),
        })
      }

      if (acquisitionCycleAtStart !== null) {
        const acquisition = acquisitionForCycle(acquisitionCycleAtStart)
        const sampledRgb = sampleStripes(renderer)
        acquisitionRenderSamples.push({
          cycle: acquisitionCycleAtStart,
          render: renderCount,
          sampledRgb,
          clearOnly: isClearOnly(sampledRgb),
          maxChannelError: maxError(sampledRgb, acquisition.finalColors),
        })
      }
    }
    renderer.render = wrapped
    return () => {
      if (renderer.render === wrapped) renderer.render = original
    }
  }, [renderer])
  return null
}

function LeaseWitness({ onReleased }: { onReleased: () => void }) {
  useLayoutEffect(() => onReleased, [onReleased])
  return null
}

function allSame(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value) => value === values[0])
}

function scheduleResult(): void {
  if (!mainGateComplete || !presentationFence || !backingStoreResize) return
  if (resultScheduled) return
  const fenceEvidence = presentationFence
  const resizeEvidence = backingStoreResize
  resultScheduled = true
  setTimeout(() => {
    if (settled) return
    try {
      const generations = receipts.map((entry) => entry.receipt.frame.generation)
      const receiptSourceIds = receipts.map((entry) => entry.receipt.frame.sourceId)
      const sourceIds = [...new Set(receiptSourceIds)]
      const receiptSurfaceEpochs = receipts.map((entry) => entry.receipt.surfaceEpoch)
      const surfaceEpochs = [...new Set(receiptSurfaceEpochs)]
      const staleReceipts = receipts.filter((entry, index) => {
        const expected = EXPECTED_RECEIPTS[index]
        return (
          !expected ||
          entry.receipt.frame.sourceId !== expected.sourceId ||
          entry.receipt.frame.generation !== expected.generation
        )
      }).length
      const staleOldSourceReceipts = receipts.filter(
        (entry, index) => index > 1 && entry.receipt.frame.sourceId === firstSourceId,
      ).length
      const replacementClearFrames = replacementRenderSamples.filter(
        (sample) => sample.clearOnly,
      ).length
      const acquisitionClearFrames = acquisitionRenderSamples.filter(
        (sample) => sample.clearOnly,
      ).length
      const acquisitionMismatchedFrames = acquisitionRenderSamples.filter(
        (sample) => sample.maxChannelError > 1,
      ).length
      const liveReplacementReceipts = receipts.slice(0, 4)
      const liveReplacementIdentityPreserved =
        allSame(liveReplacementReceipts.map((entry) => entry.meshId)) &&
        allSame(liveReplacementReceipts.map((entry) => entry.geometryId)) &&
        allSame(liveReplacementReceipts.map((entry) => entry.materialId))
      const handoffReceipts = [receipts[3], receipts[4], receipts[5], receipts[6]]
      const reacquisitionObjectsFresh = handoffReceipts.every((entry, index) => {
        if (index === 0) return entry !== undefined
        const previous = handoffReceipts[index - 1]
        return (
          entry !== undefined &&
          previous !== undefined &&
          entry.meshId !== previous.meshId &&
          entry.geometryId !== previous.geometryId &&
          entry.materialId !== previous.materialId
        )
      })
      const defaultUnlitVerified = receipts.every(
        (entry) =>
          entry.materialType === 'MeshBasicMaterial' &&
          entry.toneMapped === false &&
          entry.canvasTexture &&
          entry.textureColorSpace === THREE.SRGBColorSpace &&
          entry.textureCanvasMatchesSource,
      )
      const freshSurfaceEpochPerHandoff =
        receiptSurfaceEpochs.length === 7 &&
        receiptSurfaceEpochs[0]! > 0 &&
        receiptSurfaceEpochs[0] === receiptSurfaceEpochs[1] &&
        receiptSurfaceEpochs[2] === receiptSurfaceEpochs[3] &&
        receiptSurfaceEpochs[2]! > receiptSurfaceEpochs[1]! &&
        receiptSurfaceEpochs[4]! > receiptSurfaceEpochs[3]! &&
        receiptSurfaceEpochs[5]! > receiptSurfaceEpochs[4]! &&
        receiptSurfaceEpochs[6]! > receiptSurfaceEpochs[5]!
      const worstRgbError = Math.max(...receipts.map((entry) => entry.maxChannelError))
      const acquisitionEvidence = ACQUISITIONS.map((acquisition) => {
        const receipt = receipts.find(
          (entry) =>
            entry.receipt.frame.sourceId === secondSourceId &&
            entry.receipt.frame.generation === acquisition.expectedGeneration,
        )
        const publication = releasePublications.find(
          (entry) => entry.cycle === acquisition.cycle,
        )
        const samples = acquisitionRenderSamples.filter(
          (sample) => sample.cycle === acquisition.cycle,
        )
        return {
          cycle: acquisition.cycle,
          expectedGeneration: acquisition.expectedGeneration,
          receiptGeneration: receipt?.receipt.frame.generation ?? null,
          surfaceEpoch: receipt?.receipt.surfaceEpoch ?? null,
          releasedSurfaceAbsent: publication?.surfaceAbsent ?? false,
          publishedGenerations: publication?.publishedGenerations ?? [],
          renderSamples: samples.length,
          clearFrames: samples.filter((sample) => sample.clearOnly).length,
          mismatchedFrames: samples.filter((sample) => sample.maxChannelError > 1).length,
          receiptRgbError: receipt?.maxChannelError ?? null,
          meshId: receipt?.meshId ?? null,
          geometryId: receipt?.geometryId ?? null,
          materialId: receipt?.materialId ?? null,
        }
      })
      const acquisitionsPassed = acquisitionEvidence.every(
        (entry) =>
          entry.receiptGeneration === entry.expectedGeneration &&
          entry.releasedSurfaceAbsent &&
          entry.publishedGenerations.length === 2 &&
          entry.publishedGenerations[1] === entry.expectedGeneration &&
          entry.renderSamples >= 1 &&
          entry.clearFrames === 0 &&
          entry.mismatchedFrames === 0 &&
          entry.receiptRgbError !== null &&
          entry.receiptRgbError <= 1,
      )
      const expectedGenerations = [0, 2, 0, 2, 4, 6, 8]
      const expectedSourceIds = [
        firstSourceId,
        firstSourceId,
        secondSourceId,
        secondSourceId,
        secondSourceId,
        secondSourceId,
        secondSourceId,
      ]
      const traceMatches =
        generations.length === expectedGenerations.length &&
        receiptSourceIds.length === expectedSourceIds.length &&
        generations.every((generation, index) => generation === expectedGenerations[index]) &&
        receiptSourceIds.every((sourceId, index) => sourceId === expectedSourceIds[index])

      settled = true
      resolveDone({
        generations,
        receiptSourceIds,
        sourceIds,
        receiptSurfaceEpochs,
        surfaceEpochs,
        receipts,
        staleReceipts,
        staleOldSourceReceipts,
        replacementRenderSamples,
        replacementClearFrames,
        releasePublications,
        acquisitionRenderSamples,
        acquisitionEvidence,
        acquisitionClearFrames,
        acquisitionMismatchedFrames,
        liveReplacementIdentityPreserved,
        reacquisitionObjectsFresh,
        defaultUnlitVerified,
        freshSurfaceEpochPerHandoff,
        presentationFence: fenceEvidence,
        backingStoreResize: resizeEvidence,
        worstRgbError,
        passed:
          traceMatches &&
          sourceIds.length === 2 &&
          surfaceEpochs.length === 5 &&
          staleReceipts === 0 &&
          staleOldSourceReceipts === 0 &&
          replacementRenderSamples.length >= 1 &&
          replacementClearFrames === 0 &&
          acquisitionsPassed &&
          acquisitionClearFrames === 0 &&
          acquisitionMismatchedFrames === 0 &&
          liveReplacementIdentityPreserved &&
          defaultUnlitVerified &&
          freshSurfaceEpochPerHandoff &&
          fenceEvidence.passed &&
          resizeEvidence.passed &&
          worstRgbError <= 1,
      })
    } catch (error) {
      fail(asError(error))
    }
  }, 50)
}

function finish(): void {
  mainGateComplete = true
  scheduleResult()
}

function completePresentationFence(evidence: PresentationFenceEvidence): void {
  presentationFence = evidence
  scheduleResult()
}

function completeBackingStoreResize(evidence: BackingStoreResizeEvidence): void {
  backingStoreResize = evidence
  scheduleResult()
}

type PresentationFencePhase = 'disabled' | 'offscreen' | 'visible' | 'done'

function PresentationMaterial({ colorWrite }: { colorWrite: boolean }) {
  const texture = useSurfaceTexture()
  return (
    <meshBasicMaterial
      map={texture}
      color="#ffffff"
      colorWrite={colorWrite}
      toneMapped={false}
    />
  )
}

function PresentationRenderMonitor({
  phase,
  onRendered,
}: {
  phase: PresentationFencePhase
  onRendered: (phase: PresentationFencePhase, sampled: RGB[]) => void
}) {
  const renderer = useThree((state) => state.gl)
  const target = useMemo(() => new THREE.WebGLRenderTarget(1, 1), [])

  useLayoutEffect(() => () => target.dispose(), [target])
  useLayoutEffect(() => {
    const original = renderer.render
    const wrapped: typeof renderer.render = (scene, camera) => {
      const offscreen = phase === 'offscreen'
      const previousTarget = renderer.getRenderTarget()
      if (offscreen) {
        const size = renderer.getDrawingBufferSize(new THREE.Vector2())
        target.setSize(size.x, size.y)
        renderer.setRenderTarget(target)
      }

      original.call(renderer, scene, camera)
      const sampled = offscreen
        ? sampleTargetStripes(renderer, target)
        : sampleStripes(renderer)
      if (offscreen) renderer.setRenderTarget(previousTarget)
      onRendered(phase, sampled)
    }
    renderer.render = wrapped
    return () => {
      if (renderer.render === wrapped) renderer.render = original
    }
  }, [renderer, target, phase, onRendered])

  return null
}

function PresentationFenceScene() {
  const invalidate = useThree((state) => state.invalidate)
  const [phase, setPhase] = useState<PresentationFencePhase>('disabled')
  presentationFencePhase = phase
  const frameReceipts = useRef<FrameDrawReceipt[]>([])
  const presentationReceipts = useRef<PresentationReceipt[]>([])
  const handled = useRef(new Set<PresentationFencePhase>())
  const disabledDefaultClear = useRef(false)
  const offscreenRgbError = useRef(Number.POSITIVE_INFINITY)
  const offscreenHadPixels = useRef(false)
  const offscreenPresentationReceipts = useRef(-1)

  useLayoutEffect(() => invalidate(), [phase, invalidate])

  const onFrameDrawn = useCallback((receipt: FrameDrawReceipt) => {
    frameReceipts.current.push(receipt)
    if (frameReceipts.current.length > 1) {
      fail(new Error('presentation fence changed the FrameDrawReceipt callback count'))
    }
  }, [])

  const onPresented = useCallback((receipt: PresentationReceipt) => {
    presentationReceipts.current.push(receipt)
    if (presentationReceipts.current.length > 1) {
      fail(new Error('presentation fence emitted more than one receipt for one tuple'))
    }
  }, [])

  const onRendered = useCallback(
    (renderedPhase: PresentationFencePhase, sampled: RGB[]) => {
      if (settled || handled.current.has(renderedPhase) || renderedPhase === 'done') return
      if (renderedPhase === 'disabled' && frameReceipts.current.length === 0) return

      handled.current.add(renderedPhase)
      if (renderedPhase === 'disabled') {
        disabledDefaultClear.current = isClearOnly(sampled)
        if (presentationReceipts.current.length !== 0) {
          fail(new Error('color-disabled draw produced a presentation receipt'))
          return
        }
        queueMicrotask(() => setPhase('offscreen'))
        return
      }

      if (renderedPhase === 'offscreen') {
        offscreenRgbError.current = maxError(sampled, PRESENTATION_COLORS)
        offscreenHadPixels.current = !isClearOnly(sampled)
        offscreenPresentationReceipts.current = presentationReceipts.current.length
        if (presentationReceipts.current.length !== 0) {
          fail(new Error('off-screen draw produced a presentation receipt'))
          return
        }
        queueMicrotask(() => setPhase('visible'))
        return
      }

      const visibleRgbError = maxError(sampled, PRESENTATION_COLORS)
      const accepted = presentationReceipts.current[0]
      const passed =
        frameReceipts.current.length === 1 &&
        frameReceipts.current[0]?.frame.sourceId ===
          PRESENTATION_REQUIREMENT.frame.sourceId &&
        frameReceipts.current[0]?.frame.generation ===
          PRESENTATION_REQUIREMENT.frame.generation &&
        presentationReceipts.current.length === 1 &&
        accepted?.transferId === PRESENTATION_REQUIREMENT.transferId &&
        accepted.frame.sourceId === PRESENTATION_REQUIREMENT.frame.sourceId &&
        accepted.frame.generation === PRESENTATION_REQUIREMENT.frame.generation &&
        accepted.presentationRevision ===
          PRESENTATION_REQUIREMENT.presentationRevision &&
        disabledDefaultClear.current &&
        offscreenHadPixels.current &&
        offscreenPresentationReceipts.current === 0 &&
        visibleRgbError <= 1

      setPhase('done')
      completePresentationFence({
        frameReceipts: frameReceipts.current,
        presentationReceipts: presentationReceipts.current,
        disabledDefaultClear: disabledDefaultClear.current,
        offscreenHadPixels: offscreenHadPixels.current,
        offscreenRgbError: offscreenRgbError.current,
        visibleRgbError,
        offscreenPresentationReceipts: offscreenPresentationReceipts.current,
        passed,
      })
    },
    [],
  )

  return (
    <>
      <PresentationRenderMonitor phase={phase} onRendered={onRendered} />
      <Surface
        name="frame-presentation-gate"
        frame={presentationSource.source}
        width={64}
        height={16}
        material="none"
        presentation={PRESENTATION_REQUIREMENT}
        onFrameDrawn={onFrameDrawn}
        onPresented={onPresented}
      >
        <planeGeometry args={[4, 1]} />
        <PresentationMaterial colorWrite={phase !== 'disabled'} />
      </Surface>
    </>
  )
}

function BackingStoreResizeScene() {
  const renderer = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const generations = useRef<number[]>([])
  const rgbErrors = useRef<number[]>([])
  const firstTexture = useRef<THREE.Texture | null>(null)

  const onFrameDrawn = useCallback(
    (receipt: FrameDrawReceipt) => {
      try {
        const object = scene.getObjectByName('frame-resize-gate')
        if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) {
          throw new Error('resize gate Surface mesh was not ready')
        }
        const texture =
          object.material instanceof THREE.MeshBasicMaterial
            ? object.material.map
            : null
        if (!texture) throw new Error('resize gate had no CanvasTexture')

        const index = generations.current.length
        const expected = index === 0 ? FIRST_0 : FIRST_2
        generations.current.push(receipt.frame.generation)
        rgbErrors.current.push(maxError(sampleStripes(renderer), expected))

        if (index === 0) {
          firstTexture.current = texture
          setTimeout(() => {
            resizeSource.source.canvas.width = 128
            resizeSource.source.canvas.height = 32
            resizeSource.paint(FIRST_2)
            resizeSource.source.publish()
          }, 0)
          return
        }

        if (index > 1) throw new Error('resize gate emitted an extra frame receipt')
        completeBackingStoreResize({
          generations: generations.current,
          rgbErrors: rgbErrors.current,
          finalWidth: resizeSource.source.canvas.width,
          finalHeight: resizeSource.source.canvas.height,
          sameTexture: firstTexture.current === texture,
          passed:
            generations.current[0] === 0 &&
            generations.current[1] === 1 &&
            rgbErrors.current.every((error) => error <= 1) &&
            resizeSource.source.canvas.width === 128 &&
            resizeSource.source.canvas.height === 32 &&
            firstTexture.current === texture,
        })
      } catch (error) {
        fail(asError(error))
      }
    },
    [renderer, scene],
  )

  return (
    <Surface
      name="frame-resize-gate"
      frame={resizeSource.source}
      width={64}
      height={16}
      onFrameDrawn={onFrameDrawn}
    >
      <planeGeometry args={[4, 1]} />
    </Surface>
  )
}

function GateScene() {
  const renderer = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const [activeSource, setActiveSource] = useState(first.source)
  const [mounted, setMounted] = useState(true)

  const onReleased = useCallback(() => {
    const cycle = pendingReleaseCycle
    if (cycle === null || settled) return
    pendingReleaseCycle = null
    setTimeout(() => {
      try {
        const acquisition = acquisitionForCycle(cycle)
        const surfaceAbsent = scene.getObjectByName(SURFACE_NAME) === undefined
        if (!surfaceAbsent) {
          throw new Error(`Surface was still in the scene after release ${cycle}`)
        }
        second.paint(acquisition.intermediateColors)
        const intermediate = second.source.publish()
        second.paint(acquisition.finalColors)
        const final = second.source.publish()
        releasePublications.push({
          cycle,
          surfaceAbsent,
          publishedGenerations: [intermediate.generation, final.generation],
        })
        if (final.generation !== acquisition.expectedGeneration) {
          throw new Error(
            `cycle ${cycle} published generation ${final.generation}; expected ${acquisition.expectedGeneration}`,
          )
        }
        activeAcquisitionCycle = cycle
        setMounted(true)
      } catch (error) {
        fail(asError(error))
      }
    }, 0)
  }, [scene])

  const onFrameDrawn = useCallback(
    (receipt: FrameDrawReceipt) => {
      try {
        const receiptIndex = receipts.length
        const expected = EXPECTED_RECEIPTS[receiptIndex]
        if (!expected) {
          throw new Error(
            `extra receipt source ${receipt.frame.sourceId} generation ${receipt.frame.generation}`,
          )
        }
        if (
          receipt.frame.sourceId !== expected.sourceId ||
          receipt.frame.generation !== expected.generation
        ) {
          throw new Error(
            `receipt ${receiptIndex} was source ${receipt.frame.sourceId} generation ${receipt.frame.generation}; ` +
              `expected source ${expected.sourceId} generation ${expected.generation}`,
          )
        }

        const sampledRgb = sampleStripes(renderer)
        receipts.push({
          receipt,
          sampledRgb,
          maxChannelError: maxError(sampledRgb, expected.colors),
          ...inspectSurface(scene, receipt.frame.sourceId),
        })

        if (receiptIndex >= 4) {
          const cycle = receiptIndex - 3
          if (activeAcquisitionCycle !== cycle) {
            throw new Error(
              `cycle ${cycle} receipt arrived outside its acquisition window`,
            )
          }
          activeAcquisitionCycle = null
        }

        if (receiptIndex === 0 && !firstBurstStarted) {
          firstBurstStarted = true
          setTimeout(() => {
            first.paint(FIRST_1)
            first.source.publish()
            first.paint(FIRST_2)
            first.source.publish()
          }, 0)
          return
        }

        if (receiptIndex === 1) {
          setTimeout(() => {
            replacementRequested = true
            setActiveSource(second.source)
          }, 0)
          return
        }

        if (receiptIndex === 2 && !secondBurstStarted) {
          replacementComplete = true
          secondBurstStarted = true
          setTimeout(() => {
            // The old source must now have no subscriber. Its publication can
            // produce no receipt and no invalidation-owned render.
            first.paint([[1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]])
            first.source.publish()
            second.paint(SECOND_1)
            second.source.publish()
            second.paint(SECOND_2)
            second.source.publish()
          }, 0)
          return
        }

        if (receiptIndex >= 3 && receiptIndex <= 5) {
          const cycle = receiptIndex - 2
          setTimeout(() => {
            if (pendingReleaseCycle !== null || activeAcquisitionCycle !== null) {
              fail(new Error(`cycle ${cycle} started while another handoff was active`))
              return
            }
            pendingReleaseCycle = cycle
            setMounted(false)
          }, 0)
          return
        }

        if (receiptIndex === 6) finish()
      } catch (error) {
        fail(asError(error))
      }
    },
    [renderer, scene],
  )

  return (
    <>
      <RenderMonitor />
      {mounted && (
        <Surface
          name={SURFACE_NAME}
          frame={activeSource}
          width={64}
          height={16}
          onFrameDrawn={onFrameDrawn}
        >
          <planeGeometry args={[4, 1]} />
          <LeaseWitness onReleased={onReleased} />
        </Surface>
      )}
    </>
  )
}

declare global {
  interface Window {
    __frameSurfaceGate: {
      ready: boolean
      run: () => Promise<FrameSurfaceGateResult>
      debug: () => object
    }
  }
}

window.__frameSurfaceGate = {
  ready: true,
  run: () => done,
  debug: () => ({
    mainGateComplete,
    mainReceipts: receipts.length,
    presentationFencePhase,
    presentationFence,
    backingStoreResize,
  }),
}

createRoot(document.getElementById('root')!).render(
  <div id="stages">
    <div id="presentation-stage">
      <Canvas
        frameloop="demand"
        dpr={1}
        orthographic
        camera={{
          position: [0, 0, 1],
          left: -2,
          right: 2,
          top: 0.5,
          bottom: -0.5,
          near: 0.1,
          far: 10,
        }}
        gl={{ alpha: false, antialias: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.NoToneMapping
          gl.setClearColor(0x000000, 1)
        }}
      >
        <PresentationFenceScene />
      </Canvas>
    </div>
    <div id="resize-stage">
      <Canvas
        frameloop="demand"
        dpr={1}
        orthographic
        camera={{
          position: [0, 0, 1],
          left: -2,
          right: 2,
          top: 0.5,
          bottom: -0.5,
          near: 0.1,
          far: 10,
        }}
        gl={{ alpha: false, antialias: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.NoToneMapping
          gl.setClearColor(0x000000, 1)
        }}
      >
        <BackingStoreResizeScene />
      </Canvas>
    </div>
    <div id="stage">
      <Canvas
        frameloop="demand"
        dpr={1}
        orthographic
        camera={{
          position: [0, 0, 1],
          left: -2,
          right: 2,
          top: 0.5,
          bottom: -0.5,
          near: 0.1,
          far: 10,
        }}
        gl={{ alpha: false, antialias: false, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace
          gl.toneMapping = THREE.NoToneMapping
          gl.setClearColor(0x000000, 1)
        }}
      >
        <GateScene />
      </Canvas>
    </div>
  </div>,
)
