// Payload budget — the rule that turns a measured entry size into pass or fail.
//
// An entry passes while its gzip size stays at or under the recorded size plus
// its margin. The margin absorbs a dependency's patch release; a change in
// what an entry imports moves the size by far more than any margin recorded
// in budgets.json (instruments/README.md, payload budget).

export interface EntryBudget {
  name: string
  measuredBytes: number
  recordedBytes: number
  marginBytes: number
}

export function judgeEntry({ name, measuredBytes, recordedBytes, marginBytes }: EntryBudget) {
  const limitBytes = recordedBytes + marginBytes
  return { name, measuredBytes, recordedBytes, marginBytes, limitBytes, ok: measuredBytes <= limitBytes }
}
