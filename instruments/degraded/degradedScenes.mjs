// Degraded-fallback checks for Genie, Knobs, Selection, and Logo.

export async function checkDegradedScenes({ go, currentPage, centre, dragSteps, settle, sleep, note }) {
  // ── genie: a window goes away, comes back, and can be moved ─────────────
  await go('genie', '.gen-sheet')
  let page = currentPage()
  const docked = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[aria-label]')]
        .filter((el) => / — on the desk$/.test(el.getAttribute('aria-label')))
        .map((el) => el.getAttribute('aria-label')),
    )
  const minimizeAt = await centre('[aria-label^="minimize "]')
  if (!minimizeAt) note('genie: no minimize control found')
  else {
    const win = await page.$eval('[aria-label^="minimize "]', element => element.closest('[data-win]').dataset.win)
    const visible = () => page.$eval(`.gen-slot[data-win="${win}"] .gen-sheet`, element => element.checkVisibility({ checkVisibilityCSS: true, checkOpacity: true }))
    if (!await visible()) note(`genie: ${win} was not visible before minimize`)
    const before = (await docked()).length
    await page.mouse.click(minimizeAt.x, minimizeAt.y)
    await sleep(900)
    const after = (await docked()).length
    if (after !== before - 1) {
      note(`genie: minimize left ${after} windows on the desk, expected ${before - 1}`)
    }
    if (await visible()) note(`genie: ${win} still paints its native sheet after minimize`)
    const restoreAt = await centre('[aria-label^="restore "]')
    if (!restoreAt) note('genie: minimizing produced no restorable bay')
    else {
      await page.mouse.click(restoreAt.x, restoreAt.y)
      await sleep(900)
      if ((await docked()).length !== before) {
        note('genie: restore did not bring the window back to the desk')
      }
      if (!await visible()) note(`genie: ${win} stayed hidden after restore`)
    }
  }
  // Identify the window by the titlebar grabbed, not the first `.gen-sheet` in DOM order.
  const bar = await page.evaluate(() => {
    const el = document.querySelector('.gen-titlebar')
    if (!el) return null
    const sheet = el.closest('.gen-sheet')
    if (!sheet) return null
    sheet.dataset.degradedProbe = 'true'
    const r = el.getBoundingClientRect()
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
  })
  if (!bar) note('genie: no titlebar found')
  else {
    const at = () =>
      page.evaluate(() =>
        Math.round(
          document.querySelector('[data-degraded-probe]').getBoundingClientRect().left,
        ),
      )
    const winBefore = await at()
    await dragSteps(bar, { x: bar.x + 140, y: bar.y - 10 }, 8)
    const winAfter = await at()
    if (Math.abs(winAfter - winBefore) < 20) {
      note(`genie: a titlebar drag moved the window ${winAfter - winBefore}px`)
    }
  }
  await settle('genie')

  // ── knobs: the panel can be carried and reflowed ────────────────────────
  await go('knobs', '.knb-handle')
  page = currentPage()
  const panelBox = () =>
    page.evaluate(() => {
      const r = document.querySelector('.knb-panel, .knb-page-degraded > *').getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width) }
    })
  const handleAt = await centre('.knb-handle')
  if (!handleAt) note('knobs: no carry handle found')
  else {
    const before = await panelBox()
    await dragSteps(handleAt, { x: handleAt.x + 120, y: handleAt.y + 60 }, 8)
    const after = await panelBox()
    const moved = Math.hypot(after.left - before.left, after.top - before.top)
    if (moved < 20) note(`knobs: the carry handle moved the panel ${moved.toFixed(1)}px`)
  }
  const gripAt = await centre('.knb-resize')
  if (!gripAt) note('knobs: no resize grip found')
  else {
    const before = await panelBox()
    await dragSteps(gripAt, { x: gripAt.x + 120, y: gripAt.y }, 8)
    const after = await panelBox()
    if (Math.abs(after.width - before.width) < 20) {
      note(`knobs: the resize grip changed the panel width by ${after.width - before.width}px`)
    }
  }
  await settle('knobs')

  // ── selection: the prose is still prose ─────────────────────────────────
  await go('selection', '.sel-prose')
  page = currentPage()
  const proseFrom = await page.evaluate(() => {
    const p = document.querySelector('.sel-prose p, .sel-prose')
    const r = p.getBoundingClientRect()
    return { x: Math.round(r.left + 8), y: Math.round(r.top + 12) }
  })
  await dragSteps(proseFrom, { x: proseFrom.x + 300, y: proseFrom.y + 40 }, 6)
  const selected = await page.evaluate(() => (window.getSelection()?.toString() ?? '').trim().length)
  if (selected < 5) note(`selection: a drag over the prose selected ${selected} characters`)
  await settle('selection')

  // ── logo: the scene does not offer the renderer it cannot run ──────────
  await go('logo', '.logo-word')
  page = currentPage()
  const logoPhase = await page.evaluate(() => document.querySelector('.logo-word').dataset.phase)
  if (logoPhase !== 'page') note(`logo: the word is not on the page ('${logoPhase}')`)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Tweaks').click())
  await page.waitForSelector('.m-panel')
  const offered = await page.$$eval('[data-renderer]', (els) =>
    els.map((el) => el.dataset.renderer),
  )
  if (offered.length) {
    note(`logo: the panel still offers a renderer choice degraded (${offered.join(', ')})`)
  }
  await settle('logo')
}
