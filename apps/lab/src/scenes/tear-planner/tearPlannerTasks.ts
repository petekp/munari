// Planner tasks — what each sheet lists, and what carries to the next one.
//
// A sheet has a fixed number of ruled slots. Tomorrow's sheet is derived
// from today's while today is still on the pad: every unfinished task of
// today sits in the same slot on tomorrow, so the rows line up through the
// lifted page. A slot tomorrow already holds pushes the carried task to the
// next free slot below. Tearing today off writes the derived sheet down.

export const SLOT_COUNT = 7

export interface Task {
  readonly id: string
  readonly text: string
  readonly done: boolean
  /** The weekday a carried task came from, as printed beside it. */
  readonly carriedFrom?: string
}

export type Slots = readonly (Task | null)[]

export const EMPTY_SLOTS: Slots = Array.from({ length: SLOT_COUNT }, () => null)

/** Monday 23 November's list, and what was already written on Tuesday. */
export type Days = Readonly<Record<number, Slots>>

export const SEED = {
  0: [
    { id: 't1', text: 'Return library books, due today', done: true },
    { id: 't2', text: 'Pay council tax, £148.00', done: false },
    { id: 't3', text: 'Collect prints from Kerr & Sons', done: true },
    { id: 't4', text: 'Send Ana the floor plan', done: false },
    { id: 't5', text: 'Stamps: 2 × international', done: false },
    { id: 't6', text: 'Repot the fig', done: false },
    null,
  ],
  1: [null, null, null, null, null, null, { id: 't7', text: 'Dentist, 09:40', done: false }],
} satisfies Days

/**
 * Tomorrow's sheet as it will read if today is torn off now: today's
 * unfinished tasks rewritten at the top in today's order, then what was
 * already written on tomorrow, then blank lines. A task that does not fit
 * on the sheet is dropped, as it would be on paper.
 */
export function carryInto(today: Slots, tomorrow: Slots, fromWeekday: string): Slots {
  const carried = today
    .filter((t): t is Task => t !== null && !t.done && t.text.trim() !== '')
    .map((t) => ({ ...t, carriedFrom: t.carriedFrom ?? fromWeekday }))
  const carriedIds = new Set(carried.map((t) => t.id))
  const own = tomorrow.filter((t): t is Task => t !== null && !carriedIds.has(t.id))
  const lines: (Task | null)[] = [...carried, ...own].slice(0, SLOT_COUNT)
  while (lines.length < SLOT_COUNT) lines.push(null)
  return lines
}

/** Writes `task` on the first blank line, or drops it when the sheet is full. */
export function writeOnBlankLine(slots: Slots, task: Task): Slots {
  const at = slots.indexOf(null)
  return at < 0 ? slots : slots.map((t, i) => (i === at ? task : t))
}

export function countDone(slots: Slots) {
  const tasks = slots.filter((t): t is Task => t !== null && t.text.trim() !== '')
  return { done: tasks.filter(t => t.done).length, total: tasks.length }
}
