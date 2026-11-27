// Loading matrix summary — the cold and warm table for one or two sets of
// run.mjs records, as Markdown.
//
// Each cell is median [min–max] over a cell's loads. "Stopped" adds the
// animation-frame gaps over 50 ms; "longest" is the largest one. "Work done"
// is the last of: a blocking pipeline build's start, an async build's resolution, and a Surface
// source's first paint; it is when the page last started or finished scene
// preparation, not when a frame showed it. CLS excludes shifts after input.
//
// Usage: node summarize.mjs before.jsonl [after.jsonl]. With two files each
// cell reads "before → after".
//
// Ownership: arithmetic only; run.mjs owns what each record holds.
import { readFileSync } from 'node:fs'

const [beforeFile, afterFile] = process.argv.slice(2)
if (!beforeFile) throw new Error('usage: node summarize.mjs before.jsonl [after.jsonl]')

const read = (file) => readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))

const sum = (values) => values.reduce((total, value) => total + value, 0)
export function metrics(record) {
  const gaps = record.gaps.map(([, gap]) => gap)
  const work = Math.max(record.pipesSync.last ?? 0, record.pipesAsync.lastDone ?? 0, record.sources.last ?? 0)
  const switchGaps = record.finishSwitch?.gaps?.map((g) => g.gap) ?? []
  return {
    fcp: record.fcp,
    capture: record.sources.first,
    draw: record.renders.firstScreen,
    stopped: Math.round(sum(gaps)),
    longest: Math.round(Math.max(0, ...gaps)),
    blocking: record.pipesSync.n,
    work: Math.round(work),
    cls: record.cls + (record.top?.cls ?? 0),
    switchStopped: record.finishSwitch ? Math.round(sum(switchGaps.filter((g) => g > 50))) : null,
    switchBlocking: record.finishSwitch ? record.finishSwitch.pipes?.filter((p) => p.kind === 'sync').length : null,
  }
}

const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}
const format = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(3))
function cell(values) {
  const present = values.filter((value) => value !== null && value !== undefined)
  if (present.length === 0) return '–'
  return `${format(median(present))} [${format(Math.min(...present))}–${format(Math.max(...present))}]`
}

function group(records) {
  const groups = new Map()
  for (const record of records) {
    const key = [record.scene, record.browser, record.engine, record.load].join('|')
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(metrics(record))
  }
  return groups
}

const columns = ['fcp', 'capture', 'draw', 'stopped', 'longest', 'blocking', 'work', 'cls', 'switchStopped', 'switchBlocking']
const headers = ['FCP', 'First capture', 'First scene draw', 'Stopped in total', 'Longest stop', 'Blocking builds', 'Work done', 'CLS', 'Switch stopped', 'Switch blocking builds']
const before = group(read(beforeFile))
const after = afterFile ? group(read(afterFile)) : null
const lines = [`| Scene | Browser | Engine | Load | ${headers.join(' | ')} |`, `|${'---|'.repeat(4 + headers.length)}`]
for (const [key, rows] of before) {
  const [scene, browser, engine, load] = key.split('|')
  const cells = columns.map((column) => {
    const left = cell(rows.map((row) => row[column]))
    if (!after) return left
    const right = after.get(key)
    return right ? `${left} → ${cell(right.map((row) => row[column]))}` : `${left} → –`
  })
  lines.push(`| ${scene} | ${browser} | ${engine} | ${load} | ${cells.join(' | ')} |`)
}
console.log(lines.join('\n'))
