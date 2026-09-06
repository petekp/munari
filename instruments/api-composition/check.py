import tempfile
import json
import os
import subprocess
from pathlib import Path
from png_pixel import pixel_at

url = os.environ.get('API_COMPOSITION_URL', 'http://127.0.0.1:5178')
session = os.environ.get('API_PROOF_SESSION', 'munari-api-v2')
output = Path(os.environ.get('API_PROOF_OUTPUT', str(Path(tempfile.gettempdir())/'munari-api/evidence')))
output.mkdir(parents=True, exist_ok=True)

def call(*args):
    result = subprocess.run(['agent-browser', '--session', session, '--json', *args], capture_output=True, text=True, timeout=20)
    data = json.loads(result.stdout)
    if result.returncode or not data['success']:
        raise RuntimeError(result.stdout + result.stderr)
    return data.get('data', {})

def evaluate(code):
    return call('eval', code).get('result')

def wait(condition):
    result = evaluate('''new Promise(resolve => {
      const began = performance.now();
      const check = () => {
        if (''' + condition + ''') resolve(true);
        else if (performance.now() - began > 8000) resolve(false);
        else setTimeout(check, 25);
      }; check();
    })''')
    if not result:
        raise AssertionError('Condition timed out: ' + condition)

call('open', url)
call('errors', '--clear')
wait('Boolean(window.__composition?.records.group)')
assert evaluate('Object.hasOwn(window.__composition.records.group,"isTransitioning")'), 'The fixture must load the current public API'
browser = evaluate('navigator.userAgent')
assert evaluate('typeof CanvasRenderingContext2D.prototype.drawElementImage === "function"')
evaluate('window.originals=Object.fromEntries([...document.querySelectorAll("[data-api-live] [data-content]")].map(node=>[node.dataset.content,node]))')

# An explicitly missing second mesh holds the whole group on the page.
call('fill', '[data-api-live] [data-content="first"] input', 'group edit')
call('click', '#group-toggle')
wait('window.__composition.records.group.requestedInScene')
evaluate('new Promise(resolve=>setTimeout(resolve,250))')
assert evaluate('window.__composition.records.group.presentation') == 'page'
assert evaluate('window.__composition.records.holds.length') == 0
call('click', '#group-ready')
wait('window.__composition.records.group.presentation === "scene" && !window.__composition.records.group.isTransitioning')
call('fill', '[data-api-live] [data-content="first"] input', 'edited in scene')
call('click', '#group-toggle')
wait('window.__composition.records.group.presentation === "page" && !window.__composition.records.group.isTransitioning')
assert evaluate('window.originals.first === document.querySelector("[data-api-live] [data-content=first]")')
assert evaluate('window.originals.first.querySelector("input").value') == 'edited in scene'

# Both views retain their original React and DOM instances across opposite landings.
call('fill', '[data-api-live] [data-content="view-a"] input', 'A keeps this')
call('click', '#transition-toggle')
wait('window.__composition.records.activePage === "b" && window.__composition.records.transition.presentation === "page"')
call('fill', '[data-api-live] [data-content="view-b"] input', 'B keeps this')
call('click', '[data-api-live] [data-content="view-b"] button')
call('screenshot', str(output / 'different-content-b.png'))
background = pixel_at(output / 'different-content-b.png', 8, 8)
assert background[:3] == [241,240,235], ('A raw capture bitmap is visible behind the page', background)
call('click', '#transition-toggle')
wait('window.__composition.records.activePage === "a" && window.__composition.records.transition.presentation === "page"')
assert evaluate('window.originals["view-a"].querySelector("input").value') == 'A keeps this'
assert evaluate('window.originals["view-b"].querySelector("input").value') == 'B keeps this'
assert evaluate('window.originals["view-b"].querySelector("button").textContent') == 'Count 1'
assert evaluate('Object.entries(window.originals).every(([id,node])=>document.querySelector(`[data-api-live] [data-content="${id}"]`)===node)')

# Cancellation reverses the blend, then hands back the original page.
evaluate('''window.cancelledAt=null; const watch=()=>{
  const r=window.__composition.records;
  if(r.transition.presentation==='scene' && r.blend>0.2 && r.blend<0.85){window.cancelledAt=r.blend;document.getElementById('transition-cancel').click()}
  else requestAnimationFrame(watch);
}; document.getElementById('transition-toggle').click();requestAnimationFrame(watch)''')
wait('window.cancelledAt !== null && window.__composition.records.transition.presentation === "page"')
assert evaluate('window.__composition.records.activePage') == 'a'

# A live source is attached late, edited, resized, removed, and replaced.
call('click', '#source-toggle')
wait('Boolean(window.__composition.records.samples.a && window.__composition.records.samples.b)')
initial = evaluate('window.__composition.records.samples.a')
evaluate('window.nativeCapture=document.getElementById("capture-original");window.nativeInput=window.nativeCapture.querySelector("input")')
call('fill', '#capture-original input', 'capture edit')
evaluate('window.nativeCapture.style.background="rgb(180,40,80)";window.nativeCapture.style.width="360px";window.nativeCapture.style.height="210px"')
wait('window.__composition.records.samples.a?.width === 360 && window.__composition.records.samples.a.pixel[0] === 180')
changed = evaluate('window.__composition.records.samples.a')
assert changed['sourceId'] == initial['sourceId']
assert evaluate('window.nativeCapture === document.getElementById("capture-original") && window.nativeInput === document.querySelector("#capture-original input")')
assert evaluate('document.querySelector("[data-api-capture] input")?.value') == 'capture edit'
assert evaluate('window.nativeCapture.inert') is False
call('click', '#consumer-toggle')
wait('window.__composition.capture().consumers === 1')
assert evaluate('window.__composition.records.samples.a.sourceId') == initial['sourceId']
call('click', '#source-toggle')
wait('window.__composition.records.samples.a === null && window.__composition.capture().status.status === "waiting"')
call('click', '#source-toggle')
wait('window.__composition.records.samples.a !== null')
restored = evaluate('window.__composition.records.samples.a.sourceId')
assert restored != initial['sourceId']
call('click', '#source-replace')
wait(f'window.__composition.records.samples.a?.sourceId !== {restored} && window.__composition.records.samples.a !== null')
assert evaluate('document.querySelector("#capture-original input").value') == 'source-1'

# The idle observation is a cost measurement, not a readiness timer.
evaluate('new Promise(resolve=>setTimeout(resolve,250))')
before = evaluate('window.__composition.capture().frame.revision')
evaluate('new Promise(resolve=>setTimeout(resolve,500))')
after = evaluate('window.__composition.capture().frame.revision')
assert before == after, (before, after)
result = evaluate('window.__composition.records')
assert evaluate('[...document.querySelectorAll("canvas")].filter(canvas=>canvas.layoutSubtree).every(canvas=>getComputedStyle(canvas).visibility === "hidden")')
assert result['errors'] == [], result['errors']
assert result['unmounts'] == {}, result['unmounts']
assert all(count == 1 for count in result['mounts'].values()), result['mounts']
result['browser'] = browser
result['idleRevisions'] = [before, after]
result['captureInitial'] = initial
result['captureAfterEdit'] = changed
result['pageBackgroundPixel'] = background
result['cancelledAt'] = evaluate('window.cancelledAt')
(output / 'composition.json').write_text(json.dumps(result, indent=2) + '\n')
call('screenshot', str(output / 'composition-complete.png'))
print(json.dumps({'mounts':result['mounts'],'unmounts':result['unmounts'],'errors':result['errors'],'holds':result['holds'],'idleRevisions':[before,after],'captureInitial':initial,'captureAfterEdit':changed,'cancelledAt':result['cancelledAt']}, indent=2))
