// Flight degraded-fallback check: board reorder, keyboard Move, drag drift, and reduced motion.

export async function checkDegradedFlight({ go, currentPage, centre, dragSteps, settle, sleep, note }) {
  await go('flight', '.l14-card')
  const page = currentPage()
  const order = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[data-col]')].map((col) => [
          col.dataset.col,
          [...col.querySelectorAll('.l14-card')].map((c) => c.dataset.card),
        ]),
      ),
    )
  const unchangedFlight = await order()
  for (const button of ['right', 'middle']) {
    const deletion = await centre('.l14-card .l14-del')
    await page.mouse.click(deletion.x, deletion.y, { button })
    const title = await centre('[data-col="queue"] .l14-card h3')
    await page.mouse.move(title.x, title.y)
    await page.mouse.down({ button })
    await page.mouse.move(title.x + 650, title.y + 100, { steps: 5 })
    await page.mouse.up({ button })
    if (JSON.stringify(await order()) !== JSON.stringify(unchangedFlight)) note(`flight: ${button} press deleted or moved a card`)
  }
  const moveCardId = unchangedFlight.queue[0]
  const moveSelector = `.l14-card[data-card="${moveCardId}"]`
  const originalNote = await page.$(`${moveSelector} .l14-note`)
  await originalNote.focus()
  await page.keyboard.type('Retain this note')
  await page.focus(`${moveSelector} .l14-move summary`)
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.type('t')
  await page.keyboard.press('Tab')
  await page.keyboard.type('5')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await page.waitForFunction(id => document.querySelector('[data-col="today"] .l14-slot:last-child .l14-card')?.dataset.card === id, {}, moveCardId)
  await page.waitForFunction(id => {
    const control = document.querySelector(`.l14-card[data-card="${id}"] .l14-move summary`)
    if (!control) return false
    const box = control.getBoundingClientRect()
    return control === document.activeElement && box.top >= 0 && box.bottom <= innerHeight && !control.closest('.l14-slot').getAnimations().some(animation => animation.playState === 'running')
  }, {}, moveCardId)
  if (!await page.$eval(`${moveSelector} .l14-move summary`, element => element === document.activeElement)) note('flight: keyboard move did not retain focus on the moved card')
  if (!await originalNote.evaluate(element => element.isConnected && element.value === 'Retain this note')) note('flight: keyboard move replaced or reset the note field')
  const announcement = await page.$eval('.l14 [role="status"]', element => element.textContent)
  if (!announcement.includes('Today') || !announcement.includes('5')) note(`flight: move result was not announced: ${announcement}`)
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Escape')
  if (!await page.$eval(`${moveSelector} .l14-move`, element => !element.open && document.activeElement === element.querySelector('summary'))) note('flight: Escape did not close Move and restore focus')
  await page.keyboard.press('Space')
  await page.click('[data-col="queue"] h2')
  if (await page.$eval(`${moveSelector} .l14-move`, element => element.open)) note('flight: outside press did not close Move')
  // The keyboard move's sibling slots can still animate after its destination is visible.
  await page.waitForFunction(() => ![...document.querySelectorAll('.l14-slot')].some(element => element.getAnimations().some(animation => animation.playState === 'running')))
  const flightBefore = await order()
  const held = flightBefore.queue[0]
  const grab = await page.evaluate(() => {
    const el = document.querySelector('[data-col="queue"] .l14-card h3')
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  const cardBox = await page.evaluate(() => {
    const r = document.querySelector('[data-col="queue"] .l14-card').getBoundingClientRect()
    return { left: Math.round(r.left), top: Math.round(r.top) }
  })
  const grabOffset = { x: grab.x - cardBox.left, y: grab.y - cardBox.top }
  const target = await page.evaluate(() => {
    const r = document.querySelector('[data-col="today"] ul').getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height * 0.55) }
  })
  await page.evaluate(() => {
    window.__degradedFlightPointerdown = null
    window.addEventListener('pointerdown', event => {
      const card = event.target instanceof Element ? event.target.closest('.l14-card') : null
      window.__degradedFlightPointerdown = {
        card: card?.dataset.card ?? null,
        x: event.clientX,
        y: event.clientY,
        box: card?.getBoundingClientRect().toJSON(),
        fonts: document.fonts.status,
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        scroll: document.querySelector('.l14').scrollTop,
        timelineTime: document.timeline.currentTime,
      }
    }, { capture: true, once: true })
  })
  const drift = []
  const carrySamples = []
  const midOrders = []
  await dragSteps(grab, target, 10, async (i, x, y) => {
    const at = await page.evaluate(
      (id) => {
        const el = document.querySelector(`.l14-card[data-card="${id}"]`)
        if (!el) return null
        const r = el.getBoundingClientRect()
        const slot = el.closest('.l14-slot')
        return {
          left: Math.round(r.left), top: Math.round(r.top), height: r.height,
          headingHeight: el.querySelector('h3').getBoundingClientRect().height,
          fonts: document.fonts.status,
          scroll: document.querySelector('.l14').scrollTop,
          cardTransform: getComputedStyle(el).transform,
          slotTransform: getComputedStyle(slot).transform,
          timelineTime: document.timeline.currentTime,
          observedAt: performance.now(),
        }
      },
      held,
    )
    if (!at) {
      drift.push(Infinity)
      return
    }
    const error = Math.hypot(x - at.left - grabOffset.x, y - at.top - grabOffset.y)
    drift.push(error)
    carrySamples.push({ step: i, pointer: { x, y }, drift: error, ...at })
    // Sampled BEFORE the release: committing the whole reorder on pointerup
    // produces the same final board while hiding a frozen drag.
    if (i < 10) midOrders.push(JSON.stringify(await order()))
  })
  const flightAfter = await order()
  const pointerdown = await page.evaluate(() => window.__degradedFlightPointerdown)
  if (pointerdown?.card !== held) note(`flight: carry pressed ${pointerdown?.card ?? 'no card'}, expected ${held}: ${JSON.stringify(pointerdown)}`)
  const cardIds = board => Object.values(board).flat().sort()
  if (JSON.stringify(cardIds(flightAfter)) !== JSON.stringify(cardIds(flightBefore))) {
    note('flight: carrying a card lost or duplicated a board item')
  }
  const start = JSON.stringify(flightBefore)
  if (start === JSON.stringify(flightAfter)) {
    note(`flight: a cross-column carry committed no reorder (${JSON.stringify(flightAfter)})`)
  }
  if (!flightAfter.today.includes(held)) {
    note(`flight: ${held} was carried into today and is not there (${JSON.stringify(flightAfter)})`)
  }
  if (!midOrders.some((sample) => sample !== start)) {
    note('flight: the board never reflowed under the hand — the reorder waited for the release')
  }
  const worstDrift = Math.max(...drift)
  if (!(worstDrift <= 4)) {
    note(`flight: the carried card left the hand — worst drift ${worstDrift.toFixed(1)}px; grab offset ${JSON.stringify(grabOffset)}; press ${JSON.stringify(pointerdown)}; samples ${JSON.stringify(carrySamples)}`)
  }
  const cardsBefore = await page.$$eval('.l14-card', (els) => els.length)
  const deleteAt = await centre('.l14-card [aria-label^="Delete"], .l14-card [data-nodrag] button')
  if (deleteAt) {
    await page.mouse.click(deleteAt.x, deleteAt.y)
    await sleep(600)
    const cardsAfter = await page.$$eval('.l14-card', (els) => els.length)
    if (cardsAfter !== cardsBefore - 1) {
      note(`flight: delete left ${cardsAfter} cards, expected ${cardsBefore - 1}`)
    }
  } else {
    note('flight: no delete control found')
  }
  await checkFlightMoveOverrideAndReducedMotion({ page, centre, settle, note })
}

async function checkFlightMoveOverrideAndReducedMotion({ page, centre, settle, note }) {
  for (const requestedCard of ['c1', 'c2']) {
    await page.reload({ waitUntil: 'load' })
    await page.waitForFunction(() => document.querySelectorAll('.l14-slot').length === 9)
    await page.evaluate(() => document.fonts.ready)
    for (let tab = 0; tab < 12; tab++) {
      await page.keyboard.press('Tab')
      if (await page.$eval(`.l14-card[data-card="${requestedCard}"] .l14-move summary`, element => element === document.activeElement)) break
    }
    if (!await page.$eval(`.l14-card[data-card="${requestedCard}"] .l14-move summary`, element => element === document.activeElement)) throw new Error(`flight: Tab did not reach ${requestedCard} Move`)
    const grabAt = await page.$eval('.l14-card[data-card="c1"] h3', element => {
      const box = element.getBoundingClientRect()
      return { x: box.left + 20, y: box.top + 20 }
    })
    await page.mouse.move(grabAt.x, grabAt.y)
    await page.mouse.down()
    await page.mouse.move(grabAt.x + 20, grabAt.y + 20, { steps: 3 })
    await page.keyboard.press('Space')
    await page.keyboard.press('Tab')
    await page.keyboard.type('t')
    await page.keyboard.press('Tab')
    await page.keyboard.type('5')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForFunction(id => document.querySelector('[data-col="today"] .l14-slot:last-child .l14-card')?.dataset.card === id, {}, requestedCard)
    const resting = await page.$eval('.l14-card[data-card="c1"]', element => {
      const card = element.getBoundingClientRect()
      const slot = element.closest('.l14-slot').getBoundingClientRect()
      return Math.hypot(card.left - slot.left, card.top - slot.top) < 1
    })
    if (!resting) note(`flight: Move for ${requestedCard} left the native carry under the pointer`)
    const committed = await page.$$eval('[data-col]', columns => columns.map(column => [...column.querySelectorAll('[data-card]')].map(card => card.dataset.card)))
    await page.mouse.move(grabAt.x + 50, grabAt.y + 20, { steps: 3 })
    await page.mouse.up()
    const afterPointer = await page.$$eval('[data-col]', columns => columns.map(column => [...column.querySelectorAll('[data-card]')].map(card => card.dataset.card)))
    if (JSON.stringify(committed) !== JSON.stringify(afterPointer)) note(`flight: pointer movement overrode Move for ${requestedCard}`)
  }
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])
  await page.reload({ waitUntil: 'load' })
  await page.waitForSelector('.l14[data-reduced-motion="true"] .l14-card')
  const reducedDelete = await centre('.l14-card .l14-del')
  await page.mouse.click(reducedDelete.x, reducedDelete.y)
  await page.waitForFunction(() => document.querySelectorAll('.l14-slot').length === 8)
  const reducedLayout = await page.evaluate(() => new Promise(resolve => {
    let frames = 0
    let moving = false
    const sample = () => {
      moving ||= [...document.querySelectorAll('.l14-slot')].some(element => element.getAnimations().some(animation => animation.playState === 'running'))
      if (++frames === 8) resolve(moving)
      else requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
  if (reducedLayout) note('flight: reduced-motion deletion animated layout')
  await settle('flight')
}
