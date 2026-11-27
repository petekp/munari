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
// cell reads "before → after". With --paired first, the nth load of a cell in
// one file is paired with the nth in the other, as runs that alternate the two
// builds one profile at a time produce, and each cell gives the mean paired
// difference (after minus before) with its 95% t interval.
//
// Ownership: arithmetic only; run.mjs owns what each record holds.
import { readFileSync } from 'node:fs'

const paired = process.argv[2] === '--paired'
const [beforeFile, afterFile] = process.argv.slice(paired ? 3 : 2)
if (!beforeFile || (paired && !afterFile)) throw new Error('usage: node summarize.mjs [--paired] before.jsonl [after.jsonl]')

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
  const middle = (sorted.length - 1) / 2
  return (sorted[Math.floor(middle)] + sorted[Math.ceil(middle)]) / 2
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

// Two-sided 95% Student t quantiles for 1–30 degrees of freedom. Past 30 the
// Cornish-Fisher expansion around z = 1.959964 is within 0.001 of the table.
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042]
export function t95(degrees) {
  if (degrees <= T95.length) return T95[degrees - 1]
  const z = 1.959964
  return z + (z ** 3 + z) / (4 * degrees) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degrees ** 2) + (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * degrees ** 3)
}
export function pairedDifference(before, after) {
  const n = Math.min(before.length, after.length)
  const differences = Array.from({ length: n }, (_, index) => after[index] - before[index])
  const mean = sum(differences) / n
  const variance = sum(differences.map((value) => (value - mean) ** 2)) / (n - 1)
  const half = t95(n - 1) * Math.sqrt(variance / n)
  return { n, mean, low: mean - half, high: mean + half }
}

if (paired) {
  const before = group(read(beforeFile))
  const after = group(read(afterFile))
  const pairedColumns = ['stopped', 'longest', 'work', 'blocking']
  const lines = [`| Scene | Browser | Engine | Load | Loads | Stopped, median before → after | ${pairedColumns.map((column) => `${column} difference [95% CI]`).join(' | ')} |`, `|${'---|'.repeat(6 + pairedColumns.length)}`]
  for (const [key, rows] of before) {
    const other = after.get(key) ?? []
    if (other.length < 2 || rows.length < 2) continue
    const [scene, browser, engine, load] = key.split('|')
    const cells = pairedColumns.map((column) => {
      const { mean, low, high } = pairedDifference(rows.map((row) => row[column]), other.map((row) => row[column]))
      return `${Math.round(mean)} [${Math.round(low)}, ${Math.round(high)}]`
    })
    const n = Math.min(rows.length, other.length)
    lines.push(`| ${scene} | ${browser} | ${engine} | ${load} | ${n} | ${Math.round(median(rows.map((row) => row.stopped)))} → ${Math.round(median(other.map((row) => row.stopped)))} | ${cells.join(' | ')} |`)
  }
  console.log(lines.join('\n'))
  process.exit(0)
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
