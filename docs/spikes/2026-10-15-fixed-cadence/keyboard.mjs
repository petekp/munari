import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

export const maxIssueLatenessMs = 10
export const holdMs = 40

export function keyboardSchedule(text) {
  assert.match(text, /^[ -~]+$/)
  const groups = []
  let sequence = 0
  for (let boundary = 0; boundary <= text.length; boundary++) {
    const commands = []
    if (boundary > 0) commands.push({ sequence: sequence++, action: 'up', key: text[boundary - 1], inputIndex: boundary - 1 })
    if (boundary < text.length) commands.push({ sequence: sequence++, action: 'down', key: text[boundary], inputIndex: boundary })
    else {
      commands.push({ sequence: sequence++, action: 'down', key: 'Enter', inputIndex: null })
      commands.push({ sequence: sequence++, action: 'up', key: 'Enter', inputIndex: null })
    }
    groups.push({ offsetMs: boundary * holdMs, commands })
  }
  return groups
}

const waitUntil = async deadline => {
  while (performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, Math.max(1, deadline - performance.now())))
}

export async function issueFixedCadence(keyboard, text, phaseClock) {
  const schedule = keyboardSchedule(text)
  const commands = []
  const pending = []
  const originNodeMs = performance.now()
  for (const group of schedule) {
    const deadlineNodeMs = originNodeMs + group.offsetMs
    await waitUntil(deadlineNodeMs)
    for (const planned of group.commands) {
      const row = { ...planned, scheduledOffsetMs: group.offsetMs, deadlineNodeMs, status: 'pending' }
      commands.push(row)
      row.issueNodeMs = performance.now()
      try {
        const acknowledgement = keyboard[planned.action](planned.key)
        row.callReturnedNodeMs = performance.now()
        pending.push(Promise.resolve(acknowledgement).then(
          () => { row.status = 'fulfilled'; row.settledNodeMs = performance.now() },
          error => { row.status = 'rejected'; row.error = String(error); row.settledNodeMs = performance.now() },
        ))
      } catch (error) {
        row.callReturnedNodeMs = performance.now()
        row.status = 'rejected'
        row.error = String(error)
        row.settledNodeMs = row.callReturnedNodeMs
      }
      row.issueLatenessMs = row.issueNodeMs - deadlineNodeMs
      row.issueUpperBoundLatenessMs = row.callReturnedNodeMs - deadlineNodeMs
      row.browserIssueIntervalMs = [row.issueNodeMs + phaseClock.browserMinusNodeLowerMs, row.callReturnedNodeMs + phaseClock.browserMinusNodeUpperMs]
      row.browserScheduledIntervalMs = [deadlineNodeMs + phaseClock.browserMinusNodeLowerMs, deadlineNodeMs + phaseClock.browserMinusNodeUpperMs]
    }
  }
  const allIssuedNodeMs = performance.now()
  await Promise.all(pending)
  const maximumIssueLatenessMs = Math.max(...commands.map(command => command.issueUpperBoundLatenessMs))
  const errors = commands.filter(command => command.status !== 'fulfilled')
  const orderValid = commands.every((command, index) => command.sequence === index && (index === 0 || command.issueNodeMs >= commands[index - 1].callReturnedNodeMs))
  const noEarlyCommands = commands.every(command => command.issueNodeMs >= command.deadlineNodeMs)
  return {
    protocol: 'fixed-node-deadlines', diagnosticOnly: true, maySupportAcceptance: false,
    holdMs, maxIssueLatenessMs, originNodeMs, allIssuedNodeMs, allAcknowledgedNodeMs: performance.now(), phaseClock,
    expectedCommands: text.length * 2 + 2, commands,
    maximumIssueLatenessMs, dispatchErrors: errors, orderValid, noEarlyCommands,
    setupValid: errors.length === 0 && commands.length === text.length * 2 + 2 && orderValid && noEarlyCommands && maximumIssueLatenessMs <= maxIssueLatenessMs,
  }
}

export function validateFixedCadence(report, phase, originalValue, text) {
  assert.equal(report.commands.length, text.length * 2 + 2)
  const keys = phase.raw.events.filter(event => event.kind === 'fixedCadenceKey')
  const inputs = phase.raw.events.filter(event => event.kind === 'input')
  assert.equal(keys.length, report.commands.length, 'Every down/up command must reach the original input')
  assert.equal(inputs.length, text.length, 'Every scheduled ASCII key must produce one input event')
  for (const [index, key] of keys.entries()) {
    const command = report.commands[index]
    assert.equal(key.eventType, command.action === 'down' ? 'keydown' : 'keyup')
    assert.equal(key.key, command.key)
    assert.equal(key.trusted, true)
    assert.equal(key.repeat, false)
    for (const modifier of ['altKey','ctrlKey','metaKey','shiftKey']) assert.equal(key[modifier], false)
    command.browserKeyListenerTimeMs = key.t
    command.browserEventTimestampMs = key.eventTime
    command.issueToKeyListenerIntervalMs = [key.t - command.browserIssueIntervalMs[1], key.t - command.browserIssueIntervalMs[0]]
  }
  for (const [index, input] of inputs.entries()) {
    assert.equal(input.trusted, true)
    assert.equal(input.inputType, 'insertText')
    assert.equal(input.data, text[index])
    assert.equal(input.isComposing, false)
    assert.equal(input.selectionStart, input.value.length)
    assert.equal(input.selectionEnd, input.selectionStart)
    assert.equal(input.value, originalValue + text.slice(0, index + 1), `Input prefix ${index + 1} must be exact`)
    const command = report.commands[index * 2]
    assert.equal(command.action, 'down')
    const acknowledgement = phase.inputAcknowledgements[index]
    assert.equal(acknowledgement.inputTime, input.t)
    assert.equal(acknowledgement.sourceId, input.sourceId)
    assert.ok(acknowledgement.uploadedRead >= input.requiredRead)
    command.inputListenerTimeMs = input.t
    command.uploadTimeMs = acknowledgement.uploadTime
    command.issueToInputIntervalMs = [input.t - command.browserIssueIntervalMs[1], input.t - command.browserIssueIntervalMs[0]]
    command.issueToUploadIntervalMs = [acknowledgement.uploadTime - command.browserIssueIntervalMs[1], acknowledgement.uploadTime - command.browserIssueIntervalMs[0]]
  }
  const enter = report.commands.at(-2)
  const submit = phase.submitAcknowledgements[0]
  const submitEvent = phase.raw.events.find(event => event.kind === 'submit')
  assert.equal(submitEvent.value, originalValue + text)
  assert.ok(submitEvent.t >= inputs.at(-1).t)
  assert.equal(enter.action, 'down')
  assert.equal(enter.key, 'Enter')
  enter.submitListenerTimeMs = submit.interactionTime
  enter.submitUploadTimeMs = submit.uploadTime
  enter.issueToSubmitIntervalMs = [submit.interactionTime - enter.browserIssueIntervalMs[1], submit.interactionTime - enter.browserIssueIntervalMs[0]]
  enter.issueToSubmitUploadIntervalMs = [submit.uploadTime - enter.browserIssueIntervalMs[1], submit.uploadTime - enter.browserIssueIntervalMs[0]]
  report.observedTrustedKeyEvents = keys.length
  report.observedTrustedInputPrefixes = inputs.length
  report.domOrderAndPrefixesValid = true
}
