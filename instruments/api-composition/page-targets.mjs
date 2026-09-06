import { tmpdir } from 'node:os'
// Real-browser focus, identity, local state, and cleanup across changing layout parents.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import puppeteer from 'puppeteer-core'
import { createServer } from 'vite'

const output = process.env.API_PROOF_OUTPUT ?? path.join(tmpdir(),'munari-api/evidence')
const server = await createServer({configFile:false,root:import.meta.dirname,server:{host:'127.0.0.1',port:0},esbuild:{jsx:'automatic'},logLevel:'warn'})
await server.listen()
const browser = await puppeteer.launch({defaultViewport:null,executablePath:process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true})
try {
  const page = await browser.newPage()
  await page.setViewport({width:1200,height:900})
  const errors = []
  page.on('pageerror', error => errors.push(String(error)))
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`,{waitUntil:'load'})
  await page.waitForSelector('#target-input')
  await page.evaluate(() => { window.originalTargetInput = document.querySelector('#target-input') })
  await page.click('#target-count')
  await page.focus('#target-input')
  await page.keyboard.press('End')
  await page.keyboard.type(' retained')
  for (let i=0;i<6;i++) {
    await page.click('#target-move')
    assert.deepEqual(await page.evaluate(() => ({
      original:document.querySelector('#target-input') === window.originalTargetInput,
      connected:window.originalTargetInput.isConnected,
      focused:document.activeElement === window.originalTargetInput,
      value:window.originalTargetInput.value,
      count:document.querySelector('#target-count').textContent,
      mounts:window.__pageTargets.mounts,
    })),{original:true,connected:true,focused:true,value:'Original retained',count:'Count 1',mounts:1})
  }
  await page.click('#target-attach')
  assert.equal(await page.$eval('#target-input', input => input.checkVisibility()),false)
  await page.click('#target-attach')
  assert.equal(await page.$eval('#target-input', input => input.checkVisibility() && input === window.originalTargetInput),true)
  await page.click('#target-unmount')
  assert.equal(await page.$('#target-input'),null)
  assert.deepEqual(await page.evaluate(() => window.__pageTargets),{mounts:1,unmounts:1})
  assert.deepEqual(errors,[])
  const result = {moves:6,sameElement:true,focusPreserved:true,localStatePreserved:true,missingTargetHidden:true,unmountedOnce:true,errors,browser:await browser.version()}
  await mkdir(output,{recursive:true})
  await writeFile(path.join(output,'page-targets.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally { await browser.close(); await server.close() }
